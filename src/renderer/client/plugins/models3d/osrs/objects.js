// OSRS scenery objects (locs) from the local OSRS cache, built the way the
// client's LocType.getModel builds them: the models for one shape merged,
// recoloured, scaled, offset and lit with the scenery light.
import { lightModel, mergeModels, recolor, rsColorToRgb } from "./player.js";

// Shapes an object can be placed as (the client's LocShape).
export const LocShape = { WallStraight: 0, WallDiagonal: 9, Centrepiece: 10 };

// Scenery light: ambient 64 and contrast 768 plus the object's own, from (-50, -10, -50).
const OBJECT_LIGHT = { x: -50, y: -10, z: -50 };
const RS_UNITS_PER_TILE = 128;

export async function buildObjectData(cache, object, shape) {
  const ids = object.types ? object.models.filter((_, i) => object.types[i] === shape) : object.models;
  const models = (await Promise.all(ids.map((id) => cache.model(id)))).filter(Boolean);
  if (!models.length) return null;
  const data = mergeModels(models);
  object.recolorToFind.forEach((color, i) => recolor(data, color, object.recolorToReplace[i]));
  data.vertexX = data.vertexX.map((x) => Math.trunc((x * object.scaleX) / 128) + object.offsetX);
  data.vertexY = data.vertexY.map((y) => Math.trunc((y * object.scaleY) / 128) - object.offsetY);
  data.vertexZ = data.vertexZ.map((z) => Math.trunc((z * object.scaleZ) / 128) + object.offsetZ);
  data.cornerColors = lightModel(data, { ambient: 64 + object.ambient, contrast: 768 + object.contrast, ...OBJECT_LIGHT });
  return data;
}

// A static mesh of built object data in tile units. RS models have Y down;
// (x, -y, -z) turns them upright without mirroring, as for characters.
export function createObjectMesh(Mesh, scene, data, material, name) {
  const visible = [];
  for (let f = 0; f < data.colors.length; f++) if (data.renderTypes[f] !== 2) visible.push(f);
  const positions = new Float32Array(visible.length * 9);
  const colors = new Float32Array(visible.length * 12);
  const indices = new Uint32Array(visible.length * 3);
  visible.forEach((f, i) => {
    [data.faceA[f], data.faceB[f], data.faceC[f]].forEach((v, k) => {
      positions.set([data.vertexX[v] / RS_UNITS_PER_TILE, -data.vertexY[v] / RS_UNITS_PER_TILE, -data.vertexZ[v] / RS_UNITS_PER_TILE], (i * 3 + k) * 3);
      const [r, g, b] = data.renderTypes[f] === 3 ? [0, 0, 0] : rsColorToRgb(data.cornerColors[f][k]);
      colors.set([r, g, b, 1], (i * 3 + k) * 4);
    });
    indices.set([i * 3, i * 3 + 1, i * 3 + 2], i * 3);
  });
  const mesh = new Mesh(name, scene);
  mesh.setVerticesData("position", positions, false);
  mesh.setVerticesData("color", colors, false);
  mesh.setIndices(indices);
  mesh.material = material;
  mesh.isPickable = false;
  return mesh;
}
