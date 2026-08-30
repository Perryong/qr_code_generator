/**
 * Deterministic randomness.
 *
 * Every tree is grown from the QR matrix itself, so the same link always
 * produces the same tree — on any machine, in any browser, today or next
 * year. That rules out Math.random and calls for a seeded generator.
 */

/** FNV-1a over a string, returning an unsigned 32-bit seed. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seed derived from the module pattern, so the tree follows the code. */
export function hashMatrix(modules) {
  let h = 0x811c9dc5;
  for (let r = 0; r < modules.length; r++) {
    for (let c = 0; c < modules[r].length; c++) {
      h ^= modules[r][c] ? 1 : 0;
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

/** Mulberry32 — small, fast, and good enough for scattering leaves. */
export function makeRandom(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (min, max) => min + next() * (max - min);
  next.int = (min, max) => Math.floor(next.range(min, max + 1));
  next.pick = (arr) => arr[Math.min(arr.length - 1, Math.floor(next() * arr.length))];
  return next;
}
