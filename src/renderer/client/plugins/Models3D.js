// src/Models3D.ts
// Replaces the main player's 2D billboard sprite with a low-poly, OSRS-style
// 3D model. Body colours are sampled from the player's own composited
// spritesheet, and equipped gear is built from each item's name (for its
// shape) and the game's equipment art (for its colours and coverage).
import { Plugin, SettingsTypes, ActionState } from "@highlite/core";

const ASSET_MANIFEST_URL = "https://highspell.com:3002/assetsClient";

// Direction enum order in the client: N, E, S, W, NE, SE, SW, NW.
// North is +Z and east is +X; Babylon's yaw turns +Z toward +X.
const DIRECTION_YAW = [
  0,
  Math.PI / 2,
  Math.PI,
  -Math.PI / 2,
  Math.PI / 4,
  (3 * Math.PI) / 4,
  (-3 * Math.PI) / 4,
  -Math.PI / 4
];

// Sprite cells are 64x128. Sheets hold two sprites per row, 15 cells each;
// cell 0 of a sprite is the front-facing idle frame.
const CELL_WIDTH = 64;
const CELL_HEIGHT = 128;
const CELLS_PER_SPRITE = 15;
const SPRITES_PER_ROW = 2;

// Sample regions in the front idle cell, as lists of [x0, y0, x1, y1]. The
// figure faces the viewer, so the character's right arm is on the image's left.
const SAMPLE_REGIONS = {
  hair: [[24, 5, 40, 13]],
  skin: [[27, 16, 37, 25]],
  beard: [[29, 22, 35, 28]],
  torso: [[22, 36, 42, 60]],
  sleeve: [[9, 32, 18, 40], [46, 32, 55, 40]],
  forearm: [[9, 50, 16, 62], [48, 50, 55, 62]],
  hand: [[9, 68, 16, 78], [48, 68, 55, 78]],
  legs: [[18, 80, 46, 96]],
  feet: [[15, 112, 52, 126]]
};
const FACE_REGION = [27, 16, 37, 25];
const SKIRT_GAP_REGION = [30, 84, 34, 100];

const DEFAULT_COLORS = {
  hair: [0.35, 0.22, 0.12],
  skin: [0.85, 0.6, 0.42],
  beard: [0.85, 0.6, 0.42],
  torso: [0.55, 0.15, 0.12],
  sleeve: [0.55, 0.15, 0.12],
  forearm: [0.85, 0.6, 0.42],
  hand: [0.85, 0.6, 0.42],
  legs: [0.3, 0.3, 0.45],
  feet: [0.25, 0.18, 0.12]
};

// Equipment slots in loadout order, with the appearance art layer for each.
const EquipSlot = { Helmet: 0, Chest: 1, Legs: 2, Shield: 3, Weapon: 4, Back: 5, Neck: 6, Gloves: 7, Boots: 8 };
const SLOT_LAYERS = {
  [EquipSlot.Helmet]: ["helmet", "helmettrim"],
  [EquipSlot.Chest]: ["chest", "chesttrim"],
  [EquipSlot.Legs]: ["legs", "legstrim"],
  [EquipSlot.Shield]: ["shield_front", "shieldtrim_front"],
  [EquipSlot.Weapon]: ["weapon", null],
  [EquipSlot.Back]: ["cape_back", null],
  [EquipSlot.Neck]: ["neck", null],
  [EquipSlot.Gloves]: ["gloves", null],
  [EquipSlot.Boots]: ["boots", null]
};
// Indices into an EquippedItemIDs entry.
const EquipField = { SpritesheetID: 0, SpriteID: 1, ItemID: 2, TrimSpritesheetID: 3, TrimSpriteID: 4 };

// Below this RGB distance (0-1 per channel) two sampled colours count as the same,
// e.g. a "beard" sample that is really just chin skin.
const SAME_COLOR_DISTANCE = 0.12;
const DARK = [0.08, 0.06, 0.06];

const WALK_CYCLE_SPEED = 0.011;
const LEG_SWING = 0.6;
const ARM_SWING = 0.5;
const TURN_RATE = 0.012;

// The sprite's action animation (one swing per skilling tick or attack) lasts
// four 100ms frames; our swing follows the same timing.
const STRIKE_DURATION_MS = 450;

// Pose families; each game action state maps onto one of these.
const Activity = { Idle: 0, Chop: 1, Melee: 2, Ranged: 3, Magic: 4, Fish: 5, Work: 6, Dead: 7 };
const ACTIVITY_BY_STATE = new Map([
  [ActionState.WoodcuttingState, Activity.Chop],
  [ActionState.MiningState, Activity.Chop],
  [ActionState.MineThroughRocksState, Activity.Chop],
  [ActionState.SmithingState, Activity.Chop],
  [ActionState.DiggingState, Activity.Chop],
  [ActionState.MeleeCombatState, Activity.Melee],
  [ActionState.RangeCombatState, Activity.Ranged],
  [ActionState.MagicCombatState, Activity.Magic],
  [ActionState.EnchantingState, Activity.Magic],
  [ActionState.FishingState, Activity.Fish],
  [ActionState.CookingState, Activity.Work],
  [ActionState.HarvestingState, Activity.Work],
  [ActionState.TreeShakingState, Activity.Work],
  [ActionState.SmeltingState, Activity.Work],
  [ActionState.SmeltingKilnState, Activity.Work],
  [ActionState.CraftingState, Activity.Work],
  [ActionState.PotionMakingState, Activity.Work],
  [ActionState.UsingSpinningWheelState, Activity.Work],
  [ActionState.CreatingNonSkillItemsState, Activity.Work],
  [ActionState.PickpocketingState, Activity.Work],
  [ActionState.PicklockingState, Activity.Work],
  [ActionState.UsingItemOnEntityState, Activity.Work],
  [ActionState.PlayerDeadState, Activity.Dead],
  [ActionState.NPCDeadState, Activity.Dead]
]);

// The game only fires an action every few seconds while skilling. OSRS loops
// these animations continuously, so these activities also swing on their own
// rhythm, restarting whenever the game fires a real action.
const LOOP_INTERVAL_MS = new Map([
  [Activity.Chop, 1200],
  [Activity.Work, 1500]
]);

// Swing shape over strike progress 0-1: hold, strike fast, hold, then recover.
// Returns 0 (wound up) to 1 (impact); 0 when not striking.
function strikeCurve(progress) {
  if (progress === null) return 0;
  if (progress < 0.2) return 0;
  if (progress < 0.45) return (progress - 0.2) / 0.25;
  if (progress < 0.75) return 1;
  return 1 - (progress - 0.75) / 0.25;
}

// Moves value toward target at a rate (per ms) proportional to the distance.
function approach(value, target, deltaMs, rate) {
  return value + (target - value) * Math.min(1, deltaMs * rate);
}

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function shade(color, factor) {
  return [Math.min(1, color[0] * factor), Math.min(1, color[1] * factor), Math.min(1, color[2] * factor)];
}

// Dominant colour across regions of a cell: quantize to 4 bits per channel, take
// the most common bucket, then average the real pixels in it. Pixels where the
// mask is set (e.g. covered by a held weapon) are ignored.
function sampleDominantColor(pixels, regions, mask = null) {
  const buckets = new Map();
  for (const [x0, y0, x1, y1] of regions) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = y * CELL_WIDTH + x;
        if (mask && mask[p]) continue;
        const i = p * 4;
        if (pixels[i + 3] < 200) continue;
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
  // Art is shaded, so the single most common tone is often a shadow. Among the
  // common tones (at least half as frequent as the top one), take the brightest.
  let maxCount = 0;
  for (const bucket of buckets.values()) maxCount = Math.max(maxCount, bucket.count);
  let best = null, bestLuma = -1;
  for (const bucket of buckets.values()) {
    if (bucket.count < maxCount * 0.5) continue;
    const luma = (0.3 * bucket.r + 0.59 * bucket.g + 0.11 * bucket.b) / bucket.count;
    if (luma > bestLuma) {
      best = bucket;
      bestLuma = luma;
    }
  }
  if (!best) return null;
  return [best.r / best.count / 255, best.g / best.count / 255, best.b / best.count / 255];
}

function opaqueFraction(pixels, [x0, y0, x1, y1]) {
  let opaque = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) if (pixels[(y * CELL_WIDTH + x) * 4 + 3] > 128) opaque++;
  }
  return opaque / ((x1 - x0) * (y1 - y0));
}

function opaqueBounds(pixels) {
  let minY = CELL_HEIGHT, maxY = -1;
  for (let y = 0; y < CELL_HEIGHT; y++) {
    for (let x = 0; x < CELL_WIDTH; x++) {
      if (pixels[(y * CELL_WIDTH + x) * 4 + 3] > 128) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return maxY < 0 ? null : { minY, maxY };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function readCell(image, cellX, cellY) {
  const canvas = document.createElement("canvas");
  canvas.width = CELL_WIDTH;
  canvas.height = CELL_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, cellX, cellY, CELL_WIDTH, CELL_HEIGHT, 0, 0, CELL_WIDTH, CELL_HEIGHT);
  return context.getImageData(0, 0, CELL_WIDTH, CELL_HEIGHT).data;
}

// The game's equipment art (one PNG per layer), fetched once from the same
// asset pack the game client uses.
class AppearanceArt {
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
    const cellX = (spriteId % SPRITES_PER_ROW) * CELLS_PER_SPRITE * CELL_WIDTH;
    const cellY = Math.floor(spriteId / SPRITES_PER_ROW) * CELL_HEIGHT;
    return readCell(image, cellX, cellY);
  }
}

// Everything needed to build a model: body colours plus a description of each
// equipped item (name, colours, and coverage read from its art).
async function loadModelSpec(spritesheetInfo, getItemName) {
  const equipped = spritesheetInfo.EquippedItemIDs || [];
  const gear = {};
  await Promise.all(Object.entries(SLOT_LAYERS).map(async ([slot, [layer, trimLayer]]) => {
    const entry = equipped[slot];
    if (!entry || entry[EquipField.ItemID] < 0) return;
    const pixels = await AppearanceArt.getSpriteCell(layer, entry[EquipField.SpritesheetID], entry[EquipField.SpriteID]);
    const trimPixels = trimLayer && entry[EquipField.TrimSpritesheetID] >= 0
      ? await AppearanceArt.getSpriteCell(trimLayer, entry[EquipField.TrimSpritesheetID], entry[EquipField.TrimSpriteID])
      : null;
    const all = [[0, 0, CELL_WIDTH, CELL_HEIGHT]];
    const item = {
      name: getItemName(entry[EquipField.ItemID]),
      pixels,
      color: (pixels && sampleDominantColor(pixels, all)) || [0.5, 0.5, 0.5],
      trim: trimPixels ? sampleDominantColor(trimPixels, all) : null
    };
    if (pixels && Number(slot) === EquipSlot.Weapon) {
      // Weapon art is drawn head-up: the top part is the head, the rest the handle.
      const bounds = opaqueBounds(pixels);
      if (bounds) {
        // The handle is sampled from its middle; its far end is often a dark grip cap.
        const at = (fraction) => Math.round(bounds.minY + (bounds.maxY - bounds.minY) * fraction);
        item.headColor = sampleDominantColor(pixels, [[0, bounds.minY, CELL_WIDTH, at(0.4)]]) || item.color;
        item.handleColor = sampleDominantColor(pixels, [[0, at(0.45), CELL_WIDTH, at(0.8)]]) || item.color;
      }
    }
    if (pixels && Number(slot) === EquipSlot.Helmet) item.coversFace = opaqueFraction(pixels, FACE_REGION) > 0.5;
    if (pixels && Number(slot) === EquipSlot.Legs) item.isSkirt = opaqueFraction(pixels, SKIRT_GAP_REGION) > 0.6;
    gear[slot] = item;
  }));

  // Held items overlap the body in the 2D art; keep them out of body colours.
  const mask = new Uint8Array(CELL_WIDTH * CELL_HEIGHT);
  for (const slot of [EquipSlot.Weapon, EquipSlot.Shield]) {
    const pixels = gear[slot]?.pixels;
    if (!pixels) continue;
    for (let p = 0; p < mask.length; p++) if (pixels[p * 4 + 3] > 0) mask[p] = 1;
  }

  const sheet = await loadImage(spritesheetInfo.SpritesheetURL);
  const pixels = readCell(sheet, 0, 0);
  const colors = {};
  for (const [part, regions] of Object.entries(SAMPLE_REGIONS)) {
    colors[part] = sampleDominantColor(pixels, regions, mask) || DEFAULT_COLORS[part];
  }
  return { colors, gear };
}

// Accumulates flat-shaded, vertex-coloured boxes into one set of buffers.
// A box can be tilted about the X axis (positive tilts its top toward +Z).
class GeometryBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.indices = [];
  }

  box(width, height, depth, centerX, centerY, centerZ, color, tiltX = 0) {
    const hx = width / 2, hy = height / 2, hz = depth / 2;
    const cos = Math.cos(tiltX), sin = Math.sin(tiltX);
    const rotate = ([x, y, z]) => [x, y * cos - z * sin, y * sin + z * cos];
    const faces = [
      [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]],
      [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]],
      [[1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]]],
      [[-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]],
      [[0, 1, 0], [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]]],
      [[0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]]
    ];
    for (const [normal, corners] of faces) {
      const base = this.positions.length / 3;
      for (const corner of corners) {
        const [x, y, z] = rotate(corner);
        this.positions.push(x + centerX, y + centerY, z + centerZ);
        this.normals.push(...rotate(normal));
        this.colors.push(color[0], color[1], color[2], 1);
      }
      // Babylon is left-handed: clockwise winding when viewed from the front.
      this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    return this;
  }

  get isEmpty() {
    return this.indices.length === 0;
  }

  applyTo(mesh) {
    mesh.setVerticesData("position", this.positions, false);
    mesh.setVerticesData("normal", this.normals, false);
    mesh.setVerticesData("color", this.colors, false);
    mesh.setIndices(this.indices);
    return mesh;
  }
}

function hasWord(name, ...words) {
  return words.some((word) => name.includes(word));
}

// Held-weapon geometry in grip space: the hand is the origin and +Y runs along
// the handle toward the head.
function buildWeapon(item) {
  const name = item.name;
  const head = item.headColor || item.color;
  const handle = item.handleColor || shade(item.color, 0.7);
  const g = new GeometryBuilder();
  if (hasWord(name, "pickaxe")) {
    g.box(0.04, 0.62, 0.04, 0, 0.16, 0, handle)
      .box(0.05, 0.06, 0.36, 0, 0.45, 0.02, head)
      .box(0.04, 0.08, 0.05, 0, 0.41, 0.2, head)
      .box(0.04, 0.08, 0.05, 0, 0.41, -0.16, head);
  } else if (hasWord(name, "axe", "hatchet")) {
    g.box(0.04, 0.6, 0.04, 0, 0.15, 0, handle)
      .box(0.03, 0.16, 0.16, 0, 0.38, 0.09, head);
  } else if (hasWord(name, "dagger", "knife")) {
    g.box(0.05, 0.1, 0.05, 0, 0, 0, handle)
      .box(0.12, 0.03, 0.05, 0, 0.06, 0, head)
      .box(0.025, 0.26, 0.06, 0, 0.2, 0, head);
  } else if (hasWord(name, "sword", "scimitar", "blade", "sabre", "saber")) {
    const length = hasWord(name, "long", "2h", "great") ? 0.78 : 0.56;
    g.box(0.05, 0.14, 0.05, 0, 0, 0, handle)
      .box(0.18, 0.04, 0.06, 0, 0.08, 0, head)
      .box(0.025, length, 0.07, 0, 0.1 + length / 2, 0, head);
  } else if (hasWord(name, "mace", "hammer", "club", "maul")) {
    g.box(0.05, 0.5, 0.05, 0, 0.12, 0, handle)
      .box(0.14, 0.14, 0.14, 0, 0.4, 0, head);
  } else if (hasWord(name, "staff", "wand", "sceptre", "scepter")) {
    const length = hasWord(name, "wand") ? 0.4 : 1.1;
    g.box(0.05, length, 0.05, 0, length / 2 - 0.2, 0, handle)
      .box(0.1, 0.1, 0.1, 0, length - 0.15, 0, head);
  } else if (hasWord(name, "bow")) {
    g.box(0.04, 0.4, 0.04, 0, 0, 0.06, handle)
      .box(0.04, 0.32, 0.04, 0, 0.32, 0.0, handle, -0.45)
      .box(0.04, 0.32, 0.04, 0, -0.32, 0.0, handle, 0.45)
      .box(0.01, 1.0, 0.01, 0, 0, -0.08, [0.9, 0.9, 0.85]);
  } else if (hasWord(name, "rod", "harpoon", "spear", "net", "pole")) {
    g.box(0.04, 1.0, 0.04, 0, 0.3, 0, handle)
      .box(0.05, 0.12, 0.05, 0, 0.84, 0, head);
  } else {
    g.box(0.05, 0.5, 0.05, 0, 0.15, 0, handle)
      .box(0.1, 0.12, 0.1, 0, 0.42, 0, head);
  }
  return g;
}

function weaponTilt(name) {
  // Held roughly square to the forearm, so the head trails behind on the
  // wind-up and leads into the strike. Staffs and rods stay closer to upright.
  return hasWord(name, "staff", "wand", "sceptre", "scepter", "rod", "harpoon", "bow") ? 0.35 : 1.45;
}

// A jointed humanoid. Each limb's geometry hangs from its joint at the local
// origin so rotating the part swings it naturally. The model faces +Z.
class HumanModel {
  constructor(scene, ctors, material, spec, name) {
    this.scene = scene;
    this.ctors = ctors;
    this.material = material;
    this.name = name;
    this.root = new ctors.Mesh(`${name}-root`, scene);
    this.parts = [];
    this.walkPhase = 0;
    this.yaw = null;
    this.build(spec);
  }

  part(label, builder, x, y, z, parent = this.root) {
    const mesh = builder.applyTo(new this.ctors.Mesh(`${this.name}-${label}`, this.scene));
    mesh.material = this.material;
    mesh.isPickable = false;
    mesh.parent = parent;
    mesh.position.set(x, y, z);
    this.parts.push(mesh);
    return mesh;
  }

  build({ colors: c, gear }) {
    const hipY = 0.82;
    const shoulderY = 1.36;
    const neckY = 1.4;
    const helmet = gear[EquipSlot.Helmet];
    const chest = gear[EquipSlot.Chest];
    const legs = gear[EquipSlot.Legs];

    const leg = () => new GeometryBuilder()
      .box(0.17, 0.7, 0.2, 0, -0.35, 0, c.legs)
      .box(0.18, 0.12, 0.26, 0, -0.76, 0.03, c.feet);
    this.leftLeg = this.part("leg-l", leg(), -0.1, hipY, 0);
    this.rightLeg = this.part("leg-r", leg(), 0.1, hipY, 0);

    const torso = new GeometryBuilder()
      .box(0.46, 0.56, 0.26, 0, 0.28, 0, c.torso)
      .box(0.4, 0.06, 0.24, 0, 0.0, 0, c.legs);
    if (legs?.isSkirt || hasWord(legs?.name || "", "skirt", "robe")) {
      torso.box(0.44, 0.42, 0.3, 0, -0.2, 0, c.legs);
    }
    if (chest?.trim) torso.box(0.06, 0.5, 0.01, 0, 0.3, 0.135, chest.trim);
    const neck = gear[EquipSlot.Neck];
    if (neck) torso.box(0.07, 0.07, 0.02, 0, 0.42, 0.14, neck.color);
    this.torso = this.part("torso", torso, 0, hipY, 0);

    const back = gear[EquipSlot.Back];
    if (back) {
      this.part("cape", new GeometryBuilder().box(0.44, 0.74, 0.03, 0, -0.37, 0, back.color, -0.08), 0, 0.56, -0.15, this.torso);
    }

    const arm = (isLeft) => {
      const g = new GeometryBuilder()
        .box(0.14, 0.2, 0.16, 0, -0.09, 0, c.sleeve)
        .box(0.12, 0.23, 0.14, 0, -0.3, 0, c.forearm)
        .box(0.11, 0.12, 0.13, 0, -0.47, 0, c.hand);
      if (chest && hasWord(chest.name, "plate")) g.box(0.2, 0.1, 0.22, isLeft ? -0.02 : 0.02, 0.0, 0, chest.color);
      return g;
    };
    this.leftArm = this.part("arm-l", arm(true), -0.3, shoulderY, 0);
    this.rightArm = this.part("arm-r", arm(false), 0.3, shoulderY, 0);

    const weapon = gear[EquipSlot.Weapon];
    if (weapon) {
      // Held just outside the fist so the head clears the arm and torso.
      const mesh = this.part("weapon", buildWeapon(weapon), 0.06, -0.47, 0.05, this.rightArm);
      mesh.rotation.x = weaponTilt(weapon.name);
    }
    const shield = gear[EquipSlot.Shield];
    if (shield) {
      const g = new GeometryBuilder();
      const rim = shield.trim || shade(shield.color, 0.75);
      if (hasWord(shield.name, "kite")) {
        g.box(0.04, 0.42, 0.34, 0, 0.05, 0, shield.color)
          .box(0.04, 0.18, 0.2, 0, -0.25, 0, shield.color)
          .box(0.05, 0.05, 0.36, 0, 0.27, 0, rim);
      } else {
        g.box(0.04, 0.4, 0.38, 0, 0, 0, shield.color)
          .box(0.05, 0.44, 0.04, 0, 0, 0.18, rim)
          .box(0.05, 0.44, 0.04, 0, 0, -0.18, rim);
      }
      this.part("shield", g, -0.1, -0.32, 0.02, this.leftArm);
    }

    const head = new GeometryBuilder()
      .box(0.1, 0.06, 0.1, 0, 0.03, 0, c.skin)
      .box(0.3, 0.32, 0.28, 0, 0.22, 0, c.skin)
      .box(0.05, 0.04, 0.02, -0.07, 0.25, 0.145, DARK)
      .box(0.05, 0.04, 0.02, 0.07, 0.25, 0.145, DARK);
    if (colorDistance(c.beard, c.skin) > SAME_COLOR_DISTANCE) {
      head.box(0.26, 0.12, 0.05, 0, 0.1, 0.14, c.beard).box(0.14, 0.05, 0.04, 0, 0.18, 0.15, c.beard);
    }
    if (helmet) {
      const metal = helmet.color;
      head.box(0.35, 0.12, 0.33, 0, 0.43, 0, metal)
        .box(0.03, 0.22, 0.31, -0.165, 0.3, -0.01, metal)
        .box(0.03, 0.22, 0.31, 0.165, 0.3, -0.01, metal)
        .box(0.35, 0.24, 0.03, 0, 0.3, -0.155, metal);
      if (helmet.coversFace) {
        head.box(0.35, 0.24, 0.03, 0, 0.27, 0.155, metal)
          .box(0.22, 0.035, 0.01, 0, 0.27, 0.172, DARK);
      } else {
        head.box(0.04, 0.12, 0.02, 0, 0.31, 0.155, metal);
      }
      if (helmet.trim) head.box(0.04, 0.07, 0.3, 0, 0.52, 0, helmet.trim);
    } else {
      head.box(0.32, 0.09, 0.3, 0, 0.42, -0.005, c.hair)
        .box(0.32, 0.22, 0.06, 0, 0.3, -0.13, c.hair);
    }
    this.head = this.part("head", head, 0, neckY, 0);
  }

  // pose: { moving, activity, strike } where strike is the 0-1 progress of the
  // current action swing (null when not swinging).
  update(position, direction, pose, scale, deltaMs) {
    this.root.position.set(position.x, position.y, position.z);
    this.root.scaling.set(scale, scale, scale);

    const targetYaw = DIRECTION_YAW[direction] ?? this.yaw ?? Math.PI;
    if (this.yaw === null) this.yaw = targetYaw;
    let delta = targetYaw - this.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const maxStep = TURN_RATE * deltaMs;
    this.yaw += Math.max(-maxStep, Math.min(maxStep, delta));
    this.root.rotation.y = this.yaw;

    if (pose.moving) {
      this.walkPhase += deltaMs * WALK_CYCLE_SPEED;
    } else {
      // Settle back to a neutral stance at the nearest rest point of the cycle.
      const rest = Math.round(this.walkPhase / Math.PI) * Math.PI;
      this.walkPhase += (rest - this.walkPhase) * Math.min(1, deltaMs * 0.012);
    }
    const swing = Math.sin(this.walkPhase);
    const bob = Math.abs(Math.cos(this.walkPhase)) * 0.04;

    // Arm angles: negative rotation.x raises the arm forward.
    let rightArm = swing * ARM_SWING;
    let leftArm = -swing * ARM_SWING;
    let lean = 0;
    let lying = 0;
    if (!pose.moving) {
      const strike = strikeCurve(pose.strike);
      switch (pose.activity) {
        case Activity.Chop:
          // Hold the tool raised overhead, swing it down on each action.
          rightArm = -2.5 + 1.9 * strike;
          leftArm = -1.9 + 1.2 * strike;
          lean = 0.12 * strike;
          break;
        case Activity.Melee:
          // A quick forward thrust and recovery from a guard stance.
          rightArm = -0.6 - 1.3 * (pose.strike === null ? 0 : Math.sin(Math.PI * Math.min(1, pose.strike * 1.4)));
          leftArm = -0.35;
          lean = 0.1 * strike;
          break;
        case Activity.Ranged:
          leftArm = -1.5;
          rightArm = -1.45 + 0.5 * strike;
          break;
        case Activity.Magic:
          rightArm = leftArm = -0.4 - 1.1 * strike;
          break;
        case Activity.Fish:
          rightArm = -0.85 + 0.08 * Math.sin(performance.now() / 300);
          leftArm = -0.7;
          break;
        case Activity.Work:
          rightArm = -0.9 + 0.3 * strike;
          leftArm = -0.85 + 0.25 * strike;
          lean = 0.15;
          break;
        case Activity.Dead:
          lying = 1;
          break;
      }
    }
    this.rightArmAngle = approach(this.rightArmAngle ?? 0, rightArm, deltaMs, pose.strike !== null ? 0.05 : 0.012);
    this.leftArmAngle = approach(this.leftArmAngle ?? 0, leftArm, deltaMs, pose.strike !== null ? 0.05 : 0.012);
    this.lean = approach(this.lean ?? 0, lean, deltaMs, 0.02);
    this.lying = approach(this.lying ?? 0, lying, deltaMs, 0.006);

    this.leftLeg.rotation.x = swing * LEG_SWING;
    this.rightLeg.rotation.x = -swing * LEG_SWING;
    this.rightArm.rotation.x = this.rightArmAngle;
    this.leftArm.rotation.x = this.leftArmAngle;
    this.torso.rotation.x = this.head.rotation.x = this.lean;
    this.torso.position.y = 0.82 + bob;
    this.head.position.y = 1.4 + bob;
    this.leftArm.position.y = this.rightArm.position.y = 1.36 + bob;
    // Fall backwards onto the ground when dead.
    this.root.rotation.x = -this.lying * Math.PI / 2;
    this.root.position.y = position.y + this.lying * 0.15 * scale;
  }

  dispose() {
    for (const part of this.parts) part.dispose();
    this.root.dispose();
    this.parts = [];
  }
}

// Model specs are cached per spritesheet so identical NPCs share one analysis.
const MAX_CACHED_SPECS = 256;

var Models3D = class extends Plugin {
  constructor() {
    super();
    this.pluginName = "3D Models";
    this.author = "HighLite-Client";
    this.settings.enable.value = true;
    this.settings.showSprite = {
      text: "Show 2D sprite too",
      type: SettingsTypes.checkbox,
      value: false,
      callback: () => {
      }
    };
    this.observer = null;
    this.material = null;
    this.ctors = null;
    this.records = new Map();
    this.specCache = new Map();
  }

  init() {
    this.log("Initializing");
    AppearanceArt.load();
  }

  start() {
    this.log("Started");
    // Hot-swapped instances keep their old fields; make sure ours exist.
    this.records ??= new Map();
    this.specCache ??= new Map();
    this.attachRenderObserver();
  }

  stop() {
    this.log("Stopped");
    this.detachRenderObserver();
    for (const record of this.records.values()) this.disposeRecord(record);
    this.records.clear();
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
  }

  get scene() {
    return this.gameHooks?.GameEngine?.Instance?.Scene ?? null;
  }

  attachRenderObserver() {
    if (this.observer) return;
    const scene = this.scene;
    if (!scene) {
      // The scene is created after login; retry until it exists.
      setTimeout(() => this.settings.enable.value && this.attachRenderObserver(), 500);
      return;
    }
    this.observer = scene.onBeforeRenderObservable.add(() => {
      try {
        this.renderFrame(scene);
      } catch (error) {
        this.error("renderFrame failed", error);
      }
    });
  }

  detachRenderObserver() {
    if (this.observer && this.scene) this.scene.onBeforeRenderObservable.remove(this.observer);
    this.observer = null;
  }

  // Babylon classes are taken from the game's own scene objects so our meshes
  // come from the exact same Babylon build the game renders with.
  resolveConstructors(appearance) {
    if (this.ctors) return this.ctors;
    const billboard = appearance.BillboardMesh;
    const standardMaterial = this.scene.materials.find((m) => m.getClassName() === "StandardMaterial");
    if (!billboard || !standardMaterial) return null;
    this.ctors = {
      Mesh: billboard.constructor,
      StandardMaterial: standardMaterial.constructor,
      Color3: standardMaterial.diffuseColor.constructor
    };
    return this.ctors;
  }

  getMaterial() {
    if (this.material) return this.material;
    const { StandardMaterial, Color3 } = this.ctors;
    const material = new StandardMaterial("models3d-material", this.scene);
    material.diffuseColor = new Color3(1, 1, 1);
    material.specularColor = new Color3(0, 0, 0);
    // Sprites render unlit at full brightness; partial self-illumination keeps the
    // model readable next to them in dark areas while still showing face shading.
    material.emissiveColor = new Color3(0.45, 0.45, 0.45);
    this.material = material;
    return material;
  }

  getItemName(itemId) {
    try {
      const def = this.gameHooks.ItemDefinitionManager.getDefById(itemId);
      return String(def?.Name ?? def?._name ?? "").toLowerCase();
    } catch {
      return "";
    }
  }

  getSpec(spritesheetInfo) {
    const url = spritesheetInfo.SpritesheetURL;
    let spec = this.specCache.get(url);
    if (!spec) {
      if (this.specCache.size >= MAX_CACHED_SPECS) this.specCache.clear();
      spec = loadModelSpec(spritesheetInfo, (id) => this.getItemName(id)).catch((error) => {
        this.error("Failed to build model spec", error);
        return { colors: DEFAULT_COLORS, gear: {} };
      });
      this.specCache.set(url, spec);
    }
    return spec;
  }

  // Every entity drawn with a human sprite: the main player, other players and
  // human NPCs. Creatures use a different spritesheet type without appearance IDs.
  *humanEntities() {
    const entities = this.gameHooks.EntityManager?.Instance;
    if (!entities) return;
    const isHuman = (entity) => entity && !entity.IsDestroyed && entity.Appearance?.BillboardMesh &&
      entity.Appearance.SpritesheetInformation?.AppearanceIDs;
    if (isHuman(entities.MainPlayer)) yield entities.MainPlayer;
    for (const player of entities.Players ?? []) if (isHuman(player)) yield player;
    for (const npc of entities.NPCs?.values() ?? []) if (isHuman(npc)) yield npc;
  }

  renderFrame(scene) {
    const deltaMs = scene.getEngine().getDeltaTime();
    const now = performance.now();
    const seen = new Set();
    for (const entity of this.humanEntities()) {
      const appearance = entity.Appearance;
      if (!this.resolveConstructors(appearance)) return;
      seen.add(entity);

      let record = this.records.get(entity);
      if (!record || record.appearance !== appearance) {
        if (record) this.disposeRecord(record);
        record = { entity, appearance, model: null, spritesheetUrl: null, pendingUrl: null, wasAnimatingAction: false, strikeStart: -Infinity };
        this.records.set(entity, record);
      }
      this.updateRecordModel(record);
      if (!record.model) continue;

      const visible = appearance.IsVisible !== false;
      record.model.root.setEnabled(visible);
      if (!visible) continue;

      // A rising edge of the sprite's action animation is one swing.
      const isAnimatingAction = appearance.IsAnimatingAction;
      if (isAnimatingAction && !record.wasAnimatingAction) record.strikeStart = now;
      record.wasAnimatingAction = isAnimatingAction;
      const state = entity.CurrentState?.getCurrentState?.();
      const activity = ACTIVITY_BY_STATE.get(state) ?? Activity.Idle;
      const loopInterval = LOOP_INTERVAL_MS.get(activity);
      if (loopInterval && !entity.IsMoving && now - record.strikeStart > loopInterval) record.strikeStart = now;
      const strikeElapsed = now - record.strikeStart;

      const scale = appearance.Height / 2;
      const position = {
        x: appearance.Position.x,
        y: appearance.Position.y - appearance.Height / 2,
        z: appearance.Position.z
      };
      // CurrentDirection is the world-space facing; the sprite's "apparent" direction
      // is relative to the camera and must not be used for a 3D model.
      record.model.update(position, appearance.CurrentDirection, {
        moving: entity.IsMoving,
        activity,
        strike: strikeElapsed < STRIKE_DURATION_MS ? strikeElapsed / STRIKE_DURATION_MS : null
      }, scale, deltaMs);

      // Keep the billboard in the scene (it is the click target) but invisible.
      const spriteVisibility = this.settings.showSprite.value ? 1 : 0;
      if (appearance.BillboardMesh.visibility !== spriteVisibility) appearance.BillboardMesh.visibility = spriteVisibility;
    }

    for (const [entity, record] of this.records) {
      if (!seen.has(entity)) {
        this.disposeRecord(record);
        this.records.delete(entity);
      }
    }
  }

  // Builds the model on first sight and rebuilds it when the spritesheet is
  // re-composited (appearance or gear changed).
  updateRecordModel(record) {
    const spritesheetInfo = record.appearance.SpritesheetInformation;
    const url = spritesheetInfo?.SpritesheetURL;
    if (!url || url === record.spritesheetUrl || url === record.pendingUrl) return;
    record.pendingUrl = url;
    this.getSpec(spritesheetInfo).then((spec) => {
      if (record.pendingUrl !== url || this.records.get(record.entity) !== record) return;
      record.pendingUrl = null;
      record.spritesheetUrl = url;
      const previousYaw = record.model?.yaw ?? null;
      if (record.model) record.model.dispose();
      record.model = new HumanModel(this.scene, this.ctors, this.getMaterial(), spec, `models3d-${record.entity.EntityID}`);
      record.model.yaw = previousYaw;
      record.spec = spec;
    });
  }

  disposeRecord(record) {
    if (record.model) record.model.dispose();
    record.model = null;
    record.pendingUrl = null;
    const billboard = record.appearance?.BillboardMesh;
    if (billboard && !record.entity.IsDestroyed) billboard.visibility = 1;
  }
};


// Dev only: swap code edits into the running plugin instead of letting Vite
// reload the page, which would log the player out.
if (import.meta.hot) {
  import.meta.hot.accept((updated) => {
    const entry = document.highlite?.managers?.PluginManager?.plugins?.find((p) => p.instance?.pluginName === "3D Models");
    const instance = entry?.instance;
    if (!updated?.default || !instance) return;
    const wasEnabled = instance.settings.enable.value;
    if (wasEnabled) instance.stop();
    Object.setPrototypeOf(instance, updated.default.prototype);
    if (wasEnabled) instance.start();
    console.info("[Models3D] Hot-swapped plugin code");
  });
}

export {
  Models3D as default
};
