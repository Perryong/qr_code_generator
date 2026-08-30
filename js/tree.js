/**
 * Grows a tree from a QR matrix.
 *
 * This is pure data — positions, directions, radii. Nothing here knows about
 * Three.js, which keeps it testable in Node and makes the renderer swappable.
 *
 * The structure is a recursive branching grammar rather than a strict
 * L-system: each branch spawns two or three children, rotated off the parent
 * axis and shortened, until a depth budget runs out. Tips become blossoms.
 * All the randomness comes from a seed derived from the QR modules, so the
 * link and the tree are locked together.
 */

import { makeRandom, hashMatrix } from './random.js';

const UP = [0, 1, 0];

// ── Tiny vector helpers (avoiding a Three.js dependency in here) ────────
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

function normalize(a) {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Rotate vector v around unit axis k by angle (Rodrigues' formula). */
function rotateAround(v, k, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

/** Any unit vector perpendicular to `v`. */
function perpendicular(v) {
  const seed = Math.abs(v[1]) < 0.9 ? UP : [1, 0, 0];
  return normalize(cross(v, seed));
}

/**
 * @param {boolean[][]} modules  QR matrix
 * @param {object} [options]
 * @returns {{ branches, blossoms, grass, seed, height }}
 */
export function growTree(modules, options = {}) {
  const size = modules.length;
  const seed = hashMatrix(modules);
  const rand = makeRandom(seed);

  const depth = options.depth ?? 6;
  const trunkHeight = options.trunkHeight ?? size * 0.2;
  const trunkRadius = options.trunkRadius ?? size * 0.024;

  const branches = [];
  const blossoms = [];

  function branch(origin, direction, length, radius, level) {
    // Bend the branch slightly over its run rather than drawing it dead
    // straight — a couple of segments per branch is enough to read as growth.
    const segments = level > depth - 2 ? 3 : 2;
    let pos = origin;
    let dir = direction;

    for (let s = 0; s < segments; s++) {
      const segLen = length / segments;
      const droop = level / depth;
      // Young growth reaches up, older growth relaxes outward.
      dir = normalize(add(dir, scale(UP, (0.12 - droop * 0.16) * rand.range(0.4, 1.4))));
      const end = add(pos, scale(dir, segLen));
      const r0 = radius * (1 - (s / segments) * 0.25);
      const r1 = radius * (1 - ((s + 1) / segments) * 0.25);
      branches.push({ start: pos, end, radiusStart: r0, radiusEnd: r1, level });
      pos = end;
    }

    if (level >= depth) {
      blossoms.push({ position: pos, size: rand.range(0.6, 1.25), level });
      // A small cluster near the tip reads better than a single point.
      const extra = rand.int(1, 3);
      for (let i = 0; i < extra; i++) {
        const off = normalize([rand.range(-1, 1), rand.range(-0.4, 1), rand.range(-1, 1)]);
        blossoms.push({
          position: add(pos, scale(off, radius * rand.range(3, 9))),
          size: rand.range(0.5, 1.1),
          level,
        });
      }
      return;
    }

    const children = level === 0 ? rand.int(3, 4) : rand.int(2, 3);
    const axis = perpendicular(dir);
    const twistBase = rand.range(0, Math.PI * 2);

    for (let i = 0; i < children; i++) {
      const twist = twistBase + (i / children) * Math.PI * 2 + rand.range(-0.35, 0.35);
      const spread = rand.range(0.42, 0.72) - level * 0.03;
      const spun = rotateAround(axis, dir, twist);
      const childDir = normalize(rotateAround(dir, spun, spread));
      branch(
        pos,
        childDir,
        length * rand.range(0.62, 0.78),
        radius * rand.range(0.6, 0.72),
        level + 1
      );
    }
  }

  branch([0, 0, 0], UP, trunkHeight, trunkRadius, 0);

  // ── Grass along the edges of raised modules ──────────────────────────
  // Blades only sprout where a dark module meets a light one, so the
  // planting traces the outline of the code.
  const grass = [];
  const half = (size - 1) / 2;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!modules[r][c]) continue;
      const edge =
        !modules[r - 1]?.[c] || !modules[r + 1]?.[c] || !modules[r]?.[c - 1] || !modules[r]?.[c + 1];
      if (!edge) continue;
      const blades = rand.int(0, 2);
      for (let i = 0; i < blades; i++) {
        grass.push({
          position: [c - half + rand.range(-0.36, 0.36), 0, r - half + rand.range(-0.36, 0.36)],
          height: rand.range(0.22, 0.55),
          lean: rand.range(-0.3, 0.3),
          twist: rand.range(0, Math.PI),
        });
      }
    }
  }

  const height = branches.reduce((m, b) => Math.max(m, b.end[1]), 0);
  return { branches, blossoms, grass, seed, height };
}

/** Petal spawn points for the falling-petal effect. */
export function seedPetals(tree, count = 90) {
  const rand = makeRandom(tree.seed ^ 0x9e3779b9);
  const petals = [];
  for (let i = 0; i < count; i++) {
    const source = tree.blossoms.length
      ? rand.pick(tree.blossoms).position
      : [0, tree.height * 0.7, 0];
    petals.push({
      position: [
        source[0] + rand.range(-1.5, 1.5),
        rand.range(0.2, tree.height * 1.05),
        source[2] + rand.range(-1.5, 1.5),
      ],
      fallSpeed: rand.range(0.28, 0.72),
      swayPhase: rand.range(0, Math.PI * 2),
      swaySpeed: rand.range(0.5, 1.6),
      swayAmount: rand.range(0.15, 0.6),
      spin: rand.range(-2, 2),
      size: rand.range(0.6, 1.2),
    });
  }
  return petals;
}
