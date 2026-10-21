// OSRS-style terrain, following how the RS client builds its ground
// (SceneGraph.buildScene in the 2009 client):
//
// - Underlay colours are blended: each tile takes the average colour of the
//   11x11 tiles around it, in HSL, with hue weighted by chroma. Each tile has
//   one blended colour.
// - Every tile corner gets a lightness from the slope of the land there, lit
//   from the same direction as models: 74 + (normal . light) / 214, which is
//   86 on flat ground.
// - Each tile is drawn as two triangles (split from its south-west to its
//   north-east corner) shading its colour between its corners' lightness.
// - Overlays (paths, floors) are not blended and keep crisp edges.
//
// The game gives us one painted colour per tile with roads already in it, so
// tiles that stand out from their blended surroundings are treated as
// overlays and keep their own colour. The result is painted into a
// higher-resolution ground texture for the game's own terrain shader.

// Pixels per tile in the painted texture.
export const PIXELS_PER_TILE = 12;
// Underlay blending reaches this many tiles each way (the client uses 5).
const BLEND_RADIUS = 5;
// A tile further than this (RGB, 0-1 per channel) from its blended colour is
// treated as an overlay and keeps its own colour.
const OVERLAY_DISTANCE = 0.13;
// Overlay tiles blend with similar overlay tiles this close by.
const OVERLAY_BLEND_RADIUS = 2;
const OVERLAY_SIMILARITY = 0.2;
// The client's light for terrain, as a direction toward the light in image
// space (x right, y up from the ground, z down the image), from its
// (-50, -10, -50) with RS axes converted.
const LIGHT = [-50, 10, 50];
// Corner lightness = 74 + (unit normal . light * 256) / 214 (client values);
// flat ground comes out at 86, which is treated as the texture's own colour.
const BASE_LIGHTNESS = 74;
const LIGHT_DIVISOR = 214;
const FLAT_LIGHTNESS = 86;
// RS units per tile, for converting our heights to the client's scale.
const RS_UNITS_PER_TILE = 128;
// Tiles below this alpha are holes in the ground (the shader discards them).
const HOLE_ALPHA = 130;

// Surface grain is applied in square clusters of this many pixels, so it
// reads as pixel-art texture rather than fine noise.
const GRAIN_BLOCK = 3;
// Per surface: overall grain strength, and the chance and brightness of
// lighter and darker specks (grass blades, pebbles).
const SURFACES = {
  grass: { grain: 0.035, light: [0.04, 1.07], dark: [0.025, 0.91] },
  earth: { grain: 0.035, light: [0.015, 1.07], dark: [0.03, 0.86] },
  stone: { grain: 0.03, light: [0.015, 1.06], dark: [0.02, 0.88] }
};

// Which surface a tile colour is: green is grass, near-grey is stone, the rest
// (browns, yellows) is earth.
function surfaceOf(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 0.07) return SURFACES.stone;
  if (g >= r && g > b) return SURFACES.grass;
  return SURFACES.earth;
}

function hash(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

// Brightness factor for one grain cluster.
function grainAt(surface, gx, gy) {
  const n = hash(gx * 1.37 + 11.1, gy * 0.71 + 3.3);
  const speck = hash(gx * 0.53 + 101.7, gy * 1.91 + 47.2);
  let factor = 1 + surface.grain * (n * 2 - 1);
  if (speck < surface.light[0]) factor *= surface.light[1];
  else if (speck > 1 - surface.dark[0]) factor *= surface.dark[1];
  return factor;
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

async function readImage(url) {
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = reject;
    element.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
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

// Paints the OSRS-style ground for one map region.
//   textureUrl: the game's ground colours, one pixel per tile.
//   heightMapUrl: the region's heightmap (grey = height).
//   heightRange: world height of a white heightmap pixel.
//   tileVisibility: 0-1, a random lightness jitter per corner on top of the
//     client's lighting, to make the tile grid more or less visible.
// Returns a canvas in the same orientation as the source texture.
export async function paintTerrain(textureUrl, heightMapUrl, heightRange, tileVisibility = 0.5) {
  const colors = await readImage(textureUrl);
  const heights = await readImage(heightMapUrl);
  const tilesX = colors.width, tilesY = colors.height;
  const at = (x, y) => (Math.min(tilesY - 1, Math.max(0, y)) * tilesX + Math.min(tilesX - 1, Math.max(0, x))) * 4;

  // Each tile's own colour (HSL), and which tiles are solid ground.
  const own = [], solid = [];
  for (let i = 0; i < tilesX * tilesY; i++) {
    const p = i * 4;
    solid.push(colors.pixels[p + 3] >= HOLE_ALPHA);
    own.push(rgbToHsl(colors.pixels[p] / 255, colors.pixels[p + 1] / 255, colors.pixels[p + 2] / 255));
  }
  const rgb = own.map((hsl) => hslToRgb(...hsl));
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // Tiles that clearly stand out from their surroundings are overlays (paths,
  // dirt patches, floors).
  const surroundings = blendTiles(own, tilesX, tilesY, BLEND_RADIUS, (i) => solid[i]);
  const overlay = own.map((_, i) => solid[i] && !!surroundings[i] && distance(rgb[i], hslToRgb(...surroundings[i])) > OVERLAY_DISTANCE);

  // Underlays blend with underlays only (the client's 11x11); overlays blend a
  // little with nearby overlay tiles of a similar colour, so a path is one
  // even colour with crisp edges against the grass.
  const underlayBlend = blendTiles(own, tilesX, tilesY, BLEND_RADIUS, (i) => solid[i] && !overlay[i]);
  const overlayBlend = blendTiles(own, tilesX, tilesY, OVERLAY_BLEND_RADIUS,
    (i, center) => solid[i] && overlay[i] && distance(rgb[i], rgb[center]) < OVERLAY_SIMILARITY);
  const tileColor = own.map((hsl, i) => (overlay[i] ? overlayBlend[i] : underlayBlend[i]) ?? hsl);

  // Shaped overlay edges, in the spirit of the client's diagonal tile shapes:
  // each tile corner scores how many of the four tiles around it are overlay,
  // the score is interpolated across each tile, and pixels above one half are
  // overlay. Edges then run along diagonals and gentle curves, not steps.
  const isOverlay = (x, y) => x >= 0 && y >= 0 && x < tilesX && y < tilesY && overlay[y * tilesX + x];
  const cornerScore = new Float32Array((tilesX + 1) * (tilesY + 1));
  for (let cy = 0; cy <= tilesY; cy++) {
    for (let cx = 0; cx <= tilesX; cx++) {
      let count = 0, total = 0;
      for (const [x, y] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]) {
        if (x < 0 || y < 0 || x >= tilesX || y >= tilesY) continue;
        total++;
        if (overlay[y * tilesX + x]) count++;
      }
      cornerScore[cy * (tilesX + 1) + cx] = total ? count / total : 0;
    }
  }
  // Each tile's overlay and underlay colours: its own for its own side, and
  // for the other side the nearest neighbour's (or the blended underlay).
  const neighbours = [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  const sideColors = own.map((_, i) => {
    const x = i % tilesX, y = Math.floor(i / tilesX);
    if (!overlay[i]) {
      const near = neighbours.find(([dx, dy]) => isOverlay(x + dx, y + dy));
      return { under: tileColor[i], over: near ? tileColor[(y + near[1]) * tilesX + x + near[0]] : tileColor[i] };
    }
    return { over: tileColor[i], under: underlayBlend[i] ?? tileColor[i] };
  });

  // Height at a tile corner in RS units, from the heightmap.
  const heightAt = (cornerX, cornerY) => {
    const fx = Math.min(heights.width - 1, Math.max(0, cornerX / tilesX * (heights.width - 1)));
    const fy = Math.min(heights.height - 1, Math.max(0, cornerY / tilesY * (heights.height - 1)));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(heights.width - 1, x0 + 1), y1 = Math.min(heights.height - 1, y0 + 1);
    const value = (x, y) => heights.pixels[(y * heights.width + x) * 4] / 255 * heightRange;
    const tx = fx - x0, ty = fy - y0;
    const top = value(x0, y0) + (value(x1, y0) - value(x0, y0)) * tx;
    const bottom = value(x0, y1) + (value(x1, y1) - value(x0, y1)) * tx;
    return (top + (bottom - top) * ty) * RS_UNITS_PER_TILE;
  };

  // Corner lightness factors (1.0 on flat ground), from the slope.
  const lightLength = Math.hypot(...LIGHT);
  const cornersX = tilesX + 1, cornersY = tilesY + 1;
  const cornerLight = new Float32Array(cornersX * cornersY);
  const jitter = 0.1 * tileVisibility;
  for (let cy = 0; cy < cornersY; cy++) {
    for (let cx = 0; cx < cornersX; cx++) {
      const dx = heightAt(cx + 1, cy) - heightAt(cx - 1, cy);
      const dz = heightAt(cx, cy + 1) - heightAt(cx, cy - 1);
      // Unit normal of the slope over the two tiles either side (256 RS units).
      const length = Math.hypot(dx, 2 * RS_UNITS_PER_TILE, dz);
      const normal = [-dx / length, 2 * RS_UNITS_PER_TILE / length, -dz / length];
      const dot = normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2];
      // The client divides by 214 for its 71-unit light; scale for ours.
      const lightness = BASE_LIGHTNESS + (dot * 256 / lightLength * Math.hypot(50, 10, 50)) / LIGHT_DIVISOR;
      cornerLight[cy * cornersX + cx] = lightness / FLAT_LIGHTNESS * (1 + jitter * (hash(cx, cy) * 2 - 1));
    }
  }

  // Shade each tile's two triangles: its colour, lightness interpolated
  // between corners, split from the south-west corner to the north-east.
  const size = PIXELS_PER_TILE;
  const canvas = document.createElement("canvas");
  canvas.width = tilesX * size;
  canvas.height = tilesY * size;
  const context = canvas.getContext("2d");
  const output = context.createImageData(canvas.width, canvas.height);
  const out = output.data;
  const lightAt = (cx, cy) => cornerLight[cy * cornersX + cx];
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const index = ty * tilesX + tx;
      const sides = sideColors[index];
      const score = (cx, cy) => cornerScore[cy * (tilesX + 1) + cx];
      const s00 = score(tx, ty), s10 = score(tx + 1, ty), s01 = score(tx, ty + 1), s11 = score(tx + 1, ty + 1);
      // Ties go to the tile's own side.
      const bias = overlay[index] ? 0.001 : -0.001;
      const p = at(tx, ty);
      const surface = surfaceOf(colors.pixels[p] / 255, colors.pixels[p + 1] / 255, colors.pixels[p + 2] / 255);
      const topLeft = lightAt(tx, ty), topRight = lightAt(tx + 1, ty);
      const bottomLeft = lightAt(tx, ty + 1), bottomRight = lightAt(tx + 1, ty + 1);
      for (let py = 0; py < size; py++) {
        const v = (py + 0.5) / size;
        for (let px = 0; px < size; px++) {
          const u = (px + 0.5) / size;
          const o = ((ty * size + py) * canvas.width + tx * size + px) * 4;
          if (!solid[index]) {
            out[o + 3] = 0;
            continue;
          }
          const light = u + v <= 1
            ? topLeft + (topRight - topLeft) * u + (bottomLeft - topLeft) * v
            : bottomRight + (bottomLeft - bottomRight) * (1 - u) + (topRight - bottomRight) * (1 - v);
          const grain = grainAt(surface, Math.floor((tx * size + px) / GRAIN_BLOCK), Math.floor((ty * size + py) / GRAIN_BLOCK));
          const overlayAmount = (s00 * (1 - u) + s10 * u) * (1 - v) + (s01 * (1 - u) + s11 * u) * v + bias;
          const [h, s, l] = overlayAmount > 0.5 ? sides.over : sides.under;
          const [r, g, b] = hslToRgb(h, s, Math.min(0.99, Math.max(0.01, l * light * grain)));
          out[o] = Math.round(r * 255);
          out[o + 1] = Math.round(g * 255);
          out[o + 2] = Math.round(b * 255);
          out[o + 3] = 255;
        }
      }
    }
  }
  context.putImageData(output, 0, 0);
  return canvas;
}
