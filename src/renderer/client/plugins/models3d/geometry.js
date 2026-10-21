// Low-poly geometry building and the base for every jointed model.
import { DIRECTION_YAW, TURN_RATE, approach } from "./pose.js";

// Accumulates flat-shaded, vertex-coloured boxes into one set of buffers.
// A box can be tilted about X (positive tilts its top toward +Z) and then Z
// (positive tilts its top toward -X).
export class GeometryBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.indices = [];
  }

  box(width, height, depth, centerX, centerY, centerZ, color, tiltX = 0, tiltZ = 0) {
    const hx = width / 2, hy = height / 2, hz = depth / 2;
    const cx = Math.cos(tiltX), sx = Math.sin(tiltX);
    const cz = Math.cos(tiltZ), sz = Math.sin(tiltZ);
    const rotate = ([x, y, z]) => {
      const y1 = y * cx - z * sx, z1 = y * sx + z * cx;
      return [x * cz - y1 * sz, x * sz + y1 * cz, z1];
    };
    const faces = [
      [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]],
      [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]],
      [[1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]]],
      [[-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]],
      [[0, 1, 0], [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]]],
      [[0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]]
    ];
    for (const [normal, corners] of faces) {
      const base = this.positions.length / 3;
      for (const corner of corners) {
        const [x, y, z] = rotate(corner);
        this.positions.push(x + centerX, y + centerY, z + centerZ);
        this.normals.push(...rotate(normal));
        this.colors.push(color[0], color[1], color[2], 1);
      }
      // Babylon is left-handed: clockwise winding when viewed from the front.
      this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    return this;
  }

  applyTo(mesh) {
    mesh.setVerticesData("position", this.positions, false);
    mesh.setVerticesData("normal", this.normals, false);
    mesh.setVerticesData("color", this.colors, false);
    mesh.setIndices(this.indices);
    return mesh;
  }
}

// A root node with jointed parts. Each part's geometry hangs from its joint at
// the part's local origin, so rotating the part swings it naturally. Models
// face +Z and stand on y = 0.
export class RigModel {
  constructor(scene, ctors, material, name) {
    this.scene = scene;
    this.ctors = ctors;
    this.material = material;
    this.name = name;
    this.root = new ctors.Mesh(`${name}-root`, scene);
    this.parts = [];
    this.yaw = null;
    this.lying = 0;
  }

  part(label, builder, x, y, z, parent = this.root) {
    const mesh = builder.applyTo(new this.ctors.Mesh(`${this.name}-${label}`, this.scene));
    mesh.material = this.material;
    mesh.isPickable = false;
    mesh.parent = parent;
    mesh.position.set(x, y, z);
    this.parts.push(mesh);
    return mesh;
  }

  // An empty joint for grouping parts that move together.
  joint(label, x, y, z, parent = this.root) {
    const node = new this.ctors.Mesh(`${this.name}-${label}`, this.scene);
    node.parent = parent;
    node.position.set(x, y, z);
    this.parts.push(node);
    return node;
  }

  // Positions the model at the entity's feet, scaled per axis, turning smoothly
  // toward the entity's world-space direction.
  place(position, direction, scale, deltaMs) {
    this.root.position.set(position.x, position.y, position.z);
    this.root.scaling.set(scale.x, scale.y, scale.z);
    const targetYaw = DIRECTION_YAW[direction] ?? this.yaw ?? Math.PI;
    if (this.yaw === null) this.yaw = targetYaw;
    let delta = targetYaw - this.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const maxStep = TURN_RATE * deltaMs;
    this.yaw += Math.max(-maxStep, Math.min(maxStep, delta));
    this.root.rotation.y = this.yaw;
  }

  // Eases toward lying down (dead) or standing; returns the current amount 0-1.
  updateLying(isDead, deltaMs) {
    this.lying = approach(this.lying, isDead ? 1 : 0, deltaMs, 0.006);
    return this.lying;
  }

  dispose() {
    for (const part of this.parts) part.dispose();
    this.root.dispose();
    this.parts = [];
  }
}
