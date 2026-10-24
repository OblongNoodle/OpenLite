// Click areas for OSRS replacement models. The game picks objects by casting a
// ray at every mesh its predicate accepts and mapping a hit mesh's name
// ("_we_<id>") back to the world object, so a hidden copy of the OSRS model
// with that name makes the OSRS shape clickable. The game's own meshes for that
// object are then left out of picking (see installClickPredicate), so clicks,
// hover text and object markers all follow what is drawn.

const CLICK_MESH_PREFIX = "_we_";

// Hidden, named copies of every mesh in an OSRS model (sharing its geometry and
// parented to it, so they follow it and are disposed with it), standing in for
// the game's meshes `originals`.
export function attachClickProxies(Mesh, model, originals) {
  const name = originals.find((mesh) => mesh.name.startsWith(CLICK_MESH_PREFIX))?.name;
  if (!name) return [];
  const proxies = [];
  for (const part of [model, ...model.getChildMeshes(false)]) {
    if (!part.geometry || !part.getTotalVertices()) continue;
    const proxy = new Mesh(name, part.getScene());
    part.geometry.applyToMesh(proxy);
    proxy.parent = part;
    proxy.isVisible = false;
    proxy.isPickable = false;
    proxy.osrsClickProxy = true;
    proxies.push(proxy);
  }
  if (proxies.length) for (const mesh of originals) mesh.osrsClickReplaced = true;
  return proxies;
}

// One hidden box standing in for the game's meshes `originals`: the OSRS
// model's full height, `width` tiles wide and deep, centred on it. For
// models whose own shape is too thin or small to hit from afar (wheat
// stalks, flax).
export function attachBoxClickProxy(Mesh, model, originals, width = 0.8) {
  const name = originals.find((mesh) => mesh.name.startsWith(CLICK_MESH_PREFIX))?.name;
  if (!name) return [];
  // The model's bounds in its own space (its parts sit at its origin).
  let min = null, max = null;
  for (const part of [model, ...model.getChildMeshes(false)]) {
    if (!part.geometry || !part.getTotalVertices() || part.osrsClickProxy) continue;
    const box = part.getBoundingInfo().boundingBox;
    min = min ? min.minimizeInPlace(box.minimum) : box.minimum.clone();
    max = max ? max.maximizeInPlace(box.maximum) : box.maximum.clone();
  }
  if (!min) return [];
  const cx = (min.x + max.x) / 2, cz = (min.z + max.z) / 2;
  // (The box is in the model's space, so its scale is undone.)
  const hx = width / 2 / Math.abs(model.scaling.x || 1);
  const hz = width / 2 / Math.abs(model.scaling.z || 1);
  const x0 = cx - hx, x1 = cx + hx, z0 = cz - hz, z1 = cz + hz, y0 = min.y, y1 = max.y;
  const positions = [x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1];
  const indices = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  const proxy = new Mesh(name, model.getScene());
  proxy.setVerticesData("position", positions, false);
  proxy.setIndices(indices);
  proxy.parent = model;
  proxy.isVisible = false;
  proxy.isPickable = false;
  proxy.setEnabled(false);
  proxy.osrsClickProxy = true;
  for (const mesh of originals) mesh.osrsClickReplaced = true;
  return [proxy];
}

// Makes the game's meshes clickable again.
export function releaseClickMeshes(originals) {
  for (const mesh of originals ?? []) delete mesh.osrsClickReplaced;
}

// Wraps the game engine's pick predicate to skip replaced meshes. The engine
// passes the predicate unbound from its own property, so an own property on
// the instance takes over from the prototype's method.
export function installClickPredicate(engine) {
  if (!engine || engine._handleMultiPickWithRayPredicate?.osrsClickPredicate) return;
  const base = Object.getPrototypeOf(engine)._handleMultiPickWithRayPredicate;
  if (typeof base !== "function") return;
  const predicate = (mesh) => !mesh.osrsClickReplaced && base.call(engine, mesh);
  predicate.osrsClickPredicate = true;
  engine._handleMultiPickWithRayPredicate = predicate;
}

export function uninstallClickPredicate(engine) {
  if (engine?._handleMultiPickWithRayPredicate?.osrsClickPredicate) delete engine._handleMultiPickWithRayPredicate;
}
