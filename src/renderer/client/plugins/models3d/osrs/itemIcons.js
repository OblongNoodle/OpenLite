// OSRS inventory icons, drawn the way the client draws them
// (Inv.renderObjectSprite in the 2009 client): the item's inventory model,
// recoloured and lit, turned and placed by the item's own zoom, angles and
// offsets, projected into a 36x32 sprite around (16, 16), then given a
// one-pixel black outline and a dark drop shadow.
import { rsColorToRgb } from "./player.js";
import { lightness, mergeTextured } from "./locs.js";
import { osrsTextureCanvas } from "../../osrsworld/osrsTextures.js";

const CONFIG_INDEX = 2;
const ITEM_ARCHIVE = 10;
const WIDTH = 36, HEIGHT = 32, CENTRE_X = 16, CENTRE_Y = 16;
// The client's 2048-step sine and cosine tables (16.16 fixed point).
const SINE = Int32Array.from({ length: 2048 }, (_, i) => Math.trunc(Math.sin(i * 0.0030679615) * 65536));
const COSINE = Int32Array.from({ length: 2048 }, (_, i) => Math.trunc(Math.cos(i * 0.0030679615) * 65536));
// Outline and shadow colours (Inv.getObjectSprite's state 1 and shadow).
const OUTLINE = [0, 0, 1];
const SHADOW = [0x30, 0x20, 0x20];

// Item definitions for icons: name, inventory model, its 2D view and
// recolours. Other fields are read past (as ObjType.decode).
function decodeIconItem(id, bytes) {
  let o = 0;
  const u8 = () => bytes[o++];
  const s8 = () => (bytes[o++] << 24) >> 24;
  const u16 = () => ((bytes[o++] << 8) | bytes[o++]);
  const s16 = () => (u16() << 16) >> 16;
  const s32 = () => ((bytes[o++] << 24) | (bytes[o++] << 16) | (bytes[o++] << 8) | bytes[o++]);
  const str = () => {
    let text = "";
    while (bytes[o] !== 0) text += String.fromCharCode(bytes[o++]);
    o++;
    return text;
  };
  const item = {
    id, name: "", model: -1, zoom2d: 2000, xan2d: 0, yan2d: 0, zan2d: 0, xof2d: 0, yof2d: 0,
    recolorFind: [], recolorReplace: [], retextureFind: [], retextureReplace: [],
    resizeX: 128, resizeY: 128, resizeZ: 128, ambient: 0, contrast: 0, certTemplate: -1
  };
  for (let opcode = u8(); opcode !== 0 && o < bytes.length; opcode = u8()) {
    if (opcode === 1) item.model = u16();
    else if (opcode === 2) item.name = str();
    else if (opcode === 3 || opcode === 9 || (opcode >= 30 && opcode < 40)) str();
    else if (opcode === 4) item.zoom2d = u16();
    else if (opcode === 5) item.xan2d = u16();
    else if (opcode === 6) item.yan2d = u16();
    else if (opcode === 7) item.xof2d = s16();
    else if (opcode === 8) item.yof2d = s16();
    else if (opcode === 11 || opcode === 15 || opcode === 16 || opcode === 65 || opcode === 160 || opcode === 251) continue;
    // Current caches give the inventory model as an int (opcode 44).
    else if (opcode === 44) item.model = s32();
    else if (opcode === 12 || opcode === 46 || opcode === 47 || (opcode >= 49 && opcode <= 54)) s32();
    else if (opcode === 13 || opcode === 14 || opcode === 27 || opcode === 42 || opcode === 113 || opcode === 114 || opcode === 115) {
      const value = opcode === 115 ? u8() : s8();
      if (opcode === 113) item.ambient = value;
      if (opcode === 114) item.contrast = value * 5;
    } else if (opcode === 23 || opcode === 25) o += 3;
    else if (opcode === 24 || opcode === 26 || opcode === 78 || opcode === 79 || (opcode >= 90 && opcode <= 99) || opcode === 139 || opcode === 140 || opcode === 148 || opcode === 149) {
      const value = u16();
      if (opcode === 95) item.zan2d = value;
      if (opcode === 98) item.certTemplate = value;
    } else if (opcode === 40 || opcode === 41) {
      const count = u8();
      const [find, replace] = opcode === 40 ? [item.recolorFind, item.recolorReplace] : [item.retextureFind, item.retextureReplace];
      for (let i = 0; i < count; i++) {
        find.push(u16());
        replace.push(u16());
      }
    } else if (opcode === 43) {
      u8();
      while (u8() !== 0) str();
    } else if (opcode === 45) o += 5;
    else if (opcode === 48) o += 5;
    else if (opcode === 75) s16();
    else if (opcode >= 100 && opcode < 110) o += 4;
    else if (opcode >= 110 && opcode <= 112) {
      const value = u16();
      if (opcode === 110) item.resizeX = value;
      else if (opcode === 111) item.resizeY = value;
      else item.resizeZ = value;
    } else if (opcode === 161) o += u16() * 2;
    else if (opcode === 249) {
      const count = u8();
      for (let i = 0; i < count; i++) {
        const isString = u8() === 1;
        o += 3;
        if (isString) str();
        else s32();
      }
    } else break;
  }
  return item;
}

let itemsByName = null;

// Unnoted OSRS items with an inventory model, by lower-case name.
async function itemIndex() {
  if (!itemsByName) {
    itemsByName = window.osrsCache.files(CONFIG_INDEX, ITEM_ARCHIVE).then((files) => {
      const byName = new Map();
      for (const file of files ?? []) {
        try {
          const item = decodeIconItem(file.id, file.data);
          const key = item.name.toLowerCase();
          if (item.name && item.model >= 0 && item.certTemplate === -1 && !byName.has(key)) byName.set(key, item);
        } catch {
          // Items using fields not decoded here are simply unavailable.
        }
      }
      return byName;
    });
  }
  return itemsByName;
}

// The average colour of an OSRS texture, for textured faces of icons.
const textureColors = new Map();
function textureColor(id) {
  if (!textureColors.has(id)) {
    textureColors.set(id, osrsTextureCanvas(id).then((canvas) => {
      if (!canvas) return [0.5, 0.5, 0.5];
      const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
      const sum = [0, 0, 0];
      let count = 0;
      for (let p = 0; p < data.length; p += 4) {
        if (!data[p + 3]) continue;
        for (let k = 0; k < 3; k++) sum[k] += data[p + k];
        count++;
      }
      return sum.map((value) => (count ? value / count / 255 : 0.5));
    }));
  }
  return textureColors.get(id);
}

// Fills a triangle with colours shaded between its corners, where nearer
// faces drawn later cover it.
function fillTriangle(pixels, [ax, ay, bx, by, cx, cy], colors) {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(WIDTH - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(HEIGHT - 1, Math.ceil(Math.max(ay, by, cy)));
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (Math.abs(area) < 1e-6) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area;
      const w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const o = (y * WIDTH + x) * 4;
      for (let k = 0; k < 3; k++) pixels[o + k] = Math.round(255 * Math.min(1, colors[0][k] * w0 + colors[1][k] * w1 + colors[2][k] * w2));
      pixels[o + 3] = 255;
    }
  }
}

// The icon for an item (a data URL), or null if OSRS has no such item.
async function renderIcon(cache, item) {
  const model = await cache.model(item.model);
  if (!model) return null;
  const data = mergeTextured([model]);
  item.recolorFind.forEach((color, i) => {
    for (let f = 0; f < data.colors.length; f++) if (data.colors[f] === color) data.colors[f] = item.recolorReplace[i];
  });
  item.retextureFind.forEach((texture, i) => {
    for (let f = 0; f < data.textures.length; f++) if (data.textures[f] === texture) data.textures[f] = item.retextureReplace[i];
  });
  const lit = lightness(data, 64 + item.ambient, 768 + item.contrast);
  const xs = data.vertexX.map((x) => (x * item.resizeX) >> 7);
  const ys = data.vertexY.map((y) => (y * item.resizeY) >> 7);
  const zs = data.vertexZ.map((z) => (z * item.resizeZ) >> 7);

  // SoftwareModel.setCamera: roll, then yaw, then the offsets, then pitch.
  const zoom = item.zoom2d;
  const pitchSin = (SINE[item.xan2d] * zoom) >> 16, pitchCos = (COSINE[item.xan2d] * zoom) >> 16;
  const minY = Math.min(...ys);
  const offsetX = item.xof2d, offsetY = pitchSin + item.yof2d - Math.trunc(minY / 2), offsetZ = item.yof2d + pitchCos;
  const sinYaw = SINE[item.yan2d], cosYaw = COSINE[item.yan2d], sinRoll = SINE[item.zan2d], cosRoll = COSINE[item.zan2d];
  const sinPitch = SINE[item.xan2d], cosPitch = COSINE[item.xan2d];
  const screen = [], depth = [];
  for (let v = 0; v < xs.length; v++) {
    let x = xs[v], y = ys[v], z = zs[v], t;
    if (item.zan2d) {
      t = (y * sinRoll + x * cosRoll) >> 16;
      y = (y * cosRoll - x * sinRoll) >> 16;
      x = t;
    }
    if (item.yan2d) {
      t = (z * sinYaw + x * cosYaw) >> 16;
      z = (z * cosYaw - x * sinYaw) >> 16;
      x = t;
    }
    x += offsetX;
    y += offsetY;
    z += offsetZ;
    t = (y * cosPitch - z * sinPitch) >> 16;
    z = (y * sinPitch + z * cosPitch) >> 16;
    depth.push(z);
    screen.push(z > 0 ? [CENTRE_X + (x * 512) / z, CENTRE_Y + (t * 512) / z] : null);
  }

  // Far faces first, near faces over them (the client sorts by depth).
  const faces = [];
  for (let f = 0; f < data.faceA.length; f++) {
    const corners = [data.faceA[f], data.faceB[f], data.faceC[f]];
    if (data.renderTypes[f] === 2 || corners.some((v) => !screen[v])) continue;
    faces.push({ f, corners, depth: (depth[corners[0]] + depth[corners[1]] + depth[corners[2]]) / 3 });
  }
  faces.sort((a, b) => b.depth - a.depth);
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (const { f, corners } of faces) {
    let colors;
    if (data.textures[f] >= 0) {
      const base = await textureColor(data.textures[f]);
      colors = lit[f].map((l) => base.map((c) => c * Math.min(1.3, l / 96)));
    } else {
      colors = lit[f].map((l) => rsColorToRgb((data.colors[f] & 0xff80) + Math.min(126, Math.max(2, ((data.colors[f] & 127) * l) >> 7))));
    }
    fillTriangle(pixels, corners.flatMap((v) => screen[v]), colors);
  }

  // Outline (any clear pixel beside the item), then the shadow below-right.
  const solid = (p) => pixels[p * 4 + 3] !== 0;
  const outlined = new Uint8ClampedArray(pixels);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const p = y * WIDTH + x;
      if (solid(p)) continue;
      if ((x > 0 && solid(p - 1)) || (y > 0 && solid(p - WIDTH)) || (x < WIDTH - 1 && solid(p + 1)) || (y < HEIGHT - 1 && solid(p + WIDTH))) {
        outlined.set([...OUTLINE, 255], p * 4);
      }
    }
  }
  for (let y = HEIGHT - 1; y > 0; y--) {
    for (let x = WIDTH - 1; x > 0; x--) {
      const p = y * WIDTH + x;
      if (outlined[p * 4 + 3] === 0 && outlined[(p - WIDTH - 1) * 4 + 3] !== 0) outlined.set([...SHADOW, 255], p * 4);
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.getContext("2d").putImageData(new ImageData(outlined, WIDTH, HEIGHT), 0, 0);
  return canvas.toDataURL();
}

const icons = new Map();

// The OSRS icon (data URL) for an OSRS item name, or null.
export async function osrsItemIcon(cache, name) {
  const key = name.toLowerCase();
  if (!icons.has(key)) {
    icons.set(key, itemIndex().then((index) => {
      const item = index.get(key);
      return item ? renderIcon(cache, item) : null;
    }).catch(() => null));
  }
  return icons.get(key);
}
