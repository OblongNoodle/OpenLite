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
