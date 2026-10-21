// Draws the game's fences as OSRS fence objects from the player's local
// OSRS cache. The game's fences are hidden (their parts of the merged
// meshes) and an OSRS fence segment is placed on every tile they span,
// one thin-instanced mesh per fence object.
import { OsrsCache } from "../models3d/osrs/player.js";
import { buildObjectData, createObjectMesh, LocShape } from "../models3d/osrs/objects.js";

// Game fences and the OSRS fence object drawn instead. Wall fences are
// matched by texture and use a material per wall ("<id>-material"); model
// fences by model file, sharing that model's material.
const FENCES = [
  { texture: "20.png", objectId: 5631 }, // picket fence
  { texture: "50.png", objectId: 5631 }, // broken picket fence
  { model: "fence1.obj", objectId: 5153, material: "lowpoly_nature:lambert13SG" } // post-and-rail -> wooden fence
];
// OSRS figures are drawn larger to match the game's; scenery is scaled alike.
const WORLD_SCALE = 1.2;

export class OsrsFences {
  constructor(scene, worldEntities) {
    this.scene = scene;
    this.worldEntities = worldEntities;
    // Wall entity ids drawn as OSRS fences, as a key to spot changes.
    this.key = "";
    this.meshes = [];
    // Merged wall meshes with fence parts taken out: mesh -> original subMeshes.
    this.trimmed = new Map();
    this.building = false;
  }

  // Fences currently loaded: id -> { entity, fence }.
  fenceWalls() {
    const walls = new Map();
    for (const [id, entity] of this.worldEntities() ?? []) {
      const appearance = entity._appearance;
      const fence = FENCES.find((f) => (f.texture ? appearance?._materialFileName === f.texture : appearance?._meshFileName === f.model));
      if (fence) walls.set(id, { entity, fence });
    }
    return walls;
  }

  // Called every few hundred ms: rebuilds when the loaded fences change, and
  // hides fence parts of wall meshes the game has (re)built since.
  async update(material) {
    if (this.building) return;
    const walls = this.fenceWalls();
    const key = [...walls.keys()].sort((a, b) => a - b).join(",");
    if (key !== this.key) {
      this.building = true;
      try {
        await this.build(walls, material);
        this.key = key;
      } finally {
        this.building = false;
      }
    }
    this.hideGameFences(walls);
  }

  async build(walls, material) {
    const cache = await OsrsCache.open();
    const objects = await cache.objects();
    const byObject = new Map();
    for (const wall of walls.values()) {
      if (!byObject.has(wall.fence.objectId)) byObject.set(wall.fence.objectId, []);
      byObject.get(wall.fence.objectId).push(wall.entity);
    }
    const meshes = [];
    for (const [objectId, entities] of byObject) {
      const object = objects.get(objectId);
      const data = object && (await buildObjectData(cache, object, LocShape.WallStraight));
      if (!data) continue;
      // Straight walls stand on a tile's west edge; centre the model on the
      // wall line, which then runs along its Z axis.
      const centre = (Math.min(...data.vertexX) + Math.max(...data.vertexX)) / 2;
      data.vertexX = data.vertexX.map((x) => x - centre);
      // "-halo" names are skipped by the game's click picking.
      const Mesh = this.scene.meshes.find((m) => m.getClassName() === "Mesh").constructor;
      const mesh = createObjectMesh(Mesh, this.scene, data, material, `osrsworld-fence-${objectId}-halo`);
      const matrices = entities.flatMap((entity) => this.segmentMatrices(entity));
      mesh.thinInstanceSetBuffer("matrix", new Float32Array(matrices), 16, true);
      mesh.thinInstanceRefreshBoundingInfo(false);
      meshes.push(mesh);
    }
    this.disposeMeshes();
    this.meshes = meshes;
  }

  // One world matrix per tile the wall spans. The wall's local X axis runs
  // along it; each OSRS segment is turned so its Z axis does too.
  segmentMatrices(entity) {
    const appearance = entity._appearance;
    const yaw = appearance._rotation._y;
    const along = [Math.cos(yaw), -Math.sin(yaw)];
    const tiles = Math.max(1, Math.round(entity._tileWidth || entity._width));
    const step = entity._width / tiles;
    const centre = appearance._position;
    const groundY = entity._currentGamePosition._y;
    const turn = Math.atan2(along[0], along[1]);
    const c = Math.cos(turn), s = Math.sin(turn);
    const matrices = [];
    for (let i = 0; i < tiles; i++) {
      const offset = (i + 0.5) * step - entity._width / 2;
      const x = centre._x + along[0] * offset, z = centre._z + along[1] * offset;
      // Row-major: scaled local X, Y and Z axes, then the translation.
      matrices.push(
        WORLD_SCALE * c, 0, -WORLD_SCALE * s, 0,
        0, WORLD_SCALE, 0, 0,
        step * s, 0, step * c, 0,
        x, groundY, z, 1
      );
    }
    return matrices;
  }

  // Takes the replaced fences out of the game's meshes. Merged meshes keep
  // one sub-mesh per material, so only the fences' sub-meshes are dropped.
  hideGameFences(walls) {
    const names = new Set();
    for (const [id, wall] of walls) if (wall.fence.texture) names.add(`${id}-material`);
    const prefixes = [...new Set([...walls.values()].map((wall) => wall.fence.material).filter(Boolean))];
    const isFence = (material) => !!material && (names.has(material.name) || prefixes.some((prefix) => material.name?.startsWith(prefix)));
    for (const mesh of this.scene.meshes) {
      if (mesh.isDisposed() || mesh.name.startsWith("osrsworld")) continue;
      const materials = mesh.material?.subMaterials;
      if (!materials) {
        if (isFence(mesh.material) && mesh.isEnabled()) {
          mesh.setEnabled(false);
          this.trimmed.set(mesh, null);
        }
        continue;
      }
      const keep = mesh.subMeshes.filter((sub) => !isFence(materials[sub.materialIndex]));
      if (keep.length === mesh.subMeshes.length) continue;
      if (!this.trimmed.has(mesh)) this.trimmed.set(mesh, mesh.subMeshes);
      mesh.subMeshes = keep;
    }
  }

  disposeMeshes() {
    for (const mesh of this.meshes) mesh.dispose();
    this.meshes = [];
  }

  dispose() {
    this.disposeMeshes();
    for (const [mesh, subMeshes] of this.trimmed) {
      if (mesh.isDisposed()) continue;
      if (subMeshes) mesh.subMeshes = subMeshes;
      else mesh.setEnabled(true);
    }
    this.trimmed.clear();
    this.key = "";
  }
}
