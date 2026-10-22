// OSRS-style ground, built the way the RS client builds its scene
// (SceneGraph.buildScene in the 2009 client): geometry with a colour at every
// tile corner, no texture.
//
// - Underlay colours are blended: each tile takes the average colour of the
//   11x11 tiles around it, in HSL, with hue weighted by chroma. That one
//   colour is the whole tile's: all four corners share it and only their
//   lightness differs (SceneGraph.setTile gets the same colour four times).
//   So the ground is a fine mosaic of tile colours with smooth light and
//   shade over it, not a smooth blend of colours.
// - Every tile corner gets a lightness from the slope of the land there, lit
//   from the same direction as models: 74 + (normal . light) / 214, which is
//   86 on flat ground. Where a map gives no heights, the client makes them up
//   with its height noise (PerlinNoise.getTileHeight): the land rolls a little
//   everywhere, so the light changes from corner to corner, and that is what
//   gives OSRS ground its mottled look. The game's land is nearly flat, so the
//   same noise is added for lighting only (the ground stays where it is).
// - Overlays (paths, floors) are one colour per tile too, lit per corner;
//   stone overlays carry an OSRS texture instead (lit per corner, as the
//   client lights textured tiles). They have crisp edges and are tile
//   shapes: full squares, plus the half of a grass tile cut
//   corner to corner where a path steps, so their edges are straight lines.
//
// OSRS maps are hand-shaded: grass wears to brown-green beside paths, darkens
// under trees, greys around rocks, grows lush by water. Here rules do that:
// each tile is tinted toward the colour of the features near it, fading out
// with distance (see FEATURE_TINTS).
//
// The game gives us one painted colour per tile with roads already in it.
// Grass is underlay, as in OSRS maps; earth and stone (paths, dirt patches,
// floors) are overlays. OSRS maps mix many underlays (grass of several
// shades, dirt creeping in) and blending them gives the ground its gradual
// build-ups of colour; the game has one grass, so layered noise over the
// world stands in for them. The game's colours are also moved toward OSRS's
// muted palette (grey-olive grass, olive-brown paths).

// Underlay blending reaches this many tiles each way (the client uses 5).
const BLEND_RADIUS = 5;
// Passes of evening out path outlines (see smoothOutline).
const OUTLINE_PASSES = 2;
// Overlay tiles blend with similar overlay tiles this close by: an OSRS path
// is one overlay type, one colour, where the game paints each tile its own.
const OVERLAY_BLEND_RADIUS = 4;
const OVERLAY_SIMILARITY = 0.3;
// The client's light for terrain, as a direction toward the light in image
// space (x right, y up from the ground, z down the image), from its
// (-50, -10, -50) with RS axes converted.
const LIGHT = [-50, 10, 50];
// Corner lightness = 74 + (unit normal . light * 256) / 214 (client values);
// flat ground comes out at 86, which is treated as the tile's own colour.
const BASE_LIGHTNESS = 74;
const LIGHT_DIVISOR = 214;
const FLAT_LIGHTNESS = 86;
// Corner lightness factors are kept in this range: the game cuts ponds and
// rivers as near-vertical drops, far steeper than OSRS land, and the
// formula would light the far side of such a bank black.
const MIN_LIGHT = 0.55;
const MAX_LIGHT = 1.35;
// RS units per tile, for converting our heights to the client's scale.
const RS_UNITS_PER_TILE = 128;
// Tiles below this alpha are holes in the game's ground (water shows
// through); ours has a bed there, this colour where nothing borders it.
const HOLE_ALPHA = 130;
const WATER_BED = [0.09, 0.3, 0.26];
// How far below the water surface beds are kept, in tiles.
const BED_DEPTH = 0.3;
// Grey ground lower than this above the water is bank, not paving.
const BANK_HEIGHT = 0.75;
// OSRS texture on stone overlays (paving), and the lightness of a textured
// tile on flat ground (the texture carries the colour).
export const STONE_TEXTURE = 43;
const TEXTURED_LIGHTNESS = 0.82;
// The client's made-up heights: getTileHeight's 10-60 times 8 RS units.
const NOISE_HEIGHT_SCALE = 8;
// Height noise in the lighting per unit of tile visibility (0-1); the
// default 0.5 gives 70% of the client's own, which reads closer to OSRS on
// the game's softer colours.
const NOISE_STRENGTH = 1.4;
// Underlay variation, standing in for OSRS's mixed underlays: layers of noise
// over the world, each { scale in tiles, and how far it moves hue,
// saturation (factor) and lightness (factor) }.
const VARIATION_LAYERS = [
  { scale: 23, hue: -0.025, saturation: 0.3, lightness: 0.1 }, // yellow-green to green
  { scale: 11, hue: 0.01, saturation: -0.35, lightness: 0.08 }, // grey-green to rich green
  { scale: 5, hue: 0, saturation: 0.1, lightness: 0.08 } // lighter and darker patches
];
// Each tile's own small nudge (hue, saturation factor, lightness factor), as
// a mix of underlays gives OSRS tiles: tiles near a step of the client's
// 16-bit colour land either side of it, so every shade between gets used.
const TILE_JITTER = { hue: 0.006, saturation: 0.09, lightness: 0.025 };
// Grass near features, by feature: how far the tint reaches (tiles) and what
// it does at full strength (hue moved toward `hue` by `hueMix`, saturation
// and lightness multiplied). Strength fades from 1 beside the feature to 0
// at `reach`.
const FEATURE_TINTS = {
  path: { reach: 4, hue: 0.16, hueMix: 0.45, saturation: 1.1, lightness: 0.97 }, // worn, brown-green
  tree: { reach: 3, hue: 0.27, hueMix: 0.25, saturation: 1.15, lightness: 0.88 }, // shaded, rich green
  rock: { reach: 2.5, hue: 0.21, hueMix: 0.2, saturation: 0.78, lightness: 0.97 }, // grey-green
  water: { reach: 3, hue: 0.28, hueMix: 0.4, saturation: 1.25, lightness: 0.9 }, // lush, deep green
  building: { reach: 2, hue: 0.2, hueMix: 0.2, saturation: 0.75, lightness: 0.9 } // trodden, greyer
};
// Dirt creeping into grass: where its noise (scale in tiles) is above `from`,
// grass mixes toward this colour, by up to `amount`.
const DIRT_PATCHES = { scale: 13, from: 0.25, to: 0.85, amount: 0.5, color: [0.13, 0.3, 0.31] };

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
// Targets measured from OSRS: grass around hue 0.23, saturation 0.2-0.25,
// lightness 0.34; dirt paths olive-brown, hue 0.14, saturation 0.3,
// lightness 0.33.
function osrsPalette([h, s, l], surface) {
  if (surface === "grass") return [h + (0.235 - h) * 0.85, 0.12 + s * 0.15, 0.22 + l * 0.45];
  if (surface === "earth") return [h + (0.13 - h) * 0.7, 0.18 + s * 0.25, 0.12 + l * 0.55];
  return [h, s * 0.4, l];
}

function mixHsl(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Distance in tiles (1 beside, diagonal 1.41) from each tile to the nearest
// seed tile, out to `reach` (Infinity beyond): a two-pass chamfer transform.
function distanceField(seeds, tilesX, tilesY, reach) {
  const field = new Float32Array(tilesX * tilesY).fill(Infinity);
  for (const i of seeds) field[i] = 0;
  const relax = (i, j, step) => {
    if (field[j] + step < field[i]) field[i] = field[j] + step;
  };
  for (let y = 0; y < tilesY; y++) {
    for (let x = 0; x < tilesX; x++) {
      const i = y * tilesX + x;
      if (x > 0) relax(i, i - 1, 1);
      if (y > 0) {
        relax(i, i - tilesX, 1);
        if (x > 0) relax(i, i - tilesX - 1, Math.SQRT2);
        if (x < tilesX - 1) relax(i, i - tilesX + 1, Math.SQRT2);
      }
    }
  }
  for (let y = tilesY - 1; y >= 0; y--) {
    for (let x = tilesX - 1; x >= 0; x--) {
      const i = y * tilesX + x;
      if (x < tilesX - 1) relax(i, i + 1, 1);
      if (y < tilesY - 1) {
        relax(i, i + tilesX, 1);
        if (x < tilesX - 1) relax(i, i + tilesX + 1, Math.SQRT2);
        if (x > 0) relax(i, i + tilesX - 1, Math.SQRT2);
      }
    }
  }
  return field.map((d) => (d > reach ? Infinity : d));
}

// A colour tinted toward a feature's, by strength 0-1.
function tint([h, s, l], feature, strength) {
  return [
    h + (feature.hue - h) * feature.hueMix * strength,
    s * (1 + (feature.saturation - 1) * strength),
    l * (1 + (feature.lightness - 1) * strength)
  ];
}

// An underlay colour with the world's variation at a world position, and
// the tile's own nudge.
function varyUnderlay([h, s, l], wx, wy) {
  const jitter = (salt) => hash(Math.floor(wx) * 1.31 + salt, Math.floor(wy) * 0.77 - salt) * 2 - 1;
  h += TILE_JITTER.hue * jitter(3.1);
  s *= 1 + TILE_JITTER.saturation * jitter(7.3);
  l *= 1 + TILE_JITTER.lightness * jitter(11.9);
  for (const [k, layer] of VARIATION_LAYERS.entries()) {
    const n = valueNoise(wx / layer.scale + 17.3 * (k + 1), wy / layer.scale + 5.9 * (k + 1));
    h += layer.hue * n;
    s *= 1 + layer.saturation * n;
    l *= 1 + layer.lightness * n;
  }
  const dirt = (valueNoise(wx / DIRT_PATCHES.scale + 71.1, wy / DIRT_PATCHES.scale + 33.7) - DIRT_PATCHES.from) / (DIRT_PATCHES.to - DIRT_PATCHES.from);
  const t = Math.min(1, Math.max(0, dirt));
  return mixHsl([h, s, l], DIRT_PATCHES.color, t * t * (3 - 2 * t) * DIRT_PATCHES.amount);
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

// Each tile's surface ("grass", "earth", "stone"), or null for holes, from the
// game's ground colours ({ pixels, width, height }, one pixel per tile).
export function tileSurfaces(colors) {
  return Array.from({ length: colors.width * colors.height }, (_, i) => {
    const p = i * 4;
    if (colors.pixels[p + 3] < HOLE_ALPHA) return null;
    return surfaceOf(colors.pixels[p] / 255, colors.pixels[p + 1] / 255, colors.pixels[p + 2] / 255);
  });
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
//   tileVisibility: 0-1, strength of the height noise in the lighting (see
//     NOISE_STRENGTH), which makes the tiles more or less visible.
//   waterLevel: height of the water surface in the ground's space, if any.
//   features: tile indices of objects that tint the grass around them
//     ({ tree, rock, building }: arrays); paths and water come from the map.
// Returns vertex data in the ground's space (positions, colors as RGBA,
// indices), and the same plus uvs for the textured part (textured).
export function buildOsrsGround(colors, cornerPosition, worldOrigin, tileVisibility = 0.5, waterLevel = null, features = {}) {
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
  // Corners around water: the game cuts its beds far below the water, and
  // their square corners stick out past the round water surface as pits, so
  // the bed is raised to just under the water (OSRS pond margins are mud).
  const touchesWater = (cx, cy) => [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]
    .some(([x, y]) => x >= 0 && y >= 0 && x < tilesX && y < tilesY && !solid[y * tilesX + x]);
  const positionAt = (cx, cy) => {
    const position = cornerPosition(cx, cy);
    if (waterLevel !== null && touchesWater(cx, cy)) position[1] = Math.max(position[1], waterLevel - BED_DEPTH);
    return position;
  };
  const rgb = own.map((hsl) => hslToRgb(...hsl));
  // Grey around and at the level of water is the game's pond and river beds
  // and banks: mud, not paving.
  const nearWater = (i) => {
    const x = i % tilesX, y = Math.floor(i / tilesX);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < tilesX && ny < tilesY && !solid[ny * tilesX + nx]) return true;
      }
    }
    if (waterLevel === null) return false;
    const lowest = Math.min(...[[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]].map(([cx, cy]) => cornerPosition(cx, cy)[1]));
    return lowest < waterLevel + BANK_HEIGHT;
  };
  const surfaces = rgb.map((color, i) => {
    const surface = surfaceOf(...color);
    return surface === "stone" && nearWater(i) ? "earth" : surface;
  });
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

  // Each tile's colours: its blended underlay (with the world's variation)
  // and, for paths, its overlay. A path tile the outline smoothing added
  // takes the colour of the path around it.
  // Distances to the features that tint grass: paths and water from the
  // map, objects from `features`.
  const seeds = {
    path: painted.flatMap((isPath, i) => (isPath && surfaces[i] === "earth" ? [i] : [])),
    water: solid.flatMap((isSolid, i) => (isSolid ? [] : [i])),
    tree: features.tree ?? [],
    rock: features.rock ?? [],
    building: features.building ?? []
  };
  const distances = Object.fromEntries(Object.entries(FEATURE_TINTS).map(([name, feature]) => [name, distanceField(seeds[name], tilesX, tilesY, feature.reach)]));
  const underColor = own.map((hsl, i) => {
    const x = i % tilesX, y = Math.floor(i / tilesX);
    let color = underlayBlend[i] ?? hsl;
    for (const [name, feature] of Object.entries(FEATURE_TINTS)) {
      const d = distances[name][i];
      if (d === Infinity) continue;
      // Full strength on and beside the feature, fading out to `reach`.
      const t = Math.min(1, Math.max(0, (feature.reach - d) / (feature.reach - 1)));
      color = tint(color, feature, t * t * (3 - 2 * t));
    }
    return varyUnderlay(color, worldOrigin.x + x + 0.5, worldOrigin.y + y + 0.5);
  });
  const overColor = own.map((hsl, i) => {
    if (painted[i]) return overlayBlend[i] ?? hsl;
    const x = i % tilesX, y = Math.floor(i / tilesX), around = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < tilesX && ny < tilesY && painted[ny * tilesX + nx]) around.push(overlayBlend[ny * tilesX + nx] ?? own[ny * tilesX + nx]);
      }
    }
    return around.length ? averageHsl(around) : hsl;
  });

  // Corner lightness factors (1.0 on flat ground), from the slope of the
  // land plus the client's height noise.
  const noiseStrength = tileVisibility * NOISE_STRENGTH;
  const heightAt = (cx, cy) => {
    const land = positionAt(Math.min(tilesX, Math.max(0, cx)), Math.min(tilesY, Math.max(0, cy)))[1] * RS_UNITS_PER_TILE;
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
      cornerLight[cy * cornersX + cx] = Math.min(MAX_LIGHT, Math.max(MIN_LIGHT, lightness / FLAT_LIGHTNESS));
    }
  }

  const plain = { positions: [], colors: [] };
  const textured = { positions: [], colors: [], uvs: [] };
  const vertex = ([cx, cy], hsl) => {
    plain.positions.push(...positionAt(cx, cy));
    const light = cornerLight[cy * cornersX + cx];
    const [r, g, b] = hslToRgb(...toHsl16(hsl[0], hsl[1], Math.min(0.99, Math.max(0.01, hsl[2] * light))));
    plain.colors.push(r, g, b, 1);
  };
  // Textured corners carry only the light; the texture repeats once per tile.
  const texturedVertex = ([cx, cy]) => {
    textured.positions.push(...positionAt(cx, cy));
    const light = Math.min(1, TEXTURED_LIGHTNESS * cornerLight[cy * cornersX + cx]);
    textured.colors.push(light, light, light, 1);
    textured.uvs.push(worldOrigin.x + cx, worldOrigin.y + cy);
  };
  const stone = (i) => i >= 0 && i < surfaces.length && painted[i] && surfaces[i] === "stone";
  // A triangle in one colour, lit per corner. Stone overlay is textured.
  const triangle = (corners, color, textured = false) => {
    for (const corner of corners) (textured ? texturedVertex(corner) : vertex(corner, color));
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
      const corners = { NW: [tx, ty], NE: [tx + 1, ty], SW: [tx, ty + 1], SE: [tx + 1, ty + 1] };
      if (!solid[i]) {
        // Water: the ground goes on under it as a bed (the water plane covers
        // it), so sloping banks show earth rather than a gap.
        const bed = underlayBlend[i] ?? WATER_BED;
        triangle([corners.NW, corners.NE, corners.SW], bed);
        triangle([corners.NE, corners.SE, corners.SW], bed);
        continue;
      }
      const self = overlay[i];
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
      const ownColor = self ? overColor[i] : underColor[i];
      if (!corner) {
        // Two triangles, split from the south-west corner to the north-east.
        triangle([corners.NW, corners.NE, corners.SW], ownColor, self && stone(i));
        triangle([corners.NE, corners.SE, corners.SW], ownColor, self && stone(i));
        continue;
      }
      // The corner half is path from the tile beside it (north or south).
      const beside = (ty + (corner[0] === "N" ? -1 : 1)) * tilesX + tx;
      const [cornerHalf, rest] = HALVES[corner](corners);
      triangle(cornerHalf, overColor[beside], stone(beside));
      triangle(rest, ownColor);
    }
  }
  const indices = (data) => Array.from({ length: data.positions.length / 3 }, (_, k) => k);
  return {
    positions: plain.positions, colors: plain.colors, indices: indices(plain),
    textured: { ...textured, indices: indices(textured), textureId: STONE_TEXTURE }
  };
}
