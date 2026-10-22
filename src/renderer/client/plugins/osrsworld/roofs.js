// OSRS-style roofs in place of the game's. The game roofs its houses with a
// shallow, flat-topped slab (roof4.obj, a truncated pyramid one tile tall);
// OSRS houses have steep pitched gable roofs with overhanging eaves, tiled
// with a roof texture, and wall filling the gable ends. Each slab is
// replaced by such a roof over the same footprint. The game's roof meshes
// stay in the scene (they decide when the player is indoors) but are drawn
// invisible; ours follow their shown/hidden state.
import { osrsTextureForFile } from "./osrsTextures.js";

// The game's slab roofs, by model file.
const SLAB_ROOF = /^roof4\.obj$/;
// Roof texture when the roof names none (roof4's own), and the wall texture
// for gable ends when no wall is found.
const DEFAULT_ROOF_TEXTURE = "15.png";
const DEFAULT_GABLE_TEXTURE = "14.png";
// Wall textures that can fill a gable end.
const WALL_TEXTURES = new Set(["14.png", "16.png", "17.png", "26.png"]);
// Rise per tile of half-span (OSRS roofs are steep), extra eave overhang and
// roof thickness, in tiles.
const PITCH = 0.85;
const EAVES = 0.2;
const THICKNESS = 0.12;
// Ridge cap: how far it stands above the roof and spreads either side.
const RIDGE_HEIGHT = 0.08;
const RIDGE_WIDTH = 0.18;
// OSRS lighting for flat faces (Model.light): ambient, and the light
// direction in world space (as the terrain uses), scaled by contrast.
const AMBIENT = 64;
const LIGHT = [-50, 10, -50];
const LIGHT_DIVISOR = (768 * Math.hypot(...LIGHT)) / 256 * 1.5;
// Lightness at which a texel shows at its own colour, and the brightest lit.
const FULL_LIGHTNESS = 96;
const SHADE_MAX = 1.3;
// Underside shading relative to the lit value, and the darkest a gable end
// gets (OSRS walls in shade stay readable).
const UNDERSIDE_SHADE = 0.55;
const GABLE_MIN_SHADE = 0.6;

function shadeFor(normal) {
  const length = Math.hypot(...normal) || 1;
  const n = normal.map((value) => (value * 256) / length);
  const lightness = AMBIENT + (LIGHT[0] * n[0] + LIGHT[1] * n[1] + LIGHT[2] * n[2]) / LIGHT_DIVISOR;
  return Math.min(SHADE_MAX, Math.max(0.2, lightness / FULL_LIGHTNESS));
}

// Collects triangles for one texture: positions, light-only vertex colours
// and UVs (one texture repeat per tile).
class Batch {
  constructor() {
    this.positions = [];
    this.colors = [];
    this.uvs = [];
  }

  // A flat polygon (convex, corners in order) with UVs per corner, lit by its
  // normal (turned to face `outward`; faces are drawn two-sided, so winding
  // does not matter) times `factor`.
  polygon(corners, uvs, outward, factor = 1, minShade = 0.2) {
    const [a, b, c] = corners;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2] < 0) normal = normal.map((value) => -value);
    const shade = Math.max(minShade, shadeFor(normal) * factor);
    for (let i = 1; i < corners.length - 1; i++) {
      for (const k of [0, i, i + 1]) {
        this.positions.push(...corners[k]);
        this.colors.push(shade, shade, shade, 1);
        this.uvs.push(...uvs[k]);
      }
    }
  }
}

// A gable roof over the box [x0, x1] x [z0, z1] at height y, with its ridge
// along X (callers turn the footprint for ridges along Z).
function gableRoof(roof, gable, x0, x1, z0, z1, y) {
  const halfSpan = (z1 - z0) / 2, ridgeZ = (z0 + z1) / 2;
  const rise = halfSpan * PITCH;
  const top = y + rise;
  const slopeLength = Math.hypot(halfSpan, rise);
  // Thickness measured square to the slope.
  const dz = (THICKNESS * rise) / slopeLength, dy = (THICKNESS * halfSpan) / slopeLength;
  for (const side of [-1, 1]) {
    const eaveZ = ridgeZ + side * halfSpan;
    const eave = (x) => [x, y, eaveZ], ridge = (x) => [x, top, ridgeZ];
    const under = ([x, py, pz]) => [x, py - dy, pz - side * dz];
    const length = x1 - x0;
    // Top surface: rows of tiles running along the roof, from the eave up.
    const topCorners = side < 0 ? [eave(x0), eave(x1), ridge(x1), ridge(x0)] : [eave(x1), eave(x0), ridge(x0), ridge(x1)];
    const topUvs = side < 0 ? [[0, 0], [length, 0], [length, slopeLength], [0, slopeLength]] : [[length, 0], [0, 0], [0, slopeLength], [length, slopeLength]];
    roof.polygon(topCorners, topUvs, [0, 1, 0]);
    // Underside, darker.
    roof.polygon(topCorners.map(under), topUvs, [0, -1, 0], UNDERSIDE_SHADE);
    // Eave edge (the fascia) and the edges at the gable ends.
    const fascia = side < 0 ? [eave(x1), eave(x0), under(eave(x0)), under(eave(x1))] : [eave(x0), eave(x1), under(eave(x1)), under(eave(x0))];
    roof.polygon(fascia, [[0, 0], [length, 0], [length, THICKNESS], [0, THICKNESS]], [0, 0, side]);
    for (const x of [x0, x1]) {
      const out = x === x0 ? -1 : 1;
      const edge = [eave(x), ridge(x), under(ridge(x)), under(eave(x))];
      roof.polygon(edge, [[0, 0], [slopeLength, 0], [slopeLength, THICKNESS], [0, THICKNESS]], [out, 0, 0]);
    }
  }
  // Ridge cap: a low ridge along the top.
  const capTop = top + RIDGE_HEIGHT, length = x1 - x0;
  for (const side of [-1, 1]) {
    const low = (x) => [x, top - RIDGE_WIDTH * PITCH * 0.5, ridgeZ + side * RIDGE_WIDTH], high = (x) => [x, capTop, ridgeZ];
    const corners = side < 0 ? [low(x0), low(x1), high(x1), high(x0)] : [low(x1), low(x0), high(x0), high(x1)];
    roof.polygon(corners, [[0, 0], [length, 0], [length, 0.3], [0, 0.3]], [0, 1, side], 0.85);
  }
  // Gable ends: wall triangles, set in from the eaves to sit over the walls.
  const inset = EAVES + 0.25;
  for (const x of [x0 + inset, x1 - inset]) {
    const out = x < (x0 + x1) / 2 ? -1 : 1;
    const corners = [[x, y, z0 + inset], [x, y, z1 - inset], [x, top - dy - inset * PITCH, ridgeZ]];
    const uvs = [[0, 0], [z1 - z0 - 2 * inset, 0], [halfSpan - inset, rise - inset * PITCH]];
    gable.polygon(corners, uvs, [out, 0, 0], 0.9, GABLE_MIN_SHADE);
  }
}

export class OsrsRoofs {
  constructor(scene, roofEntities, worldEntities) {
    this.scene = scene;
    this.roofEntities = roofEntities;
    this.worldEntities = worldEntities;
    // Roof id -> { meshes: ours, originals: the game's }.
    this.built = new Map();
    this.materials = new Map();
    this.building = false;
  }

  // Called every few hundred ms: builds roofs for new slab roofs, drops gone
  // ones. `materialFor(canvas)` makes a material for a texture.
  async update(materialFor) {
    if (this.building) return;
    this.building = true;
    try {
      const seen = new Set();
      for (const [id, entity] of this.roofEntities() ?? []) {
        const appearance = entity?.Appearance ?? entity?._appearance;
        const model = String(appearance?._meshFileName ?? "").split("%")[0];
        const texture = appearance?._materialFileName;
        const originals = (appearance?.BJSMeshes ?? []).filter((mesh) => mesh && !mesh.isDisposed());
        if (!SLAB_ROOF.test(model) || !originals.length) continue;
        seen.add(id);
        if (this.built.has(id)) continue;
        const meshes = await this.buildRoof(originals, texture?.endsWith(".png") ? texture : DEFAULT_ROOF_TEXTURE, materialFor);
        if (meshes) this.built.set(id, { meshes, originals });
      }
      for (const [id, roof] of this.built) {
        if (seen.has(id)) continue;
        this.disposeRoof(roof);
        this.built.delete(id);
      }
    } finally {
      this.building = false;
    }
  }

  // Ours follow the game's shown/hidden state (roofs hide when indoors).
  syncVisibility() {
    for (const { meshes, originals } of this.built.values()) {
      const shown = originals.some((mesh) => mesh.isVisible && mesh.isEnabled());
      for (const mesh of meshes) if (mesh.isVisible !== shown) mesh.isVisible = shown;
    }
  }

  async buildRoof(originals, roofTexture, materialFor) {
    // The slab's footprint and base, in world space.
    let min = null, max = null;
    for (const mesh of originals) {
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      if (Math.abs(box.centerWorld.x) > 2000) return null;
      min = min ? min.minimizeInPlace(box.minimumWorld) : box.minimumWorld.clone();
      max = max ? max.maximizeInPlace(box.maximumWorld) : box.maximumWorld.clone();
    }
    if (!min || max.x - min.x < 1 || max.z - min.z < 1) return null;
    const gableTexture = this.gableTextureNear(min, max);
    const [roofMaterial, gableMaterial] = await Promise.all([this.material(roofTexture, materialFor), this.material(gableTexture, materialFor)]);
    if (!roofMaterial || !gableMaterial) return null;

    // Ridge along the longer side (along X for a square, as most OSRS
    // houses face). Built along X, then turned when it runs along Z.
    const alongX = max.x - min.x >= max.z - min.z;
    const roof = new Batch(), gable = new Batch();
    const [a0, a1, b0, b1] = alongX ? [min.x, max.x, min.z, max.z] : [min.z, max.z, min.x, max.x];
    gableRoof(roof, gable, a0 - EAVES, a1 + EAVES, b0 - EAVES, b1 + EAVES, min.y);
    const toWorld = (batch) => {
      if (alongX) return batch.positions;
      const turned = [];
      for (let i = 0; i < batch.positions.length; i += 3) turned.push(batch.positions[i + 2], batch.positions[i + 1], batch.positions[i]);
      return turned;
    };
    const Mesh = this.scene.meshes.find((m) => m.getClassName() === "Mesh").constructor;
    const meshes = [];
    for (const [batch, material, name] of [[roof, roofMaterial, "roof"], [gable, gableMaterial, "gable"]]) {
      if (!batch.positions.length) continue;
      // "-halo" names are skipped by the game's click picking.
      const mesh = new Mesh(`osrsworld-${name}-halo`, this.scene);
      let positions = toWorld(batch);
      // Turning swaps handedness; flip the winding back.
      const indices = Array.from({ length: positions.length / 3 }, (_, k) => k);
      if (!alongX) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
      mesh.setVerticesData("position", positions, false);
      mesh.setVerticesData("color", batch.colors, false);
      mesh.setVerticesData("uv", batch.uvs, false);
      mesh.setIndices(indices);
      mesh.material = material;
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
      meshes.push(mesh);
    }
    // The game's slab stays for its indoors check, drawn invisible.
    for (const mesh of originals) mesh.visibility = 0;
    return meshes;
  }

  // The wall texture most used by walls under the roof.
  gableTextureNear(min, max) {
    const counts = new Map();
    for (const entity of this.worldEntities()?.values() ?? []) {
      const appearance = entity._appearance, texture = appearance?._materialFileName, position = appearance?._position;
      if (!WALL_TEXTURES.has(texture) || !position) continue;
      if (position._x < min.x - 1 || position._x > max.x + 1 || position._z < min.z - 1 || position._z > max.z + 1) continue;
      counts.set(texture, (counts.get(texture) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? DEFAULT_GABLE_TEXTURE;
  }

  material(file, materialFor) {
    if (!this.materials.has(file)) {
      this.materials.set(file, osrsTextureForFile(file).then((canvas) => (canvas ? materialFor(canvas, file) : null)));
    }
    return this.materials.get(file);
  }

  disposeRoof({ meshes, originals }) {
    for (const mesh of meshes) mesh.dispose();
    for (const mesh of originals) if (!mesh.isDisposed()) mesh.visibility = 1;
  }

  dispose() {
    for (const roof of this.built.values()) this.disposeRoof(roof);
    this.built.clear();
    for (const material of this.materials.values()) material.then((m) => m?.dispose(true, true)).catch(() => {});
    this.materials.clear();
  }

}
