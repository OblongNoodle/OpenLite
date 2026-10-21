// OSRS-style terrain painting.
//
// The game paints the ground from a texture with one pixel per tile. OSRS
// instead gives each tile corner a colour (the surrounding tiles blended, with
// a little noise for variation, lit by the slope of the land there) and
// shades each tile's two triangles between its corners. That gives smooth
// gradients that still show the tile grid. This module paints that look into
// a higher-resolution ground texture for the game's own terrain shader.

// Pixels per tile in the painted texture.
export const PIXELS_PER_TILE = 12;
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

// Brightness factor for one grain cluster.
function grainAt(surface, gx, gy) {
  const n = hash(gx * 1.37 + 11.1, gy * 0.71 + 3.3);
  const speck = hash(gx * 0.53 + 101.7, gy * 1.91 + 47.2);
  let factor = 1 + surface.grain * (n * 2 - 1);
  if (speck < surface.light[0]) factor *= surface.light[1];
  else if (speck > 1 - surface.dark[0]) factor *= surface.dark[1];
  return factor;
}
// Lightness variation from broad patches (fraction of the colour).
const PATCH_NOISE = 0.04;
// Tile visibility (0-1) controls two things that make the grid show:
// - a random lightness jitter at every corner, so each tile's two triangles
//   shade between slightly different corners;
// - how much of each tile's own flat colour is mixed into its gradient.
const MIN_CORNER_JITTER = 0.03;
const MAX_CORNER_JITTER = 0.16;
const MAX_TILE_MIX = 0.45;
// Wavelength of the broad patches, in tiles.
const NOISE_SCALE = 7;
// Direction the light comes from, in image space (x right, y up from the
// ground, z down the image). Roughly OSRS: from above, upper left.
const LIGHT = normalize([-0.45, 1, -0.35]);
// How strongly slopes brighten or darken, and the limits.
const SLOPE_LIGHTING = 0.9;
const MIN_LIGHT = 0.62;
const MAX_LIGHT = 1.22;
// Tiles below this alpha are holes in the ground (the shader discards them).
const HOLE_ALPHA = 130;

function normalize([x, y, z]) {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

function hash(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

// Smooth value noise in [-1, 1].
function valueNoise(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const top = hash(x0, y0) + (hash(x0 + 1, y0) - hash(x0, y0)) * sx;
  const bottom = hash(x0, y0 + 1) + (hash(x0 + 1, y0 + 1) - hash(x0, y0 + 1)) * sx;
  return (top + (bottom - top) * sy) * 2 - 1;
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

// Paints the OSRS-style ground for one map region.
//   textureUrl: the game's ground colours, one pixel per tile.
//   heightMapUrl: the region's heightmap (grey = height).
//   heightRange: world height of a white heightmap pixel.
//   tileVisibility: 0 (smooth gradients) to 1 (clearly separate tiles).
// Returns a canvas in the same orientation as the source texture.
export async function paintTerrain(textureUrl, heightMapUrl, heightRange, tileVisibility = 0.5) {
  const cornerJitter = MIN_CORNER_JITTER + (MAX_CORNER_JITTER - MIN_CORNER_JITTER) * tileVisibility;
  const tileMix = MAX_TILE_MIX * tileVisibility;
  const colors = await readImage(textureUrl);
  const heights = await readImage(heightMapUrl);
  const tilesX = colors.width, tilesY = colors.height;
  const tile = (x, y) => {
    const cx = Math.min(tilesX - 1, Math.max(0, x)), cy = Math.min(tilesY - 1, Math.max(0, y));
    return (cy * tilesX + cx) * 4;
  };

  // Height at a tile corner, sampled from the heightmap (which may have a
  // different resolution) with bilinear filtering.
  const heightAt = (cornerX, cornerY) => {
    const fx = cornerX / tilesX * (heights.width - 1), fy = cornerY / tilesY * (heights.height - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(heights.width - 1, x0 + 1), y1 = Math.min(heights.height - 1, y0 + 1);
    const at = (x, y) => heights.pixels[(y * heights.width + x) * 4] / 255 * heightRange;
    const tx = fx - x0, ty = fy - y0;
    const top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * tx;
    const bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * tx;
    return top + (bottom - top) * ty;
  };

  // Colour of every tile corner: the solid tiles touching it blended, then
  // varied by noise and lit by the slope.
  const cornersX = tilesX + 1, cornersY = tilesY + 1;
  const corners = new Float32Array(cornersX * cornersY * 3);
  const cornerLights = new Float32Array(cornersX * cornersY);
  for (let cy = 0; cy < cornersY; cy++) {
    for (let cx = 0; cx < cornersX; cx++) {
      let r = 0, g = 0, b = 0, count = 0;
      for (let dy = -1; dy <= 0; dy++) {
        for (let dx = -1; dx <= 0; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= tilesX || y >= tilesY) continue;
          const i = tile(x, y);
          if (colors.pixels[i + 3] < HOLE_ALPHA) continue;
          r += colors.pixels[i];
          g += colors.pixels[i + 1];
          b += colors.pixels[i + 2];
          count++;
        }
      }
      if (count === 0) continue;

      const noise = PATCH_NOISE * valueNoise(cx / NOISE_SCALE, cy / NOISE_SCALE) + cornerJitter * (hash(cx, cy) * 2 - 1);
      const dhx = (heightAt(cx + 1, cy) - heightAt(cx - 1, cy)) / 2;
      const dhz = (heightAt(cx, cy + 1) - heightAt(cx, cy - 1)) / 2;
      const normal = normalize([-dhx, 1, -dhz]);
      const facing = normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2];
      const slopeLight = 1 + (facing / LIGHT[1] - 1) * SLOPE_LIGHTING;
      const light = Math.min(MAX_LIGHT, Math.max(MIN_LIGHT, slopeLight)) * (1 + noise);

      cornerLights[cy * cornersX + cx] = light;
      const o = (cy * cornersX + cx) * 3;
      corners[o] = r / count / 255 * light;
      corners[o + 1] = g / count / 255 * light;
      corners[o + 2] = b / count / 255 * light;
    }
  }

  // Shade each tile's two triangles between its corner colours. The diagonal
  // runs from the tile's top-right to its bottom-left, as in OSRS.
  const size = PIXELS_PER_TILE;
  const canvas = document.createElement("canvas");
  canvas.width = tilesX * size;
  canvas.height = tilesY * size;
  const context = canvas.getContext("2d");
  const output = context.createImageData(canvas.width, canvas.height);
  const out = output.data;
  const corner = (cx, cy, channel) => corners[(cy * cornersX + cx) * 3 + channel];
  const lightAt = (cx, cy) => cornerLights[cy * cornersX + cx];
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const isHole = colors.pixels[tile(tx, ty) + 3] < HOLE_ALPHA;
      // The tile's own colour, lit like its corners on average.
      const tileLight = (lightAt(tx, ty) + lightAt(tx + 1, ty) + lightAt(tx, ty + 1) + lightAt(tx + 1, ty + 1)) / 4;
      const flat = [0, 1, 2].map((channel) => colors.pixels[tile(tx, ty) + channel] / 255 * tileLight);
      const t = tile(tx, ty);
      const surface = surfaceOf(colors.pixels[t] / 255, colors.pixels[t + 1] / 255, colors.pixels[t + 2] / 255);
      for (let py = 0; py < size; py++) {
        const v = (py + 0.5) / size;
        for (let px = 0; px < size; px++) {
          const u = (px + 0.5) / size;
          const o = ((ty * size + py) * canvas.width + tx * size + px) * 4;
          if (isHole) {
            out[o + 3] = 0;
            continue;
          }
          const grain = grainAt(surface, Math.floor((tx * size + px) / GRAIN_BLOCK), Math.floor((ty * size + py) / GRAIN_BLOCK));
          for (let channel = 0; channel < 3; channel++) {
            const topLeft = corner(tx, ty, channel), topRight = corner(tx + 1, ty, channel);
            const bottomLeft = corner(tx, ty + 1, channel), bottomRight = corner(tx + 1, ty + 1, channel);
            const gradient = u + v <= 1
              ? topLeft + (topRight - topLeft) * u + (bottomLeft - topLeft) * v
              : bottomRight + (bottomLeft - bottomRight) * (1 - u) + (topRight - bottomRight) * (1 - v);
            const value = (gradient + (flat[channel] - gradient) * tileMix) * grain;
            out[o + channel] = Math.max(0, Math.min(255, Math.round(value * 255)));
          }
          out[o + 3] = 255;
        }
      }
    }
  }
  context.putImageData(output, 0, 0);
  return canvas;
}
