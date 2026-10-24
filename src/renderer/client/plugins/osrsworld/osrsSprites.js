// OSRS interface sprites from the player's local OSRS cache, as data URLs.

const SPRITE_INDEX = 8;
const FLAG_VERTICAL = 1, FLAG_ALPHA = 2;

// First frame of a sprite group as a data URL; `inset` trims that many
// pixels off every edge (for tiling a sprite without its border).
export function spriteUrl(bytes, inset = 0) {
  const n = bytes.length;
  const count = (bytes[n - 2] << 8) | bytes[n - 1];
  let o = n - 7 - count * 8;
  const u16 = () => {
    const value = (bytes[o] << 8) | bytes[o + 1];
    o += 2;
    return value;
  };
  u16();
  u16();
  const paletteLength = bytes[o++] + 1;
  o += count * 4;
  const width = u16();
  o += (count - 1) * 2;
  const height = u16();
  o = n - 7 - count * 8 - (paletteLength - 1) * 3;
  const palette = [0];
  for (let i = 1; i < paletteLength; i++, o += 3) palette.push((bytes[o] << 16) | (bytes[o + 1] << 8) | bytes[o + 2]);
  o = 0;
  const flags = bytes[o++];
  const size = width * height;
  const read = (target) => {
    if (flags & FLAG_VERTICAL) {
      for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) target[y * width + x] = bytes[o++];
    } else {
      for (let i = 0; i < size; i++) target[i] = bytes[o++];
    }
  };
  const indices = new Uint8Array(size);
  read(indices);
  const alpha = new Uint8Array(size).fill(255);
  if (flags & FLAG_ALPHA) read(alpha);
  const rgba = new Uint8ClampedArray(size * 4);
  for (let p = 0; p < size; p++) {
    const color = palette[indices[p]];
    rgba.set([(color >> 16) & 255, (color >> 8) & 255, color & 255, indices[p] ? alpha[p] : 0], p * 4);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width - 2 * inset;
  canvas.height = height - 2 * inset;
  canvas.getContext("2d").putImageData(new ImageData(rgba, width, height), -inset, -inset);
  return canvas.toDataURL();
}

// Data URLs by sprite id; `insets` gives the trim for any that need it.
export async function loadSprites(ids, insets = {}) {
  const urls = {};
  await Promise.all(ids.map(async (id) => {
    const files = await window.osrsCache.files(SPRITE_INDEX, id);
    if (files?.length) urls[id] = spriteUrl(files[0].data, insets[id] ?? 0);
  }));
  return urls;
}
