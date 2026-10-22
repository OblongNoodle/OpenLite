// OSRS scenery objects (locs) with their textures, from the player's local
// OSRS cache: trees, rocks, bushes. Built the way the client's LocType.getModel
// builds them (the models for one shape merged, recoloured, retextured,
// scaled, offset and lit with the scenery light), keeping each face's texture
// and its texture coordinates (computed as RuneLite's
// ModelDefinition.computeTextureUVCoordinates does; BSD-licensed).
import { rsColorToRgb } from "./player.js";
import { osrsTextureCanvas } from "../../osrsworld/osrsTextures.js";

const RS_UNITS_PER_TILE = 128;
// Scenery light: ambient 64 and contrast 768 plus the object's own, from (-50, -10, -50).
const OBJECT_LIGHT = [-50, -10, -50];
// Lightness at which a texel shows at its own colour, and the brightest a lit
// texel gets.
const TEXTURE_FULL_LIGHTNESS = 96;
const TEXTURE_SHADE_MAX = 1.3;
// A wrapped texture is about this much darker than white on average.
const TINT_BOOST = 2.2;
// Shapes, preferred in this order when an object has several.
const SHAPE_ORDER = [10, 11, 22, 0];

// Texture coordinates of a model's face f: [u0, u1, u2, v0, v1, v2], from the
// texture triangle it names (or the face itself).
function faceUvs(model, f) {
  const tf = model.textureCoords ? model.textureCoords[f] : -1;
  if (tf === -1 || tf === undefined || !model.texIndices1) return [0, 1, 0, 0, 0, 1];
  const t = tf & 0xff;
  const xs = model.vertexX, ys = model.vertexY, zs = model.vertexZ;
  const p = model.texIndices1[t], m = model.texIndices2[t], n = model.texIndices3[t];
  const v1 = [xs[p], ys[p], zs[p]];
  const sub = (i) => [xs[i] - v1[0], ys[i] - v1[1], zs[i] - v1[2]];
  const v2 = sub(m), v3 = sub(n);
  const corners = [model.faceIndices1[f], model.faceIndices2[f], model.faceIndices3[f]].map(sub);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const v7 = cross(v2, v3);
  let v8 = cross(v3, v7);
  let scale = 1 / dot(v8, v2);
  const us = corners.map((c) => dot(v8, c) * scale);
  v8 = cross(v2, v7);
  scale = 1 / dot(v8, v3);
  const vs = corners.map((c) => dot(v8, c) * scale);
  return [...us, ...vs];
}

// Merges decoded models, keeping per-face textures and texture coordinates.
function mergeTextured(models) {
  const merged = { vertexX: [], vertexY: [], vertexZ: [], faceA: [], faceB: [], faceC: [], colors: [], renderTypes: [], textures: [], uvs: [] };
  for (const model of models) {
    const base = merged.vertexX.length;
    for (let v = 0; v < model.vertexCount; v++) {
      merged.vertexX.push(model.vertexX[v]);
      merged.vertexY.push(model.vertexY[v]);
      merged.vertexZ.push(model.vertexZ[v]);
    }
    for (let f = 0; f < model.faceCount; f++) {
      merged.faceA.push(model.faceIndices1[f] + base);
      merged.faceB.push(model.faceIndices2[f] + base);
      merged.faceC.push(model.faceIndices3[f] + base);
      merged.colors.push(model.faceColors[f] & 0xffff);
      merged.renderTypes.push(model.faceRenderTypes ? model.faceRenderTypes[f] & 3 : 0);
      const texture = model.faceTextures ? model.faceTextures[f] : -1;
      merged.textures.push(texture);
      merged.uvs.push(texture >= 0 ? faceUvs(model, f) : null);
    }
  }
  return merged;
}

// Lightness (the client's 2-126) at each face corner, as Model.light works it
// out: smooth faces from vertex normals, flat faces from their own.
function lightness(model, ambient, contrast) {
  const vertexCount = model.vertexX.length, faceCount = model.faceA.length;
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
  const [lx, ly, lz] = OBJECT_LIGHT;
  const contrastLight = (contrast * Math.hypot(lx, ly, lz)) / 256;
  const clamp = (value) => Math.min(126, Math.max(2, Math.trunc(value)));
  return model.faceA.map((a, f) => {
    if (model.renderTypes[f] !== 0) {
      const [fx, fy, fz] = faceNormals[f];
      const lit = clamp(ambient + (lx * fx + ly * fy + lz * fz) / (contrastLight + contrastLight / 2));
      return [lit, lit, lit];
    }
    return [a, model.faceB[f], model.faceC[f]].map((v) => clamp(ambient + (lx * nx[v] + ly * ny[v] + lz * nz[v]) / (contrastLight * Math.max(1, count[v]))));
  });
}

// An OSRS object's model, ready to draw: coloured faces and textured faces
// grouped by texture, in RS units, and its size in tiles. Null if the cache
// lacks its models.
//   wrapTexture: put this texture on every face, tinted by the face's own
//     colour (OSRS's ore rocks are one plain colour; this gives them stone).
export async function buildLoc(cache, object, { wrapTexture = null } = {}) {
  const shape = object.types ? SHAPE_ORDER.find((s) => object.types.includes(s)) ?? object.types[0] : null;
  const ids = object.types ? object.models.filter((_, i) => object.types[i] === shape) : object.models;
  const models = (await Promise.all(ids.map((id) => cache.model(id)))).filter(Boolean);
  if (!models.length) return null;
  const data = mergeTextured(models);
  object.recolorToFind.forEach((color, i) => {
    for (let f = 0; f < data.colors.length; f++) if (data.colors[f] === color) data.colors[f] = object.recolorToReplace[i];
  });
  object.retextureToFind.forEach((texture, i) => {
    for (let f = 0; f < data.textures.length; f++) if (data.textures[f] === texture) data.textures[f] = object.textureToReplace[i];
  });
  data.vertexX = data.vertexX.map((x) => Math.trunc((x * object.scaleX) / 128) + object.offsetX);
  data.vertexY = data.vertexY.map((y) => Math.trunc((y * object.scaleY) / 128) - object.offsetY);
  data.vertexZ = data.vertexZ.map((z) => Math.trunc((z * object.scaleZ) / 128) + object.offsetZ);
  data.lightness = lightness(data, 64 + object.ambient, 768 + object.contrast);
  if (wrapTexture !== null) {
    data.tinted = true;
    data.textures = data.textures.map(() => wrapTexture);
    data.uvs = data.uvs.map((uvs) => uvs ?? [0, 1, 0, 0, 0, 1]);
  }
  const span = (values) => (Math.max(...values) - Math.min(...values)) / RS_UNITS_PER_TILE;
  data.size = { width: span(data.vertexX), height: -Math.min(...data.vertexY) / RS_UNITS_PER_TILE, depth: span(data.vertexZ) };
  return data;
}

// Meshes for built loc data, in tile units with Y up ((x, -y, -z), as for
// characters): a root mesh of the coloured faces, with one child per texture.
//   textureMaterial(id): a material for a texture (async; null to skip).
export async function createLocMeshes(Mesh, scene, data, material, textureMaterial, name) {
  const groups = new Map();
  for (let f = 0; f < data.faceA.length; f++) {
    if (data.renderTypes[f] === 2) continue;
    const key = data.textures[f] >= 0 ? data.textures[f] : -1;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const build = (faces, textured, meshName) => {
    const positions = [], colors = [], uvs = [];
    for (const f of faces) {
      const corners = [data.faceA[f], data.faceB[f], data.faceC[f]];
      corners.forEach((v, k) => {
        positions.push(data.vertexX[v] / RS_UNITS_PER_TILE, -data.vertexY[v] / RS_UNITS_PER_TILE, -data.vertexZ[v] / RS_UNITS_PER_TILE);
        const lit = data.lightness[f][k];
        if (textured && data.tinted) {
          // Wrapped texture: the face's own lit colour tints it (brightened,
          // as the texture is darker than white).
          const [r, g, b] = rsColorToRgb((data.colors[f] & 0xff80) + Math.min(126, Math.max(2, ((data.colors[f] & 127) * lit) >> 7)));
          colors.push(r * TINT_BOOST, g * TINT_BOOST, b * TINT_BOOST, 1);
          uvs.push(data.uvs[f][k], data.uvs[f][k + 3]);
        } else if (textured) {
          // The texture carries the colour; the corner carries the light (a
          // texel shows at its own colour around lightness 96).
          const shade = Math.min(TEXTURE_SHADE_MAX, lit / TEXTURE_FULL_LIGHTNESS);
          colors.push(shade, shade, shade, 1);
          uvs.push(data.uvs[f][k], data.uvs[f][k + 3]);
        } else {
          const [r, g, b] = data.renderTypes[f] === 3 ? [0, 0, 0] : rsColorToRgb((data.colors[f] & 0xff80) + Math.min(126, Math.max(2, ((data.colors[f] & 127) * lit) >> 7)));
          colors.push(r, g, b, 1);
        }
      });
    }
    const mesh = new Mesh(meshName, scene);
    if (positions.length) {
      mesh.setVerticesData("position", positions, false);
      mesh.setVerticesData("color", colors, false);
      if (textured) mesh.setVerticesData("uv", uvs, false);
      mesh.setIndices(Array.from({ length: positions.length / 3 }, (_, k) => k));
    }
    mesh.isPickable = false;
    return mesh;
  };
  const root = build(groups.get(-1) ?? [], false, name);
  root.metadata = { size: data.size };
  root.material = material;
  for (const [texture, faces] of groups) {
    if (texture === -1) continue;
    const childMaterial = await textureMaterial(texture);
    if (!childMaterial) continue;
    const child = build(faces, true, `${name}-tex${texture}`);
    child.material = childMaterial;
    child.parent = root;
  }
  return root;
}

// A canvas for an OSRS texture (see osrsworld/osrsTextures.js).
export { osrsTextureCanvas };
