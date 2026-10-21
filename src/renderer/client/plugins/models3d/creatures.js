// Non-human creatures (rats, chickens, cows, bears, dragons...).
//
// Each body shape is a rig built inside a unit box: width x in [-0.5, 0.5],
// height y in [0, 1], length z in [-0.5, 0.5] with the head toward +Z. The
// model is then stretched to the creature's real size, measured from its own
// sprite art, so one rig fits every species of that shape.
import {
  PALETTE_DISTANCE,
  colorDistance,
  opaqueBounds,
  readSpritesheetCell,
  sampleDominantColor,
  samplePalette,
  shade
} from "./sampling.js";
import { GeometryBuilder, RigModel } from "./geometry.js";
import { Activity, WALK_CYCLE_SPEED, approach, strikeCurve } from "./pose.js";

const DARK = [0.06, 0.05, 0.05];
const BONE = [0.88, 0.85, 0.75];
const PINK = [0.9, 0.6, 0.6];
const BEAK = [0.95, 0.72, 0.15];
const COMB = [0.85, 0.1, 0.1];

// Creature sprites hold 15 cells per creature: 3 frames for each of S, SE, E,
// NE and N. The first E frame is a clean side view.
const SIDE_VIEW_CELL = 6;

// Body shape for a creature, by a word in its name. Checked in order.
const CREATURE_FAMILIES = [
  ["jockey", "jockey"],
  ["squirrel", "squirrel"],
  ["rat", "rodent"],
  ["chicken", "bird"],
  ["rooster", "bird"],
  ["cow", "cattle"],
  ["bull", "cattle"],
  ["bear", "bear"],
  ["dragon", "dragon"]
];

export function creatureFamilyFor(name) {
  return CREATURE_FAMILIES.find(([word]) => name.includes(word))?.[1] ?? null;
}

// Colours and real-world proportions of one creature, from its sprite art.
export async function loadCreatureSpec(spritesheetInfo, startIndex, family, name) {
  const front = await readSpritesheetCell(spritesheetInfo, startIndex);
  const side = await readSpritesheetCell(spritesheetInfo, startIndex + SIDE_VIEW_CELL);
  const frontBounds = opaqueBounds(front.pixels, front.width, front.height);
  const sideBounds = opaqueBounds(side.pixels, side.width, side.height);
  // The front view is mostly body; the side view also shows wings, spots and
  // tails, which supply the secondary colours.
  const body = sampleDominantColor(front.pixels, front.width, [[0, 0, front.width, front.height]]) ?? [0.5, 0.5, 0.5];
  const others = samplePalette(side.pixels, side.width, side.height, 4).filter((color) => colorDistance(color, body) > PALETTE_DISTANCE);
  return {
    family,
    name,
    body,
    second: others[0] ?? shade(body, 0.7),
    third: others[1] ?? null,
    // Fractions of the sprite quad the creature actually fills.
    lengthFraction: sideBounds ? (sideBounds.maxX - sideBounds.minX + 1) / side.width : 1,
    heightFraction: sideBounds ? (sideBounds.maxY - sideBounds.minY + 1) / side.height : 1,
    widthFraction: frontBounds ? (frontBounds.maxX - frontBounds.minX + 1) / front.width : 1
  };
}

function leg(width, height, depth, color, footColor = color) {
  return new GeometryBuilder()
    .box(width, height, depth, 0, -height / 2, 0, color)
    .box(width * 1.1, Math.min(0.06, height * 0.2), depth * 1.3, 0, -height + 0.02, depth * 0.1, footColor);
}

// Each builder adds parts to the rig and records which ones animate:
// rig.legs [{ mesh, phase }], rig.head, rig.tail, rig.wings [left, right], rig.body.
const BUILDERS = {
  rodent(rig, s) {
    const accent = s.second;
    rig.body = rig.part("body", new GeometryBuilder().box(0.62, 0.42, 0.5, 0, 0.32, 0.02, s.body), 0, 0, 0);
    rig.head = rig.part("head", new GeometryBuilder()
      .box(0.5, 0.36, 0.22, 0, 0, 0.1, s.body)
      .box(0.24, 0.18, 0.1, 0, -0.06, 0.25, s.body)
      .box(0.1, 0.08, 0.04, 0, -0.06, 0.31, accent)
      .box(0.16, 0.16, 0.04, -0.2, 0.2, 0.04, accent)
      .box(0.16, 0.16, 0.04, 0.2, 0.2, 0.04, accent)
      .box(0.06, 0.06, 0.02, -0.12, 0.06, 0.21, DARK)
      .box(0.06, 0.06, 0.02, 0.12, 0.06, 0.21, DARK), 0, 0.34, 0.26);
    rig.tail = rig.part("tail", new GeometryBuilder().box(0.08, 0.07, 0.42, 0, 0, -0.2, accent, -0.25), 0, 0.3, -0.22);
    rig.legs = [
      [-0.24, 0.16, 0], [0.24, 0.16, Math.PI], [-0.24, -0.12, Math.PI], [0.24, -0.12, 0]
    ].map(([x, z, phase], i) => ({ mesh: rig.part(`leg-${i}`, leg(0.14, 0.16, 0.12, s.body, accent), x, 0.16, z), phase }));
  },

  squirrel(rig, s) {
    rig.body = rig.part("body", new GeometryBuilder().box(0.5, 0.42, 0.34, 0, 0.3, 0.1, s.body, -0.3), 0, 0, 0);
    rig.head = rig.part("head", new GeometryBuilder()
      .box(0.4, 0.3, 0.26, 0, 0.05, 0.08, s.body)
      .box(0.08, 0.14, 0.04, -0.13, 0.25, 0.04, s.body)
      .box(0.08, 0.14, 0.04, 0.13, 0.25, 0.04, s.body)
      .box(0.06, 0.06, 0.02, -0.1, 0.08, 0.215, DARK)
      .box(0.06, 0.06, 0.02, 0.1, 0.08, 0.215, DARK), 0, 0.48, 0.22);
    // A big bushy tail that curls up the back.
    rig.tail = rig.part("tail", new GeometryBuilder()
      .box(0.34, 0.22, 0.3, 0, 0.06, -0.12, s.second ?? s.body, 0.3)
      .box(0.36, 0.4, 0.22, 0, 0.34, -0.26, s.second ?? s.body)
      .box(0.3, 0.2, 0.2, 0, 0.6, -0.16, s.second ?? s.body, -0.5), 0, 0.18, -0.12);
    rig.legs = [
      [-0.16, 0.18, 0], [0.16, 0.18, Math.PI], [-0.18, -0.06, Math.PI], [0.18, -0.06, 0]
    ].map(([x, z, phase], i) => ({ mesh: rig.part(`leg-${i}`, leg(0.12, 0.14, 0.14, s.body), x, 0.14, z), phase }));
  },

  bird(rig, s) {
    buildBird(rig, s, 1);
  },

  // A goblin riding a chicken: the bird takes the lower part of the sprite.
  jockey(rig, s) {
    buildBird(rig, s, 0.62);
    const skin = [0.42, 0.58, 0.22];
    const clothes = s.third ?? s.second;
    const rider = rig.joint("rider", 0, 0.58, -0.02, rig.body);
    rig.part("rider-body", new GeometryBuilder()
      .box(0.34, 0.26, 0.2, 0, 0.13, 0, clothes)
      .box(0.1, 0.24, 0.1, -0.2, 0.12, 0.08, skin, -0.6)
      .box(0.1, 0.24, 0.1, 0.2, 0.12, 0.08, skin, -0.6)
      .box(0.1, 0.18, 0.12, -0.2, -0.02, 0.06, clothes, 1.2)
      .box(0.1, 0.18, 0.12, 0.2, -0.02, 0.06, clothes, 1.2), 0, 0, 0, rider);
    rig.part("rider-head", new GeometryBuilder()
      .box(0.24, 0.2, 0.2, 0, 0.1, 0, skin)
      .box(0.12, 0.06, 0.03, -0.17, 0.14, -0.02, skin, 0, 0.6)
      .box(0.12, 0.06, 0.03, 0.17, 0.14, -0.02, skin, 0, -0.6)
      .box(0.05, 0.04, 0.02, -0.05, 0.12, 0.105, DARK)
      .box(0.05, 0.04, 0.02, 0.05, 0.12, 0.105, DARK), 0, 0.26, 0, rider);
  },

  cattle(rig, s) {
    const isCow = s.name.includes("cow");
    rig.body = rig.part("body", new GeometryBuilder().box(0.86, 0.46, 0.66, 0, 0.62, -0.04, s.body), 0, 0, 0);
    if (isCow && s.second) {
      // Patches of the second colour on both flanks and the back.
      const patch = new GeometryBuilder()
        .box(0.03, 0.22, 0.22, -0.43, 0.66, 0.12, s.second)
        .box(0.03, 0.2, 0.18, 0.43, 0.6, -0.18, s.second)
        .box(0.03, 0.16, 0.16, 0.43, 0.7, 0.16, s.second)
        .box(0.03, 0.18, 0.2, -0.43, 0.58, -0.22, s.second)
        .box(0.3, 0.03, 0.24, 0.12, 0.855, -0.06, s.second);
      rig.part("spots", patch, 0, 0, 0, rig.body);
      rig.part("udder", new GeometryBuilder().box(0.22, 0.1, 0.16, 0, 0.36, -0.22, PINK), 0, 0, 0, rig.body);
    }
    const horn = isCow ? 0.1 : 0.2;
    rig.head = rig.part("head", new GeometryBuilder()
      .box(0.42, 0.36, 0.28, 0, 0, 0.1, s.body)
      .box(0.36, 0.2, 0.12, 0, -0.1, 0.27, isCow ? PINK : shade(s.body, 0.75))
      .box(0.06, 0.05, 0.02, -0.12, 0.06, 0.245, DARK)
      .box(0.06, 0.05, 0.02, 0.12, 0.06, 0.245, DARK)
      .box(0.14, 0.06, 0.06, -0.28, 0.08, 0.02, s.body)
      .box(0.14, 0.06, 0.06, 0.28, 0.08, 0.02, s.body)
      .box(horn, 0.05, 0.05, -0.22 - horn / 2, 0.2, 0.08, BONE, 0, -0.5)
      .box(horn, 0.05, 0.05, 0.22 + horn / 2, 0.2, 0.08, BONE, 0, 0.5), 0, 0.74, 0.34);
    rig.tail = rig.part("tail", new GeometryBuilder()
      .box(0.05, 0.4, 0.05, 0, -0.2, 0, s.body)
      .box(0.08, 0.1, 0.08, 0, -0.42, 0, s.second ?? DARK), 0, 0.8, -0.37);
    rig.legs = [
      [-0.3, 0.2, 0], [0.3, 0.2, Math.PI], [-0.3, -0.26, Math.PI], [0.3, -0.26, 0]
    ].map(([x, z, phase], i) => ({ mesh: rig.part(`leg-${i}`, leg(0.16, 0.42, 0.16, s.body, DARK), x, 0.42, z), phase }));
  },

  bear(rig, s) {
    // Bear art is dark; a slightly lifted coat keeps the shape readable, with a
    // pale muzzle and darker paws for contrast.
    const coat = shade(s.body, 1.2);
    const muzzle = s.third ?? shade(s.body, 1.9);
    rig.body = rig.part("body", new GeometryBuilder()
      .box(0.7, 0.4, 0.68, 0, 0.6, -0.06, coat)
      .box(0.62, 0.18, 0.3, 0, 0.84, 0.12, coat)
      .box(0.6, 0.06, 0.56, 0, 0.38, -0.06, shade(coat, 0.8)), 0, 0, 0);
    rig.head = rig.part("head", new GeometryBuilder()
      .box(0.42, 0.34, 0.28, 0, 0, 0.06, coat)
      .box(0.22, 0.16, 0.18, 0, -0.07, 0.27, muzzle)
      .box(0.09, 0.06, 0.03, 0, -0.03, 0.37, DARK)
      .box(0.05, 0.05, 0.02, -0.11, 0.07, 0.205, DARK)
      .box(0.05, 0.05, 0.02, 0.11, 0.07, 0.205, DARK)
      .box(0.11, 0.11, 0.06, -0.17, 0.19, 0.0, coat)
      .box(0.11, 0.11, 0.06, 0.17, 0.19, 0.0, coat), 0, 0.64, 0.36);
    rig.legs = [
      [-0.25, 0.18, 0], [0.25, 0.18, Math.PI], [-0.25, -0.28, Math.PI], [0.25, -0.28, 0]
    ].map(([x, z, phase], i) => ({ mesh: rig.part(`leg-${i}`, leg(0.2, 0.42, 0.22, coat, shade(coat, 0.55)), x, 0.42, z), phase }));
  },

  dragon(rig, s) {
    // The dragon sprite's palette: scales first, then the lighter wing membrane.
    const membrane = s.second;
    const belly = shade(s.body, 1.2);
    rig.body = rig.part("body", new GeometryBuilder()
      .box(0.36, 0.3, 0.34, 0, 0.46, 0.02, s.body)
      .box(0.3, 0.06, 0.3, 0, 0.32, 0.02, belly)
      .box(0.04, 0.06, 0.3, 0, 0.63, 0.02, BONE), 0, 0, 0);
    const neck = rig.joint("neck", 0, 0.55, 0.17, rig.body);
    rig.part("neck-mesh", new GeometryBuilder().box(0.14, 0.28, 0.14, 0, 0.12, 0.05, s.body, 0.6), 0, 0, 0, neck);
    rig.head = rig.part("head", new GeometryBuilder()
      .box(0.18, 0.14, 0.24, 0, 0, 0.08, s.body)
      .box(0.14, 0.05, 0.16, 0, -0.08, 0.12, belly)
      .box(0.04, 0.03, 0.02, -0.06, 0.04, 0.21, [0.95, 0.2, 0.1])
      .box(0.04, 0.03, 0.02, 0.06, 0.04, 0.21, [0.95, 0.2, 0.1])
      .box(0.04, 0.16, 0.04, -0.06, 0.12, -0.06, BONE, -0.7)
      .box(0.04, 0.16, 0.04, 0.06, 0.12, -0.06, BONE, -0.7), 0, 0.28, 0.2, neck);
    rig.tail = rig.part("tail", new GeometryBuilder()
      .box(0.2, 0.16, 0.2, 0, 0, -0.1, s.body)
      .box(0.14, 0.12, 0.2, 0, -0.04, -0.28, s.body)
      .box(0.08, 0.08, 0.16, 0, -0.08, -0.44, s.body)
      .box(0.12, 0.1, 0.03, 0, -0.08, -0.52, BONE), 0, 0.46, -0.15);
    rig.wings = [-1, 1].map((side) => rig.part(`wing-${side}`, new GeometryBuilder()
      .box(0.42, 0.02, 0.3, side * 0.21, 0, -0.04, membrane)
      .box(0.44, 0.04, 0.04, side * 0.22, 0.01, 0.12, s.body), side * 0.16, 0.6, 0.08));
    rig.legs = [
      [-0.16, 0.12, 0], [0.16, 0.12, Math.PI], [-0.16, -0.1, Math.PI], [0.16, -0.1, 0]
    ].map(([x, z, phase], i) => ({ mesh: rig.part(`leg-${i}`, leg(0.1, 0.32, 0.12, s.body, BONE), x, 0.32, z), phase }));
  }
};

// Chicken body; `height` < 1 squeezes it into the lower part of the box.
function buildBird(rig, s, height) {
  const h = (y) => y * height;
  rig.body = rig.part("body", new GeometryBuilder()
    .box(0.62, h(0.42), 0.62, 0, h(0.48), -0.02, s.body)
    .box(0.4, h(0.38), 0.14, 0, h(0.72), -0.36, s.body, -0.4), 0, 0, 0);
  rig.head = rig.part("head", new GeometryBuilder()
    .box(0.26, h(0.26), 0.24, 0, 0, 0.06, s.body)
    .box(0.1, h(0.07), 0.12, 0, -h(0.02), 0.22, BEAK)
    .box(0.06, h(0.14), 0.2, 0, h(0.17), 0.06, COMB)
    .box(0.06, h(0.1), 0.05, 0, -h(0.12), 0.18, COMB)
    .box(0.05, h(0.05), 0.02, -0.08, h(0.05), 0.185, DARK)
    .box(0.05, h(0.05), 0.02, 0.08, h(0.05), 0.185, DARK), 0, h(0.76), 0.26);
  rig.wings = [-1, 1].map((side) => rig.part(`wing-${side}`, new GeometryBuilder()
    .box(0.06, h(0.28), 0.44, side * 0.03, -h(0.14), 0, shade(s.body, 0.9)), side * 0.31, h(0.62), -0.02));
  rig.legs = [[-0.12, 0], [0.12, Math.PI]].map(([x, phase], i) => ({
    mesh: rig.part(`leg-${i}`, new GeometryBuilder()
      .box(0.05, h(0.28), 0.05, 0, -h(0.14), 0, BEAK)
      .box(0.14, 0.03, 0.18, 0, -h(0.28), 0.04, BEAK), x, h(0.28), 0.02),
    phase
  }));
}

export class CreatureModel extends RigModel {
  constructor(scene, ctors, material, spec, name) {
    super(scene, ctors, material, name);
    this.spec = spec;
    this.walkPhase = 0;
    this.legs = [];
    this.wings = null;
    this.tail = null;
    BUILDERS[spec.family](this, spec);
    this.headRestZ = this.head?.position.z ?? 0;
  }

  // appearance: the sprite's Width and Height, which give the size of the
  // quad the creature is drawn in.
  update(position, direction, pose, appearance, deltaMs) {
    const s = this.spec;
    this.place(position, direction, {
      x: appearance.Width * s.widthFraction,
      y: appearance.Height * s.heightFraction,
      z: appearance.Width * s.lengthFraction
    }, deltaMs);
    const now = performance.now();

    if (pose.moving) {
      this.walkPhase += deltaMs * WALK_CYCLE_SPEED * 1.3;
    } else {
      const rest = Math.round(this.walkPhase / Math.PI) * Math.PI;
      this.walkPhase += (rest - this.walkPhase) * Math.min(1, deltaMs * 0.012);
    }
    for (const { mesh, phase } of this.legs) mesh.rotation.x = Math.sin(this.walkPhase + phase) * 0.55;

    // Attacks: the head lunges forward and dips.
    const strike = pose.activity === Activity.Melee ? strikeCurve(pose.strike) : 0;
    if (this.head) {
      // Birds peck now and then while idle.
      const peck = s.family === "bird" && !pose.moving ? Math.max(0, Math.sin(now / 900) - 0.85) * 4 : 0;
      this.head.rotation.x = approach(this.head.rotation.x, 0.45 * strike + 0.6 * peck, deltaMs, 0.03);
      this.head.position.z = this.headRestZ + 0.08 * strike;
    }
    if (this.tail) this.tail.rotation.y = Math.sin(now / 700) * 0.25;
    if (this.wings) {
      // Dragons beat their wings slowly at rest and harder when moving or
      // attacking; birds only flap when moving or attacking.
      const active = pose.moving || strike > 0;
      const flap = s.family === "dragon"
        ? 0.25 + Math.sin(now / (active ? 160 : 450)) * (active ? 0.6 : 0.2)
        : active ? Math.abs(Math.sin(now / 90)) * 0.7 : 0;
      this.wings[0].rotation.z = -flap;
      this.wings[1].rotation.z = flap;
    }

    // Fall over onto one side when dead.
    const lying = this.updateLying(pose.activity === Activity.Dead, deltaMs);
    this.root.rotation.z = lying * Math.PI / 2;
    this.root.position.y = position.y + lying * appearance.Width * s.widthFraction * 0.5;
  }
}
