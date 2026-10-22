// src/OsrsWorld.ts
// Makes the world look like OSRS with the RuneLite GPU plugin:
// - overworld atmosphere: constant daylight, a light sky that distant terrain
//   fades into, a longer draw distance and softer shadows (caves and other map
//   levels keep the game's own atmosphere);
// - terrain: one crisp colour per tile and faceted (flat-shaded) hills;
// - objects: textures baked into one flat colour per face, like OSRS models.
import { Plugin, SettingsTypes } from "@highlite/core";
import { buildOsrsGround, buildTerrainGeometry, readImage } from "./osrsworld/terrain.js";
import { osrsStyleTexture } from "./osrsworld/textures.js";
import { MODEL_DEFAULT_TEXTURES, osrsTextureCanvas, osrsTextureForFile } from "./osrsworld/osrsTextures.js";
import { OsrsFences } from "./osrsworld/fences.js";

// Map levels in the client.
const MapLevel = { EarthUnderground: 0, EarthOverworld: 1, EarthSky: 2, MoonUnderground: 3, MoonOverworld: 4 };
const GROUND_MESH_NAME = "ground";
const NEAREST_SAMPLING = 1;
const BILINEAR_SAMPLING = 2;
// When more of a mesh's triangles than this land on see-through texels, its
// texture is a cutout (reeds, grass cards) and baking would turn the gaps solid.
const MAX_BAKE_TRANSPARENCY = 0.25;
// How often to look for newly loaded objects (new map regions) to bake.
const BAKE_SCAN_INTERVAL_MS = 1000;
// How often to check for fences that loaded or unloaded.
const FENCE_UPDATE_INTERVAL_MS = 500;
// Names ending in "-halo" are skipped by the game's click picking.
const OSRS_GROUND_NAME = "osrsworld-ground-halo";
const OSRS_PAVING_NAME = "osrsworld-paving-halo";
const WATER_MESH_NAME = "water-plane";
// Objects that tint the grass around them (see groundFeatures): by name, and
// building walls by texture.
const TREE_NAMES = /tree|stump|bush|blossom/i;
const ROCK_NAMES = /rock/i;
const BUILDING_TEXTURES = new Set(["14.png", "16.png", "17.png", "26.png", "window1.png"]);
// OSRS water texture, and how fast it drifts (texture repeats per ms).
const WATER_TEXTURE = 1;
const WATER_DRIFT = 0.00004;
// The game's decorative plants (see hideDecorativePlants), by name.
const DECORATIVE_PLANTS = new Set(["Plant", "Cat Tails", "Flower"]);

function hexToRgb(hex) {
  const value = parseInt(String(hex).replace("#", ""), 16);
  return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255];
}

var OsrsWorld = class extends Plugin {
  constructor() {
    super();
    this.pluginName = "OSRS World";
    this.author = "HighLite-Client";
    this.settings.enable.value = true;
    this.defineSettings();
    this.observer = null;
    this.saved = null;
    this.resetTracking();
  }

  // Adds any settings not yet defined (a hot-swapped instance keeps the
  // settings its original constructor created).
  defineSettings() {
    const defaults = {
      alwaysDay: {
        text: "Always daylight",
        type: SettingsTypes.checkbox,
        value: true,
        callback: () => this.restoreIfDisabled()
      },
      skyColor: {
        text: "Sky colour",
        type: SettingsTypes.color,
        value: "#9cbde6",
        callback: () => {
        }
      },
      drawDistance: {
        text: "Draw distance (tiles)",
        type: SettingsTypes.range,
        value: 72,
        min: 32,
        max: 120,
        callback: () => {
        }
      },
      fullResolutionTerrain: {
        text: "Full-resolution terrain (one quad per tile)",
        type: SettingsTypes.checkbox,
        value: true,
        callback: () => {
        }
      },
      osrsTerrain: {
        text: "OSRS terrain shading",
        type: SettingsTypes.checkbox,
        value: true,
        callback: () => this.refreshGround()
      },
      tileVisibility: {
        text: "Tile visibility (OSRS shading)",
        type: SettingsTypes.range,
        value: 5,
        min: 0,
        max: 10,
        callback: () => this.refreshGround()
      },
      tiledGround: {
        text: "One flat colour per tile (when OSRS shading is off)",
        type: SettingsTypes.checkbox,
        value: false,
        callback: () => this.applyGroundSampling()
      },
      facetedTerrain: {
        text: "Faceted terrain",
        type: SettingsTypes.checkbox,
        value: false,
        callback: () => {
        }
      },
      osrsTextures: {
        text: "OSRS-style object textures",
        type: SettingsTypes.checkbox,
        value: true,
        callback: () => this.settings.osrsTextures.value || this.restoreTextures()
      },
      hideDecorativePlants: {
        text: "Hide decorative plants",
        type: SettingsTypes.checkbox,
        value: true,
        callback: () => this.settings.hideDecorativePlants.value || this.showDecorativePlants()
      },
      osrsFences: {
        text: "OSRS fences (from your OSRS cache)",
        type: SettingsTypes.checkbox,
        value: true,
        callback: () => this.settings.osrsFences.value || this.removeFences()
      },
      flatObjects: {
        text: "Flat-coloured objects (when OSRS textures are off)",
        type: SettingsTypes.checkbox,
        value: false,
        callback: () => this.settings.flatObjects.value || this.unbakeAll()
      }
    };
    for (const [key, setting] of Object.entries(defaults)) this.settings[key] ??= setting;
  }

  resetTracking() {
    this.groundMesh = null;
    // Baked materials: material -> { texture, pixels, width, height }.
    this.bakedMaterials = new Map();
    this.skippedMaterials = new WeakSet();
    this.bakedMeshes = new WeakSet();
    this.lastBakeScan = 0;
    this.bakeInProgress = false;
    // Retextured materials: material -> original texture.
    this.retextured = new Map();
    this.facetedMeshes = new WeakSet();
  }

  init() {
    this.log("Initializing");
  }

  start() {
    this.log("Started");
    // Hot-swapped instances keep their old fields; make sure ours exist.
    this.defineSettings();
    this.resetTracking();
    this.attachRenderObserver();
  }

  stop() {
    this.log("Stopped");
    this.detachRenderObserver();
    this.restore();
    this.unbakeAll();
    this.restoreTextures();
    this.removeFences();
    this.showDecorativePlants();
    this.restoreWater();
    this.osrsSceneryMaterial?.dispose();
    this.osrsSceneryMaterial = null;
    this.stoneMaterial?.dispose();
    this.stoneMaterial = null;
    this.removeOsrsGround();
    if (this.groundMesh) this.setGroundSampling(this.groundMesh, BILINEAR_SAMPLING);
    this.groundMesh = null;
  }

  get scene() {
    return this.gameHooks?.GameEngine?.Instance?.Scene ?? null;
  }

  get atmosphere() {
    return this.gameHooks?.AtmosphereManager?.Instance ?? null;
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

  renderFrame(scene) {
    this.updateGround(scene);
    const objectMode = this.settings.osrsTextures.value ? "retexture" : this.settings.flatObjects.value ? "bake" : null;
    if (objectMode && !this.bakeInProgress && performance.now() - this.lastBakeScan > BAKE_SCAN_INTERVAL_MS) {
      this.lastBakeScan = performance.now();
      this.bakeInProgress = true;
      (objectMode === "retexture" ? this.retextureNewObjects(scene) : this.bakeNewObjects(scene))
        .catch((error) => this.error("Updating objects failed", error))
        .finally(() => (this.bakeInProgress = false));
    }
    this.updateAtmosphere(scene);
    this.updateSceneryBrightness();
    this.updateFences(scene);
    this.updateWater(scene, scene.getEngine().getDeltaTime());
  }

  // OSRS water: the game's flat blue water plane gets OSRS's water texture
  // from the player's cache, once per tile, drifting as OSRS water does.
  updateWater(scene, deltaMs) {
    const water = scene.getMeshByName(WATER_MESH_NAME);
    const material = water?.material;
    if (!material || !window.osrsCache) return;
    if (this.waterMaterial !== material) {
      this.restoreWater();
      this.waterMaterial = material;
      this.originalWater = {
        diffuseColor: material.diffuseColor.clone(),
        emissiveColor: material.emissiveColor.clone(),
        diffuseTexture: material.diffuseTexture,
        alpha: material.alpha,
        disableLighting: material.disableLighting
      };
      osrsTextureCanvas(WATER_TEXTURE).then((canvas) => {
        if (!canvas || this.waterMaterial !== material) return;
        const Texture = scene.textures.find((t) => t.getClassName() === "Texture")?.constructor;
        if (!Texture) return;
        const texture = new Texture(canvas.toDataURL(), scene, false, true, NEAREST_SAMPLING);
        // OSRS water keeps its own colour: unlit (the emissive colour follows
        // the scene's light level, see updateSceneryBrightness) and solid.
        material.unfreeze?.();
        material.diffuseTexture = texture;
        material.disableLighting = true;
        material.diffuseColor.set(0, 0, 0);
        material.alpha = 1;
      });
    }
    // The plane spans the region with UVs 0-1; repeat once per tile. (Set
    // every frame: something resets the scale after it is first set.)
    const texture = material.diffuseTexture;
    if (texture && texture !== this.originalWater?.diffuseTexture) {
      const options = this.gameHooks.WorldMapManager?.Instance?._groundMeshOptions;
      texture.uScale = options?.width ?? 144;
      texture.vScale = options?.height ?? 144;
      texture.vOffset = (texture.vOffset + deltaMs * WATER_DRIFT) % 1;
    }
  }

  restoreWater() {
    const material = this.waterMaterial, original = this.originalWater;
    if (material && original) {
      if (material.diffuseTexture !== original.diffuseTexture) material.diffuseTexture?.dispose();
      material.diffuseTexture = original.diffuseTexture;
      material.diffuseColor.copyFrom(original.diffuseColor);
      material.emissiveColor.copyFrom(original.emissiveColor);
      material.alpha = original.alpha;
      material.disableLighting = original.disableLighting;
    }
    this.waterMaterial = null;
    this.originalWater = null;
  }

  // OSRS scenery and ground have their lighting baked in; their brightness
  // follows the scene's light level (dim in caves).
  updateSceneryBrightness() {
    const light = this.atmosphere?.HemisphericLight;
    if (!light || !this.osrsSceneryMaterial) return;
    const level = (channel) => Math.min(1, Math.max(0.45, light.diffuse[channel] * light.intensity * 1.1));
    this.osrsSceneryMaterial.emissiveColor.set(level("r"), level("g"), level("b"));
    this.stoneMaterial?.emissiveColor.set(level("r"), level("g"), level("b"));
    if (this.waterMaterial?.disableLighting) this.waterMaterial.emissiveColor.set(level("r"), level("g"), level("b"));
  }

  // OSRS fence objects in place of the game's fence walls (see fences.js).
  updateFences(scene) {
    if (!this.settings.osrsFences.value || !window.osrsCache) return;
    const material = this.sceneryMaterial(scene);
    if (!material) return;
    if (performance.now() - (this.lastFenceUpdate ?? 0) < FENCE_UPDATE_INTERVAL_MS) return;
    this.lastFenceUpdate = performance.now();
    if (this.settings.osrsTerrain.value) this.refreshGroundForFeatures();
    this.fences ??= new OsrsFences(scene, () => this.gameHooks.WorldEntityManager?.Instance?.WorldEntities);
    this.fences.update(material).catch((error) => this.error("Building OSRS fences failed", error));
    if (this.settings.hideDecorativePlants.value) this.hideDecorativePlants(scene);
  }

  // Hides the game's purely decorative plants (no actions: big leafy plants,
  // cat tails, flowers). Harvestable ones stay.
  hideDecorativePlants(scene) {
    const entities = this.gameHooks.WorldEntityManager?.Instance?.WorldEntities;
    if (!entities) return;
    this.hiddenPlants ??= new Set();
    // An object's parts are separate meshes sharing its name.
    const names = new Set();
    for (const [id, entity] of entities) {
      if (DECORATIVE_PLANTS.has(entity._def?._name) && !entity._def._actions?.length) names.add(`_we_${id}`);
    }
    for (const mesh of scene.meshes) {
      if (names.has(mesh.name) && mesh.isEnabled()) {
        mesh.setEnabled(false);
        this.hiddenPlants.add(mesh);
      }
    }
  }

  showDecorativePlants() {
    for (const mesh of this.hiddenPlants ?? []) if (!mesh.isDisposed()) mesh.setEnabled(true);
    this.hiddenPlants = null;
  }

  removeFences() {
    this.fences?.dispose();
    this.fences = null;
  }

  // Unlit material for OSRS scenery: lighting is baked into vertex colours,
  // and the emissive colour follows the scene's light level (dim in caves).
  sceneryMaterial(scene) {
    if (this.osrsSceneryMaterial) return this.osrsSceneryMaterial;
    const template = scene.materials.find((m) => m.getClassName() === "StandardMaterial");
    if (!template) return null;
    const material = new template.constructor("osrsworld-scenery", scene);
    material.disableLighting = true;
    material.diffuseColor = new template.diffuseColor.constructor(0, 0, 0);
    material.specularColor = new template.diffuseColor.constructor(0, 0, 0);
    material.emissiveColor = new template.diffuseColor.constructor(1, 1, 1);
    material.backFaceCulling = false;
    this.osrsSceneryMaterial = material;
    return material;
  }

  // Object materials (walls, roofs, trees, rocks...) with a diffuse texture.
  // Merged meshes use a MultiMaterial; its sub-materials are included.
  *objectMaterials(mesh) {
    const material = mesh.material;
    if (!material || mesh.billboardMode || mesh.name === GROUND_MESH_NAME || mesh.name.startsWith("models3d")) return;
    const materials = material.getClassName() === "MultiMaterial" ? material.subMaterials : [material];
    for (const sub of materials) if (sub?.getClassName?.() === "StandardMaterial") yield sub;
  }

  // Gives every newly loaded object OSRS-style textures and faceted shading.
  async retextureNewObjects(scene) {
    for (const mesh of [...scene.meshes]) {
      const source = mesh.sourceMesh ?? mesh;
      let touched = false;
      for (const material of this.objectMaterials(source)) {
        touched = true;
        if (this.retextured.has(material) || !material.diffuseTexture?.isReady?.()) continue;
        await this.retexture(material, source);
      }
      if (touched && !this.facetedMeshes.has(source) && !source.isDisposed() && source.getTotalVertices?.() > 0) {
        this.facetedMeshes.add(source);
        source.convertToFlatShadedMesh();
        this.refreezeWorldMatrix(source);
      }
    }
  }

  async retexture(material, mesh) {
    const original = material.diffuseTexture;
    this.retextured.set(material, original);
    // Textures with an OSRS counterpart use the real one from the player's
    // OSRS cache; the rest are restyled.
    let canvas = await osrsTextureForFile(this.textureFileOf(material, mesh));
    if (material.diffuseTexture !== original) return;
    if (!canvas) {
      const { width, height } = original.getSize();
      const pixels = await original.readPixels();
      if (!pixels || material.diffuseTexture !== original) return;
      canvas = osrsStyleTexture(pixels, width, height);
    }
    const Texture = original.constructor;
    const texture = new Texture(canvas.toDataURL(), material.getScene(), false, original._invertY ?? true, NEAREST_SAMPLING);
    texture.hasAlpha = original.hasAlpha;
    texture.wrapU = original.wrapU;
    texture.wrapV = original.wrapV;
    material.unfreeze?.();
    material.diffuseTexture = texture;
  }

  // The game texture a world object's material was made from ("15.png").
  // Walls name their materials after their entity ("2903-material"); other
  // objects name it in their mesh spec ("roof4.obj%15.png%...",
  // "cube_8_1_8_10_0_14.png_null") or use their model's default.
  textureFileOf(material, mesh) {
    const id = /^(\d+)-material$/.exec(material.name)?.[1];
    const fromEntity = id && this.gameHooks.WorldEntityManager?.Instance?.WorldEntities?.get(Number(id))?._appearance?._materialFileName;
    if (fromEntity) return fromEntity;
    const spec = mesh?.metadata?._meshFileName;
    if (typeof spec !== "string") return null;
    if (spec.startsWith("cube_")) return /_([^_]+\.png)_/.exec(spec)?.[1] ?? null;
    const [file, override] = spec.split("%");
    if (override?.endsWith(".png")) return override;
    return MODEL_DEFAULT_TEXTURES.get(file)?.[material.name] ?? null;
  }

  restoreTextures() {
    for (const [material, original] of this.retextured) {
      const current = material.diffuseTexture;
      material.diffuseTexture = original;
      if (current && current !== original) current.dispose();
    }
    this.retextured.clear();
  }

  // Static meshes have frozen world matrices; after their geometry changes the
  // matrix must be refrozen, or the bounding box stays at the origin and the
  // mesh is culled as off-screen.
  refreezeWorldMatrix(mesh) {
    if (!mesh.isWorldMatrixFrozen) return;
    mesh.unfreezeWorldMatrix();
    mesh.computeWorldMatrix(true);
    mesh.freezeWorldMatrix();
  }

  // The ground mesh is rebuilt whenever a new map region loads.
  updateGround(scene) {
    const map = this.gameHooks.WorldMapManager?.Instance;
    // Regions load with half as many quads as tiles; asking for one per tile
    // makes every later region load at full resolution.
    const options = map?._groundMeshOptions;
    if (options && this.settings.fullResolutionTerrain.value && options.subdivisions !== map._numberTilesPerAxis) {
      options.subdivisions = map._numberTilesPerAxis;
    }

    const ground = scene.getMeshByName(GROUND_MESH_NAME);
    if (!ground || ground === this.groundMesh) return;
    this.removeOsrsGround();
    this.groundMesh = ground;
    this.upgradeGroundGeometry(ground)
      .catch((error) => this.error("Rebuilding terrain failed", error))
      .finally(() => {
        if (ground !== this.groundMesh) return;
        if (this.settings.facetedTerrain.value) {
          ground.convertToFlatShadedMesh();
          this.refreezeWorldMatrix(ground);
        }
        this.refreshGround();
      });
  }

  // A region loaded before the option took effect is rebuilt in place at one
  // quad per tile. The ground's height lookups are told its new resolution.
  async upgradeGroundGeometry(ground) {
    const map = this.gameHooks.WorldMapManager?.Instance;
    const tiles = map?._numberTilesPerAxis;
    if (!this.settings.fullResolutionTerrain.value || !tiles || !map._heightMapUrl || ground._subdivisionsX >= tiles) return;
    const options = map._groundMeshOptions;
    const { positions, uvs, indices } = await buildTerrainGeometry(map._heightMapUrl, options.width, tiles, options.minHeight, options.maxHeight);
    if (ground !== this.groundMesh || ground.isDisposed()) return;
    ground.setVerticesData("position", positions, false);
    ground.setVerticesData("uv", uvs, false);
    ground.setIndices(indices);
    ground.createNormals(false);
    ground._subdivisionsX = ground._subdivisionsY = tiles;
    // The height lookup table is only rebuilt for the new resolution when empty.
    ground._heightQuads = [];
    ground.updateCoordinateHeights();
    ground.refreshBoundingInfo();
    this.refreezeWorldMatrix(ground);
  }

  refreshGround() {
    if (!this.groundMesh) return;
    if (this.settings.osrsTerrain.value) {
      this.buildGround(this.groundMesh).catch((error) => this.error("Building terrain failed", error));
    } else {
      this.removeOsrsGround();
      this.applyGroundSampling();
    }
  }

  // Draws the region's ground the OSRS way (see osrsworld/terrain.js) in
  // place of the game's. The game's ground stays in the scene, hidden, for
  // clicks and height lookups; ours is named so the game's picking skips it.
  async buildGround(ground) {
    const map = this.gameHooks.WorldMapManager?.Instance;
    if (!map?._textureUrl) return;
    const colors = await readImage(map._textureUrl);
    if (ground !== this.groundMesh || ground.isDisposed() || !this.settings.osrsTerrain.value) return;
    const material = this.sceneryMaterial(ground.getScene());
    if (!material) return;
    // Tile corners sit on the game ground's own vertices (one row per
    // subdivision, the first row at the image's top), so heights match.
    const vertices = ground.getVerticesData("position");
    const subdivisions = ground._subdivisionsX ?? map._groundMeshOptions.subdivisions;
    const options = map._groundMeshOptions;
    const cornerPosition = (cx, cy) => {
      const col = Math.round((cx / colors.width) * subdivisions), row = Math.round((cy / colors.height) * subdivisions);
      const y = vertices[(row * (subdivisions + 1) + col) * 3 + 1];
      return [(cx / colors.width) * options.width - options.width / 2, y, options.height / 2 - (cy / colors.height) * options.height];
    };
    // World tile of corner 0, 0 (the image's top-left), for the height noise.
    const worldOrigin = { x: Math.round(ground.position.x - options.width / 2), y: Math.round(-(ground.position.z + options.height / 2)) };
    const water = ground.getScene().getMeshByName(WATER_MESH_NAME);
    const waterLevel = water ? water.position.y - ground.position.y : null;
    const features = this.groundFeatures(colors, worldOrigin, ground, options);
    this.groundFeatureCount = features.count;
    const data = buildOsrsGround(colors, cornerPosition, worldOrigin, this.settings.tileVisibility.value / 10, waterLevel, features);
    const Mesh = this.scene.meshes.find((m) => m.getClassName() === "Mesh").constructor;
    const osrsGround = new Mesh(OSRS_GROUND_NAME, ground.getScene());
    osrsGround.setVerticesData("position", data.positions, false);
    osrsGround.setVerticesData("color", data.colors, false);
    osrsGround.setIndices(data.indices);
    osrsGround.material = material;
    osrsGround.isPickable = false;
    osrsGround.parent = ground;
    // Stone paving, textured; it hangs off our ground, so it goes with it.
    await this.texturedGround(osrsGround, data.textured);
    if (ground !== this.groundMesh || ground.isDisposed()) {
      osrsGround.dispose();
      return;
    }
    this.removeOsrsGround();
    this.osrsGround = osrsGround;
    ground.isVisible = false;
  }

  // The textured part of our ground (stone paving), with the OSRS texture from
  // the player's cache.
  async texturedGround(parent, textured) {
    if (!textured.positions.length) return null;
    const material = await this.stonePavingMaterial(parent.getScene(), textured.textureId);
    if (!material || parent.isDisposed()) return null;
    const mesh = new parent.constructor(OSRS_PAVING_NAME, parent.getScene());
    mesh.setVerticesData("position", textured.positions, false);
    mesh.setVerticesData("color", textured.colors, false);
    mesh.setVerticesData("uv", textured.uvs, false);
    mesh.setIndices(textured.indices);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.parent = parent;
    return mesh;
  }

  // Unlit, textured, lit by vertex colour. With lighting disabled only the
  // emissive colour reaches the output (times texture and vertex colour), so
  // that is what follows the scene's light level (see updateSceneryBrightness).
  async stonePavingMaterial(scene, textureId) {
    if (this.stoneMaterial) return this.stoneMaterial;
    const canvas = await osrsTextureCanvas(textureId);
    const template = scene.materials.find((m) => m.getClassName() === "StandardMaterial");
    const Texture = scene.textures.find((t) => t.getClassName() === "Texture")?.constructor;
    if (!canvas || !template || !Texture || this.stoneMaterial) return this.stoneMaterial ?? null;
    const material = new template.constructor("osrsworld-stone", scene);
    material.disableLighting = true;
    material.diffuseTexture = new Texture(canvas.toDataURL(), scene, false, true, NEAREST_SAMPLING);
    material.diffuseColor = new template.diffuseColor.constructor(0, 0, 0);
    material.specularColor = new template.diffuseColor.constructor(0, 0, 0);
    material.emissiveColor = new template.diffuseColor.constructor(1, 1, 1);
    material.backFaceCulling = false;
    this.stoneMaterial = material;
    return material;
  }

  // Tiles of the objects that tint the grass around them (see terrain.js
  // FEATURE_TINTS): trees, rocks and building walls, as tile indices.
  groundFeatures(colors, worldOrigin, ground, options) {
    const top = ground.position.z + options.height / 2;
    const toTile = (x, z) => {
      const tx = Math.floor(x - worldOrigin.x), ty = Math.floor(top - z);
      return tx >= 0 && ty >= 0 && tx < colors.width && ty < colors.height ? ty * colors.width + tx : -1;
    };
    const features = { tree: new Set(), rock: new Set(), building: new Set(), count: 0 };
    const add = (set, x, z) => {
      const tile = toTile(x, z);
      if (tile >= 0) set.add(tile);
    };
    for (const entity of this.gameHooks.WorldEntityManager?.Instance?.WorldEntities?.values() ?? []) {
      const appearance = entity._appearance, centre = appearance?._position;
      if (!centre) continue;
      const name = entity._def?._name ?? "";
      if (TREE_NAMES.test(name)) add(features.tree, centre._x, centre._z);
      else if (ROCK_NAMES.test(name)) add(features.rock, centre._x, centre._z);
      else if (BUILDING_TEXTURES.has(appearance._materialFileName) && !entity._tileLength && appearance._rotation) {
        // A wall: tiles along its line.
        const yaw = appearance._rotation._y, along = [Math.cos(yaw), -Math.sin(yaw)];
        for (let t = -entity._width / 2; t <= entity._width / 2; t += 0.5) add(features.building, centre._x + along[0] * t, centre._z + along[1] * t);
      } else continue;
      features.count++;
    }
    return { tree: [...features.tree], rock: [...features.rock], building: [...features.building], count: features.count };
  }

  // Objects often finish loading after the ground: rebuild it once they do.
  refreshGroundForFeatures() {
    if (!this.osrsGround || !this.groundMesh || this.buildingGround) return;
    let count = 0;
    for (const entity of this.gameHooks.WorldEntityManager?.Instance?.WorldEntities?.values() ?? []) {
      const name = entity._def?._name ?? "";
      if (TREE_NAMES.test(name) || ROCK_NAMES.test(name) || (BUILDING_TEXTURES.has(entity._appearance?._materialFileName) && !entity._tileLength && entity._appearance?._rotation)) count++;
    }
    if (count === this.groundFeatureCount) return;
    this.buildingGround = true;
    this.buildGround(this.groundMesh)
      .catch((error) => this.error("Building terrain failed", error))
      .finally(() => (this.buildingGround = false));
  }

  removeOsrsGround() {
    this.osrsGround?.dispose();
    this.osrsGround = null;
    if (this.groundMesh && !this.groundMesh.isDisposed()) this.groundMesh.isVisible = true;
  }

  applyGroundSampling() {
    if (!this.groundMesh || this.osrsGround) return;
    this.setGroundSampling(this.groundMesh, this.settings.tiledGround.value ? NEAREST_SAMPLING : BILINEAR_SAMPLING);
  }

  setGroundSampling(ground, mode) {
    const texture = ground.material?._textures?.groundTexture ?? ground.material?.diffuseTexture;
    if (texture && texture.samplingMode !== mode) texture.updateSamplingMode(mode);
  }

  // Bakes every textured object not seen before. Each material's texture is
  // read once and kept. Whether a material is baked is decided from the first
  // mesh that uses it; meshes loaded later that share an already-baked material
  // are baked from the stored pixels.
  async bakeNewObjects(scene) {
    for (const mesh of [...scene.meshes]) {
      const source = mesh.sourceMesh ?? mesh;
      if (this.bakedMeshes.has(source) || !this.isBakeable(source)) continue;
      const material = source.material;
      const baked = await this.getMaterialPixels(material);
      if (!baked || source.isDisposed() || this.skippedMaterials.has(material)) continue;
      const { colors, transparentFraction } = this.faceColors(source, baked);
      this.bakedMeshes.add(source);
      if (!baked.decided) {
        if (transparentFraction > MAX_BAKE_TRANSPARENCY) {
          this.skippedMaterials.add(material);
          this.bakedMaterials.delete(material);
          continue;
        }
        baked.decided = true;
        material.unfreeze?.();
        material.diffuseTexture = null;
        material.diffuseColor.set(1, 1, 1);
      }
      source.setVerticesData("color", colors, false);
      this.refreezeWorldMatrix(source);
    }
  }

  isBakeable(mesh) {
    const material = mesh.material;
    return !!material && material.getClassName() === "StandardMaterial" && !mesh.billboardMode &&
      mesh.name !== GROUND_MESH_NAME && !mesh.name.startsWith("models3d") &&
      !this.skippedMaterials.has(material) && (this.bakedMaterials.has(material) || !!material.diffuseTexture) &&
      !!mesh.getVerticesData?.("uv");
  }

  async getMaterialPixels(material) {
    const known = this.bakedMaterials.get(material);
    if (known) return known;
    const texture = material.diffuseTexture;
    if (!texture?.isReady?.()) return null;
    const { width, height } = texture.getSize();
    const pixels = await texture.readPixels();
    if (!pixels) return null;
    if (!this.bakedMaterials.has(material)) this.bakedMaterials.set(material, { texture, pixels, width, height, decided: false });
    return this.bakedMaterials.get(material);
  }

  // Flat-shades a mesh and works out each triangle's colour: the texture at its
  // centre. Also reports how many triangles landed on see-through texels.
  faceColors(mesh, { pixels, width, height }) {
    mesh.convertToFlatShadedMesh();
    const uv = mesh.getVerticesData("uv");
    const count = uv.length / 2;
    const colors = new Float32Array(count * 4);
    const wrap = (value) => ((value % 1) + 1) % 1;
    let transparent = 0;
    for (let t = 0; t + 2 < count; t += 3) {
      const u = (uv[t * 2] + uv[t * 2 + 2] + uv[t * 2 + 4]) / 3;
      const v = (uv[t * 2 + 1] + uv[t * 2 + 3] + uv[t * 2 + 5]) / 3;
      // Texture rows run top to bottom; v runs bottom to top.
      const x = Math.min(width - 1, Math.floor(wrap(u) * width));
      const y = Math.min(height - 1, Math.floor((1 - wrap(v)) * height));
      const i = (y * width + x) * 4;
      if (pixels[i + 3] < 128) transparent++;
      for (let k = 0; k < 3; k++) {
        colors[(t + k) * 4] = pixels[i] / 255;
        colors[(t + k) * 4 + 1] = pixels[i + 1] / 255;
        colors[(t + k) * 4 + 2] = pixels[i + 2] / 255;
        colors[(t + k) * 4 + 3] = 1;
      }
    }
    return { colors, transparentFraction: count ? transparent / (count / 3) : 0 };
  }

  // Puts the textures back. Geometry stays flat-shaded, which only changes how
  // light falls across faces.
  unbakeAll() {
    const scene = this.scene;
    for (const [material, { texture }] of this.bakedMaterials) {
      material.diffuseTexture = texture;
      for (const mesh of scene?.meshes ?? []) {
        if (mesh.material === material && !mesh.sourceMesh) mesh.removeVerticesData?.("color");
      }
    }
    this.bakedMaterials.clear();
    this.bakedMeshes = new WeakSet();
  }

  // The game recomputes fog and light only when the hour changes, so writing
  // our values just before each render keeps them in force.
  updateAtmosphere(scene) {
    const atmosphere = this.atmosphere;
    const camera = scene.activeCamera;
    if (!atmosphere?.DidInit || !camera) return;
    const isOverworld = atmosphere._currentMapLevel === MapLevel.EarthOverworld;
    if (!isOverworld || !this.settings.alwaysDay.value) {
      this.restore();
      return;
    }
    this.save(scene, camera);

    const [r, g, b] = hexToRgb(this.settings.skyColor.value);
    scene.fogColor.set(r, g, b);
    scene.clearColor.set(r, g, b, 1);
    const distance = this.settings.drawDistance.value;
    camera.maxZ = distance;
    // RuneLite-style fog: clear up close, fading only over the last stretch.
    scene.fogStart = distance * 0.8;
    scene.fogEnd = distance;

    const light = atmosphere.HemisphericLight;
    if (light) {
      light.diffuse.set(1, 0.98, 0.94);
      light.intensity = 1;
      // OSRS shading never goes fully black: faces turned away from the sky
      // keep a good share of light.
      light.groundColor.set(0.42, 0.42, 0.45);
    }
  }

  // Remembers the game's own values the first time we override them.
  save(scene, camera) {
    if (this.saved) return;
    const light = this.atmosphere?.HemisphericLight;
    this.saved = {
      maxZ: camera.maxZ,
      fogStart: scene.fogStart,
      fogEnd: scene.fogEnd,
      fogColor: scene.fogColor.clone(),
      clearColor: scene.clearColor.clone(),
      lightDiffuse: light?.diffuse.clone(),
      lightGround: light?.groundColor.clone(),
      lightIntensity: light?.intensity
    };
  }

  // Hands the atmosphere back to the game. It only reapplies its values on the
  // next hour change, so restore what it last set.
  restore() {
    const scene = this.scene;
    if (!this.saved || !scene) return;
    const camera = scene.activeCamera;
    const light = this.atmosphere?.HemisphericLight;
    if (camera) camera.maxZ = this.saved.maxZ;
    scene.fogStart = this.saved.fogStart;
    scene.fogEnd = this.saved.fogEnd;
    scene.fogColor.copyFrom(this.saved.fogColor);
    scene.clearColor.copyFrom(this.saved.clearColor);
    if (light && this.saved.lightDiffuse) {
      light.diffuse.copyFrom(this.saved.lightDiffuse);
      light.groundColor.copyFrom(this.saved.lightGround);
      light.intensity = this.saved.lightIntensity;
    }
    this.saved = null;
  }

  restoreIfDisabled() {
    if (!this.settings.alwaysDay.value) this.restore();
  }
};

// Dev only: swap code edits into the running plugin instead of letting Vite
// reload the page, which would log the player out.
if (import.meta.hot) {
  import.meta.hot.accept((updated) => {
    const entry = document.highlite?.managers?.PluginManager?.plugins?.find((p) => p.instance?.pluginName === "OSRS World");
    const instance = entry?.instance;
    if (!updated?.default || !instance) return;
    const wasEnabled = instance.settings.enable.value;
    // A half-finished edit can leave stop() broken; swap in the new code anyway.
    try {
      if (wasEnabled) instance.stop();
    } catch (error) {
      console.error("[OsrsWorld] stop() failed during hot swap", error);
    }
    Object.setPrototypeOf(instance, updated.default.prototype);
    if (wasEnabled) instance.start();
    console.info("[OsrsWorld] Hot-swapped plugin code");
  });
}

export {
  OsrsWorld as default
};
