// Low-poly geometry building and the base for every jointed model.
import { DIRECTION_YAW, TURN_RATE, approach } from "./pose.js";

// Lathe detail multipliers: sides per ring, and rings per profile segment.
const LATHE_SIDE_DETAIL = 1.5;
const LATHE_RING_DETAIL = 2;

// Adds `factor - 1` rings between each pair of profile rings, following a
// smooth (Catmull-Rom) curve through them so outlines round off.
function refineProfile(profile, factor) {
  if (factor <= 1 || profile.length < 2) return profile;
  const at = (i) => profile[Math.max(0, Math.min(profile.length - 1, i))];
  const result = [];
  for (let i = 0; i + 1 < profile.length; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 0; s < factor; s++) {
      const t = s / factor, t2 = t * t, t3 = t2 * t;
      result.push(p1.map((_, c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)));
    }
  }
  result.push(profile[profile.length - 1]);
  // Radii never go negative where the curve overshoots.
  return result.map(([t, rx, ry]) => [t, Math.max(0, rx), Math.max(0, ry)]);
}

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

  // A smooth-shaded solid of revolution: rings of points swept along an axis,
  // closed with caps. profile is [[t, rx, ry], ...] from one end to the other:
  // t is the position along the axis, rx/ry the ring's radii across it. Along
  // "y", rx is the X radius and ry the Z radius; along "z", rx is X and ry is Y.
  // Detail is raised automatically: more sides than asked for, and extra rings
  // interpolated smoothly between the profile's rings. Light rolls smoothly
  // across the surface like OSRS's Gouraud-shaded models; caps stay flat.
  // Tilts rotate the shape about its centre like box().
  lathe(profile, sides, centerX, centerY, centerZ, color, { axis = "y", tiltX = 0, tiltZ = 0, caps = true } = {}) {
    sides = Math.round(sides * LATHE_SIDE_DETAIL);
    profile = refineProfile(profile, LATHE_RING_DETAIL);
    const cx = Math.cos(tiltX), sx = Math.sin(tiltX);
    const cz = Math.cos(tiltZ), sz = Math.sin(tiltZ);
    const rotate = ([x, y, z]) => {
      const y1 = y * cx - z * sx, z1 = y * sx + z * cx;
      return [x * cz - y1 * sz, x * sz + y1 * cz, z1];
    };
    const point = (t, a, b) => (axis === "y" ? [a, t, b] : [a, b, t]);
    const offset = Math.PI / sides;
    const rings = profile.map(([t, rx, ry], i) => {
      // Slope of the outline here, for the normal's lean along the axis.
      const before = profile[Math.max(0, i - 1)], after = profile[Math.min(profile.length - 1, i + 1)];
      const span = after[0] - before[0] || 1;
      const slope = ((after[1] + after[2]) - (before[1] + before[2])) / 2 / span;
      const ring = [], normals = [];
      for (let k = 0; k < sides; k++) {
        const angle = offset + (k / sides) * Math.PI * 2;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        ring.push(rotate(point(t, rx * cos, ry * sin)));
        // Normal of an ellipse: (cos / rx, sin / ry), leaning against the slope.
        const nx = cos / Math.max(rx, 1e-4), ny = sin / Math.max(ry, 1e-4);
        const length = Math.hypot(nx, ny);
        const n = point(-slope, nx / length, ny / length);
        const nl = Math.hypot(...n);
        normals.push(rotate(n.map((value) => value / nl)));
      }
      return { center: rotate(point(t, 0, 0)), ring, normals };
    });
    // Shared vertices per ring point so normals blend across faces.
    const base = this.positions.length / 3;
    for (const { ring, normals } of rings) {
      ring.forEach(([x, y, z], k) => {
        this.positions.push(x + centerX, y + centerY, z + centerZ);
        this.normals.push(...normals[k]);
        this.colors.push(color[0], color[1], color[2], 1);
      });
    }
    const index = (i, k) => base + i * sides + (k % sides);
    for (let i = 0; i + 1 < rings.length; i++) {
      // Wind so the face points away from the axis (checked on the first quad).
      const a = rings[i].ring[0], b = rings[i].ring[1], d = rings[i + 1].ring[0];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const out = [a[0] - rings[i].center[0], a[1] - rings[i].center[1], a[2] - rings[i].center[2]];
      const outward = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] >= 0;
      for (let k = 0; k < sides; k++) {
        const q = [index(i, k), index(i, k + 1), index(i + 1, k + 1), index(i + 1, k)];
        if (outward) this.indices.push(q[0], q[2], q[1], q[0], q[3], q[2]);
        else this.indices.push(q[0], q[1], q[2], q[0], q[2], q[3]);
      }
    }
    if (caps) {
      for (const end of [rings[0], rings[rings.length - 1]]) {
        // The cap's inside point sits just inward along the axis, so its faces
        // orient outward.
        const inward = end === rings[0] ? rings[1].center : rings[rings.length - 2].center;
        for (let k = 0; k < sides; k++) {
          this.polygon([end.center, end.ring[k], end.ring[(k + 1) % sides]], inward, centerX, centerY, centerZ, color);
        }
      }
    }
    return this;
  }

  // One flat face (triangle or quad), wound so its normal points away from
  // `inside`, offset by the given centre.
  polygon(corners, inside, centerX, centerY, centerZ, color) {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const last = corners[corners.length - 1];
    let normal = cross(sub(corners[1], corners[0]), sub(last, corners[0]));
    const centroid = corners.reduce((sum, c) => [sum[0] + c[0] / corners.length, sum[1] + c[1] / corners.length, sum[2] + c[2] / corners.length], [0, 0, 0]);
    const outward = sub(centroid, inside);
    if (normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2] < 0) {
      corners = [corners[0], ...corners.slice(1).reverse()];
      normal = normal.map((value) => -value);
    }
    const length = Math.hypot(...normal) || 1;
    normal = normal.map((value) => value / length);
    const base = this.positions.length / 3;
    for (const [x, y, z] of corners) {
      this.positions.push(x + centerX, y + centerY, z + centerZ);
      this.normals.push(...normal);
      this.colors.push(color[0], color[1], color[2], 1);
    }
    // Same winding rule as box(): corners ordered so (c1 - c0) x (cN - c0)
    // points outward are emitted as (0, 2, 1), (0, 3, 2).
    for (let k = 1; k + 1 < corners.length; k++) this.indices.push(base, base + k + 1, base + k);
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
