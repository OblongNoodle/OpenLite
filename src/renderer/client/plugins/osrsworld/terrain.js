// OSRS-style ground, built the way the RS client builds its scene
// (SceneGraph.buildScene in the 2009 client): geometry with a colour at every
// tile corner, no texture.
//
// - Underlay colours are blended: each tile takes the average colour of the
//   11x11 tiles around it, in HSL, with hue weighted by chroma. A tile's
//   corners take the blended colours around them, and the GPU shades
//   between corners, so underlays change smoothly from tile to tile.
// - Every tile corner gets a lightness from the slope of the land there, lit
//   from the same direction as models: 74 + (normal . light) / 214, which is
//   86 on flat ground. Where a map gives no heights, the client makes them up
//   with its height noise (PerlinNoise.getTileHeight): the land rolls a little
//   everywhere, so the light changes from corner to corner, and that is what
//   gives OSRS ground its mottled look. The game's land is nearly flat, so the
//   same noise is added for lighting only (the ground stays where it is).
// - Overlays (paths, floors) are one flat colour per tile, lit per corner,
//   and are tile shapes: full squares, plus the half of a grass tile cut
//   corner to corner where a path steps, so their edges are straight lines.
//
// The game gives us one painted colour per tile with roads already in it.
// Grass is underlay, as in OSRS maps; earth and stone (paths, dirt patches,
// floors) are overlays. OSRS maps mix several
// underlays (grass of a few shades); the game has one, so a gentle
// low-frequency variation is added in their place. The game's colours are
// also moved toward OSRS's palette (olive grass, brown earth).

// Underlay blending reaches this many tiles each way (the client uses 5).
const BLEND_RADIUS = 5;
// Passes of evening out path outlines (see smoothOutline).
const OUTLINE_PASSES = 2;
// Overlay tiles blend with similar overlay tiles this close by.
const OVERLAY_BLEND_RADIUS = 2;
const OVERLAY_SIMILARITY = 0.2;
// The client's light for terrain, as a direction toward the light in image
// space (x right, y up from the ground, z down the image), from its
// (-50, -10, -50) with RS axes converted.
const LIGHT = [-50, 10, 50];
// Corner lightness = 74 + (unit normal . light * 256) / 214 (client values);
// flat ground comes out at 86, which is treated as the tile's own colour.
const BASE_LIGHTNESS = 74;
const LIGHT_DIVISOR = 214;
const FLAT_LIGHTNESS = 86;
// RS units per tile, for converting our heights to the client's scale.
const RS_UNITS_PER_TILE = 128;
// Tiles below this alpha are holes in the ground (water shows through).
const HOLE_ALPHA = 130;
// The client's made-up heights: getTileHeight's 10-60 times 8 RS units.
const NOISE_HEIGHT_SCALE = 8;
// Underlay variation: hue and lightness drift over patches this many tiles
// across, by up to these amounts.
const VARIATION_SCALE = 6;
const VARIATION_HUE = 0.012;
const VARIATION_LIGHTNESS = 0.07;

// The client's height noise (PerlinNoise in the 2009 client): hashed values
// smoothed over their neighbours, cosine-interpolated, in three octaves.
const COSINE = Int32Array.from({ length: 2048 }, (_, i) => Math.trunc(Math.cos(i * 0.0030679615) * 65536));

function noiseAt(x, y) {
  const n = (y * 57 + x) | 0;
  const h = n ^ (n << 13);
  const result = (Math.imul(Math.imul(Math.imul(h, h), 15731) + 789221 | 0, h) + 1376312589) & 0x7fffffff;
  return (result >> 19) & 0xff;
}

function smoothNoise(x, y) {
  const corners = noiseAt(x - 1, y - 1) + noiseAt(x + 1, y - 1) + noiseAt(x - 1, y + 1) + noiseAt(x + 1, y + 1);
  const sides = noiseAt(x - 1, y) + noiseAt(x + 1, y) + noiseAt(x, y - 1) + noiseAt(x, y + 1);
  return Math.trunc(sides / 8) + Math.trunc(corners / 16) + Math.trunc(noiseAt(x, y) / 4);
}

function interpolate(a, b, t, scale) {
  const weight = (65536 - COSINE[Math.trunc((t * 1024) / scale)]) >> 1;
  return ((a * (65536 - weight)) >> 16) + ((b * weight) >> 16);
}

function interpolatedNoise(frequency, x, y) {
  const gridX = Math.trunc(x / frequency), gridY = Math.trunc(y / frequency);
  const fracX = x & (frequency - 1), fracY = y & (frequency - 1);
  const top = interpolate(smoothNoise(gridX, gridY), smoothNoise(gridX + 1, gridY), fracX, frequency);
  const bottom = interpolate(smoothNoise(gridX, gridY + 1), smoothNoise(gridX + 1, gridY + 1), fracX, frequency);
  return interpolate(top, bottom, fracY, frequency);
}

// Height (10-60) the client gives a tile corner with no height of its own;
// the scene builder calls it with these offsets from the world position.
function noiseHeight(worldX, worldY) {
  const x = worldX + 932731, y = worldY + 556238;
  let height = interpolatedNoise(4, y + 45365, x + 91923) + ((interpolatedNoise(2, y + 10294, x + 37821) - 128) >> 1) + ((interpolatedNoise(1, y, x) - 128) >> 2) - 128;
  height = Math.trunc(height * 0.3) + 35;
  return Math.min(60, Math.max(10, height));
}

// Moves the game's ground colours toward OSRS's palette, keeping their own
// light and dark: grass toward a lighter olive green, earth toward brown.
function osrsPalette([h, s, l], surface) {
  if (surface === "grass") return [h + (0.255 - h) * 0.6, 0.25 + s * 0.3, 0.18 + l * 0.5];
  if (surface === "earth") return [h + (0.08 - h) * 0.5, 0.2 + s * 0.35, 0.12 + l * 0.75];
  return [h, s * 0.5, l];
}

// Snaps a colour to the client's 16-bit HSL (64 hues, 8 saturations, 128
// lightnesses), decoded as its palette does (hue and saturation at the middle
// of their step). Neighbouring tiles land on different steps, which gives
// OSRS ground its small colour shifts from tile to tile.
function toHsl16(h, s, l) {
  const hue = Math.min(63, Math.max(0, Math.floor((((h % 1) + 1) % 1) * 64)));
  const saturation = Math.min(7, Math.max(0, Math.floor(s * 8)));
  const lightness = Math.min(127, Math.max(0, Math.floor(l * 128)));
  return [hue / 64 + 1 / 128, saturation / 8 + 1 / 16, lightness / 128];
}

// Which kind of surface a tile colour is: green is grass, near-grey is stone,
// the rest (browns, yellows) is earth.
function surfaceOf(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 0.07) return "stone";
  if (g >= r && g > b) return "grass";
  return "earth";
}

function hash(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

// Smooth noise in -1..1: random values on a grid, interpolated with a
// smoothstep between them.
function valueNoise(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const corner = (cx, cy) => hash(cx * 0.913 + 7.7, cy * 1.177 + 19.3) * 2 - 1;
  const top = corner(x0, y0) + (corner(x0 + 1, y0) - corner(x0, y0)) * sx;
  const bottom = corner(x0, y0 + 1) + (corner(x0 + 1, y0 + 1) - corner(x0, y0 + 1)) * sx;
  return top + (bottom - top) * sy;
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

// Reads an image's pixels.
export async function readImage(url) {
  const image = await createImageBitmap(await (await fetch(url)).blob());
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  return { pixels: context.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height };
}

// Ground geometry at a chosen resolution, laid out exactly as Babylon's
// CreateGroundFromHeightMap does (so UVs, picking and height lookups behave
// the same): a size x size square centred on the origin, `subdivisions` quads
// per side, heights read from the heightmap's brightness.
export async function buildTerrainGeometry(heightMapUrl, size, subdivisions, minHeight, maxHeight) {
  const heights = await readImage(heightMapUrl);
  const positions = [], uvs = [], indices = [];
  for (let row = 0; row <= subdivisions; row++) {
    for (let col = 0; col <= subdivisions; col++) {
      const x = col * size / subdivisions - size / 2;
      const z = (subdivisions - row) * size / subdivisions - size / 2;
      const mapX = Math.floor((x + size / 2) / size * (heights.width - 1));
      const mapY = Math.floor((1 - (z + size / 2) / size) * (heights.height - 1));
      const i = (mapY * heights.width + mapX) * 4;
      const brightness = (heights.pixels[i] * 0.3 + heights.pixels[i + 1] * 0.59 + heights.pixels[i + 2] * 0.11) / 255;
      positions.push(x, minHeight + (maxHeight - minHeight) * brightness, z);
      uvs.push(col / subdivisions, 1 - row / subdivisions);
    }
  }
  const stride = subdivisions + 1;
  for (let row = 0; row < subdivisions; row++) {
    for (let col = 0; col < subdivisions; col++) {
      indices.push(col + 1 + (row + 1) * stride, col + 1 + row * stride, col + row * stride);
      indices.push(col + (row + 1) * stride, col + 1 + (row + 1) * stride, col + row * stride);
    }
  }
  return { positions, uvs, indices };
}

// Blends tile colours the client's way: an average in HSL over the tiles
// within `radius` that `include` accepts, hue weighted by chroma. Returns
// [h, s, l] per tile (or null where nothing was included).
function blendTiles(tiles, tilesX, tilesY, radius, include) {
  const blended = new Array(tilesX * tilesY).fill(null);
  for (let y = 0; y < tilesY; y++) {
    for (let x = 0; x < tilesX; x++) {
      let hue = 0, saturation = 0, lightness = 0, chroma = 0, count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ty = y + dy;
        if (ty < 0 || ty >= tilesY) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const tx = x + dx;
          if (tx < 0 || tx >= tilesX || !include(ty * tilesX + tx, y * tilesX + x)) continue;
          const [h, s, l] = tiles[ty * tilesX + tx];
          const c = s * (1 - Math.abs(2 * l - 1));
          hue += h * c;
          chroma += c;
          saturation += s;
          lightness += l;
          count++;
        }
      }
      if (count) blended[y * tilesX + x] = [chroma > 0 ? hue / chroma : 0, saturation / count, lightness / count];
    }
  }
  return blended;
}

// Average of HSL colours, hue weighted by chroma (as the client blends).
function averageHsl(colorList) {
  let hue = 0, chroma = 0, saturation = 0, lightness = 0;
  for (const [h, s, l] of colorList) {
    const c = s * (1 - Math.abs(2 * l - 1));
    hue += h * c;
    chroma += c;
    saturation += s;
    lightness += l;
  }
  const count = colorList.length;
  return [chroma > 0 ? hue / chroma : 0, saturation / count, lightness / count];
}

// Evens out a path outline: a tile whose sides are three or four of the other
// kind joins them, which removes one-tile notches and bumps (OSRS paths have
// none); corner cuts then make the edges straight diagonals.
function smoothOutline(overlay, solid, tilesX, tilesY) {
  let current = overlay;
  for (let pass = 0; pass < OUTLINE_PASSES; pass++) {
    current = current.map((self, i) => {
      if (!solid[i]) return self;
      const x = i % tilesX, y = Math.floor(i / tilesX);
      let other = 0;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < tilesX && ny < tilesY && solid[ny * tilesX + nx] && current[ny * tilesX + nx] !== self) other++;
      }
      return other >= 3 ? !self : self;
    });
  }
  return current;
}

// Builds the OSRS-style ground for one map region.
//   colors: the game's ground colours, one pixel per tile ({ pixels, width, height }).
//   cornerPosition(cx, cy): [x, y, z] of a tile corner in the ground's space
//     (corner 0, 0 is the image's top-left).
//   worldOrigin: world tile coordinates of corner 0, 0 ({ x, y }, y growing
//     down the image), so the height noise lines up across regions.
//   tileVisibility: 0-1, strength of the height noise in the lighting (0.5
//     is the client's own), which makes the tiles more or less visible.
// Returns vertex data in the ground's space: positions, colors (RGBA), indices.
export function buildOsrsGround(colors, cornerPosition, worldOrigin, tileVisibility = 0.5) {
  const tilesX = colors.width, tilesY = colors.height;
  const cornersX = tilesX + 1;

  // Each tile's own colour (HSL), and which tiles are solid ground.
  const own = [], solid = [];
  for (let i = 0; i < tilesX * tilesY; i++) {
    const p = i * 4;
    solid.push(colors.pixels[p + 3] >= HOLE_ALPHA);
    own.push(rgbToHsl(colors.pixels[p] / 255, colors.pixels[p + 1] / 255, colors.pixels[p + 2] / 255));
  }
  // Surfaces are judged on the game's colours; blending uses OSRS's palette.
  const rgb = own.map((hsl) => hslToRgb(...hsl));
  const surfaces = rgb.map((color) => surfaceOf(...color));
  for (let i = 0; i < own.length; i++) own[i] = osrsPalette(own[i], surfaces[i]);
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // Grass is underlay; everything else is overlay. Colours come from the
  // tiles as the game painted them; the outline is then evened out.
  const painted = surfaces.map((surface, i) => solid[i] && surface !== "grass");
  const overlay = smoothOutline(painted, solid, tilesX, tilesY);

  // Underlays blend with underlays only (the client's 11x11); overlays blend a
  // little with nearby overlay tiles of a similar colour.
  const underlayBlend = blendTiles(own, tilesX, tilesY, BLEND_RADIUS, (i) => solid[i] && !painted[i]);
  const overlayBlend = blendTiles(own, tilesX, tilesY, OVERLAY_BLEND_RADIUS,
    (i, center) => solid[i] && painted[i] && distance(rgb[i], rgb[center]) < OVERLAY_SIMILARITY);

  // Colours at each tile corner, from the tiles around it: underlay (with the
  // gentle variation added) and overlay. Paths shade smoothly between
  // corners like grass does, while their edges stay crisp.
  const cornerUnder = new Array(cornersX * (tilesY + 1));
  const cornerOver = new Array(cornersX * (tilesY + 1));
  for (let cy = 0; cy <= tilesY; cy++) {
    for (let cx = 0; cx <= tilesX; cx++) {
      const unders = [], overs = [];
      for (const [x, y] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]) {
        if (x < 0 || y < 0 || x >= tilesX || y >= tilesY) continue;
        const i = y * tilesX + x;
        if (!solid[i]) continue;
        if (painted[i]) overs.push(overlayBlend[i] ?? own[i]);
        else if (underlayBlend[i]) unders.push(underlayBlend[i]);
      }
      const c = cy * cornersX + cx;
      if (overs.length) cornerOver[c] = averageHsl(overs);
      if (unders.length) {
        const [h, s, l] = averageHsl(unders);
        const hueShift = VARIATION_HUE * valueNoise(cx / VARIATION_SCALE + 31.4, cy / VARIATION_SCALE + 2.7);
        const lightShift = 1 + VARIATION_LIGHTNESS * valueNoise(cx / VARIATION_SCALE, cy / VARIATION_SCALE);
        cornerUnder[c] = [h + hueShift, s, l * lightShift];
      }
    }
  }

  // Corner lightness factors (1.0 on flat ground), from the slope of the
  // land plus the client's height noise.
  const noiseStrength = tileVisibility * 2;
  const heightAt = (cx, cy) => {
    const land = cornerPosition(Math.min(tilesX, Math.max(0, cx)), Math.min(tilesY, Math.max(0, cy)))[1] * RS_UNITS_PER_TILE;
    return land + noiseStrength * NOISE_HEIGHT_SCALE * noiseHeight(worldOrigin.x + cx, worldOrigin.y + cy);
  };
  const lightLength = Math.hypot(...LIGHT);
  const cornerLight = new Float32Array(cornersX * (tilesY + 1));
  for (let cy = 0; cy <= tilesY; cy++) {
    for (let cx = 0; cx <= tilesX; cx++) {
      const dx = heightAt(cx + 1, cy) - heightAt(cx - 1, cy);
      const dz = heightAt(cx, cy + 1) - heightAt(cx, cy - 1);
      // Unit normal of the slope over the two tiles either side (256 RS units).
      const length = Math.hypot(dx, 2 * RS_UNITS_PER_TILE, dz);
      const normal = [-dx / length, 2 * RS_UNITS_PER_TILE / length, -dz / length];
      const dot = normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2];
      // The client divides by 214 for its 71-unit light; scale for ours.
      const lightness = BASE_LIGHTNESS + (dot * 256 / lightLength * Math.hypot(50, 10, 50)) / LIGHT_DIVISOR;
      cornerLight[cy * cornersX + cx] = lightness / FLAT_LIGHTNESS;
    }
  }

  const positions = [], vertexColors = [];
  const vertex = ([cx, cy], hsl) => {
    positions.push(...cornerPosition(cx, cy));
    const light = cornerLight[cy * cornersX + cx];
    const [r, g, b] = hslToRgb(...toHsl16(hsl[0], hsl[1], Math.min(0.99, Math.max(0.01, hsl[2] * light))));
    vertexColors.push(r, g, b, 1);
  };
  // A triangle of overlay or underlay, coloured per corner (the other kind's
  // colour, then the tile's own, where a corner has none of its kind).
  const triangle = (corners, asOverlay, i) => {
    for (const [cx, cy] of corners) {
      const c = cy * cornersX + cx;
      vertex([cx, cy], (asOverlay ? cornerOver[c] ?? cornerUnder[c] : cornerUnder[c] ?? cornerOver[c]) ?? own[i]);
    }
  };

  const isOverlay = (x, y, self) => {
    if (x < 0 || y < 0 || x >= tilesX || y >= tilesY || !solid[y * tilesX + x]) return self;
    return overlay[y * tilesX + x];
  };
  // Each tile corner's half of a tile cut corner to corner, then the rest.
  const HALVES = {
    NW: (c) => [[c.NW, c.NE, c.SW], [c.NE, c.SE, c.SW]],
    SE: (c) => [[c.NE, c.SE, c.SW], [c.NW, c.NE, c.SW]],
    NE: (c) => [[c.NW, c.NE, c.SE], [c.NW, c.SE, c.SW]],
    SW: (c) => [[c.NW, c.SE, c.SW], [c.NW, c.NE, c.SE]]
  };
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const i = ty * tilesX + tx;
      if (!solid[i]) continue;
      const self = overlay[i];
      const corners = { NW: [tx, ty], NE: [tx + 1, ty], SW: [tx, ty + 1], SE: [tx + 1, ty + 1] };
      // Neighbours of the other kind, by side.
      const n = isOverlay(tx, ty - 1, self) !== self, s = isOverlay(tx, ty + 1, self) !== self;
      const w = isOverlay(tx - 1, ty, self) !== self, e = isOverlay(tx + 1, ty, self) !== self;
      // A grass tile with path on exactly two touching sides is cut corner to
      // corner and that corner's half is path, so a stepped path edge becomes
      // one straight diagonal. (Cutting path tiles too would leave two
      // diagonals a tile apart: a zigzag.)
      let corner = null;
      if (self) corner = null;
      else if (n && w && !s && !e) corner = "NW";
      else if (n && e && !s && !w) corner = "NE";
      else if (s && w && !n && !e) corner = "SW";
      else if (s && e && !n && !w) corner = "SE";
      if (!corner) {
        // Two triangles, split from the south-west corner to the north-east.
        triangle([corners.NW, corners.NE, corners.SW], self, i);
        triangle([corners.NE, corners.SE, corners.SW], self, i);
        continue;
      }
      const [cornerHalf, rest] = HALVES[corner](corners);
      triangle(cornerHalf, !self, i);
      triangle(rest, self, i);
    }
  }
  const indices = Array.from({ length: positions.length / 3 }, (_, k) => k);
  return { positions, colors: vertexColors, indices };
}
