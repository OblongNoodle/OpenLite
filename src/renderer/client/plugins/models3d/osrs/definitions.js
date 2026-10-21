// Decoders for OSRS cache definitions: models, identity kits, items, animation
// sequences, frames and framemaps (skeletons). Ported from RuneLite's cache
// loaders (KitLoader, ItemLoader, SequenceLoader, FrameLoader,
// FramemapLoader, ModelLoader; BSD-licensed, see modelFormats.js).
import { ByteStream } from "./stream.js";
import { decodeOldFormat, decodeType1, decodeType2, decodeType3 } from "./modelFormats.js";

// Cache layout: index numbers, and archives inside the config index.
export const CacheIndex = { Frames: 0, Framemaps: 1, Configs: 2, Models: 7 };
export const ConfigArchive = { IdentityKit: 3, Npc: 9, Item: 10, Sequence: 12 };

// NPC definitions: models, name, animations, recolours, scale and lighting.
// Decoding stops at the first opcode past those (head icons, transforms...).
export function decodeNpc(id, bytes) {
  const s = new ByteStream(bytes);
  const def = { id, name: "", models: [], size: 1, standAnimation: -1, walkAnimation: -1, recolorToFind: [], recolorToReplace: [], widthScale: 128, heightScale: 128, ambient: 0, contrast: 0, combatLevel: -1 };
  for (let opcode = s.readUnsignedByte(); opcode !== 0; opcode = s.readUnsignedByte()) {
    if (opcode === 1) def.models = Array.from({ length: s.readUnsignedByte() }, () => s.readUnsignedShort());
    else if (opcode === 61) def.models = Array.from({ length: s.readUnsignedByte() }, () => s.readInt());
    else if (opcode === 2) def.name = s.readString();
    else if (opcode === 12) def.size = s.readUnsignedByte();
    else if (opcode === 13) def.standAnimation = s.readUnsignedShort();
    else if (opcode === 14) def.walkAnimation = s.readUnsignedShort();
    else if (opcode === 15 || opcode === 16 || opcode === 18) s.readUnsignedShort();
    else if (opcode === 17) {
      def.walkAnimation = s.readUnsignedShort();
      s.skip(6);
    } else if (opcode >= 30 && opcode < 35) s.readString();
    else if (opcode === 40) {
      const count = s.readUnsignedByte();
      for (let i = 0; i < count; i++) {
        def.recolorToFind.push(s.readUnsignedShort());
        def.recolorToReplace.push(s.readUnsignedShort());
      }
    } else if (opcode === 41) s.skip(s.readUnsignedByte() * 4);
    else if (opcode === 42) s.readUnsignedShort();
    else if (opcode === 60) s.skip(s.readUnsignedByte() * 2);
    else if (opcode === 62) s.skip(s.readUnsignedByte() * 4);
    else if (opcode >= 74 && opcode <= 79) s.readUnsignedShort();
    else if (opcode === 93 || opcode === 99) continue;
    else if (opcode === 95) def.combatLevel = s.readUnsignedShort();
    else if (opcode === 97) def.widthScale = s.readUnsignedShort();
    else if (opcode === 98) def.heightScale = s.readUnsignedShort();
    else if (opcode === 100) def.ambient = s.readByte();
    else if (opcode === 101) def.contrast = s.readByte();
    else break;
  }
  return def;
}

// A model's vertices, triangles, per-face colours and render data. The trailing
// bytes say which of the format revisions it uses.
export function decodeModel(bytes) {
  const data = bytes instanceof Int8Array ? bytes : new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const def = {};
  const last = data[data.length - 1], beforeLast = data[data.length - 2];
  if (beforeLast === -1 && last === -3) decodeType3(def, data);
  else if (beforeLast === -1 && last === -2) decodeType2(def, data);
  else if (beforeLast === -1 && last === -1) decodeType1(def, data);
  else decodeOldFormat(def, data);
  return def;
}

export function decodeKit(id, bytes) {
  const s = new ByteStream(bytes);
  const def = { id, bodyPartId: -1, models: [], recolorToFind: [], recolorToReplace: [], nonSelectable: false };
  for (let opcode = s.readUnsignedByte(); opcode !== 0; opcode = s.readUnsignedByte()) {
    if (opcode === 1) def.bodyPartId = s.readUnsignedByte();
    else if (opcode === 2) {
      const count = s.readUnsignedByte();
      def.models = Array.from({ length: count }, () => s.readUnsignedShort());
    } else if (opcode === 3) def.nonSelectable = true;
    else if (opcode === 5) {
      const count = s.readUnsignedByte();
      def.models = Array.from({ length: count }, () => s.readInt());
    } else if (opcode === 40) {
      const count = s.readUnsignedByte();
      for (let i = 0; i < count; i++) {
        def.recolorToFind.push(s.readShort());
        def.recolorToReplace.push(s.readShort());
      }
    } else if (opcode === 41) {
      const count = s.readUnsignedByte();
      s.skip(count * 4);
    } else if (opcode >= 60 && opcode < 70) s.readUnsignedShort();
    else if (opcode >= 70 && opcode < 80) s.readInt();
    else break;
  }
  return def;
}

// Item definitions: only what the player builder needs (name, worn models,
// recolours, wear slots). Decoding stops at the first opcode past those.
export function decodeItem(id, bytes) {
  const s = new ByteStream(bytes);
  const def = { id, name: "", wearPos1: -1, wearPos2: -1, wearPos3: -1, maleModel0: -1, maleModel1: -1, maleModel2: -1, maleOffset: 0, colorFind: [], colorReplace: [] };
  const skipString = () => s.readString();
  for (let opcode = s.readUnsignedByte(); opcode !== 0; opcode = s.readUnsignedByte()) {
    if (opcode === 1) s.readUnsignedShort();
    else if (opcode === 2) def.name = s.readString();
    else if (opcode === 3 || opcode === 9) skipString();
    else if (opcode >= 4 && opcode <= 8) s.readUnsignedShort();
    else if (opcode === 11 || opcode === 15 || opcode === 16 || opcode === 65 || opcode === 160 || opcode === 251) continue;
    else if (opcode === 12) s.readInt();
    else if (opcode === 13) def.wearPos1 = s.readByte();
    else if (opcode === 14) def.wearPos2 = s.readByte();
    else if (opcode === 27) def.wearPos3 = s.readByte();
    else if (opcode === 23) {
      def.maleModel0 = s.readUnsignedShort();
      def.maleOffset = s.readUnsignedByte();
    } else if (opcode === 24) def.maleModel1 = s.readUnsignedShort();
    else if (opcode === 25) s.skip(3);
    else if (opcode === 26) s.readUnsignedShort();
    else if (opcode >= 30 && opcode < 40) skipString();
    else if (opcode === 40) {
      const count = s.readUnsignedByte();
      for (let i = 0; i < count; i++) {
        def.colorFind.push(s.readUnsignedShort());
        def.colorReplace.push(s.readUnsignedShort());
      }
    } else if (opcode === 41) s.skip(s.readUnsignedByte() * 4);
    else if (opcode === 42) s.readByte();
    else if (opcode === 43) {
      s.readUnsignedByte();
      while (s.readUnsignedByte() !== 0) skipString();
    } else if (opcode === 44) s.readInt();
    else if (opcode === 45) {
      def.maleModel0 = s.readInt();
      def.maleOffset = s.readUnsignedByte();
    } else if (opcode === 46) def.maleModel1 = s.readInt();
    else if (opcode === 47) def.maleModel2 = s.readInt();
    else if (opcode === 48) s.skip(5);
    else if (opcode >= 49 && opcode <= 54) s.readInt();
    else if (opcode === 75) s.readShort();
    else if (opcode === 78) def.maleModel2 = s.readUnsignedShort();
    else if (opcode === 79 || (opcode >= 90 && opcode <= 95) || opcode === 97 || opcode === 98 || opcode === 99) s.readUnsignedShort();
    else if (opcode >= 100 && opcode < 110) s.skip(4);
    else if (opcode >= 110 && opcode <= 112) s.readUnsignedShort();
    else if (opcode === 113 || opcode === 114) s.readByte();
    else if (opcode === 115) s.readUnsignedByte();
    else if (opcode === 139 || opcode === 140 || opcode === 148 || opcode === 149) s.readUnsignedShort();
    else if (opcode === 161) s.skip(s.readUnsignedShort() * 2);
    else break;
  }
  return def;
}

// Sequences: the frame list (opcode 1) is all the player builder needs. Only
// the simple fields that can precede it are skipped; decoding stops after it.
export function decodeSequence(id, bytes) {
  const s = new ByteStream(bytes);
  const def = { id, frameIds: [], frameLengths: [] };
  for (let opcode = s.readUnsignedByte(); opcode !== 0; opcode = s.readUnsignedByte()) {
    if (opcode === 1) {
      const count = s.readUnsignedShort();
      def.frameLengths = Array.from({ length: count }, () => s.readUnsignedShort());
      const low = Array.from({ length: count }, () => s.readUnsignedShort());
      def.frameIds = low.map((value) => value + (s.readUnsignedShort() << 16));
      break;
    }
    if (opcode === 2 || opcode === 6 || opcode === 7) s.readUnsignedShort();
    else if (opcode === 3) s.skip(s.readUnsignedByte());
    else if (opcode === 4 || opcode === 19) continue;
    // 16 is the vertical offset in current caches (rev 226+).
    else if (opcode === 5 || (opcode >= 8 && opcode <= 11) || opcode === 16) s.readUnsignedByte();
    else break;
  }
  return def;
}

// A framemap (skeleton): a list of transform slots, each with a type
// (0 origin, 1 translate, 2 rotate, 3 scale, 5 alpha) and the vertex-group
// labels it moves.
export function decodeFramemap(id, bytes) {
  const s = new ByteStream(bytes);
  const length = s.readUnsignedByte();
  const types = Array.from({ length }, () => s.readUnsignedByte());
  const maps = Array.from({ length }, () => new Array(s.readUnsignedByte()));
  for (const map of maps) for (let j = 0; j < map.length; j++) map[j] = s.readUnsignedByte();
  return { id, types, maps };
}

// The framemap id a frame file belongs to (its first two bytes).
export function frameFramemapId(bytes) {
  return (bytes[0] << 8) | bytes[1];
}

// One animation frame: which framemap slots it uses and their x/y/z values.
export function decodeFrame(framemap, bytes) {
  const header = new ByteStream(bytes);
  const data = new ByteStream(bytes);
  header.readUnsignedShort();
  const length = header.readUnsignedByte();
  data.skip(3 + length);
  const slots = [], xs = [], ys = [], zs = [];
  let lastSlot = -1;
  for (let i = 0; i < length; i++) {
    const flags = header.readUnsignedByte();
    if (flags <= 0) continue;
    // A transform needs the origin slot before it; add the nearest one if the
    // frame skipped it.
    if (framemap.types[i] !== 0) {
      for (let previous = i - 1; previous > lastSlot; previous--) {
        if (framemap.types[previous] === 0) {
          slots.push(previous);
          xs.push(0);
          ys.push(0);
          zs.push(0);
          break;
        }
      }
    }
    slots.push(i);
    const fallback = framemap.types[i] === 3 ? 128 : 0;
    xs.push(flags & 1 ? data.readShortSmart() : fallback);
    ys.push(flags & 2 ? data.readShortSmart() : fallback);
    zs.push(flags & 4 ? data.readShortSmart() : fallback);
    lastSlot = i;
  }
  return { framemap, slots, xs, ys, zs };
}
