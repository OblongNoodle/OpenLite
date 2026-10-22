// src/ObjectMarkers.ts
// RuneLite-style object markers: Alt + right-click an object and pick "Tag" to
// outline where it can be clicked, along with every other object of the same
// kind ("Untag" removes it). The outline traces the game's own click meshes
// (the "_we_<id>" meshes its ray picking maps back to world objects), so it
// shows the real clickable zone even where an OSRS model is drawn instead.
import { Plugin, SettingsTypes, ContextMenuManager, EntityType } from "@highlite/core";

// Click meshes are named "_we_<world entity id>" (see the game's
// getActionsAndEntitiesAtMousePointer).
const CLICK_MESH_PREFIX = "_we_";
// How often the list of click meshes is rebuilt (objects load and unload as
// map regions change).
const MESH_SCAN_INTERVAL_MS = 500;
// Triangles with a vertex this close to (or behind) the camera are skipped.
const MIN_CLIP_W = 0.05;
// ...and so are those reaching this far off screen (in screen widths): huge
// coordinates make the canvas crawl.
const MAX_SCREEN_REACH = 2;

// Menu entries are added from one hook on the game's menu builder; the hook is
// installed once per page and calls whichever plugin instance is current (so
// a hot-swapped plugin doesn't stack a second hook).
const hookState = window.__objectMarkersHook ??= { plugin: null, installed: false };

// The game's menu labels come from its GameWorldActions enum; new names are
// added the way the core adds its own actions.
function gameWorldAction(name) {
  const actions = document.highlite.gameLookups.GameWorldActions;
  if (actions[name] === undefined) {
    const number = Object.keys(actions).length / 2;
    actions[actions[name] = number] = name;
  }
  return actions[name];
}

// Objects count as "the same" when they share a definition (or, failing that,
// a type and name).
function objectKey(entity) {
  const defId = entity?._def?._id;
  if (defId !== undefined && defId !== null) return `def:${defId}`;
  return `${entity?.Type ?? entity?._type}|${entity?.Name ?? entity?._name}`;
}

function objectLabel(entity) {
  return String(entity?.Name ?? entity?._name ?? "object");
}

var ObjectMarkers = class extends Plugin {
  constructor() {
    super();
    this.pluginName = "Object Markers";
    this.author = "HighLite-Client";
    this.settings.enable.value = true;
    this.defineSettings();
    this.resetState();
  }

  // Adds any settings not yet defined (a hot-swapped instance keeps the
  // settings its original constructor created).
  defineSettings() {
    const defaults = {
      borderColor: {
        text: "Border colour",
        type: SettingsTypes.color,
        value: "#71D9E2",
        callback: () => {}
      },
      borderWidth: {
        text: "Border width",
        type: SettingsTypes.range,
        value: 2,
        min: 1,
        max: 6,
        callback: () => {}
      },
      fillOpacity: {
        text: "Fill opacity (%)",
        type: SettingsTypes.range,
        value: 0,
        min: 0,
        max: 60,
        callback: () => {}
      },
      clearTags: {
        text: "Untag all objects",
        type: SettingsTypes.button,
        value: "Untag all",
        callback: () => this.setTags([])
      }
    };
    for (const [key, setting] of Object.entries(defaults)) this.settings[key] ??= setting;
  }

  resetState() {
    this.observer = null;
    this.overlay = null;
    this.mask = null;
    this.clickMeshes = [];
    this.lastMeshScan = 0;
    this.altHeld = false;
    this.geometry = new WeakMap();
  }

  init() {
    this.log("Initializing");
  }

  start() {
    this.log("Started");
    this.defineSettings();
    this.resetState();
    this.tags = new Set(this.data?.taggedObjects ?? []);
    this.installMenuHook();
    hookState.plugin = this;
    this.onKey = (event) => {
      this.altHeld = event.altKey;
      // A bare Alt press would put the window into Windows' menu mode on
      // release (closing the game's menu as soon as the mouse moves), and the
      // game would pass it to the chat box; keep it to ourselves.
      if (event.key === "Alt") {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    this.onBlur = () => (this.altHeld = false);
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("keyup", this.onKey, true);
    window.addEventListener("pointerdown", this.onKey, true);
    window.addEventListener("blur", this.onBlur);
    this.attachRenderObserver();
  }

  stop() {
    this.log("Stopped");
    if (hookState.plugin === this) hookState.plugin = null;
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("keyup", this.onKey, true);
    window.removeEventListener("pointerdown", this.onKey, true);
    window.removeEventListener("blur", this.onBlur);
    this.detachRenderObserver();
    this.overlay?.remove();
    this.resetState();
  }

  get scene() {
    return this.gameHooks?.GameEngine?.Instance?.Scene ?? null;
  }

  setTags(keys) {
    this.tags = new Set(keys);
    if (this.data) this.data.taggedObjects = [...this.tags];
  }

  toggleTag(entity) {
    const key = objectKey(entity);
    const tags = new Set(this.tags);
    if (tags.has(key)) tags.delete(key);
    else tags.add(key);
    this.setTags([...tags]);
    this.log(`${tags.has(key) ? "Tagged" : "Untagged"} ${objectLabel(entity)} (${key})`);
  }

  // --- Menu ---------------------------------------------------------------

  installMenuHook() {
    if (hookState.installed) return;
    hookState.installed = new ContextMenuManager().registerContextHook(
      "ContextMenuItemManager",
      "_createGameWorldContextMenuItems",
      (args, items, menuItemManager) => {
        try {
          hookState.plugin?.addMenuItems(args, items, menuItemManager);
        } catch (error) {
          console.error("[Object Markers] Adding menu items failed", error);
        }
        return items;
      }
    );
  }

  // While Alt is held, each world object under the cursor gets a Tag (or
  // Untag) entry at the bottom of the menu.
  addMenuItems(args, items, menuItemManager) {
    if (!this.altHeld || !Array.isArray(items)) return;
    const raycast = args[0];
    const actionsAndEntities = raycast?.ActionsAndEntities ?? raycast?._actionsAndEntities ?? [];
    const seen = new Set();
    for (const actionAndEntity of actionsAndEntities) {
      const entity = actionAndEntity?.Entity ?? actionAndEntity?._entity;
      if (!entity || seen.has(entity)) continue;
      if ((entity.EntityType ?? entity._entityType) !== EntityType.WorldObject) continue;
      seen.add(entity);
      const action = gameWorldAction(this.tags.has(objectKey(entity)) ? "untag" : "tag");
      items.push(menuItemManager._contextMenuItemFactory.createGameWorldContextMenuItem(
        action,
        () => this.toggleTag(entity),
        entity,
        null,
        null,
        null
      ));
    }
  }

  // --- Outlines -----------------------------------------------------------

  attachRenderObserver() {
    if (this.observer) return;
    const scene = this.scene;
    if (!scene) {
      // The scene is created after login; retry until it exists.
      setTimeout(() => this.settings.enable.value && hookState.plugin === this && this.attachRenderObserver(), 500);
      return;
    }
    // Meshes go away with the map region they belong to; rescan then.
    this.removedObserver = scene.onMeshRemovedObservable.add(() => (this.lastMeshScan = 0));
    this.observer = scene.onAfterRenderObservable.add(() => {
      try {
        this.drawOutlines(scene);
      } catch (error) {
        this.error("Drawing outlines failed", error);
      }
    });
  }

  detachRenderObserver() {
    if (this.observer && this.scene) this.scene.onAfterRenderObservable.remove(this.observer);
    if (this.removedObserver && this.scene) this.scene.onMeshRemovedObservable.remove(this.removedObserver);
    this.observer = null;
    this.removedObserver = null;
  }

  // A canvas laid over the game's, beneath the game's interface.
  ensureOverlay(canvas, width, height) {
    if (!this.overlay || this.overlay.previousSibling !== canvas) {
      this.overlay?.remove();
      this.overlay = document.createElement("canvas");
      this.overlay.className = "object-markers-overlay";
      this.overlay.style.position = "absolute";
      this.overlay.style.pointerEvents = "none";
      canvas.after(this.overlay);
      this.mask = document.createElement("canvas");
    }
    const style = this.overlay.style;
    if (style.left !== canvas.offsetLeft + "px") style.left = canvas.offsetLeft + "px";
    if (style.top !== canvas.offsetTop + "px") style.top = canvas.offsetTop + "px";
    if (style.width !== canvas.clientWidth + "px") style.width = canvas.clientWidth + "px";
    if (style.height !== canvas.clientHeight + "px") style.height = canvas.clientHeight + "px";
    for (const target of [this.overlay, this.mask]) {
      if (target.width !== width) target.width = width;
      if (target.height !== height) target.height = height;
    }
  }

  // The click meshes of tagged objects, refreshed every so often.
  taggedClickMeshes(scene) {
    const now = performance.now();
    if (now - this.lastMeshScan < MESH_SCAN_INTERVAL_MS) return this.clickMeshes;
    this.lastMeshScan = now;
    const worldEntities = this.gameHooks.WorldEntityManager?.Instance;
    this.clickMeshes = [];
    if (!worldEntities || this.tags.size === 0) return this.clickMeshes;
    // The game's own pick predicate decides which meshes take clicks (the 3D
    // Models plugin swaps in its OSRS shapes there).
    const engine = this.gameHooks.GameEngine?.Instance;
    const clickable = (mesh) => engine?._handleMultiPickWithRayPredicate?.(mesh) ?? true;
    for (const mesh of scene.meshes) {
      if (!mesh.name.startsWith(CLICK_MESH_PREFIX) || !clickable(mesh)) continue;
      const entity = worldEntities.getWorldEntityById(parseInt(mesh.name.slice(CLICK_MESH_PREFIX.length)));
      if (entity && !entity._isDestroyed && this.tags.has(objectKey(entity))) this.clickMeshes.push(mesh);
    }
    return this.clickMeshes;
  }

  // Positions and indices never change for a click mesh; read them once.
  geometryOf(mesh) {
    let geometry = this.geometry.get(mesh);
    if (!geometry) {
      geometry = { positions: mesh.getVerticesData("position"), indices: mesh.getIndices() };
      this.geometry.set(mesh, geometry);
    }
    return geometry;
  }

  drawOutlines(scene) {
    const engine = scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    if (!canvas) return;
    const meshes = this.tags.size ? this.taggedClickMeshes(scene) : [];
    const width = engine.getRenderWidth();
    const height = engine.getRenderHeight();
    if (!meshes.length) {
      this.clearLastDrawn();
      return;
    }
    this.ensureOverlay(canvas, width, height);

    // Fill every tagged click mesh's triangles into the mask, all wound the
    // same way so overlapping triangles never cancel out.
    const mask = this.mask.getContext("2d");
    if (this.maskBox) mask.clearRect(...this.maskBox);
    mask.beginPath();
    const reach = MAX_SCREEN_REACH;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const viewProjection = scene.getTransformMatrix().m;
    const m = new Float32Array(16);
    let drawn = 0;
    for (const mesh of meshes) {
      if (mesh.isDisposed?.()) continue;
      const { positions, indices } = this.geometryOf(mesh);
      if (!positions || !indices) continue;
      // Hidden meshes aren't kept up to date by the renderer.
      multiply(mesh.computeWorldMatrix().m, viewProjection, m);
      const count = positions.length / 3;
      const screen = new Float32Array(count * 2);
      const visible = new Uint8Array(count);
      for (let v = 0; v < count; v++) {
        const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
        const w = x * m[3] + y * m[7] + z * m[11] + m[15];
        if (!(w >= MIN_CLIP_W)) continue;
        const nx = (x * m[0] + y * m[4] + z * m[8] + m[12]) / w;
        const ny = (x * m[1] + y * m[5] + z * m[9] + m[13]) / w;
        if (!(Math.abs(nx) <= reach && Math.abs(ny) <= reach)) continue;
        visible[v] = 1;
        screen[v * 2] = (nx * 0.5 + 0.5) * width;
        screen[v * 2 + 1] = (0.5 - ny * 0.5) * height;
      }
      for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t], b = indices[t + 1], c = indices[t + 2];
        if (!visible[a] || !visible[b] || !visible[c]) continue;
        const ax = screen[a * 2], ay = screen[a * 2 + 1];
        const bx = screen[b * 2], by = screen[b * 2 + 1];
        const cx = screen[c * 2], cy = screen[c * 2 + 1];
        const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (!area) continue;
        mask.moveTo(ax, ay);
        if (area > 0) {
          mask.lineTo(bx, by);
          mask.lineTo(cx, cy);
        } else {
          mask.lineTo(cx, cy);
          mask.lineTo(bx, by);
        }
        minX = Math.min(minX, ax, bx, cx);
        maxX = Math.max(maxX, ax, bx, cx);
        minY = Math.min(minY, ay, by, cy);
        maxY = Math.max(maxY, ay, by, cy);
        drawn++;
      }
    }
    const color = this.settings.borderColor.value;
    mask.fillStyle = color;
    mask.fill("nonzero");

    // Border: the mask spread outward by the border width, minus the mask;
    // then a faint fill inside. Only the part of the screen the outlines
    // cover is touched.
    this.clearLastDrawn();
    if (!drawn) return;
    const overlay = this.overlay.getContext("2d");
    const borderWidth = Math.max(1, Number(this.settings.borderWidth.value) || 2) * (window.devicePixelRatio || 1);
    const pad = Math.ceil(borderWidth) + 2;
    const left = Math.max(0, Math.floor(minX) - pad), top = Math.max(0, Math.floor(minY) - pad);
    const box = [left, top, Math.min(width, Math.ceil(maxX) + pad) - left, Math.min(height, Math.ceil(maxY) + pad) - top];
    if (box[2] <= 0 || box[3] <= 0) return;
    this.maskBox = box;
    this.overlayBox = box;
    overlay.save();
    overlay.beginPath();
    overlay.rect(...box);
    overlay.clip();
    const steps = 16;
    for (let radius = borderWidth; radius > 0; radius -= 2) {
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        overlay.drawImage(this.mask, ...box, box[0] + Math.cos(angle) * radius, box[1] + Math.sin(angle) * radius, box[2], box[3]);
      }
    }
    overlay.globalCompositeOperation = "destination-out";
    overlay.drawImage(this.mask, ...box, ...box);
    overlay.globalCompositeOperation = "source-over";
    const fill = (Number(this.settings.fillOpacity.value) || 0) / 100;
    if (fill > 0) {
      overlay.globalAlpha = fill;
      overlay.drawImage(this.mask, ...box, ...box);
      overlay.globalAlpha = 1;
    }
    overlay.restore();
  }

  clearLastDrawn() {
    if (this.overlay && this.overlayBox) this.overlay.getContext("2d").clearRect(...this.overlayBox);
    this.overlayBox = null;
  }
};

// out = a * b for Babylon's row-major 4x4 matrices (world then view-projection).
function multiply(a, b, out) {
  for (let row = 0; row < 4; row++) {
    const a0 = a[row * 4], a1 = a[row * 4 + 1], a2 = a[row * 4 + 2], a3 = a[row * 4 + 3];
    for (let col = 0; col < 4; col++) {
      out[row * 4 + col] = a0 * b[col] + a1 * b[4 + col] + a2 * b[8 + col] + a3 * b[12 + col];
    }
  }
  return out;
}

// Dev only: swap code edits into the running plugin instead of letting Vite
// reload the page, which would log the player out.
if (import.meta.hot) {
  import.meta.hot.accept((updated) => {
    const entry = document.highlite?.managers?.PluginManager?.plugins?.find((p) => p.instance?.pluginName === "Object Markers");
    const instance = entry?.instance;
    if (!updated?.default || !instance) return;
    const wasEnabled = instance.settings.enable.value;
    // A half-finished edit can leave stop() broken; swap in the new code anyway.
    try {
      if (wasEnabled) instance.stop();
    } catch (error) {
      console.error("[ObjectMarkers] stop() failed during hot swap", error);
    }
    Object.setPrototypeOf(instance, updated.default.prototype);
    if (wasEnabled) instance.start();
    console.info("[ObjectMarkers] Hot-swapped plugin code");
  });
}

export {
  ObjectMarkers as default
};
