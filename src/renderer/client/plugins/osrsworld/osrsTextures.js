// Real OSRS textures, decoded from the player's local OSRS cache: texture
// definitions (index 9) name a palette sprite (index 8) holding the pixels.
// The sprite format is RuneLite's SpriteLoader (BSD-licensed).
const TEXTURE_INDEX = 9;
const SPRITE_INDEX = 8;
const FLAG_VERTICAL = 1;

// HighSpell texture file -> the OSRS texture that plays the same part.
export const OSRS_TEXTURE_FOR = new Map([
  ["15.png", 6], // red roof tiles
  ["11.png", 18], // yellow roof -> thatch
  ["14.png", 45], // stone wall -> stone bricks
  ["16.png", 43], // grey blocks -> stone slabs
  ["17.png", 43],
  ["0.png", 51], // light wood planks
  ["3.png", 0] // dark wood planks
]);

// Game textures with no single OSRS counterpart, built from OSRS textures.
// The game's timber wall (plaster with one big diagonal beam per tile)
// becomes an OSRS Tudor panel: plaster framed by wooden posts and rails,
// which repeats along a wall into the familiar grid.
const TIMBER_PANEL = {
  plaster: 47,
  wood: 16,
  // Beam widths as a share of the panel: posts at both sides, rails along
  // the top and bottom (half each, so stacked panels share one) and middle.
  post: 0.09,
  rail: 0.07,
  middleRail: 0.08
};
const COMPOSITE_TEXTURES = new Map([["26.png", timberPanel]]);

async function timberPanel() {
  const [plaster, wood] = await Promise.all([osrsTextureCanvas(TIMBER_PANEL.plaster), osrsTextureCanvas(TIMBER_PANEL.wood)]);
  if (!plaster || !wood) return null;
  const size = plaster.width;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = false;
  context.drawImage(plaster, 0, 0, size, size);
  // Rails take the wood as it lies (grain along them); posts take it turned.
  const rail = (y, height) => context.drawImage(wood, 0, 0, wood.width, wood.height * (height / size), 0, y, size, height);
  const post = (x, width) => {
    context.save();
    context.translate(x + width, 0);
    context.rotate(Math.PI / 2);
    context.drawImage(wood, 0, 0, wood.width, wood.height * (width / size), 0, 0, size, width);
    context.restore();
  };
  const postWidth = Math.round(size * TIMBER_PANEL.post / 2), railHeight = Math.round(size * TIMBER_PANEL.rail / 2);
  const middle = Math.round(size * TIMBER_PANEL.middleRail);
  rail(0, railHeight);
  rail(size - railHeight, railHeight);
  rail(Math.round(size / 2 - middle / 2), middle);
  post(0, postWidth);
  post(size - postWidth, postWidth);
  return canvas;
}

// The OSRS texture (a canvas) to draw in place of a game texture file, or
// null if it has none.
export async function osrsTextureForFile(file) {
  if (COMPOSITE_TEXTURES.has(file)) {
    if (!canvases.has(file)) canvases.set(file, COMPOSITE_TEXTURES.get(file)().catch(() => null));
    return canvases.get(file);
  }
  const id = OSRS_TEXTURE_FOR.get(file);
  return id === undefined ? null : osrsTextureCanvas(id);
}

// Textures the game's models use when their spec names none (from each
// model's .mtl file), by material name.
export const MODEL_DEFAULT_TEXTURES = new Map([
  ["roof2.obj", { Mat_0: "15.png" }],
  ["roof3.obj", { Mat_0: "14.png" }],
  ["roof4.obj", { Mat_0: "15.png" }],
  ["roof5.obj", { Mat_0: "26.png", Mat_1: "5.png" }],
  ["cylinder7x6.obj", { Mat_0: "14.png" }],
  ["castleledge1.obj", { Mat_0: "16.png" }]
]);

let spriteForTexture = null;
const canvases = new Map();

async function textureSprites() {
  if (!spriteForTexture) {
    spriteForTexture = (async () => {
      const opened = await window.osrsCache?.open();
      if (!opened?.ok) throw new Error(`OSRS cache unavailable: ${opened?.error ?? "no cache bridge"}`);
      const archives = await window.osrsCache.archives(TEXTURE_INDEX);
      const files = await window.osrsCache.files(TEXTURE_INDEX, archives[0].id ?? archives[0]);
      // Current caches (rev 233+) start each definition with its sprite id.
      return new Map(files.map((file) => [file.id, (file.data[0] << 8) | file.data[1]]));
    })();
  }
  return spriteForTexture;
}

// First frame of a sprite group as RGBA pixels (palette index 0 is clear).
function decodeSprite(bytes) {
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
  // Offsets, widths and heights are stored as one array per field.
  o += count * 4;
  const width = u16();
  o += (count - 1) * 2;
  const height = u16();
  o = n - 7 - count * 8 - (paletteLength - 1) * 3;
  const palette = [0];
  for (let i = 1; i < paletteLength; i++, o += 3) palette.push((bytes[o] << 16) | (bytes[o + 1] << 8) | bytes[o + 2]);
  o = 0;
  const flags = bytes[o++];
  const rgba = new Uint8ClampedArray(width * height * 4);
  const put = (pixel, index) => {
    const color = palette[index];
    rgba.set([(color >> 16) & 255, (color >> 8) & 255, color & 255, index ? 255 : 0], pixel * 4);
  };
  if (flags & FLAG_VERTICAL) {
    for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) put(y * width + x, bytes[o++]);
  } else {
    for (let i = 0; i < width * height; i++) put(i, bytes[o++]);
  }
  return { width, height, rgba };
}

// A canvas holding OSRS texture `id`, or null if the cache lacks it.
export async function osrsTextureCanvas(id) {
  if (!canvases.has(id)) {
    canvases.set(id, (async () => {
      const sprite = (await textureSprites()).get(id);
      if (sprite === undefined) return null;
      const files = await window.osrsCache.files(SPRITE_INDEX, sprite);
      if (!files?.length) return null;
      const { width, height, rgba } = decodeSprite(files[0].data);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").putImageData(new ImageData(rgba, width, height), 0, 0);
      return canvas;
    })().catch(() => null));
  }
  return canvases.get(id);
}
