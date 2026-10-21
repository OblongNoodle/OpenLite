// Scenery: OSRS-style replacements for the game's trees, rocks and bushes.
//
// Each generator builds its model in a unit box (x and z in [-0.5, 0.5], y in
// [0, 1]) which is then stretched over the original object's bounds. Colours
// come from the original's own textures, and a per-object seed varies shapes.
import { GeometryBuilder, noise3 } from "./geometry.js";
import { PALETTE_DISTANCE, colorDistance, shade } from "./sampling.js";

// Which generator replaces each of the game's object meshes.
const SCENERY_BY_MESH = [
  [/^normal_tree\d*\.obj$/, "tree"],
  [/^deadtree\d*\.obj$/, "deadTree"],
  [/^treestump\d*\.obj$/, "stump"],
  [/^ore_rock\d*\.obj$/, "oreRock"],
  [/^rock\d*\.obj$/, "rock"],
  [/^bush\d*\.obj$/, "bush"]
];

export function sceneryKindFor(meshFileName) {
  return SCENERY_BY_MESH.find(([pattern]) => pattern.test(meshFileName ?? ""))?.[1] ?? null;
}

// Resource states: a chopped tree shows its stump, a mined rock its bare stone.
const EXHAUSTED = 0;

// Seeded random numbers in [0, 1).
function random(seed) {
  let state = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

// A colour varied slightly per vertex, so surfaces are not one flat tone.
function mottled(color, amount, seed) {
  return (dir, lump) => shade(color, 1 + amount * noise3(dir[0] * 3 + seed, dir[1] * 3, dir[2] * 3 - seed) + amount * 0.5 * lump);
}

// Foliage: leafy speckle, lighter on top where the sun hits and darker
// underneath, like OSRS tree crowns.
function foliage(color, seed) {
  return (dir, lump) => shade(color, 1 + 0.16 * noise3(dir[0] * 5 + seed, dir[1] * 5, dir[2] * 5 - seed) + 0.1 * lump + 0.2 * dir[1]);
}

// Brightens a sampled colour that is too dark to read (leaf textures are
// mostly shadow), and adds a little saturation.
function vivid(color, minLuma) {
  const luma = 0.3 * color[0] + 0.59 * color[1] + 0.11 * color[2];
  const lifted = luma > 0 && luma < minLuma ? shade(color, minLuma / luma) : color;
  const grey = 0.3 * lifted[0] + 0.59 * lifted[1] + 0.11 * lifted[2];
  return lifted.map((value) => Math.max(0, Math.min(1, grey + (value - grey) * 1.15)));
}

// Dominant colours of one of the original object's meshes, sampled at its
// triangles' texture coordinates.
const pixelCache = new WeakMap();
export async function sampleMeshColors(mesh) {
  const source = mesh.sourceMesh ?? mesh;
  const material = mesh.material ?? source.material;
  const texture = material?.diffuseTexture;
  const uv = source.getVerticesData?.("uv");
  if (!texture || !uv) {
    const c = material?.diffuseColor;
    return c ? [[c.r, c.g, c.b]] : [];
  }
  let read = pixelCache.get(texture);
  if (!read) {
    read = texture.readPixels().then((pixels) => ({ pixels, ...texture.getSize() }));
    pixelCache.set(texture, read);
  }
  const { pixels, width, height } = await read;
  if (!pixels) return [];
  const indices = source.getIndices();
  const buckets = new Map();
  const wrap = (value) => ((value % 1) + 1) % 1;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
    const u = (uv[a * 2] + uv[b * 2] + uv[c * 2]) / 3, v = (uv[a * 2 + 1] + uv[b * 2 + 1] + uv[c * 2 + 1]) / 3;
    const x = Math.min(width - 1, Math.floor(wrap(u) * width)), y = Math.min(height - 1, Math.floor((1 - wrap(v)) * height));
    const p = (y * width + x) * 4;
    if (pixels[p + 3] < 128) continue;
    const key = (pixels[p] >> 5) << 6 | (pixels[p + 1] >> 5) << 3 | (pixels[p + 2] >> 5);
    const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++;
    bucket.r += pixels[p];
    bucket.g += pixels[p + 1];
    bucket.b += pixels[p + 2];
    buckets.set(key, bucket);
  }
  const palette = [];
  for (const bucket of [...buckets.values()].sort((x, y) => y.count - x.count)) {
    const color = [bucket.r / bucket.count / 255, bucket.g / bucket.count / 255, bucket.b / bucket.count / 255];
    if (palette.every((picked) => colorDistance(picked, color) > PALETTE_DISTANCE)) palette.push(color);
    if (palette.length >= 3) break;
  }
  return palette;
}

const DEFAULTS = {
  bark: [0.36, 0.24, 0.14],
  leaves: [0.22, 0.42, 0.14],
  stone: [0.5, 0.5, 0.48],
  ore: [0.55, 0.32, 0.22]
};

// Colours for a scenery object from its original meshes. Tree meshes are
// [stump, trunk, leaves]; everything else uses its first mesh.
export async function loadSceneryColors(kind, meshes) {
  const palettes = await Promise.all(meshes.map((mesh) => sampleMeshColors(mesh).catch(() => [])));
  switch (kind) {
    case "tree":
      return { bark: palettes[1]?.[0] ?? palettes[0]?.[0] ?? DEFAULTS.bark, leaves: palettes[2]?.[0] ?? DEFAULTS.leaves, stumpTop: palettes[0]?.[1] ?? null };
    case "deadTree":
    case "stump":
      return { bark: palettes[0]?.[0] ?? DEFAULTS.bark, stumpTop: palettes[0]?.[1] ?? null };
    case "rock":
    case "oreRock":
      return { stone: palettes[0]?.[0] ?? DEFAULTS.stone, ore: palettes[0]?.[1] ?? DEFAULTS.ore };
    case "bush":
      return { leaves: palettes[0]?.[0] ?? DEFAULTS.leaves };
  }
  return {};
}

function trunk(g, bark, rand, height, radius) {
  // Roots flaring out at the base, then a slightly leaning, tapering trunk.
  const lean = (rand() - 0.5) * 0.12;
  g.lathe([[0, radius * 1.9, radius * 1.9], [height * 0.06, radius * 1.15, radius * 1.15], [height * 0.45, radius * 0.95, radius * 0.95], [height, radius * 0.75, radius * 0.75]], 8, 0, 0, 0, bark, { tiltZ: lean });
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + rand();
    g.lathe([[0, radius * 0.5, radius * 0.4], [radius * 3.2, radius * 0.15, radius * 0.12]], 6, Math.cos(angle) * radius * 0.8, radius * 0.25, Math.sin(angle) * radius * 0.8, shade(bark, 0.9), { axis: "z", tiltX: 0.25, tiltZ: 0 });
  }
}

function branch(g, bark, x, y, z, length, radius, tiltX, tiltZ) {
  g.lathe([[0, radius, radius], [length, radius * 0.45, radius * 0.45]], 6, x, y, z, bark, { tiltX, tiltZ });
}

const GENERATORS = {
  // A thick trunk with a few boughs carrying a crown of rounded leaf clumps.
  tree(g, colors, rand, seed) {
    const bark = colors.bark, leaves = vivid(colors.leaves, 0.3);
    trunk(g, bark, rand, 0.56, 0.06);
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2 + rand();
      branch(g, bark, 0, 0.42, 0, 0.22, 0.035, Math.cos(angle) * 0.9, Math.sin(angle) * 0.9);
    }
    const tones = [leaves, shade(leaves, 0.86), shade(leaves, 1.1)];
    g.blob([0.3, 0.2, 0.3], 0, 0.72, 0, leaves, { seed, roughness: 0.28, colorAt: foliage(leaves, seed) });
    const clumps = 6 + Math.floor(rand() * 3);
    for (let i = 0; i < clumps; i++) {
      const angle = (i / clumps) * Math.PI * 2 + rand() * 0.6;
      const distance = 0.2 + rand() * 0.1;
      const size = 0.15 + rand() * 0.07;
      const tone = tones[i % tones.length];
      g.blob([size, size * 0.8, size], Math.cos(angle) * distance, 0.62 + rand() * 0.2, Math.sin(angle) * distance, tone,
        { seed: seed + i * 13, roughness: 0.32, sides: 10, rings: 7, colorAt: foliage(tone, seed + i) });
    }
    g.blob([0.18, 0.13, 0.18], (rand() - 0.5) * 0.1, 0.88, (rand() - 0.5) * 0.1, tones[2], { seed: seed + 99, roughness: 0.28, colorAt: foliage(tones[2], seed) });
  },

  // A bare trunk splitting into crooked branches and twigs.
  deadTree(g, colors, rand) {
    const bark = colors.bark;
    trunk(g, bark, rand, 0.62, 0.07);
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 + rand() * 0.8;
      const height = 0.38 + rand() * 0.24;
      const tilt = 0.6 + rand() * 0.5;
      const length = 0.26 + rand() * 0.14;
      const tx = Math.cos(angle) * tilt, tz = Math.sin(angle) * tilt;
      branch(g, bark, 0, height, 0, length, 0.03, tx, tz);
      // A twig forking off near the branch's end.
      const endX = -Math.sin(tz) * length * 0.7, endY = height + Math.cos(tilt) * length * 0.7, endZ = Math.sin(tx) * length * 0.7;
      branch(g, bark, endX, endY, endZ, length * 0.5, 0.016, tx * 0.4 + (rand() - 0.5), tz * 0.4 + (rand() - 0.5));
    }
  },

  // A short trunk with roots and a lighter cut face on top.
  stump(g, colors, rand) {
    const bark = colors.bark;
    const top = colors.stumpTop ?? shade(bark, 1.6);
    g.lathe([[0, 0.48, 0.48], [0.12, 0.36, 0.36], [0.62, 0.32, 0.32], [0.82, 0.31, 0.31]], 10, 0, 0, 0, bark);
    g.lathe([[0.82, 0.29, 0.29], [0.86, 0.27, 0.27]], 10, 0, 0, 0, top);
    g.lathe([[0.86, 0.14, 0.14], [0.87, 0.12, 0.12]], 10, 0, 0, 0, shade(top, 0.8));
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 + rand();
      g.lathe([[0, 0.12, 0.1], [0.42, 0.04, 0.03]], 6, Math.cos(angle) * 0.25, 0.05, Math.sin(angle) * 0.25, shade(bark, 0.9), { axis: "z", tiltX: 0.3, tiltZ: angle });
    }
  },

  // A lumpy boulder resting on the ground, with a smaller one leaning on it.
  rock(g, colors, rand, seed) {
    const stone = colors.stone;
    g.blob([0.46, 0.5, 0.42], 0, 0.42, 0, stone, { seed, roughness: 0.26, sides: 14, rings: 9, flatBottom: 0.82, colorAt: mottled(stone, 0.1, seed) });
    g.blob([0.2, 0.2, 0.2], 0.3 * (rand() > 0.5 ? 1 : -1), 0.16, 0.22, shade(stone, 0.92), { seed: seed + 5, roughness: 0.3, flatBottom: 0.7, colorAt: mottled(stone, 0.1, seed + 5) });
  },

  // A rock with veins of ore showing on its surface (bare once mined).
  oreRock(g, colors, rand, seed, exhausted) {
    const stone = colors.stone, ore = colors.ore;
    const veins = (dir, lump) => {
      const vein = noise3(dir[0] * 3.1 + seed, dir[1] * 3.1, dir[2] * 3.1 - seed);
      return !exhausted && vein > 0.35 && dir[1] > -0.2 ? shade(ore, 1 + 0.15 * lump) : shade(stone, 1 + 0.1 * lump);
    };
    g.blob([0.46, 0.5, 0.42], 0, 0.42, 0, stone, { seed, roughness: 0.24, sides: 16, rings: 10, flatBottom: 0.82, colorAt: veins });
  },

  // A low cluster of leafy clumps.
  bush(g, colors, rand, seed) {
    const leaves = vivid(colors.leaves, 0.28);
    const tones = [leaves, shade(leaves, 0.86), shade(leaves, 1.1)];
    g.blob([0.32, 0.3, 0.32], 0, 0.36, 0, leaves, { seed, roughness: 0.28, flatBottom: 0.9, colorAt: foliage(leaves, seed) });
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 + rand();
      const tone = tones[i % tones.length];
      g.blob([0.2, 0.2, 0.2], Math.cos(angle) * 0.25, 0.25 + rand() * 0.25, Math.sin(angle) * 0.25, tone, { seed: seed + i * 7, roughness: 0.3, sides: 10, rings: 7, colorAt: foliage(tone, seed + i) });
    }
  }
};

// Builds the geometry for one scenery object. A tree out of resources is
// drawn as a stump.
export function buildScenery(kind, colors, seed, resourceState) {
  const exhausted = resourceState === EXHAUSTED;
  const generator = (kind === "tree" || kind === "deadTree") && exhausted ? "stump" : kind;
  const g = new GeometryBuilder();
  GENERATORS[generator](g, colors, random(seed * 9301 + 49297), seed, exhausted);
  return g;
}
