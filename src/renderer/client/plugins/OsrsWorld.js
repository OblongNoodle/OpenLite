// src/OsrsWorld.ts
// Makes the world look like OSRS with the RuneLite GPU plugin:
// - overworld atmosphere: constant daylight, a light sky that distant terrain
//   fades into, a longer draw distance and softer shadows (caves and other map
//   levels keep the game's own atmosphere);
// - terrain: one crisp colour per tile and faceted (flat-shaded) hills;
// - objects: textures baked into one flat colour per face, like OSRS models.
import { Plugin, SettingsTypes } from "@highlite/core";

// Map levels in the client.
const MapLevel = { EarthUnderground: 0, EarthOverworld: 1, EarthSky: 2, MoonUnderground: 3, MoonOverworld: 4 };
const GROUND_MESH_NAME = "ground";
const NEAREST_SAMPLING = 1;
const BILINEAR_SAMPLING = 2;
// Textures with more see-through texels than this are cutouts (reeds, grass
// cards, fences); baking them would turn their transparent parts solid.
const MAX_BAKE_TRANSPARENCY = 0.2;
// How often to look for newly loaded objects (new map regions) to bake.
const BAKE_SCAN_INTERVAL_MS = 1000;

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
      tiledGround: {
        text: "One colour per ground tile",
        type: SettingsTypes.checkbox,
        value: true,
        callback: () => this.applyGroundSampling()
      },
      facetedTerrain: {
        text: "Faceted terrain",
        type: SettingsTypes.checkbox,
        value: true,
        callback: () => {
        }
      },
      flatObjects: {
        text: "Flat-coloured objects",
        type: SettingsTypes.checkbox,
        value: true,
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
  }

  init() {
    this.log("Initializing");
  }

  start() {
    this.log("Started");
    // Hot-swapped instances keep their old fields; make sure ours exist.
    this.defineSettings();
    if (!this.bakedMaterials) this.resetTracking();
    this.attachRenderObserver();
  }

  stop() {
    this.log("Stopped");
    this.detachRenderObserver();
    this.restore();
    this.unbakeAll();
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
    if (this.settings.flatObjects.value && !this.bakeInProgress && performance.now() - this.lastBakeScan > BAKE_SCAN_INTERVAL_MS) {
      this.lastBakeScan = performance.now();
      this.bakeInProgress = true;
      this.bakeNewObjects(scene)
        .catch((error) => this.error("Baking objects failed", error))
        .finally(() => (this.bakeInProgress = false));
    }
    this.updateAtmosphere(scene);
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
    const ground = scene.getMeshByName(GROUND_MESH_NAME);
    if (!ground || ground === this.groundMesh) return;
    this.groundMesh = ground;
    if (this.settings.facetedTerrain.value) {
      ground.convertToFlatShadedMesh();
      this.refreezeWorldMatrix(ground);
    }
    this.applyGroundSampling();
  }

  applyGroundSampling() {
    if (this.groundMesh) this.setGroundSampling(this.groundMesh, this.settings.tiledGround.value ? NEAREST_SAMPLING : BILINEAR_SAMPLING);
  }

  setGroundSampling(ground, mode) {
    const texture = ground.material?._textures?.groundTexture ?? ground.material?.diffuseTexture;
    if (texture && texture.samplingMode !== mode) texture.updateSamplingMode(mode);
  }

  // Bakes every textured object not seen before. Textures are read once per
  // material and kept, so objects loaded later that share an already-baked
  // material are baked from the stored pixels.
  async bakeNewObjects(scene) {
    for (const mesh of [...scene.meshes]) {
      const source = mesh.sourceMesh ?? mesh;
      if (this.bakedMeshes.has(source) || !this.isBakeable(source)) continue;
      const baked = await this.getBakedMaterial(source.material);
      if (!baked || source.isDisposed()) continue;
      this.bakeMesh(source, baked);
      this.bakedMeshes.add(source);
    }
  }

  isBakeable(mesh) {
    const material = mesh.material;
    return !!material && material.getClassName() === "StandardMaterial" && !mesh.billboardMode &&
      mesh.name !== GROUND_MESH_NAME && !mesh.name.startsWith("models3d") &&
      !this.skippedMaterials.has(material) && (this.bakedMaterials.has(material) || !!material.diffuseTexture) &&
      !!mesh.getVerticesData?.("uv");
  }

  async getBakedMaterial(material) {
    const known = this.bakedMaterials.get(material);
    if (known) return known;
    const texture = material.diffuseTexture;
    if (!texture?.isReady?.()) return null;
    const { width, height } = texture.getSize();
    const pixels = await texture.readPixels();
    if (!pixels || this.bakedMaterials.has(material)) return this.bakedMaterials.get(material) ?? null;
    let transparent = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 128) transparent++;
    if (transparent / (width * height) > MAX_BAKE_TRANSPARENCY) {
      this.skippedMaterials.add(material);
      return null;
    }
    const baked = { texture, pixels, width, height };
    this.bakedMaterials.set(material, baked);
    material.unfreeze?.();
    material.diffuseTexture = null;
    material.diffuseColor.set(1, 1, 1);
    return baked;
  }

  // Flat-shades a mesh and gives each triangle the texture colour at its centre.
  bakeMesh(mesh, { pixels, width, height }) {
    mesh.convertToFlatShadedMesh();
    const uv = mesh.getVerticesData("uv");
    const count = uv.length / 2;
    const colors = new Float32Array(count * 4);
    const wrap = (value) => ((value % 1) + 1) % 1;
    for (let t = 0; t + 2 < count; t += 3) {
      const u = (uv[t * 2] + uv[t * 2 + 2] + uv[t * 2 + 4]) / 3;
      const v = (uv[t * 2 + 1] + uv[t * 2 + 3] + uv[t * 2 + 5]) / 3;
      // Texture rows run top to bottom; v runs bottom to top.
      const x = Math.min(width - 1, Math.floor(wrap(u) * width));
      const y = Math.min(height - 1, Math.floor((1 - wrap(v)) * height));
      const i = (y * width + x) * 4;
      for (let k = 0; k < 3; k++) {
        colors[(t + k) * 4] = pixels[i] / 255;
        colors[(t + k) * 4 + 1] = pixels[i + 1] / 255;
        colors[(t + k) * 4 + 2] = pixels[i + 2] / 255;
        colors[(t + k) * 4 + 3] = 1;
      }
    }
    mesh.setVerticesData("color", colors, false);
    this.refreezeWorldMatrix(mesh);
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
