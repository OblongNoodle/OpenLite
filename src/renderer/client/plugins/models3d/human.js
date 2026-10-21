// Humans (players and human NPCs) and humanoid creatures.
import {
  AppearanceArt,
  SAME_COLOR_DISTANCE,
  colorDistance,
  isTranslucent,
  loadImage,
  opaqueBounds,
  opaqueFraction,
  readCell,
  readSpritesheetCell,
  sampleDominantColor,
  shade
} from "./sampling.js";
import { GeometryBuilder, RigModel } from "./geometry.js";
import { Activity, WALK_CYCLE_SPEED, approach, strikeCurve } from "./pose.js";

const CELL_WIDTH = AppearanceArt.CELL_WIDTH;
const CELL_HEIGHT = AppearanceArt.CELL_HEIGHT;

// Sample regions in a front idle cell (64x128), as lists of [x0, y0, x1, y1].
// The figure faces the viewer, so the character's right arm is on the image's left.
const SAMPLE_REGIONS = {
  hair: [[24, 5, 40, 13]],
  skin: [[27, 16, 37, 25]],
  beard: [[29, 22, 35, 28]],
  torso: [[22, 36, 42, 60]],
  belt: [[22, 63, 42, 67]],
  sleeve: [[9, 32, 18, 40], [46, 32, 55, 40]],
  forearm: [[9, 50, 16, 62], [48, 50, 55, 62]],
  hand: [[9, 68, 16, 78], [48, 68, 55, 78]],
  legs: [[18, 80, 46, 96]],
  feet: [[15, 112, 52, 126]]
};
const FACE_REGION = [27, 16, 37, 25];
const SKIRT_GAP_REGION = [30, 84, 34, 100];

export const DEFAULT_COLORS = {
  hair: [0.35, 0.22, 0.12],
  skin: [0.85, 0.6, 0.42],
  beard: [0.85, 0.6, 0.42],
  torso: [0.55, 0.15, 0.12],
  belt: [0.3, 0.2, 0.12],
  sleeve: [0.55, 0.15, 0.12],
  forearm: [0.85, 0.6, 0.42],
  hand: [0.85, 0.6, 0.42],
  legs: [0.3, 0.3, 0.45],
  feet: [0.25, 0.18, 0.12]
};

const DARK = [0.08, 0.06, 0.06];

// Joint heights and shoulder spacing of the humanoid rig (2 units tall).
const LAYOUT = { hipY: 0.98, shoulderY: 1.55, neckY: 1.62, shoulderX: 0.2 };
// Heads are modelled at about 0.5 units tall and scaled down to OSRS size.
const HEAD_SCALE = 0.62;
const BONE = [0.86, 0.82, 0.7];
const LEG_SWING = 0.6;
const ARM_SWING = 0.5;

// Equipment slots in loadout order, with the appearance art layer for each.
export const EquipSlot = { Helmet: 0, Chest: 1, Legs: 2, Shield: 3, Weapon: 4, Back: 5, Neck: 6, Gloves: 7, Boots: 8 };
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

// Humanoid creatures, by a word in their name: the head and body variant to
// build, plus the weapon they carry in their sprite art.
const HUMANOID_CREATURES = [
  { word: "minotaur", variant: "bull", weapon: "axe" },
  { word: "ghost", variant: "ghost" },
  { word: "nisse", variant: "gnome" },
  { word: "damogui", variant: "demon", weapon: "staff" }
];

export function humanoidCreatureFor(name) {
  return HUMANOID_CREATURES.find((creature) => name.includes(creature.word)) ?? null;
}

function sampleBodyColors(pixels, mask) {
  const colors = {};
  for (const [part, regions] of Object.entries(SAMPLE_REGIONS)) {
    colors[part] = sampleDominantColor(pixels, CELL_WIDTH, regions, mask) || DEFAULT_COLORS[part];
  }
  return colors;
}

// Everything needed to build a human: body colours plus a description of each
// equipped item (name, colours, and coverage read from its art).
export async function loadHumanSpec(spritesheetInfo, getItemName) {
  const equipped = spritesheetInfo.EquippedItemIDs || [];
  const gear = {};
  const all = [[0, 0, CELL_WIDTH, CELL_HEIGHT]];
  await Promise.all(Object.entries(SLOT_LAYERS).map(async ([slot, [layer, trimLayer]]) => {
    const entry = equipped[slot];
    if (!entry || entry[EquipField.ItemID] < 0) return;
    const pixels = await AppearanceArt.getSpriteCell(layer, entry[EquipField.SpritesheetID], entry[EquipField.SpriteID]);
    const trimPixels = trimLayer && entry[EquipField.TrimSpritesheetID] >= 0
      ? await AppearanceArt.getSpriteCell(trimLayer, entry[EquipField.TrimSpritesheetID], entry[EquipField.TrimSpriteID])
      : null;
    const item = {
      name: getItemName(entry[EquipField.ItemID]),
      pixels,
      color: (pixels && sampleDominantColor(pixels, CELL_WIDTH, all)) || [0.5, 0.5, 0.5],
      trim: trimPixels ? sampleDominantColor(trimPixels, CELL_WIDTH, all) : null
    };
    if (pixels && Number(slot) === EquipSlot.Weapon) {
      // Weapon art is drawn head-up: the top part is the head, the rest the handle.
      const bounds = opaqueBounds(pixels, CELL_WIDTH, CELL_HEIGHT);
      if (bounds) {
        // The handle is sampled from its middle; its far end is often a dark grip cap.
        const at = (fraction) => Math.round(bounds.minY + (bounds.maxY - bounds.minY) * fraction);
        item.headColor = sampleDominantColor(pixels, CELL_WIDTH, [[0, bounds.minY, CELL_WIDTH, at(0.4)]]) || item.color;
        item.handleColor = sampleDominantColor(pixels, CELL_WIDTH, [[0, at(0.45), CELL_WIDTH, at(0.8)]]) || item.color;
      }
    }
    if (pixels && Number(slot) === EquipSlot.Helmet) item.coversFace = opaqueFraction(pixels, CELL_WIDTH, FACE_REGION) > 0.5;
    if (pixels && Number(slot) === EquipSlot.Legs) item.isSkirt = opaqueFraction(pixels, CELL_WIDTH, SKIRT_GAP_REGION) > 0.6;
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
  return { colors: sampleBodyColors(readCell(sheet, 0, 0, CELL_WIDTH, CELL_HEIGHT), mask), gear };
}

// Humanoid creatures share the human rig; their colours come from their own
// front idle cell in the creature sheet (same 64x128 layout as humans).
export async function loadHumanoidCreatureSpec(spritesheetInfo, startIndex, creature) {
  const { pixels } = await readSpritesheetCell(spritesheetInfo, startIndex);
  const colors = sampleBodyColors(pixels, null);
  const translucent = isTranslucent(pixels);
  const gear = {};
  if (creature.weapon) {
    gear[EquipSlot.Weapon] = { name: creature.weapon, color: [0.55, 0.55, 0.58], headColor: [0.55, 0.55, 0.58], handleColor: [0.4, 0.25, 0.12] };
  }
  return { colors, gear, variant: creature.variant, translucent };
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

// Head geometry for each variant, in head space (neck at the origin).
function buildHead(c, gear, variant) {
  const head = new GeometryBuilder();
  switch (variant) {
    case "bull":
      return head
        .box(0.14, 0.08, 0.14, 0, 0.04, 0, c.skin)
        .box(0.34, 0.32, 0.34, 0, 0.22, 0, c.skin)
        .box(0.26, 0.17, 0.14, 0, 0.14, 0.22, shade(c.skin, 1.25))
        .box(0.04, 0.04, 0.02, -0.06, 0.15, 0.295, DARK)
        .box(0.04, 0.04, 0.02, 0.06, 0.15, 0.295, DARK)
        .box(0.05, 0.05, 0.02, -0.1, 0.3, 0.175, DARK)
        .box(0.05, 0.05, 0.02, 0.1, 0.3, 0.175, DARK)
        .box(0.2, 0.06, 0.06, -0.25, 0.38, 0, BONE, 0, -0.5)
        .box(0.2, 0.06, 0.06, 0.25, 0.38, 0, BONE, 0, 0.5)
        .box(0.12, 0.05, 0.03, -0.2, 0.3, -0.05, c.skin)
        .box(0.12, 0.05, 0.03, 0.2, 0.3, -0.05, c.skin);
    case "ghost": {
      // A deep hood with only a shadowed face and pale eyes showing.
      const hood = c.torso;
      return head
        .box(0.36, 0.38, 0.34, 0, 0.22, -0.01, hood)
        .box(0.24, 0.22, 0.02, 0, 0.2, 0.161, DARK)
        .box(0.05, 0.03, 0.01, -0.06, 0.24, 0.172, [0.85, 0.95, 1])
        .box(0.05, 0.03, 0.01, 0.06, 0.24, 0.172, [0.85, 0.95, 1])
        .box(0.2, 0.12, 0.2, 0, 0.44, -0.04, hood);
    }
    case "gnome":
      // A tall pointed hat over a big beard.
      head
        .box(0.1, 0.06, 0.1, 0, 0.03, 0, c.skin)
        .box(0.3, 0.3, 0.28, 0, 0.21, 0, c.skin)
        .box(0.05, 0.04, 0.02, -0.07, 0.25, 0.145, DARK)
        .box(0.05, 0.04, 0.02, 0.07, 0.25, 0.145, DARK)
        .box(0.06, 0.06, 0.05, 0, 0.19, 0.16, shade(c.skin, 0.9))
        .box(0.3, 0.2, 0.06, 0, 0.06, 0.15, c.beard)
        .box(0.2, 0.12, 0.05, 0, -0.06, 0.15, c.beard);
      for (let i = 0; i < 5; i++) {
        const size = 0.36 - i * 0.07;
        head.box(size, 0.11, size, 0, 0.4 + i * 0.1, -0.01 - i * 0.015, c.hair);
      }
      return head;
    case "demon":
      return head
        .box(0.12, 0.06, 0.12, 0, 0.03, 0, c.skin)
        .box(0.32, 0.32, 0.3, 0, 0.22, 0, c.skin)
        .box(0.06, 0.035, 0.02, -0.07, 0.26, 0.155, [0.95, 0.15, 0.1])
        .box(0.06, 0.035, 0.02, 0.07, 0.26, 0.155, [0.95, 0.15, 0.1])
        .box(0.06, 0.2, 0.06, -0.12, 0.45, -0.02, shade(c.skin, 0.6), -0.3, 0.35)
        .box(0.06, 0.2, 0.06, 0.12, 0.45, -0.02, shade(c.skin, 0.6), -0.3, -0.35);
  }

  // Neck, then the head: chin forward, square jaw, cheekbones, brow, crown.
  head.loft([{ t: -0.02, w: 0.058, f: 0.055, b: 0.06 }, { t: 0.08, w: 0.06, f: 0.055, b: 0.065 }], 8, 0, 0, -0.01, c.skin)
    .loft([
      { t: 0.05, w: 0.07, f: 0.13, b: 0.05, oz: 0.0, n: 2.6 },
      { t: 0.1, w: 0.115, f: 0.145, b: 0.09, n: 2.7 },
      { t: 0.18, w: 0.142, f: 0.15, b: 0.135, n: 2.6 },
      { t: 0.27, w: 0.15, f: 0.152, b: 0.15, n: 2.5 },
      { t: 0.35, w: 0.145, f: 0.14, b: 0.15 },
      { t: 0.42, w: 0.115, f: 0.105, b: 0.12 },
      { t: 0.465, w: 0.05, f: 0.045, b: 0.055 }
    ], 12, 0, 0, -0.01, c.skin)
    // Nose: a wedge widening toward its base.
    .loft([{ t: 0.0, w: 0.016, f: 0.012, b: 0.012 }, { t: 0.05, w: 0.026, f: 0.022, b: 0.014 }, { t: 0.075, w: 0.032, f: 0.03, b: 0.012 }], 6, 0, 0.19, 0.145, shade(c.skin, 0.95), { tiltX: -0.25 })
    // Brow ridge over inset eyes, and a mouth.
    .loft([{ t: -0.1, w: 0.012, f: 0.014, b: 0.01 }, { t: 0.1, w: 0.012, f: 0.014, b: 0.01 }], 6, 0, 0.29, 0.14, shade(c.skin, 0.9), { tiltZ: Math.PI / 2 })
    .box(0.042, 0.028, 0.02, -0.058, 0.258, 0.138, DARK)
    .box(0.042, 0.028, 0.02, 0.058, 0.258, 0.138, DARK)
    .box(0.075, 0.014, 0.02, 0, 0.135, 0.135, shade(c.skin, 0.65))
    // Ears.
    .blob([0.02, 0.045, 0.03], -0.15, 0.24, -0.01, shade(c.skin, 0.95), { roughness: 0.05, sides: 8, rings: 5 })
    .blob([0.02, 0.045, 0.03], 0.15, 0.24, -0.01, shade(c.skin, 0.95), { roughness: 0.05, sides: 8, rings: 5 });
  if (colorDistance(c.beard, c.skin) > SAME_COLOR_DISTANCE) {
    // A full beard following the jaw, thickest at the chin.
    head.loft([
      { t: 0.03, w: 0.055, f: 0.14, b: 0.04 },
      { t: 0.09, w: 0.12, f: 0.155, b: 0.09 },
      { t: 0.16, w: 0.148, f: 0.153, b: 0.13 }
    ], 12, 0, -0.005, -0.006, c.beard)
      .box(0.1, 0.03, 0.03, 0, 0.165, 0.15, c.beard);
  }
  const helmet = gear[EquipSlot.Helmet];
  if (helmet) {
    const metal = helmet.color;
    // A dome over the crown down to the brow.
    head.loft([
      { t: 0.29, w: 0.168, f: 0.164, b: 0.172, n: 2.6 },
      { t: 0.37, w: 0.168, f: 0.158, b: 0.172 },
      { t: 0.44, w: 0.14, f: 0.13, b: 0.148 },
      { t: 0.5, w: 0.06, f: 0.055, b: 0.065 }
    ], 12, 0, 0, -0.01, metal);
    if (helmet.coversFace) {
      // A full helm closes the front too, leaving eye and breathing slits.
      head.loft([
        { t: 0.06, w: 0.13, f: 0.16, b: 0.1, n: 2.8 },
        { t: 0.18, w: 0.16, f: 0.165, b: 0.15, n: 2.8 },
        { t: 0.3, w: 0.168, f: 0.166, b: 0.172, n: 2.6 }
      ], 12, 0, 0, -0.01, metal)
        .box(0.2, 0.026, 0.02, 0, 0.255, 0.165, DARK)
        .box(0.026, 0.11, 0.02, 0, 0.17, 0.168, DARK);
    } else {
      // A medium helm: plates down the sides and back framing an open face,
      // and a nose guard.
      head.loft([
        { t: 0.12, w: 0.15, f: 0.03, b: 0.1, oz: -0.06 },
        { t: 0.22, w: 0.168, f: 0.05, b: 0.115, oz: -0.06 },
        { t: 0.31, w: 0.17, f: 0.06, b: 0.11, oz: -0.06 }
      ], 12, 0, 0, -0.01, metal)
        .box(0.032, 0.12, 0.03, 0, 0.255, 0.168, metal);
    }
    if (helmet.trim) head.loft([{ t: 0.3, w: 0.172, f: 0.168, b: 0.176 }, { t: 0.33, w: 0.172, f: 0.166, b: 0.176 }], 12, 0, 0, -0.01, helmet.trim);
  } else {
    // Hair: a chunky cap from a fringe above the brow, over the crown and down
    // the back of the head, slightly larger than the skull beneath.
    head.loft([
      { t: 0.32, w: 0.166, f: 0.162, b: 0.172, n: 2.6 },
      { t: 0.38, w: 0.165, f: 0.155, b: 0.172 },
      { t: 0.44, w: 0.138, f: 0.126, b: 0.146 },
      { t: 0.49, w: 0.07, f: 0.064, b: 0.076 }
    ], 12, 0, 0, -0.01, c.hair)
      .loft([
        { t: 0.12, w: 0.14, f: 0.03, b: 0.07, oz: -0.11 },
        { t: 0.22, w: 0.163, f: 0.05, b: 0.09, oz: -0.1 },
        { t: 0.34, w: 0.166, f: 0.07, b: 0.085, oz: -0.09 }
      ], 10, 0, 0, -0.01, c.hair)
      .box(0.03, 0.13, 0.17, -0.155, 0.27, -0.035, c.hair)
      .box(0.03, 0.13, 0.17, 0.155, 0.27, -0.035, c.hair);
  }
  return head;
}

// A jointed humanoid, 2 units tall at scale 1 (the height of a human sprite).
export class HumanModel extends RigModel {
  constructor(scene, ctors, material, spec, name) {
    super(scene, ctors, material, name);
    this.walkPhase = 0;
    this.variant = spec.variant ?? null;
    this.build(spec);
  }

  // OSRS proportions (2 units tall): long legs with the belt at half height,
  // a slim torso, narrow shoulders, arms hanging close, a small head.
  build({ colors: c, gear }) {
    const { hipY, shoulderY, neckY, shoulderX } = LAYOUT;
    const chest = gear[EquipSlot.Chest];
    const legs = gear[EquipSlot.Legs];
    const isGhost = this.variant === "ghost";

    // Legs: thigh, knee, calf, ankle, then a compact boot with its toe forward.
    // Ghosts have no visible legs: the robe reaches the ground instead.
    const legColor = isGhost ? c.torso : c.legs, bootColor = isGhost ? c.torso : c.feet;
    const leg = () => new GeometryBuilder()
      .loft([
        { t: 0.03, w: 0.088, f: 0.085, b: 0.092 },
        { t: -0.15, w: 0.08, f: 0.08, b: 0.085 },
        { t: -0.38, w: 0.062, f: 0.066, b: 0.06 },
        { t: -0.44, w: 0.06, f: 0.064, b: 0.062, oz: 0.003 },
        { t: -0.56, w: 0.057, f: 0.056, b: 0.07, oz: -0.004 },
        { t: -0.7, w: 0.05, f: 0.05, b: 0.055 },
        { t: -0.8, w: 0.043, f: 0.045, b: 0.046 }
      ], 10, 0, 0, 0, legColor)
      .loft([
        { t: -0.77, w: 0.05, f: 0.054, b: 0.054, n: 2.6 },
        { t: -0.87, w: 0.055, f: 0.06, b: 0.06, n: 2.6 },
        { t: -0.93, w: 0.06, f: 0.1, b: 0.064, n: 2.8 },
        { t: -0.98, w: 0.058, f: 0.108, b: 0.062, n: 3 }
      ], 10, 0, 0, 0.008, bootColor);
    this.leftLeg = this.part("leg-l", leg(), -0.075, hipY, 0);
    this.rightLeg = this.part("leg-r", leg(), 0.075, hipY, 0);

    // Torso: a tunic hem over the trousers, a belt, a slim waist, chest and
    // shoulders, and the base of the neck.
    const torso = new GeometryBuilder()
      .loft([
        { t: -0.07, w: 0.152, f: 0.1, b: 0.1, n: 2.5 },
        { t: 0.1, w: 0.135, f: 0.085, b: 0.08, n: 2.5 },
        { t: 0.33, w: 0.158, f: 0.105, b: 0.088, n: 2.6 },
        { t: 0.5, w: 0.178, f: 0.098, b: 0.09, n: 2.7 },
        { t: 0.58, w: 0.155, f: 0.083, b: 0.083, n: 2.5 },
        { t: 0.64, w: 0.065, f: 0.05, b: 0.055 }
      ], 12, 0, 0, 0, c.torso)
      .loft([
        { t: -0.025, w: 0.148, f: 0.097, b: 0.097, n: 2.6 },
        { t: 0.035, w: 0.142, f: 0.092, b: 0.092, n: 2.6 }
      ], 12, 0, 0, 0, c.belt);
    if (isGhost) {
      torso.lathe([[0, 0.16, 0.11], [-0.5, 0.2, 0.15], [-0.96, 0.24, 0.18]], 8, 0, 0, 0, c.torso);
    } else if (legs?.isSkirt || hasWord(legs?.name || "", "skirt", "robe")) {
      torso.lathe([[0, 0.15, 0.1], [-0.5, 0.2, 0.15]], 8, 0, 0, 0, c.legs);
    }
    if (chest?.trim) torso.box(0.05, 0.42, 0.02, 0, 0.3, 0.1, chest.trim);
    const neck = gear[EquipSlot.Neck];
    if (neck) torso.box(0.05, 0.05, 0.02, 0, 0.52, 0.1, neck.color);
    this.torso = this.part("torso", torso, 0, hipY, 0);

    const back = gear[EquipSlot.Back];
    if (back) {
      // A cape hanging from the shoulders, flaring slightly toward the hem.
      this.part("cape", new GeometryBuilder()
        .box(0.3, 0.36, 0.025, 0, -0.18, 0, back.color, -0.05)
        .box(0.36, 0.5, 0.025, 0, -0.6, -0.02, back.color, -0.08), 0, 0.6, -0.1, this.torso);
    }

    // Arms: shoulder, upper arm in the sleeve to the elbow, slim forearm, and a
    // small hand with a thumb on the inner side.
    const arm = (isLeft) => {
      const inner = isLeft ? 1 : -1;
      const g = new GeometryBuilder()
        .loft([
          { t: 0.05, w: 0.035, f: 0.035, b: 0.035 },
          { t: 0.01, w: 0.057, f: 0.056, b: 0.058 },
          { t: -0.12, w: 0.053, f: 0.05, b: 0.05 },
          { t: -0.27, w: 0.046, f: 0.046, b: 0.046 }
        ], 10, 0, 0, 0, c.sleeve)
        .loft([
          { t: -0.25, w: 0.04, f: 0.04, b: 0.04 },
          { t: -0.33, w: 0.043, f: 0.043, b: 0.041 },
          { t: -0.5, w: 0.032, f: 0.032, b: 0.03 }
        ], 10, 0, 0, 0, c.forearm)
        .loft([
          { t: -0.49, w: 0.033, f: 0.033, b: 0.03, n: 2.8 },
          { t: -0.55, w: 0.037, f: 0.044, b: 0.032, n: 3 },
          { t: -0.61, w: 0.036, f: 0.042, b: 0.03, n: 3 },
          { t: -0.65, w: 0.025, f: 0.03, b: 0.022, n: 2.8 }
        ], 10, 0, 0, 0.003, c.hand)
        .loft([
          { t: 0, w: 0.013, f: 0.014, b: 0.013 },
          { t: -0.045, w: 0.011, f: 0.012, b: 0.011 }
        ], 6, inner * 0.03, -0.54, 0.025, c.hand, { tiltX: 0.5, tiltZ: inner * 0.5 });
      if (chest && hasWord(chest.name, "plate")) {
        g.lathe([[-0.05, 0.07, 0.075], [0.03, 0.066, 0.07], [0.06, 0.035, 0.04]], 8, isLeft ? -0.01 : 0.01, 0, 0, chest.color);
      }
      return g;
    };
    this.leftArm = this.part("arm-l", arm(true), -shoulderX, shoulderY, 0);
    this.rightArm = this.part("arm-r", arm(false), shoulderX, shoulderY, 0);
    // Arms hang slightly away from the body.
    this.leftArm.rotation.z = -0.06;
    this.rightArm.rotation.z = 0.06;

    const weapon = gear[EquipSlot.Weapon];
    if (weapon) {
      // Held just outside the fist so the head clears the arm and torso.
      const mesh = this.part("weapon", buildWeapon(weapon), 0.04, -0.6, 0.03, this.rightArm);
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
      this.part("shield", g, -0.07, -0.42, 0.02, this.leftArm);
    }

    this.head = this.part("head", buildHead(c, gear, this.variant), 0, neckY, 0);
    // The head is modelled large for detail and scaled to OSRS size here.
    const headScale = this.variant ? 0.72 : HEAD_SCALE;
    this.head.scaling.set(headScale, headScale, headScale);
  }

  // pose: { moving, activity, strike } where strike is the 0-1 progress of the
  // current action swing (null when not swinging).
  update(position, direction, pose, scale, deltaMs) {
    this.place(position, direction, { x: scale, y: scale, z: scale }, deltaMs);

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
      }
    }
    this.rightArmAngle = approach(this.rightArmAngle ?? 0, rightArm, deltaMs, pose.strike !== null ? 0.05 : 0.012);
    this.leftArmAngle = approach(this.leftArmAngle ?? 0, leftArm, deltaMs, pose.strike !== null ? 0.05 : 0.012);
    this.lean = approach(this.lean ?? 0, lean, deltaMs, 0.02);

    const legSwing = this.variant === "ghost" ? 0 : swing * LEG_SWING;
    this.leftLeg.rotation.x = legSwing;
    this.rightLeg.rotation.x = -legSwing;
    this.rightArm.rotation.x = this.rightArmAngle;
    this.leftArm.rotation.x = this.leftArmAngle;
    this.torso.rotation.x = this.head.rotation.x = this.lean;
    this.torso.position.y = LAYOUT.hipY + bob;
    this.head.position.y = LAYOUT.neckY + bob;
    this.leftArm.position.y = this.rightArm.position.y = LAYOUT.shoulderY + bob;

    // Fall backwards onto the ground when dead.
    const lying = this.updateLying(pose.activity === Activity.Dead, deltaMs);
    this.root.rotation.x = -lying * Math.PI / 2;
    let lift = lying * 0.15;
    // Ghosts hover and drift up and down.
    if (this.variant === "ghost") lift += (0.12 + 0.05 * Math.sin(performance.now() / 600)) * (1 - lying);
    this.root.position.y = position.y + lift * scale;
  }
}
