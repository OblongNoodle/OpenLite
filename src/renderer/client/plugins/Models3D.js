// src/Models3D.ts
// Replaces the 2D billboard sprites of players, NPCs and creatures with
// low-poly, OSRS-style 3D models built from the game's own sprite art. Models
// live in ./models3d; this plugin tracks entities and keeps each one's model
// in sync with its position, facing and action state.
import { Plugin, SettingsTypes } from "@highlite/core";
import { AppearanceArt } from "./models3d/sampling.js";
import { ACTIVITY_BY_STATE, Activity, LOOP_INTERVAL_MS, STRIKE_DURATION_MS } from "./models3d/pose.js";
import { DEFAULT_COLORS, HumanModel, humanoidCreatureFor, loadHumanSpec, loadHumanoidCreatureSpec } from "./models3d/human.js";
import { CreatureModel, creatureFamilyFor, loadCreatureSpec } from "./models3d/creatures.js";
import { ITEM_SIZE, itemYaw, loadItemGeometry } from "./models3d/items.js";
import { buildScenery, loadSceneryColors, sceneryKindFor } from "./models3d/scenery.js";
import { OsrsCache, OsrsPlayerModel, buildPlayerData } from "./models3d/osrs/player.js";
import { ActionState } from "@highlite/core";

// Model specs are cached per sprite so identical NPCs share one analysis.
const MAX_CACHED_SPECS = 256;
// Cells per creature in a creature spritesheet (3 frames x 5 directions).
const CELLS_PER_CREATURE = 15;
const SOUTH = 2;

var Models3D = class extends Plugin {
  constructor() {
    super();
    this.pluginName = "3D Models";
    this.author = "HighLite-Client";
    this.settings.enable.value = true;
    this.settings.showSprite = {
      text: "Show 2D sprite too",
      type: SettingsTypes.checkbox,
      value: false,
      callback: () => {
      }
    };
    this.settings.creatures = {
      text: "3D creatures",
      type: SettingsTypes.checkbox,
      value: true,
      callback: () => {
      }
    };
    this.settings.groundItems = {
      text: "3D ground items",
      type: SettingsTypes.checkbox,
      value: true,
      callback: () => {
      }
    };
    this.observer = null;
    this.material = null;
    this.ctors = null;
    this.records = new Map();
    this.specCache = new Map();
    this.itemRecords = new Map();
    this.itemSources = new Map();
    this.sceneryRecords = new Map();
    this.settings.scenery = {
      text: "3D trees, rocks and bushes",
      type: SettingsTypes.checkbox,
      value: true,
      callback: () => {
      }
    };
  }

  init() {
    this.log("Initializing");
    AppearanceArt.load();
  }

  start() {
    this.log("Started");
    // Hot-swapped instances keep their old fields; make sure ours exist.
    this.records ??= new Map();
    this.specCache ??= new Map();
    this.itemRecords ??= new Map();
    this.itemSources ??= new Map();
    this.sceneryRecords ??= new Map();
    this.settings.scenery ??= { text: "3D trees, rocks and bushes", type: SettingsTypes.checkbox, value: true, callback: () => {} };
    this.settings.osrsCharacters ??= { text: "OSRS character models (needs RuneLite's OSRS cache)", type: SettingsTypes.checkbox, value: true, callback: () => {} };
    // Players are built from the local OSRS cache when it is available.
    this.osrsCache = OsrsCache.open().catch((error) => {
      this.warn("OSRS cache not available; using generated characters", error);
      return null;
    });
    this.settings.creatures ??= { text: "3D creatures", type: SettingsTypes.checkbox, value: true, callback: () => {} };
    this.settings.groundItems ??= { text: "3D ground items", type: SettingsTypes.checkbox, value: true, callback: () => {} };
    this.attachRenderObserver();
  }

  stop() {
    this.log("Stopped");
    this.detachRenderObserver();
    this.hideGallery();
    for (const record of this.records.values()) this.disposeRecord(record);
    this.records.clear();
    this.clearGroundItems();
    this.clearScenery();
    // Specs are cheap to rebuild and may come from older code after a hot swap.
    this.specCache.clear();
    for (const key of ["material", "translucentMaterial", "osrsMaterial"]) {
      this[key]?.dispose();
      this[key] = null;
    }
  }

  get scene() {
    return this.gameHooks?.GameEngine?.Instance?.Scene ?? null;
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

  // Babylon classes are taken from the game's own scene objects so our meshes
  // come from the exact same Babylon build the game renders with.
  resolveConstructors(appearance) {
    if (this.ctors) return this.ctors;
    const billboard = appearance.BillboardMesh;
    const standardMaterial = this.scene.materials.find((m) => m.getClassName() === "StandardMaterial");
    if (!billboard || !standardMaterial) return null;
    this.ctors = {
      Mesh: billboard.constructor,
      StandardMaterial: standardMaterial.constructor,
      Color3: standardMaterial.diffuseColor.constructor
    };
    return this.ctors;
  }

  // One shared material, plus a see-through one for translucent creatures (ghosts).
  getMaterial(translucent = false) {
    const key = translucent ? "translucentMaterial" : "material";
    if (this[key]) return this[key];
    const { StandardMaterial, Color3 } = this.ctors;
    const material = new StandardMaterial(`models3d-${key}`, this.scene);
    // OSRS-style lighting is baked into the vertex colours, so the scene's
    // lights are not applied again: with lighting disabled the output is the
    // emissive colour times the vertex colour. emissiveColor follows the
    // scene's light level each frame (see updateMaterialBrightness) so models
    // dim in caves.
    material.disableLighting = true;
    material.diffuseColor = new Color3(0, 0, 0);
    material.specularColor = new Color3(0, 0, 0);
    material.emissiveColor = new Color3(1, 1, 1);
    if (translucent) material.alpha = 0.55;
    this[key] = material;
    return material;
  }

  getItemName(itemId) {
    try {
      const def = this.gameHooks.ItemDefinitionManager.getDefById(itemId);
      return String(def?.Name ?? def?._name ?? "").toLowerCase();
    } catch {
      return "";
    }
  }

  // What kind of model an entity gets, or null to leave it as a sprite.
  // Humans have appearance IDs (layered, equippable sprites); creatures are
  // matched by name to a humanoid variant or a creature body shape.
  classify(entity) {
    const appearance = entity?.Appearance;
    if (!entity || entity.IsDestroyed || !appearance?.BillboardMesh || !appearance.SpritesheetInformation) return null;
    if (appearance.SpritesheetInformation.AppearanceIDs) return { kind: "human" };
    if (!this.settings.creatures.value || appearance.CreatureType === undefined) return null;
    const name = String(entity.Name ?? "").toLowerCase();
    const humanoid = humanoidCreatureFor(name);
    if (humanoid) return { kind: "humanoid", creature: humanoid };
    const family = creatureFamilyFor(name);
    return family ? { kind: "creature", family } : null;
  }

  *modelledEntities() {
    const entities = this.gameHooks.EntityManager?.Instance;
    if (!entities) return;
    const all = [entities.MainPlayer, ...(entities.Players ?? []), ...(entities.NPCs?.values() ?? [])];
    for (const entity of all) {
      const type = this.classify(entity);
      if (type) yield [entity, type];
    }
  }

  // Cache key and loader for an entity's model spec.
  specFor(record) {
    const info = record.appearance.SpritesheetInformation;
    const start = record.appearance._spriteSetStartIndex ?? 0;
    const name = String(record.entity.Name ?? "").toLowerCase();
    switch (record.type.kind) {
      case "human":
        return [info.SpritesheetURL, () => loadHumanSpec(info, (id) => this.getItemName(id))];
      case "humanoid":
        return [`${info.SpritesheetURL}#${start}`, () => loadHumanoidCreatureSpec(info, start, record.type.creature)];
      case "creature":
        return [`${info.SpritesheetURL}#${start}#${name}`, () => loadCreatureSpec(info, start, record.type.family, name)];
    }
  }

  getSpec(record) {
    const [key, load] = this.specFor(record);
    let spec = this.specCache.get(key);
    if (!spec) {
      if (this.specCache.size >= MAX_CACHED_SPECS) this.specCache.clear();
      spec = load().catch((error) => {
        this.error("Failed to build model spec", error);
        return null;
      });
      this.specCache.set(key, spec);
    }
    return [key, spec];
  }

  // Baked-lit models still follow the overall light level (daylight, caves,
  // night if the OSRS World plugin is off), with a floor so they stay readable.
  updateMaterialBrightness() {
    const light = this.gameHooks.AtmosphereManager?.Instance?.HemisphericLight;
    if (!light) return;
    const level = (channel) => Math.min(1, Math.max(0.45, light.diffuse[channel] * light.intensity * 1.1));
    for (const material of [this.material, this.translucentMaterial, this.osrsMaterial]) {
      material?.emissiveColor.set(level("r"), level("g"), level("b"));
    }
  }

  renderFrame(scene) {
    this.updateMaterialBrightness();
    const deltaMs = scene.getEngine().getDeltaTime();
    const now = performance.now();
    const seen = new Set();
    for (const [entity, type] of this.modelledEntities()) {
      const appearance = entity.Appearance;
      if (!this.resolveConstructors(appearance)) return;
      seen.add(entity);

      let record = this.records.get(entity);
      if (!record || record.appearance !== appearance) {
        if (record) this.disposeRecord(record);
        record = { entity, appearance, type, model: null, specKey: null, pendingKey: null, wasAnimatingAction: false, strikeStart: -Infinity };
        this.records.set(entity, record);
      }
      this.updateRecordModel(record);
      if (!record.model) continue;

      const visible = appearance.IsVisible !== false;
      record.model.root.setEnabled(visible);
      if (!visible) continue;

      // A rising edge of the sprite's action animation is one swing.
      const isAnimatingAction = appearance.IsAnimatingAction;
      if (isAnimatingAction && !record.wasAnimatingAction) record.strikeStart = now;
      record.wasAnimatingAction = isAnimatingAction;
      const state = entity.CurrentState?.getCurrentState?.();
      const activity = ACTIVITY_BY_STATE.get(state) ?? Activity.Idle;
      const loopInterval = LOOP_INTERVAL_MS.get(activity);
      if (loopInterval && !entity.IsMoving && now - record.strikeStart > loopInterval) record.strikeStart = now;
      const strikeElapsed = now - record.strikeStart;
      const pose = {
        moving: entity.IsMoving,
        activity,
        woodcutting: state === ActionState.WoodcuttingState,
        strike: strikeElapsed < STRIKE_DURATION_MS ? strikeElapsed / STRIKE_DURATION_MS : null
      };

      const position = {
        x: appearance.Position.x,
        y: appearance.Position.y - appearance.Height / 2,
        z: appearance.Position.z
      };
      // CurrentDirection is the world-space facing; the sprite's "apparent" direction
      // is relative to the camera and must not be used for a 3D model.
      if (record.model instanceof CreatureModel) {
        record.model.update(position, appearance.CurrentDirection, pose, appearance, deltaMs);
      } else {
        record.model.update(position, appearance.CurrentDirection, pose, appearance.Height / 2, deltaMs);
      }

      // Keep the billboard in the scene (it is the click target) but invisible.
      const spriteVisibility = this.settings.showSprite.value ? 1 : 0;
      if (appearance.BillboardMesh.visibility !== spriteVisibility) appearance.BillboardMesh.visibility = spriteVisibility;
    }

    for (const [entity, record] of this.records) {
      if (!seen.has(entity)) {
        this.disposeRecord(record);
        this.records.delete(entity);
      }
    }

    this.renderGroundItems();
    this.renderScenery();

    for (const exhibit of this.gallery ?? []) {
      const pose = { ...this.galleryPose, strike: null };
      if (exhibit.model instanceof CreatureModel) {
        exhibit.model.update(exhibit.position, SOUTH, pose, exhibit.size, deltaMs);
      } else {
        exhibit.model.update(exhibit.position, SOUTH, pose, exhibit.size.Height / 2, deltaMs);
      }
    }
  }

  // Each ground item gets an instance of its item's extruded icon; the
  // billboard stays in the scene, invisible, as the click target.
  renderGroundItems() {
    const groundItems = this.gameHooks.GroundItemManager?.Instance?.GroundItems;
    const enabled = this.settings.groundItems.value && this.ctors && groundItems;
    const seen = new Set();
    if (enabled) {
      for (const item of groundItems.values()) {
        const appearance = item?.Appearance;
        const info = appearance?.SpritesheetInformation;
        if (!appearance?.BillboardMesh || !info?.SpritesheetURL || item.IsDestroyed) continue;
        seen.add(item);
        let record = this.itemRecords.get(item);
        if (!record) {
          record = { item, appearance, instance: null };
          this.itemRecords.set(item, record);
          this.getItemSource(info, appearance._currentSpriteIndex).then((source) => {
            if (!source || this.itemRecords.get(item) !== record) return;
            record.instance = source.createInstance(`models3d-item-${item.EntityID}`);
            record.instance.isPickable = false;
            record.instance.rotation.y = itemYaw(item.EntityID);
            record.instance.scaling.set(ITEM_SIZE, ITEM_SIZE, ITEM_SIZE);
          });
        }
        if (!record.instance) continue;
        const position = appearance.Position;
        record.instance.position.set(position.x, position.y - appearance.Height / 2 + 0.01, position.z);
        record.instance.setEnabled(appearance.IsVisible !== false);
        if (appearance.BillboardMesh.visibility !== 0) appearance.BillboardMesh.visibility = 0;
      }
    }
    for (const [item, record] of this.itemRecords) {
      if (seen.has(item)) continue;
      this.disposeItemRecord(record);
      this.itemRecords.delete(item);
    }
  }

  // Trees, rocks and bushes are replaced by generated models stretched over
  // the original's visible meshes. The originals stay in the scene, invisible,
  // as click targets; a chopped tree or mined rock is rebuilt for its new state.
  renderScenery() {
    const worldEntities = this.gameHooks.WorldEntityManager?.Instance?.WorldEntities;
    const enabled = this.settings.scenery.value && this.ctors && worldEntities;
    const seen = new Set();
    if (enabled) {
      for (const entity of worldEntities.values()) {
        const appearance = entity?.Appearance;
        const meshes = appearance?.BJSMeshes;
        const kind = sceneryKindFor(appearance?.MeshFileName);
        if (!kind || !meshes?.length || entity.IsDestroyed) continue;
        seen.add(entity);
        let record = this.sceneryRecords.get(entity);
        if (!record) {
          record = { entity, appearance, kind, colors: null, mesh: null, state: undefined };
          this.sceneryRecords.set(entity, record);
          loadSceneryColors(kind, meshes).then((colors) => (record.colors = colors));
        }
        // Instances draw with their source mesh's visibility, so hide the source
        // (every copy of that object gets a replacement anyway).
        for (const mesh of meshes) {
          const drawn = mesh.sourceMesh ?? mesh;
          if (drawn.visibility !== 0) drawn.visibility = 0;
        }
        const state = appearance.VisualResourceState;
        if (record.colors && record.state !== state) this.buildSceneryModel(record, state);
      }
    }
    for (const [entity, record] of this.sceneryRecords) {
      if (seen.has(entity)) continue;
      this.disposeSceneryRecord(record);
      this.sceneryRecords.delete(entity);
    }
  }

  buildSceneryModel(record, state) {
    // Fit to the bounds of the original meshes currently shown for this state.
    const shown = record.appearance.BJSMeshes.filter((mesh) => mesh.isEnabled());
    if (!shown.length) return;
    let min = null, max = null;
    for (const mesh of shown) {
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      min = min ? min.minimizeInPlace(box.minimumWorld) : box.minimumWorld.clone();
      max = max ? max.maximizeInPlace(box.maximumWorld) : box.maximumWorld.clone();
    }
    record.mesh?.dispose();
    const geometry = buildScenery(record.kind, record.colors, record.entity.EntityID, state).bakeLighting();
    const mesh = geometry.applyTo(new this.ctors.Mesh(`models3d-scenery-${record.entity.EntityID}`, this.scene));
    mesh.material = this.getMaterial();
    mesh.isPickable = false;
    mesh.position.set((min.x + max.x) / 2, min.y, (min.z + max.z) / 2);
    mesh.scaling.set(max.x - min.x, max.y - min.y, max.z - min.z);
    mesh.freezeWorldMatrix();
    record.mesh = mesh;
    record.state = state;
  }

  disposeSceneryRecord(record) {
    record.mesh?.dispose();
    record.mesh = null;
    if (!record.entity.IsDestroyed) for (const mesh of record.appearance.BJSMeshes ?? []) (mesh.sourceMesh ?? mesh).visibility = 1;
  }

  clearScenery() {
    for (const record of this.sceneryRecords?.values() ?? []) this.disposeSceneryRecord(record);
    this.sceneryRecords?.clear();
  }

  // One hidden source mesh per item icon; ground items are instances of it.
  getItemSource(info, cellIndex) {
    const key = `${info.SpritesheetURL}#${cellIndex}`;
    let source = this.itemSources.get(key);
    if (!source) {
      source = loadItemGeometry(info, cellIndex).then((geometry) => {
        const mesh = geometry.bakeLighting().applyTo(new this.ctors.Mesh(`models3d-itemsource-${cellIndex}`, this.scene));
        mesh.material = this.getMaterial();
        mesh.isPickable = false;
        mesh.setEnabled(false);
        return mesh;
      }).catch((error) => {
        this.error("Failed to build ground item", error);
        return null;
      });
      this.itemSources.set(key, source);
    }
    return source;
  }

  disposeItemRecord(record) {
    record.instance?.dispose();
    record.instance = null;
    if (record.appearance?.BillboardMesh && !record.item.IsDestroyed) record.appearance.BillboardMesh.visibility = 1;
  }

  clearGroundItems() {
    for (const record of this.itemRecords?.values() ?? []) this.disposeItemRecord(record);
    this.itemRecords?.clear();
    for (const source of this.itemSources?.values() ?? []) source.then((mesh) => mesh?.dispose());
    this.itemSources?.clear();
  }

  // Dev aid, called from the console: one model of every creature type in a
  // row beside the main player, facing south. Purely local; nothing is sent to
  // the server. hideGallery() removes it.
  async showGallery({ moving = false, activity = Activity.Idle } = {}) {
    this.hideGallery();
    const player = this.gameHooks.EntityManager.Instance.MainPlayer;
    const npcDefs = this.gameHooks.NpcDefinitionManager._npcDefMap ?? this.gameHooks.NpcDefinitionManager.Instance?._npcDefMap;
    const sheets = this.gameHooks.SpriteSheetManager.Instance._creatureSpritesheetInfo;
    const origin = player.Appearance.Position;
    const groundY = origin.y - player.Appearance.Height / 2;
    this.galleryPose = { moving, activity };
    this.gallery = [];
    const seenNames = new Set();
    // Rows of about 14 tiles, each row further north (+Z).
    let x = origin.x + 1.5;
    let z = origin.z + 2;
    let rowDepth = 0;
    for (const def of npcDefs.values()) {
      const name = String(def.Name ?? "").toLowerCase();
      if (!def.IsCreature || seenNames.has(name)) continue;
      seenNames.add(name);
      const creature = def.CreatureAppearance;
      const info = sheets[creature.CreatureType]?.[0];
      if (!info?.SpritesheetURL) continue;
      const start = creature.CreatureSpriteID * CELLS_PER_CREATURE;
      const humanoid = humanoidCreatureFor(name);
      const family = humanoid ? null : creatureFamilyFor(name);
      if (!humanoid && !family) continue;
      const spec = humanoid
        ? await loadHumanoidCreatureSpec(info, start, humanoid)
        : await loadCreatureSpec(info, start, family, name);
      const modelName = `models3d-gallery-${seenNames.size}`;
      const material = this.getMaterial(spec.translucent);
      const model = humanoid
        ? new HumanModel(this.scene, this.ctors, material, spec, modelName)
        : new CreatureModel(this.scene, this.ctors, material, spec, modelName);
      if (x + creature.Width > origin.x + 15.5) {
        x = origin.x + 1.5;
        z += rowDepth + 1;
        rowDepth = 0;
      }
      this.gallery.push({ name, model, size: { Width: creature.Width, Height: creature.Height }, position: { x: x + creature.Width / 2, y: groundY, z: z + creature.Width / 2 } });
      x += creature.Width + 0.5;
      rowDepth = Math.max(rowDepth, creature.Width);
    }
    return this.gallery.map((exhibit) => exhibit.name);
  }

  hideGallery() {
    for (const exhibit of this.gallery ?? []) exhibit.model.dispose();
    this.gallery = [];
  }

  // Builds the model on first sight and rebuilds it when the sprite changes
  // (e.g. a player's spritesheet is re-composited after a gear change).
  updateRecordModel(record) {
    if (!record.appearance.SpritesheetInformation?.SpritesheetURL) return;
    const [key, specPromise] = this.getSpec(record);
    if (key === record.specKey || key === record.pendingKey) return;
    record.pendingKey = key;
    specPromise.then((spec) => {
      if (record.pendingKey !== key || this.records.get(record.entity) !== record) return;
      record.pendingKey = null;
      record.specKey = key;
      const previousYaw = record.model?.yaw ?? null;
      if (record.model) record.model.dispose();
      const name = `models3d-${record.entity.EntityType}-${record.entity.EntityID}`;
      const material = this.getMaterial(spec?.translucent);
      record.model = record.type.kind === "creature"
        ? (spec ? new CreatureModel(this.scene, this.ctors, material, spec, name) : null)
        : new HumanModel(this.scene, this.ctors, material, spec ?? { colors: DEFAULT_COLORS, gear: {} }, name);
      if (record.model) record.model.yaw = previousYaw;
      record.spec = spec;
      if (record.type.kind === "human" && spec && this.settings.osrsCharacters.value) this.upgradeToOsrsModel(record, key, name);
    });
  }

  // Swaps a human's generated model for one built from the OSRS cache once
  // its kit and equipment models have loaded.
  async upgradeToOsrsModel(record, key, name) {
    const cache = await this.osrsCache;
    if (!cache) return;
    try {
      const data = await buildPlayerData(cache, record.spec.appearanceIds, record.spec.colors, record.spec.gear);
      if (record.specKey !== key || this.records.get(record.entity) !== record) return;
      const previousYaw = record.model?.yaw ?? null;
      record.model?.dispose();
      record.model = new OsrsPlayerModel(this.scene, this.ctors, this.getOsrsMaterial(), data, cache, name);
      record.model.yaw = previousYaw;
    } catch (error) {
      this.error("Building OSRS player failed", error);
    }
  }

  // OSRS models are lit into their colours like the others, and drawn
  // two-sided because the client does not cull by winding the same way.
  getOsrsMaterial() {
    if (this.osrsMaterial) return this.osrsMaterial;
    const material = this.getMaterial().clone("models3d-osrs-material");
    material.backFaceCulling = false;
    this.osrsMaterial = material;
    return material;
  }

  disposeRecord(record) {
    if (record.model) record.model.dispose();
    record.model = null;
    record.pendingKey = null;
    const billboard = record.appearance?.BillboardMesh;
    if (billboard && !record.entity.IsDestroyed) billboard.visibility = 1;
  }
};

// Dev only: swap code edits into the running plugin instead of letting Vite
// reload the page, which would log the player out.
if (import.meta.hot) {
  import.meta.hot.accept((updated) => {
    const entry = document.highlite?.managers?.PluginManager?.plugins?.find((p) => p.instance?.pluginName === "3D Models");
    const instance = entry?.instance;
    if (!updated?.default || !instance) return;
    const wasEnabled = instance.settings.enable.value;
    // A half-finished edit can leave stop() broken; swap in the new code anyway.
    try {
      if (wasEnabled) instance.stop();
    } catch (error) {
      console.error("[Models3D] stop() failed during hot swap", error);
    }
    Object.setPrototypeOf(instance, updated.default.prototype);
    if (wasEnabled) instance.start();
    console.info("[Models3D] Hot-swapped plugin code");
  });
}

export {
  Models3D as default
};
