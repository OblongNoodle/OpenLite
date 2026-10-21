// OSRS ground clutter: flowers, daisies, ferns, thistles, mushrooms, pebbles
// and plants from the player's local OSRS cache, scattered over grass the way
// OSRS maps sprinkle ground decorations. Placement is fixed per tile (a hash
// of its world position), so the same tile always gets the same decoration.
import { OsrsCache } from "../models3d/osrs/player.js";
import { buildObjectData, createObjectMesh, LocShape } from "../models3d/osrs/objects.js";

// OSRS decoration objects and how often each is picked. Flowers only grow in
// flowery patches, as OSRS meadows have them.
const DECORATIONS = [
  { objectId: 1192, weight: 3, flowers: true }, // Flowers
  { objectId: 1193, weight: 3, flowers: true }, // Flowers
  { objectId: 1189, weight: 3, flowers: true }, // Daisies
  { objectId: 1298, weight: 2 }, // Fern
  { objectId: 1300, weight: 2 }, // Fern
  { objectId: 1174, weight: 1 }, // Thistle
  { objectId: 1163, weight: 1 }, // Mushroom
  { objectId: 2231, weight: 2 }, // Rocks (pebbles)
  { objectId: 3723, weight: 1 }, // Rocks (pebbles)
  { objectId: 1313, weight: 2 } // Plant
];
// Share of open grass tiles that get a decoration.
const DENSITY = 0.07;
// Flowery patches: blocks this many tiles across, and the share that are flowery.
const PATCH_SIZE = 6;
const FLOWERY_SHARE = 0.35;
// OSRS figures are drawn larger to match the game's; scenery is scaled alike.
const WORLD_SCALE = 1.2;
// How far from the tile centre a decoration may sit, in tiles.
const JITTER = 0.25;

function hash(x, y, salt) {
  const value = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

// Tiles that objects, walls and fences stand on (tile index set), from the
// game's world entities. toTile(x, z) maps world coordinates to a tile index
// (or -1 off the region).
export function occupiedTiles(entities, toTile) {
  const occupied = new Set();
  const mark = (x, z) => {
    const index = toTile(x, z);
    if (index >= 0) occupied.add(index);
  };
  for (const entity of entities) {
    const appearance = entity._appearance;
    const position = entity._currentGamePosition;
    if (!appearance || !position) continue;
    if (!entity._tileLength && entity._tileWidth > 0 && appearance._position && appearance._rotation) {
      // A wall: a line along its local X axis, through its centre.
      const yaw = appearance._rotation._y, centre = appearance._position;
      const along = [Math.cos(yaw), -Math.sin(yaw)], across = [-along[1], along[0]];
      for (let t = -entity._width / 2; t <= entity._width / 2; t += 0.25) {
        for (const side of [-0.4, 0.4]) mark(centre._x + along[0] * t + across[0] * side, centre._z + along[1] * t + across[1] * side);
      }
      continue;
    }
    // Anything else: its footprint and a tile around it.
    const reach = Math.ceil(Math.max(entity._tileWidth || 1, entity._tileLength || 1) / 2);
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) mark(position._x + dx + 0.5, position._z + dz + 0.5);
    }
  }
  return occupied;
}

// Builds the decorations for one region as thin-instanced meshes (one per
// model), parented to `parent`.
//   surfaces: each tile's surface (see terrain.js tileSurfaces).
//   cornerPosition(cx, cy): [x, y, z] of a tile corner in the parent's space.
//   worldOrigin: world tile coordinates of corner 0, 0.
//   occupied: tile indices to keep clear.
export async function buildDecorations({ scene, material, parent, surfaces, tilesX, tilesY, cornerPosition, worldOrigin, occupied }) {
  const cache = await OsrsCache.open();
  const objects = await cache.objects();
  const placements = new Map(DECORATIONS.map((d) => [d, []]));
  const isGrass = (x, y) => x >= 0 && y >= 0 && x < tilesX && y < tilesY && surfaces[y * tilesX + x] === "grass";

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      // Open grass only: not on or beside a path, and clear of objects.
      if (occupied.has(ty * tilesX + tx)) continue;
      let open = true;
      for (let dy = -1; dy <= 1 && open; dy++) for (let dx = -1; dx <= 1 && open; dx++) open = isGrass(tx + dx, ty + dy);
      if (!open) continue;
      const wx = worldOrigin.x + tx, wy = worldOrigin.y + ty;
      if (hash(wx, wy, 1) >= DENSITY) continue;
      const flowery = hash(Math.floor(wx / PATCH_SIZE), Math.floor(wy / PATCH_SIZE), 2) < FLOWERY_SHARE;
      const choices = DECORATIONS.filter((d) => !d.flowers || flowery);
      let pick = hash(wx, wy, 3) * choices.reduce((sum, d) => sum + d.weight, 0);
      const decoration = choices.find((d) => (pick -= d.weight) < 0) ?? choices[0];
      placements.get(decoration).push({ tx, ty, wx, wy });
    }
  }

  const Mesh = scene.meshes.find((m) => m.getClassName() === "Mesh").constructor;
  const meshes = [];
  for (const [decoration, spots] of placements) {
    const object = objects.get(decoration.objectId);
    if (!spots.length || !object) continue;
    const shape = object.types?.includes(LocShape.GroundDecoration) ? LocShape.GroundDecoration : LocShape.Centrepiece;
    const data = await buildObjectData(cache, object, object.types ? shape : undefined);
    if (!data) continue;
    // "-halo" names are skipped by the game's click picking.
    const mesh = createObjectMesh(Mesh, scene, data, material, `osrsworld-decoration-${decoration.objectId}-halo`);
    const matrices = [];
    for (const { tx, ty, wx, wy } of spots) {
      const corners = [cornerPosition(tx, ty), cornerPosition(tx + 1, ty), cornerPosition(tx, ty + 1), cornerPosition(tx + 1, ty + 1)];
      const centre = [0, 1, 2].map((k) => corners.reduce((sum, c) => sum + c[k], 0) / 4);
      const x = centre[0] + (hash(wx, wy, 4) * 2 - 1) * JITTER, z = centre[2] + (hash(wx, wy, 5) * 2 - 1) * JITTER;
      // OSRS turns decorations by quarter turns.
      const turn = Math.floor(hash(wx, wy, 6) * 4) * (Math.PI / 2);
      const c = Math.cos(turn) * WORLD_SCALE, s = Math.sin(turn) * WORLD_SCALE;
      matrices.push(c, 0, -s, 0, 0, WORLD_SCALE, 0, 0, s, 0, c, 0, x, centre[1], z, 1);
    }
    mesh.thinInstanceSetBuffer("matrix", new Float32Array(matrices), 16, true);
    mesh.parent = parent;
    mesh.thinInstanceRefreshBoundingInfo(false);
    meshes.push(mesh);
  }
  return meshes;
}
