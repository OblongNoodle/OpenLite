// Builds the OSRS ground (terrain.js's buildOsrsGround) on a worker thread, so
// a new map region doesn't freeze the game while its ground is made. The
// worker runs terrain.js's own source (it has no imports) with a small entry
// point added, started from a Blob: a worker importing plugin modules would
// put them outside the dev server's hot-swap boundary.
import terrainSource from "./terrain.js?raw";

const WORKER_ENTRY = `
self.onmessage = (event) => {
  const { id, request } = event.data;
  try {
    const result = buildGroundRequest(request);
    const arrays = [result, result.textured].flatMap((part) => [part.positions, part.colors, part.indices, part.uvs]);
    postMessage({ id, result }, arrays.filter(Boolean).map((array) => array.buffer));
  } catch (error) {
    postMessage({ id, error: String(error?.stack ?? error) });
  }
};
`;

export class GroundWorker {
  constructor() {
    const url = URL.createObjectURL(new Blob([terrainSource, WORKER_ENTRY], { type: "text/javascript" }));
    this.worker = new Worker(url, { type: "module" });
    URL.revokeObjectURL(url);
    this.pending = new Map();
    this.nextId = 0;
    this.worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id);
      this.pending.delete(data.id);
      if (data.error) request?.reject(new Error(data.error));
      else request?.resolve(data.result);
    };
    this.worker.onerror = (event) => {
      for (const request of this.pending.values()) request.reject(new Error(event.message || "Ground worker failed"));
      this.pending.clear();
    };
  }

  // See terrain.js buildGroundRequest.
  build(request) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, request });
    });
  }

  terminate() {
    this.worker.terminate();
    for (const request of this.pending.values()) request.reject(new Error("Ground worker stopped"));
    this.pending.clear();
  }
}
