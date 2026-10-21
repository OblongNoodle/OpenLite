// Reading colours and shapes out of the game's 2D sprite art.

const ASSET_MANIFEST_URL = "https://highspell.com:3002/assetsClient";

// Below this RGB distance (0-1 per channel) two sampled colours count as the same,
// e.g. a "beard" sample that is really just chin skin.
export const SAME_COLOR_DISTANCE = 0.12;
// Minimum distance between the colours picked for a palette.
export const PALETTE_DISTANCE = 0.22;
const MIN_SAMPLE_ALPHA = 100;

// Whether a cell's art is drawn see-through (typical opaque pixel well below
// full alpha), like ghosts.
export function isTranslucent(pixels) {
  let sum = 0, count = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < MIN_SAMPLE_ALPHA) continue;
    sum += pixels[i];
    count++;
  }
  return count > 0 && sum / count < 200;
}

export function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function shade(color, factor) {
  return [Math.min(1, color[0] * factor), Math.min(1, color[1] * factor), Math.min(1, color[2] * factor)];
}

// Opaque pixels of the given regions, grouped into 4-bit-per-channel buckets.
function bucketColors(pixels, width, regions, mask) {
  const buckets = new Map();
  for (const [x0, y0, x1, y1] of regions) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = y * width + x;
        if (mask && mask[p]) continue;
        const i = p * 4;
        // Low enough to include deliberately translucent art (ghosts are drawn
        // at half opacity) while skipping faint edge pixels.
        if (pixels[i + 3] < MIN_SAMPLE_ALPHA) continue;
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
        const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
        bucket.count++;
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
        buckets.set(key, bucket);
      }
    }
  }
  return [...buckets.values()];
}

const bucketColor = (bucket) => [bucket.r / bucket.count / 255, bucket.g / bucket.count / 255, bucket.b / bucket.count / 255];

// Dominant colour across regions of a cell. Art is shaded, so the single most
// common tone is often a shadow: among the common tones (at least half as
// frequent as the top one), take the brightest. Masked pixels are ignored.
export function sampleDominantColor(pixels, width, regions, mask = null) {
  const buckets = bucketColors(pixels, width, regions, mask);
  let maxCount = 0;
  for (const bucket of buckets) maxCount = Math.max(maxCount, bucket.count);
  let best = null, bestLuma = -1;
  for (const bucket of buckets) {
    if (bucket.count < maxCount * 0.5) continue;
    const luma = (0.3 * bucket.r + 0.59 * bucket.g + 0.11 * bucket.b) / bucket.count;
    if (luma > bestLuma) {
      best = bucket;
      bestLuma = luma;
    }
  }
  return best ? bucketColor(best) : null;
}

// Up to `count` clearly different colours of a whole cell, most common first.
export function samplePalette(pixels, width, height, count = 3) {
  const buckets = bucketColors(pixels, width, [[0, 0, width, height]], null).sort((a, b) => b.count - a.count);
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const palette = [];
  for (const bucket of buckets) {
    if (palette.length >= count) break;
    // Ignore specks (eyes, outlines) that cover almost nothing.
    if (bucket.count < total * 0.01) break;
    const color = bucketColor(bucket);
    if (palette.every((picked) => colorDistance(picked, color) > PALETTE_DISTANCE)) palette.push(color);
  }
  return palette;
}

export function opaqueFraction(pixels, width, [x0, y0, x1, y1]) {
  let opaque = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) if (pixels[(y * width + x) * 4 + 3] > 128) opaque++;
  }
  return opaque / ((x1 - x0) * (y1 - y0));
}

export function opaqueBounds(pixels, width, height) {
  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] > 128) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return maxY < 0 ? null : { minX, maxX, minY, maxY };
}

const imageCache = new Map();

export function loadImage(src) {
  let image = imageCache.get(src);
  if (!image) {
    if (imageCache.size > 64) imageCache.clear();
    image = new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = src;
    });
    imageCache.set(src, image);
    image.catch(() => imageCache.delete(src));
  }
  return image;
}

export function readCell(image, cellX, cellY, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, cellX, cellY, width, height, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

// One cell of a game spritesheet, addressed by its cell index.
export async function readSpritesheetCell(spritesheetInfo, index) {
  const image = await loadImage(spritesheetInfo.SpritesheetURL);
  const width = spritesheetInfo.SpriteWidth, height = spritesheetInfo.SpriteHeight;
  const columns = spritesheetInfo.SpritesheetColumns;
  return {
    pixels: readCell(image, (index % columns) * width, Math.floor(index / columns) * height, width, height),
    width,
    height
  };
}

// The game's equipment art (one PNG per layer), fetched once from the same
// asset pack the game client uses. Equipment sheets hold two sprites per row of
// 15 cells; cell 0 of a sprite is its front-facing idle frame.
export class AppearanceArt {
  static CELL_WIDTH = 64;
  static CELL_HEIGHT = 128;
  static CELLS_PER_SPRITE = 15;
  static SPRITES_PER_ROW = 2;
  static images = null;
  static loading = null;

  static load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const manifest = await (await fetch(ASSET_MANIFEST_URL)).json();
      const files = await (await fetch(manifest.data.files.gameAssets.appearance)).json();
      this.images = new Map(files.map(({ filename, data }) => [filename.split("/").pop(), data]));
    })().catch((error) => {
      console.error("[Models3D] Failed to load appearance art", error);
      this.loading = null;
    });
    return this.loading;
  }

  // Front idle cell of one sprite in a layer, or null if the art is missing.
  static async getSpriteCell(layer, spritesheetId, spriteId) {
    await this.load();
    const data = this.images?.get(`${layer}${spritesheetId + 1}.png`);
    if (!data || spriteId < 0) return null;
    const image = await loadImage(data);
    const cellX = (spriteId % this.SPRITES_PER_ROW) * this.CELLS_PER_SPRITE * this.CELL_WIDTH;
    const cellY = Math.floor(spriteId / this.SPRITES_PER_ROW) * this.CELL_HEIGHT;
    return readCell(image, cellX, cellY, this.CELL_WIDTH, this.CELL_HEIGHT);
  }
}
