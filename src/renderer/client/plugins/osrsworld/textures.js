// Converts the game's object textures (walls, roofs, trees, rocks...) into
// OSRS-style textures: low resolution, a small palette, a little extra
// contrast and saturation, and hard edges between pixels.

// Each texture is reduced by this factor, but never below MIN_SIZE pixels.
const DOWNSCALE = 2;
const MIN_SIZE = 16;
// Colours kept per texture.
const PALETTE_SIZE = 12;
const SATURATION = 1.18;
const CONTRAST = 1.12;
// Below this alpha a pixel is see-through (cutout edges stay hard, as in OSRS).
const ALPHA_CUTOFF = 128;

function adjust([r, g, b], mean) {
  // Contrast around the texture's mean brightness, then saturation around grey.
  let [cr, cg, cb] = [r, g, b].map((value) => mean + (value - mean) * CONTRAST);
  const grey = 0.3 * cr + 0.59 * cg + 0.11 * cb;
  [cr, cg, cb] = [cr, cg, cb].map((value) => grey + (value - grey) * SATURATION);
  return [cr, cg, cb].map((value) => Math.max(0, Math.min(255, value)));
}

// Picks up to `size` representative colours: the most common colours after
// coarse bucketing, each averaged over its bucket.
function buildPalette(colors, size) {
  const buckets = new Map();
  for (const [r, g, b] of colors) {
    const key = (r >> 5) << 6 | (g >> 5) << 3 | (b >> 5);
    const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, size)
    .map((bucket) => [bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count]);
}

function nearest(palette, [r, g, b]) {
  let best = palette[0], bestDistance = Infinity;
  for (const color of palette) {
    const distance = (color[0] - r) ** 2 + (color[1] - g) ** 2 + (color[2] - b) ** 2;
    if (distance < bestDistance) {
      best = color;
      bestDistance = distance;
    }
  }
  return best;
}

// pixels: RGBA rows as read from the texture. Returns a canvas in the same
// row order, ready to load with the original texture's settings.
export function osrsStyleTexture(pixels, width, height) {
  const outWidth = Math.max(MIN_SIZE, Math.round(width / DOWNSCALE));
  const outHeight = Math.max(MIN_SIZE, Math.round(height / DOWNSCALE));
  const blockW = width / outWidth, blockH = height / outHeight;

  // Box-filter down, keeping each output pixel's average colour and coverage.
  const reduced = [];
  let sum = 0, solidCount = 0;
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      let r = 0, g = 0, b = 0, a = 0, solid = 0, total = 0;
      for (let sy = Math.floor(y * blockH); sy < Math.max(Math.floor(y * blockH) + 1, Math.floor((y + 1) * blockH)); sy++) {
        for (let sx = Math.floor(x * blockW); sx < Math.max(Math.floor(x * blockW) + 1, Math.floor((x + 1) * blockW)); sx++) {
          const i = (Math.min(height - 1, sy) * width + Math.min(width - 1, sx)) * 4;
          total++;
          a += pixels[i + 3];
          if (pixels[i + 3] < ALPHA_CUTOFF) continue;
          solid++;
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
        }
      }
      const isSolid = a / total >= ALPHA_CUTOFF && solid > 0;
      const color = isSolid ? [r / solid, g / solid, b / solid] : null;
      if (color) {
        sum += 0.3 * color[0] + 0.59 * color[1] + 0.11 * color[2];
        solidCount++;
      }
      reduced.push(color);
    }
  }
  const mean = solidCount ? sum / solidCount : 128;
  const adjusted = reduced.map((color) => color && adjust(color, mean));
  const palette = buildPalette(adjusted.filter(Boolean), PALETTE_SIZE);

  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const context = canvas.getContext("2d");
  const output = context.createImageData(outWidth, outHeight);
  adjusted.forEach((color, p) => {
    const o = p * 4;
    if (!color || palette.length === 0) {
      output.data[o + 3] = 0;
      return;
    }
    const [r, g, b] = nearest(palette, color);
    output.data[o] = r;
    output.data[o + 1] = g;
    output.data[o + 2] = b;
    output.data[o + 3] = 255;
  });
  context.putImageData(output, 0, 0);
  return canvas;
}
