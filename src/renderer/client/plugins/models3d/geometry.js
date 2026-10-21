// Low-poly geometry building and the base for every jointed model.
import { DIRECTION_YAW, TURN_RATE, approach } from "./pose.js";

// The RS client lights players and objects from (-50, -10, -50) in its own
// axes (X left, Y down, Z toward the viewer for a model facing it). In ours
// (X right, Y up, a model facing +Z) that is light from the model's front
// right, slightly from above.
export const OSRS_LIGHT = [50, 10, 50];
// NPCs are lit more from above: (-30, -50, -30), with contrast 850.
export const OSRS_NPC_LIGHT = [30, 50, 30];
// Lowest lighting factor applied to any surface.
const MIN_LIGHT_FACTOR = 0.4;

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

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
  // Radii (the values after t, up to three) never go negative where the curve
  // overshoots; later values (offsets, squareness) pass through.
  return result.map((values) => values.map((value, i) => (i >= 1 && i <= 3 ? Math.max(0, value) : value)));
}

function hash3(x, y, z) {
  const value = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

// Smooth 3D value noise in [-1, 1].
export function noise3(x, y, z) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fade = (t) => t * t * (3 - 2 * t);
  const fx = fade(x - x0), fy = fade(y - y0), fz = fade(z - z0);
  const lerp = (a, b, t) => a + (b - a) * t;
  const corner = (dx, dy, dz) => hash3(x0 + dx, y0 + dy, z0 + dz);
  const value = lerp(
    lerp(lerp(corner(0, 0, 0), corner(1, 0, 0), fx), lerp(corner(0, 1, 0), corner(1, 1, 0), fx), fy),
    lerp(lerp(corner(0, 0, 1), corner(1, 0, 1), fx), lerp(corner(0, 1, 1), corner(1, 1, 1), fx), fy),
    fz
  );
  return value * 2 - 1;
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

  // A smooth-shaded body shape swept through sculpted cross-sections, for
  // anatomy (chests, calves, jaws, toes). Each ring is
  //   { t, w, f, b, ox = 0, oz = 0, n = 2.4 }
  // t: position along the axis; w: half-width across; f/b: depth to the front
  // and back (along "y": +Z/-Z; along "z": up/down); ox/oz: offset of the
  // ring's centre; n: squareness (2 = ellipse, higher = boxier, as OSRS models
  // are). Extra rings are interpolated smoothly between those given.
  loft(rings, sides, centerX, centerY, centerZ, color, { axis = "y", tiltX = 0, tiltZ = 0, caps = true } = {}) {
    const fields = ["t", "w", "f", "b", "ox", "oz", "n"];
    const asArrays = rings.map((r) => [r.t, r.w, r.f, r.b, r.ox ?? 0, r.oz ?? 0, r.n ?? 2.4]);
    const refined = refineProfile(asArrays, LATHE_RING_DETAIL).map((values) => Object.fromEntries(fields.map((key, i) => [key, values[i]])));
    sides = Math.round(sides * LATHE_SIDE_DETAIL);
    const cx = Math.cos(tiltX), sx = Math.sin(tiltX);
    const cz = Math.cos(tiltZ), sz = Math.sin(tiltZ);
    const rotate = ([x, y, z]) => {
      const y1 = y * cx - z * sx, z1 = y * sx + z * cx;
      return [x * cz - y1 * sz, x * sz + y1 * cz, z1];
    };
    const place = (t, across, depth, ox, oz) => (axis === "y" ? [ox + across, t, oz + depth] : [ox + across, oz + depth, t]);
    const base = this.positions.length / 3;
    const centers = [];
    for (const ring of refined) {
      const exponent = 2 / Math.max(1.2, ring.n);
      for (let k = 0; k < sides; k++) {
        const angle = Math.PI / sides + (k / sides) * Math.PI * 2;
        const c = Math.cos(angle), s = Math.sin(angle);
        const across = Math.max(0, ring.w) * Math.sign(c) * Math.abs(c) ** exponent;
        const depth = Math.max(0, s >= 0 ? ring.f : ring.b) * Math.sign(s) * Math.abs(s) ** exponent;
        const [x, y, z] = rotate(place(ring.t, across, depth, ring.ox, ring.oz));
        this.positions.push(x + centerX, y + centerY, z + centerZ);
        this.normals.push(0, 0, 0);
        this.colors.push(color[0], color[1], color[2], 1);
      }
      centers.push(rotate(place(ring.t, 0, 0, ring.ox, ring.oz)));
    }
    const start = this.indices.length;
    const index = (i, k) => base + i * sides + (k % sides);
    const vertex = (v) => [this.positions[v * 3], this.positions[v * 3 + 1], this.positions[v * 3 + 2]];
    // Babylon front faces are those whose (b - a) x (c - a) points inward;
    // pick the winding per segment by checking one quad against its centre.
    const facesOut = (a, b, c, inside) => {
      const [pa, pb, pc] = [vertex(a), vertex(b), vertex(c)];
      const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const out = [pa[0] - centerX - inside[0], pa[1] - centerY - inside[1], pa[2] - centerZ - inside[2]];
      return n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0;
    };
    for (let i = 0; i + 1 < refined.length; i++) {
      const middle = centers[i].map((value, c) => (value + centers[i + 1][c]) / 2);
      const keep = facesOut(index(i, 0), index(i, 1), index(i + 1, 0), middle);
      for (let k = 0; k < sides; k++) {
        const [a, b, c, d] = [index(i, k), index(i, k + 1), index(i + 1, k + 1), index(i + 1, k)];
        if (keep) this.indices.push(a, b, d, b, c, d);
        else this.indices.push(a, d, b, b, d, c);
      }
    }
    if (caps) {
      for (const [ring, inner] of [[0, 1], [refined.length - 1, refined.length - 2]]) {
        const center = this.positions.length / 3;
        const [x, y, z] = centers[ring];
        this.positions.push(x + centerX, y + centerY, z + centerZ);
        this.normals.push(0, 0, 0);
        this.colors.push(color[0], color[1], color[2], 1);
        const keep = facesOut(center, index(ring, 0), index(ring, 1), centers[inner]);
        for (let k = 0; k < sides; k++) {
          const [a, b] = [index(ring, k), index(ring, k + 1)];
          if (keep) this.indices.push(center, a, b);
          else this.indices.push(center, b, a);
        }
      }
    }
    this.smoothNormals(base, start);
    return this;
  }

  // A smooth, lumpy sphere: a latitude/longitude grid pushed in and out by
  // noise. radii is [rx, ry, rz]. Options: seed (varies the lumps), roughness
  // (how far lumps push, as a fraction of the radius), flatBottom (cuts the
  // underside flat at this fraction of ry below the centre, for things resting
  // on the ground), and colorAt(direction, noise) to vary colour per vertex.
  blob([rx, ry, rz], centerX, centerY, centerZ, color, { seed = 0, roughness = 0.15, sides = 12, rings = 8, flatBottom = null, colorAt = null } = {}) {
    const base = this.positions.length / 3;
    const ring = [];
    for (let r = 0; r <= rings; r++) {
      const latitude = -Math.PI / 2 + (r / rings) * Math.PI;
      const count = r === 0 || r === rings ? 1 : sides;
      const row = [];
      for (let k = 0; k < count; k++) {
        const longitude = (k / sides) * Math.PI * 2 + (r % 2) * Math.PI / sides;
        const dir = [Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), Math.cos(latitude) * Math.sin(longitude)];
        const lump = noise3(dir[0] * 1.8 + seed * 7.1, dir[1] * 1.8 + seed * 3.3, dir[2] * 1.8 + seed * 5.7);
        const scale = 1 + roughness * lump;
        let y = dir[1] * ry * scale;
        if (flatBottom !== null) y = Math.max(y, -ry * flatBottom);
        this.positions.push(dir[0] * rx * scale + centerX, y + centerY, dir[2] * rz * scale + centerZ);
        this.normals.push(0, 0, 0);
        const c = colorAt ? colorAt(dir, lump) : color;
        this.colors.push(c[0], c[1], c[2], 1);
        row.push(this.positions.length / 3 - 1);
      }
      ring.push(row);
    }
    const start = this.indices.length;
    for (let r = 0; r < rings; r++) {
      const lower = ring[r], upper = ring[r + 1];
      for (let k = 0; k < sides; k++) {
        const a = lower[k % lower.length], b = lower[(k + 1) % lower.length];
        const c = upper[(k + 1) % upper.length], d = upper[k % upper.length];
        // Viewed from outside, a -> b runs east and d sits north of a.
        if (a !== b) this.indices.push(a, b, d);
        if (c !== d) this.indices.push(b, c, d);
      }
    }
    this.smoothNormals(base, start);
    return this;
  }

  // Averages face normals onto the vertices from `firstVertex` on, using the
  // triangles from `firstIndex` on.
  smoothNormals(firstVertex, firstIndex) {
    const p = this.positions, n = this.normals;
    for (let i = firstIndex; i < this.indices.length; i += 3) {
      const [a, b, c] = [this.indices[i], this.indices[i + 1], this.indices[i + 2]];
      const u = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]];
      const v = [p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]];
      // Babylon's left-handed winding: the outward normal is v x u.
      const f = [v[1] * u[2] - v[2] * u[1], v[2] * u[0] - v[0] * u[2], v[0] * u[1] - v[1] * u[0]];
      for (const vertex of [a, b, c]) for (let k = 0; k < 3; k++) n[vertex * 3 + k] += f[k];
    }
    for (let vertex = firstVertex; vertex < p.length / 3; vertex++) {
      const length = Math.hypot(n[vertex * 3], n[vertex * 3 + 1], n[vertex * 3 + 2]) || 1;
      for (let k = 0; k < 3; k++) n[vertex * 3 + k] /= length;
    }
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

  // OSRS model lighting, baked into the vertex colours once (as the RS client
  // does when it builds a model): each vertex's HSL lightness is scaled by
  //   (ambient + (65536 / contrast) * cos(angle to light)) / 128
  // and clamped like the client's 7-bit lightness. Defaults are the client's
  // player/object values (ambient 64, contrast 768, light from -50,-10,-50),
  // with its Y-down axes converted to ours.
  bakeLighting({ light = OSRS_LIGHT, ambient = 64, contrast = 768 } = {}) {
    const length = Math.hypot(...light);
    const [lx, ly, lz] = light.map((value) => value / length);
    const strength = 65536 / contrast;
    for (let v = 0; v < this.positions.length / 3; v++) {
      const nx = this.normals[v * 3], ny = this.normals[v * 3 + 1], nz = this.normals[v * 3 + 2];
      const n = Math.hypot(nx, ny, nz) || 1;
      const cos = (nx * lx + ny * ly + nz * lz) / n;
      // A floor keeps surfaces facing away from the light readable rather than
      // black (the client's own floor is lightness 2/127).
      const factor = Math.max(MIN_LIGHT_FACTOR, (ambient + strength * cos) / 128);
      const [h, s, l] = rgbToHsl(this.colors[v * 4], this.colors[v * 4 + 1], this.colors[v * 4 + 2]);
      const [r, g, b] = hslToRgb(h, s, Math.min(126 / 127, Math.max(2 / 127, l * factor)));
      this.colors[v * 4] = r;
      this.colors[v * 4 + 1] = g;
      this.colors[v * 4 + 2] = b;
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
    builder.bakeLighting(this.lighting ?? {});
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
