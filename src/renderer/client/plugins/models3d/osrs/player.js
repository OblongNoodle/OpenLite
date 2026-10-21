// OSRS-style players built the way the RS client builds them, from a local
// OSRS cache: identity-kit body parts plus equipment models merged into one
// mesh, recoloured, lit once (Model.light / createModel), and animated by
// moving labelled vertex groups frame by frame (Model.animate).
import { Activity } from "../pose.js";
import { RigModel } from "../geometry.js";
import {
  CacheIndex,
  ConfigArchive,
  decodeFrame,
  decodeFramemap,
  decodeItem,
  decodeKit,
  decodeModel,
  decodeNpc,
  decodeSequence,
  frameFramemapId
} from "./definitions.js";

// Body parts of identity kits, and the equipment slot that replaces each.
const BodyPart = { Hair: 0, Jaw: 1, Torso: 2, Arms: 3, Hands: 4, Legs: 5, Feet: 6 };
const SLOT_FOR_BODY_PART = [8, 11, 4, 6, 9, 7, 10];
// HighSpell equipment slots (helmet, chest, legs, shield, weapon, back, neck,
// gloves, boots) and the OSRS equipment slot each corresponds to.
const OSRS_SLOT_FOR_HIGHSPELL_SLOT = [0, 4, 7, 5, 3, 1, 2, 9, 10];
// The colours player kits are made in, replaced by each player's own: hair,
// torso, legs, feet, skin (the client's colorsToFind).
const KIT_SOURCE_COLORS = { hair: 6798, torso: 8741, legs: 25238, feet: 4626, skin: 4550 };
// The client's player lighting (PlayerAppearance.getBodyModel).
const PLAYER_LIGHT = { ambient: 64, contrast: 850, x: -30, y: -50, z: -30 };
// Colour brightness the client builds its palette with.
const PALETTE_BRIGHTNESS = 0.8;
// Sequence ids for each activity (OSRS player animations).
const SEQUENCES = {
  idle: 808,
  walk: 819,
  [Activity.Chop]: 625,
  [Activity.Melee]: 422,
  [Activity.Ranged]: 426,
  [Activity.Magic]: 711,
  [Activity.Fish]: 621,
  [Activity.Work]: 899,
  [Activity.Dead]: 836
};
// Woodcutting uses its own animation; mining shares the Chop pose family.
const WOODCUTTING_SEQUENCE = 879;
// Client ticks are 20ms; frame lengths are counted in them.
const TICK_MS = 20;
// RS units per tile.
const RS_UNITS_PER_TILE = 128;
// Identity kits below this id are the male body kits.
const MALE_KIT_LIMIT = 45;

const SINE = new Int32Array(2048), COSINE = new Int32Array(2048);
for (let i = 0; i < 2048; i++) {
  SINE[i] = Math.trunc(65536 * Math.sin(i * Math.PI / 1024));
  COSINE[i] = Math.trunc(65536 * Math.cos(i * Math.PI / 1024));
}

// --- Colours -------------------------------------------------------------

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

// A packed RS colour (6-bit hue, 3-bit saturation, 7-bit lightness) as RGB,
// as the client's palette computes it.
export function rsColorToRgb(hsl) {
  const hue = ((hsl >> 10) & 63) / 64 + 0.0078125;
  const saturation = ((hsl >> 7) & 7) / 8 + 0.0625;
  const lightness = (hsl & 127) / 128;
  return hslToRgb(hue, saturation, lightness).map((value) => Math.pow(value, PALETTE_BRIGHTNESS));
}

// The nearest packed RS colour for an RGB colour (0-1 per channel).
export function rgbToRsColor([r, g, b]) {
  [r, g, b] = [r, g, b].map((value) => Math.pow(Math.max(0, value), 1 / PALETTE_BRIGHTNESS));
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  const hue = Math.round(h * 64 - 0.5) & 63;
  const saturation = Math.max(0, Math.min(7, Math.round(s * 8 - 0.5)));
  const lightness = Math.max(0, Math.min(127, Math.round(l * 128)));
  return (hue << 10) | (saturation << 7) | lightness;
}

// The client's multiplyLightness: scale a colour's 7-bit lightness.
function multiplyLightness(hsl, lightness) {
  let value = (lightness * (hsl & 127)) >> 7;
  value = value < 2 ? 2 : value > 126 ? 126 : value;
  return (hsl & 0xff80) + value;
}

// --- Cache access ---------------------------------------------------------

// Loads and caches definitions and models from the local OSRS cache.
export class OsrsCache {
  static instance = null;

  static async open() {
    if (!this.instance) this.instance = new OsrsCache();
    return this.instance.ready;
  }

  constructor() {
    this.models = new Map();
    this.framemaps = new Map();
    this.frameArchives = new Map();
    this.ready = this.load().then(() => this);
  }

  async load() {
    const opened = await window.osrsCache?.open();
    if (!opened?.ok) throw new Error(`OSRS cache unavailable: ${opened?.error ?? "no cache bridge"}`);
    const [kitFiles, itemFiles, sequenceFiles, npcFiles] = await Promise.all([
      window.osrsCache.files(CacheIndex.Configs, ConfigArchive.IdentityKit),
      window.osrsCache.files(CacheIndex.Configs, ConfigArchive.Item),
      window.osrsCache.files(CacheIndex.Configs, ConfigArchive.Sequence),
      window.osrsCache.files(CacheIndex.Configs, ConfigArchive.Npc)
    ]);
    this.npcsByName = new Map();
    for (const file of npcFiles) {
      try {
        const npc = decodeNpc(file.id, file.data);
        const key = npc.name.toLowerCase();
        // Keep the first animated version of each name (later ids are often
        // quest variants and transforms).
        if (npc.name && npc.models.length && npc.standAnimation >= 0 && !this.npcsByName.has(key)) this.npcsByName.set(key, npc);
      } catch {
        // NPCs using fields not decoded here are simply unavailable.
      }
    }
    this.kits = kitFiles.map((file) => decodeKit(file.id, file.data));
    this.itemsByName = new Map();
    for (const file of itemFiles) {
      try {
        const item = decodeItem(file.id, file.data);
        const key = item.name.toLowerCase();
        // Keep the first (usually the base, unnoted) item of each name.
        if (item.name && item.wearPos1 >= 0 && !this.itemsByName.has(key)) this.itemsByName.set(key, item);
      } catch {
        // A few items use fields not decoded here; they are simply unavailable.
      }
    }
    this.sequences = new Map(sequenceFiles.map((file) => [file.id, file.data]));
  }

  // Selectable male kits for a body part (the male kits are ids below 45).
  kitsFor(bodyPart) {
    return this.kits.filter((kit) => kit.bodyPartId === bodyPart && !kit.nonSelectable && kit.models.length && kit.id < MALE_KIT_LIMIT);
  }

  async model(id) {
    if (!this.models.has(id)) {
      this.models.set(id, window.osrsCache.files(CacheIndex.Models, id).then((files) => (files ? decodeModel(files[0].data) : null)));
    }
    return this.models.get(id);
  }

  sequence(id) {
    const data = this.sequences.get(id);
    return data ? decodeSequence(id, data) : null;
  }

  // Frames are stored in archives of related frames; framemaps (skeletons)
  // one per archive in their own index.
  async frame(frameId) {
    const archive = frameId >>> 16, file = frameId & 0xffff;
    if (!this.frameArchives.has(archive)) {
      this.frameArchives.set(archive, window.osrsCache.files(CacheIndex.Frames, archive).then(async (files) => {
        const byId = new Map();
        for (const entry of files ?? []) {
          const framemap = await this.framemap(frameFramemapId(entry.data));
          if (framemap) byId.set(entry.id, decodeFrame(framemap, entry.data));
        }
        return byId;
      }));
    }
    return (await this.frameArchives.get(archive)).get(file) ?? null;
  }

  async framemap(id) {
    if (!this.framemaps.has(id)) {
      this.framemaps.set(id, window.osrsCache.files(CacheIndex.Framemaps, id).then((files) => (files ? decodeFramemap(id, files[0].data) : null)));
    }
    return this.framemaps.get(id);
  }

  // Frames of a sequence, with their lengths in ms.
  async animation(id) {
    const sequence = this.sequence(id);
    if (!sequence) return null;
    const frames = await Promise.all(sequence.frameIds.map((frameId) => this.frame(frameId)));
    const usable = frames.map((frame, i) => ({ frame, ms: Math.max(1, sequence.frameLengths[i]) * TICK_MS })).filter((f) => f.frame);
    return usable.length ? usable : null;
  }
}

// --- Building ----------------------------------------------------------------

// Merges decoded models into one, like the client's RawModel(models, count).
function mergeModels(models) {
  const merged = { vertexX: [], vertexY: [], vertexZ: [], groups: [], faceA: [], faceB: [], faceC: [], colors: [], renderTypes: [], alphas: [] };
  for (const model of models) {
    const base = merged.vertexX.length;
    for (let v = 0; v < model.vertexCount; v++) {
      merged.vertexX.push(model.vertexX[v]);
      merged.vertexY.push(model.vertexY[v]);
      merged.vertexZ.push(model.vertexZ[v]);
      merged.groups.push(model.packedVertexGroups ? model.packedVertexGroups[v] : -1);
    }
    for (let f = 0; f < model.faceCount; f++) {
      merged.faceA.push(model.faceIndices1[f] + base);
      merged.faceB.push(model.faceIndices2[f] + base);
      merged.faceC.push(model.faceIndices3[f] + base);
      merged.colors.push(model.faceColors[f] & 0xffff);
      merged.renderTypes.push(model.faceRenderTypes ? model.faceRenderTypes[f] & 3 : 0);
      merged.alphas.push(model.faceTransparencies ? model.faceTransparencies[f] & 255 : 0);
    }
  }
  return merged;
}

function recolor(model, find, replace) {
  for (let f = 0; f < model.colors.length; f++) if (model.colors[f] === find) model.colors[f] = replace;
}

// The client's lighting: each face gets a colour per corner from the
// vertex normals (smooth faces) or its own normal (flat faces).
function lightModel(model, { ambient, contrast, x: lx, y: ly, z: lz }) {
  const vertexCount = model.vertexX.length, faceCount = model.colors.length;
  const nx = new Float64Array(vertexCount), ny = new Float64Array(vertexCount), nz = new Float64Array(vertexCount), count = new Int32Array(vertexCount);
  const faceNormals = [];
  for (let f = 0; f < faceCount; f++) {
    const a = model.faceA[f], b = model.faceB[f], c = model.faceC[f];
    const ux = model.vertexX[b] - model.vertexX[a], uy = model.vertexY[b] - model.vertexY[a], uz = model.vertexZ[b] - model.vertexZ[a];
    const vx = model.vertexX[c] - model.vertexX[a], vy = model.vertexY[c] - model.vertexY[a], vz = model.vertexZ[c] - model.vertexZ[a];
    let fx = uy * vz - vy * uz, fy = uz * vx - vz * ux, fz = ux * vy - vx * uy;
    const length = Math.hypot(fx, fy, fz) || 1;
    fx = (fx * 256) / length;
    fy = (fy * 256) / length;
    fz = (fz * 256) / length;
    faceNormals.push([fx, fy, fz]);
    if (model.renderTypes[f] === 0) {
      for (const v of [a, b, c]) {
        nx[v] += fx;
        ny[v] += fy;
        nz[v] += fz;
        count[v]++;
      }
    }
  }
  const lightLength = Math.hypot(lx, ly, lz);
  const contrastLight = (contrast * lightLength) / 256;
  const corners = [];
  for (let f = 0; f < faceCount; f++) {
    const color = model.colors[f];
    const type = model.renderTypes[f];
    if (type === 0) {
      corners.push([model.faceA[f], model.faceB[f], model.faceC[f]].map((v) => {
        const lightness = ambient + (lx * nx[v] + ly * ny[v] + lz * nz[v]) / (contrastLight * Math.max(1, count[v]));
        return multiplyLightness(color, lightness);
      }));
    } else {
      const [fx, fy, fz] = faceNormals[f];
      const lightness = ambient + (lx * fx + ly * fy + lz * fz) / (contrastLight + contrastLight / 2);
      const lit = multiplyLightness(color, lightness);
      corners.push([lit, lit, lit]);
    }
  }
  return corners;
}

// Equipment for a player: OSRS items matched by name to their HighSpell gear.
function findItem(cache, name) {
  if (!name) return null;
  const key = name.toLowerCase();
  const tries = [key, key.replace(/ helm$/, " med helm"), key.replace(/ helmet$/, " full helm"), key.replace(/ shield$/, " sq shield")];
  for (const attempt of tries) {
    const item = cache.itemsByName.get(attempt);
    if (item) return item;
  }
  return null;
}

// The merged, recoloured, lit player mesh data for a HighSpell player.
//   appearanceIds: HighSpell [hair, beard, shirt, body, legs] sprite ids
//   colors: sampled colours (hair, torso, legs, feet, skin, ...)
//   gear: HighSpell equipped items by HighSpell slot, with item names
export async function buildPlayerData(cache, appearanceIds, colors, gear) {
  const equipped = new Map();
  for (const [slot, item] of Object.entries(gear ?? {})) {
    const osrsItem = findItem(cache, item?.name);
    if (osrsItem) equipped.set(OSRS_SLOT_FOR_HIGHSPELL_SLOT[slot], osrsItem);
  }
  // Slots hidden by equipment covering more than its own slot (e.g. a
  // platebody covers the arms, a full helm the hair and jaw).
  const hidden = new Set();
  for (const item of equipped.values()) for (const pos of [item.wearPos2, item.wearPos3]) if (pos >= 0) hidden.add(pos);

  const spriteId = (index) => appearanceIds?.[index]?.[1] ?? 0;
  const kitChoice = [spriteId(0), spriteId(1), spriteId(2), spriteId(2), 0, spriteId(4), 0];
  const parts = [];
  for (let bodyPart = 0; bodyPart < 7; bodyPart++) {
    const slot = SLOT_FOR_BODY_PART[bodyPart];
    if (equipped.has(slot) || hidden.has(slot)) continue;
    const options = cache.kitsFor(bodyPart);
    const kit = options[kitChoice[bodyPart] % options.length];
    if (kit) parts.push(...kit.models.map((id) => ({ id, kit })));
  }
  const decoded = [];
  for (const { id, kit } of parts) {
    const model = await cache.model(id);
    if (model) decoded.push({ model, find: kit.recolorToFind, replace: kit.recolorToReplace, offset: 0, isKit: true });
  }
  for (const item of equipped.values()) {
    for (const id of [item.maleModel0, item.maleModel1, item.maleModel2]) {
      if (id < 0) continue;
      const model = await cache.model(id);
      if (model) decoded.push({ model, find: item.colorFind, replace: item.colorReplace, offset: item.maleOffset });
    }
  }
  const merged = mergeModels(decoded.map(({ model, offset }) => {
    if (!offset) return model;
    return { ...model, vertexY: model.vertexY.map((y) => y + offset) };
  }));
  // Each part's own recolours; body kits then take the player's colours.
  // Equipment keeps its own colours (a bronze helm can share a source colour
  // with hair, and must not turn hair-coloured).
  const playerColors = Object.entries(KIT_SOURCE_COLORS).filter(([part]) => colors[part]).map(([part, source]) => [source, rgbToRsColor(colors[part])]);
  let faceStart = 0;
  for (const { model, find, replace, isKit } of decoded) {
    const range = { colors: merged.colors.slice(faceStart, faceStart + model.faceCount) };
    find.forEach((color, i) => recolor(range, color & 0xffff, replace[i] & 0xffff));
    if (isKit) for (const [source, target] of playerColors) recolor(range, source, target);
    merged.colors.splice(faceStart, model.faceCount, ...range.colors);
    faceStart += model.faceCount;
  }
  merged.cornerColors = lightModel(merged, PLAYER_LIGHT);
  merged.labels = new Map();
  merged.groups.forEach((label, v) => {
    if (label < 0) return;
    if (!merged.labels.has(label)) merged.labels.set(label, []);
    merged.labels.get(label).push(v);
  });
  return merged;
}

// HighSpell NPC names that differ from the closest OSRS NPC.
const NPC_ALIASES = [
  [/^isradore's /, ""],
  [/^sewer rat$|^hell rat$/, "rat"],
  [/^giant hell rat$/, "giant rat"],
  [/^cave chicken$/, "chicken"],
  [/^bull$/, "cow"],
  [/^(brown|cave) bear$/, "grizzly bear"],
  [/^(brown|black) bear cub$/, "bear cub"],
  [/^plains dragon$/, "green dragon"],
  [/^shadow dragon$/, "black dragon"],
  [/^water dragon$/, "blue dragon"],
  [/^fire dragon$/, "red dragon"],
  [/^sky dragon$/, "bronze dragon"],
  [/^dragon hatchling$/, "baby green dragon"],
  [/^corrupt minotaur$/, "minotaur"],
  [/^(king )?goblin jockey$/, "goblin"],
  [/^damogui$/, "lesser demon"],
  [/^nisse$/, "gnome"],
  [/^shop owner$/, "shop keeper"],
  [/^knight$/, "white knight"],
  [/^wandering monk$/, "monk"]
];

// The OSRS NPC for a HighSpell NPC name: the same name, or a close stand-in.
export function findNpc(cache, name) {
  let key = String(name ?? "").toLowerCase();
  if (cache.npcsByName.has(key)) return cache.npcsByName.get(key);
  for (const [pattern, replacement] of NPC_ALIASES) {
    key = key.replace(pattern, replacement);
    if (cache.npcsByName.has(key)) return cache.npcsByName.get(key);
  }
  return null;
}

// The merged, recoloured, scaled and lit mesh data for an OSRS NPC, as the
// client's NpcType.getBodyModel builds it.
export async function buildNpcData(cache, npc) {
  const models = (await Promise.all(npc.models.map((id) => cache.model(id)))).filter(Boolean);
  if (!models.length) return null;
  const merged = mergeModels(models);
  npc.recolorToFind.forEach((color, i) => recolor(merged, color, npc.recolorToReplace[i]));
  if (npc.widthScale !== 128 || npc.heightScale !== 128) {
    merged.vertexX = merged.vertexX.map((x) => Math.trunc((x * npc.widthScale) / 128));
    merged.vertexY = merged.vertexY.map((y) => Math.trunc((y * npc.heightScale) / 128));
    merged.vertexZ = merged.vertexZ.map((z) => Math.trunc((z * npc.widthScale) / 128));
  }
  merged.cornerColors = lightModel(merged, { ...PLAYER_LIGHT, ambient: 64 + npc.ambient, contrast: 850 + npc.contrast });
  merged.labels = new Map();
  merged.groups.forEach((label, v) => {
    if (label < 0) return;
    if (!merged.labels.has(label)) merged.labels.set(label, []);
    merged.labels.get(label).push(v);
  });
  merged.sequences = { idle: npc.standAnimation, walk: npc.walkAnimation >= 0 ? npc.walkAnimation : npc.standAnimation };
  return merged;
}

// --- Animation -------------------------------------------------------------

// Applies one frame to base vertex positions, as the client's Model.animate.
function applyFrame(data, frame, outX, outY, outZ) {
  outX.set(data.vertexX);
  outY.set(data.vertexY);
  outZ.set(data.vertexZ);
  let originX = 0, originY = 0, originZ = 0;
  const { framemap, slots, xs, ys, zs } = frame;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const type = framemap.types[slot];
    const labels = framemap.maps[slot];
    const dx = xs[i], dy = ys[i], dz = zs[i];
    if (type === 0) {
      let count = 0;
      originX = originY = originZ = 0;
      for (const label of labels) {
        for (const v of data.labels.get(label) ?? []) {
          originX += outX[v];
          originY += outY[v];
          originZ += outZ[v];
          count++;
        }
      }
      if (count > 0) {
        originX = Math.trunc(originX / count) + dx;
        originY = Math.trunc(originY / count) + dy;
        originZ = Math.trunc(originZ / count) + dz;
      } else {
        originX = dx;
        originY = dy;
        originZ = dz;
      }
    } else if (type === 1) {
      for (const label of labels) {
        for (const v of data.labels.get(label) ?? []) {
          outX[v] += dx;
          outY[v] += dy;
          outZ[v] += dz;
        }
      }
    } else if (type === 2) {
      const ax = (dx & 255) * 8, ay = (dy & 255) * 8, az = (dz & 255) * 8;
      for (const label of labels) {
        for (const v of data.labels.get(label) ?? []) {
          let x = outX[v] - originX, y = outY[v] - originY, z = outZ[v] - originZ;
          if (az !== 0) {
            const t = (y * SINE[az] + x * COSINE[az]) >> 16;
            y = (y * COSINE[az] - x * SINE[az]) >> 16;
            x = t;
          }
          if (ax !== 0) {
            const t = (y * COSINE[ax] - z * SINE[ax]) >> 16;
            z = (y * SINE[ax] + z * COSINE[ax]) >> 16;
            y = t;
          }
          if (ay !== 0) {
            const t = (z * SINE[ay] + x * COSINE[ay]) >> 16;
            z = (z * COSINE[ay] - x * SINE[ay]) >> 16;
            x = t;
          }
          outX[v] = x + originX;
          outY[v] = y + originY;
          outZ[v] = z + originZ;
        }
      }
    } else if (type === 3) {
      for (const label of labels) {
        for (const v of data.labels.get(label) ?? []) {
          outX[v] = Math.trunc(((outX[v] - originX) * dx) / 128) + originX;
          outY[v] = Math.trunc(((outY[v] - originY) * dy) / 128) + originY;
          outZ[v] = Math.trunc(((outZ[v] - originZ) * dz) / 128) + originZ;
        }
      }
    }
  }
}

// --- Rendering ---------------------------------------------------------------

// A player drawn from OSRS kit and equipment models, animated with OSRS
// sequences. Same interface as HumanModel (update / dispose / yaw / root).
export class OsrsPlayerModel extends RigModel {
  constructor(scene, ctors, material, data, cache, name) {
    super(scene, ctors, material, name);
    this.data = data;
    this.cache = cache;
    this.animations = new Map();
    this.current = null;
    this.elapsed = 0;
    const vertexCount = data.vertexX.length;
    this.posX = new Int32Array(vertexCount);
    this.posY = new Int32Array(vertexCount);
    this.posZ = new Int32Array(vertexCount);
    // Faces get their own corners so each can carry its lit colours.
    const faceCount = data.colors.length;
    const visible = [];
    for (let f = 0; f < faceCount; f++) if (data.renderTypes[f] !== 2) visible.push(f);
    this.faces = visible;
    this.positions = new Float32Array(visible.length * 9);
    const colors = new Float32Array(visible.length * 12);
    const indices = new Uint32Array(visible.length * 3);
    visible.forEach((f, i) => {
      data.cornerColors[f].forEach((hsl, k) => {
        const [r, g, b] = data.renderTypes[f] === 3 ? [0, 0, 0] : rsColorToRgb(hsl);
        colors.set([r, g, b, 1], (i * 3 + k) * 4);
      });
      indices.set([i * 3, i * 3 + 1, i * 3 + 2], i * 3);
    });
    this.mesh = new ctors.Mesh(`${name}-osrs`, scene);
    this.mesh.setVerticesData("position", this.positions, true);
    this.mesh.setVerticesData("color", colors, false);
    this.mesh.setIndices(indices);
    this.mesh.material = material;
    this.mesh.isPickable = false;
    this.mesh.parent = this.root;
    this.parts.push(this.mesh);
    // Model height and longest horizontal span in RS units (feet at y = 0, up
    // is negative y).
    this.height = Math.max(1, -Math.min(...data.vertexY));
    const span = (values) => Math.max(...values) - Math.min(...values);
    this.length = Math.max(1, span(data.vertexX), span(data.vertexZ));
    this.writePositions(data.vertexX, data.vertexY, data.vertexZ);
  }

  // RS models face -Z with Y pointing down; turning them half a turn about X
  // makes them face +Z, upright, like the other rigs (without mirroring).
  writePositions(xs, ys, zs) {
    const p = this.positions;
    let o = 0;
    for (const f of this.faces) {
      for (const v of [this.data.faceA[f], this.data.faceB[f], this.data.faceC[f]]) {
        p[o++] = xs[v] / RS_UNITS_PER_TILE;
        p[o++] = -ys[v] / RS_UNITS_PER_TILE;
        p[o++] = -zs[v] / RS_UNITS_PER_TILE;
      }
    }
    this.mesh.updateVerticesData("position", p);
  }

  // NPCs bring their own stand and walk animations; players use the player
  // set, with an animation per activity.
  sequenceFor(pose) {
    const npcSequences = this.data.sequences;
    if (npcSequences) return pose.moving ? npcSequences.walk : npcSequences.idle;
    if (pose.moving) return SEQUENCES.walk;
    if (pose.activity === Activity.Chop && pose.woodcutting) return WOODCUTTING_SEQUENCE;
    return SEQUENCES[pose.activity] ?? SEQUENCES.idle;
  }

  animation(id) {
    if (!this.animations.has(id)) {
      this.animations.set(id, null);
      this.cache.animation(id).then((frames) => this.animations.set(id, frames)).catch(() => {});
    }
    return this.animations.get(id);
  }

  // box: { height, length } in tiles, the space the entity's sprite takes up.
  // The model is scaled to fit inside it, so tall figures fit by height and
  // long, low animals by length.
  update(position, direction, pose, box, deltaMs) {
    const size = Math.min(
      box.height / (this.height / RS_UNITS_PER_TILE),
      box.length / (this.length / RS_UNITS_PER_TILE)
    );
    this.place(position, direction, { x: size, y: size, z: size }, deltaMs);

    const id = this.sequenceFor(pose);
    if (id !== this.current) {
      this.current = id;
      this.elapsed = 0;
    }
    const frames = this.animation(id) ?? this.animation(this.data.sequences?.idle ?? SEQUENCES.idle);
    if (!frames) return;
    this.elapsed += deltaMs;
    const total = frames.reduce((sum, f) => sum + f.ms, 0);
    // Death plays once and holds its last frame.
    let t = id === SEQUENCES[Activity.Dead] ? Math.min(this.elapsed, total - 1) : this.elapsed % total;
    let index = 0;
    while (index < frames.length - 1 && t >= frames[index].ms) {
      t -= frames[index].ms;
      index++;
    }
    if (frames[index] !== this.shownFrame) {
      this.shownFrame = frames[index];
      applyFrame(this.data, frames[index].frame, this.posX, this.posY, this.posZ);
      this.writePositions(this.posX, this.posY, this.posZ);
    }
  }
}
