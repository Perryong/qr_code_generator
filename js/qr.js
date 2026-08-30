/**
 * A small QR encoder — byte mode, versions 1 to 10, all four error
 * correction levels.
 *
 * Written out rather than pulled from a CDN because the matrix is the whole
 * point of this project: it is the terrain, the tree seed and the scannable
 * artefact all at once. It is verified byte-for-byte against the reference
 * `qrcode` package in test/qr.test.mjs.
 *
 * Returns a square boolean matrix where true means a dark module.
 */

// ── Error correction block structure ────────────────────────────────────
// [ec codewords per block, group1 blocks, group1 data codewords,
//                          group2 blocks, group2 data codewords]
const ECC_BLOCKS = {
  1: { L: [7, 1, 19, 0, 0], M: [10, 1, 16, 0, 0], Q: [13, 1, 13, 0, 0], H: [17, 1, 9, 0, 0] },
  2: { L: [10, 1, 34, 0, 0], M: [16, 1, 28, 0, 0], Q: [22, 1, 22, 0, 0], H: [28, 1, 16, 0, 0] },
  3: { L: [15, 1, 55, 0, 0], M: [26, 1, 44, 0, 0], Q: [18, 2, 17, 0, 0], H: [22, 2, 13, 0, 0] },
  4: { L: [20, 1, 80, 0, 0], M: [18, 2, 32, 0, 0], Q: [26, 2, 24, 0, 0], H: [16, 4, 9, 0, 0] },
  5: { L: [26, 1, 108, 0, 0], M: [24, 2, 43, 0, 0], Q: [18, 2, 15, 2, 16], H: [22, 2, 11, 2, 12] },
  6: { L: [18, 2, 68, 0, 0], M: [16, 4, 27, 0, 0], Q: [24, 4, 19, 0, 0], H: [28, 4, 15, 0, 0] },
  7: { L: [20, 2, 78, 0, 0], M: [18, 4, 31, 0, 0], Q: [18, 2, 14, 4, 15], H: [26, 4, 13, 1, 14] },
  8: { L: [24, 2, 97, 0, 0], M: [22, 2, 38, 2, 39], Q: [22, 4, 18, 2, 19], H: [26, 4, 14, 2, 15] },
  9: { L: [30, 2, 116, 0, 0], M: [22, 3, 36, 2, 37], Q: [20, 4, 16, 4, 17], H: [24, 4, 12, 4, 13] },
  10: { L: [18, 2, 68, 2, 69], M: [26, 4, 43, 1, 44], Q: [24, 6, 19, 2, 20], H: [28, 6, 15, 2, 16] },
};

const ALIGNMENT = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const ECC_BITS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

// ── Galois field GF(256), primitive polynomial 0x11D ────────────────────
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** Generator polynomial for `degree` error correction codewords. */
function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecCount) {
  const gen = rsGenerator(ecCount);
  const res = new Array(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.shift();
    res.push(0);
    for (let i = 0; i < ecCount; i++) {
      res[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return res;
}

// ── Bit buffer ──────────────────────────────────────────────────────────
class Bits {
  constructor() {
    this.bits = [];
  }
  put(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length() {
    return this.bits.length;
  }
}

// ── Version selection ───────────────────────────────────────────────────
function dataCapacityBits(version, ecc) {
  const [, g1, d1, g2, d2] = ECC_BLOCKS[version][ecc];
  return (g1 * d1 + g2 * d2) * 8;
}

function charCountBits(version) {
  return version < 10 ? 8 : 16;
}

function pickVersion(byteLength, ecc) {
  for (let v = 1; v <= 10; v++) {
    const needed = 4 + charCountBits(v) + byteLength * 8;
    if (needed <= dataCapacityBits(v, ecc)) return v;
  }
  throw new Error(
    `Content is too long for this encoder (${byteLength} bytes at level ${ecc}; max version is 10).`
  );
}

// ── Matrix construction ─────────────────────────────────────────────────
function buildMatrix(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const setF = (r, c, v) => {
    modules[r][c] = v;
    reserved[r][c] = true;
  };

  // Finder patterns plus their separators.
  const finder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        setF(rr, cc, inRing);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    setF(6, i, i % 2 === 0);
    setF(i, 6, i % 2 === 0);
  }

  // Alignment patterns, skipping any that would sit on a finder.
  const centres = ALIGNMENT[version];
  for (const r of centres) {
    for (const c of centres) {
      const onFinder =
        (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (onFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          setF(r + dr, c + dc, ring !== 1);
        }
      }
    }
  }

  // Dark module.
  setF(size - 8, 8, true);

  // Reserve the format information areas.
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) setF(8, i, false);
    if (!reserved[i][8]) setF(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8][size - 1 - i]) setF(8, size - 1 - i, false);
    if (!reserved[size - 1 - i][8]) setF(size - 1 - i, 8, false);
  }

  // Reserve the version information areas.
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      setF(r, c, false);
      setF(c, r, false);
    }
  }

  return { size, modules, reserved };
}

// ── Data placement ──────────────────────────────────────────────────────
function placeData(modules, reserved, size, codewords) {
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  const nextBit = () => {
    if (bitIndex >= totalBits) return false;
    const byte = codewords[bitIndex >> 3];
    const bit = (byte >>> (7 - (bitIndex & 7))) & 1;
    bitIndex++;
    return bit === 1;
  };

  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    // The vertical timing column is skipped entirely.
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let k = 0; k < 2; k++) {
        const col = right - k;
        if (reserved[row][col]) continue;
        modules[row][col] = nextBit();
      }
    }
    upward = !upward;
  }
}

// ── Masking ─────────────────────────────────────────────────────────────
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function penalty(modules, size) {
  let score = 0;

  // Rule 1: runs of five or more of the same colour.
  const runScore = (get) => {
    let total = 0;
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        if (get(a, b) === get(a, b - 1)) {
          run++;
        } else {
          if (run >= 5) total += run - 2;
          run = 1;
        }
      }
      if (run >= 5) total += run - 2;
    }
    return total;
  };
  score += runScore((r, c) => modules[r][c]);
  score += runScore((c, r) => modules[r][c]);

  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  // Rule 3: finder-like patterns.
  const PATTERN = [true, false, true, true, true, false, true, false, false, false, false];
  const REVERSED = [...PATTERN].reverse();
  const matches = (get, a, b) => {
    const test = (pat) => {
      for (let i = 0; i < 11; i++) if (get(a, b + i) !== pat[i]) return false;
      return true;
    };
    return test(PATTERN) || test(REVERSED);
  };
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      if (matches((a, b) => modules[a][b], r, c)) score += 40;
      if (matches((a, b) => modules[b][a], r, c)) score += 40;
    }
  }

  // Rule 4: overall balance of dark to light.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules[r][c]) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

// ── Format and version information ──────────────────────────────────────
function formatBits(ecc, mask) {
  const data = (ECC_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

function writeFormat(modules, size, ecc, mask) {
  const bits = formatBits(ecc, mask);
  const bit = (i) => ((bits >>> i) & 1) === 1;

  // First copy: down the left of the top-right finder, then along the top of
  // the bottom-left one.
  for (let i = 0; i <= 5; i++) modules[i][8] = bit(i);
  modules[7][8] = bit(6);
  modules[8][8] = bit(7);
  modules[8][7] = bit(8);
  for (let i = 9; i <= 14; i++) modules[8][14 - i] = bit(i);

  // Second copy: along row 8 from the right edge, then down column 8 from the
  // bottom edge.
  for (let i = 0; i <= 7; i++) modules[8][size - 1 - i] = bit(i);
  for (let i = 8; i <= 14; i++) modules[size - 15 + i][8] = bit(i);

  modules[size - 8][8] = true; // dark module
}

function writeVersion(modules, size, version) {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const on = ((bits >>> i) & 1) === 1;
    const r = Math.floor(i / 3);
    const c = size - 11 + (i % 3);
    modules[r][c] = on;
    modules[c][r] = on;
  }
}

// ── Public API ──────────────────────────────────────────────────────────
/**
 * @param {string} text
 * @param {{ ecc?: 'L'|'M'|'Q'|'H' }} [options]
 * @returns {{ size: number, version: number, ecc: string, modules: boolean[][] }}
 */
export function encodeQR(text, options = {}) {
  const ecc = options.ecc || 'M';
  if (!Object.prototype.hasOwnProperty.call(ECC_BITS, ecc)) {
    throw new Error(`Unknown error correction level: ${ecc}`);
  }

  const bytes = new TextEncoder().encode(text);
  const version = pickVersion(bytes.length, ecc);
  const [ecPerBlock, g1, d1, g2, d2] = ECC_BLOCKS[version][ecc];
  const totalData = g1 * d1 + g2 * d2;

  // Mode indicator, character count, payload.
  const buf = new Bits();
  buf.put(0b0100, 4);
  buf.put(bytes.length, charCountBits(version));
  for (const b of bytes) buf.put(b, 8);

  // Terminator, then pad to a byte boundary.
  const capacity = totalData * 8;
  buf.put(0, Math.min(4, capacity - buf.length));
  while (buf.length % 8 !== 0) buf.bits.push(0);

  const data = [];
  for (let i = 0; i < buf.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | buf.bits[i + j];
    data.push(byte);
  }
  // Pad codewords alternate between these two values.
  const PAD = [0xec, 0x11];
  for (let i = 0; data.length < totalData; i++) data.push(PAD[i % 2]);

  // Split into blocks and compute error correction for each.
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < g1 + g2; i++) {
    const len = i < g1 ? d1 : d2;
    const block = data.slice(offset, offset + len);
    offset += len;
    blocks.push({ data: block, ec: rsEncode(block, ecPerBlock) });
  }

  // Interleave data codewords, then error correction codewords.
  const codewords = [];
  const maxData = Math.max(d1, d2);
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.data.length) codewords.push(block.data[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of blocks) codewords.push(block.ec[i]);
  }

  const { size, modules, reserved } = buildMatrix(version);
  placeData(modules, reserved, size, codewords);
  writeVersion(modules, size, version);

  // Try every mask and keep the one with the lowest penalty.
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = modules.map((row) => [...row]);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!reserved[r][c] && MASKS[mask](r, c)) candidate[r][c] = !candidate[r][c];
      }
    }
    writeFormat(candidate, size, ecc, mask);
    const score = penalty(candidate, size);
    if (!best || score < best.score) best = { score, mask, modules: candidate };
  }

  return { size, version, ecc, mask: best.mask, modules: best.modules };
}
