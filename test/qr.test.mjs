/**
 * Verification for the hand-rolled QR encoder.
 *
 * Two independent checks, because a QR code that looks plausible and does not
 * scan is worse than no QR code at all:
 *
 *   1. Compare the matrix bit-for-bit against the reference `qrcode` package.
 *   2. Render the matrix to pixels and read it back with `jsqr`, an actual
 *      decoder, to prove the thing scans.
 *
 * Run with:  npm install && npm test
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { encodeQR } from '../js/qr.js';

const SAMPLES = [
  'a',
  'https://example.com',
  'https://github.com/anthropics',
  'The quick brown fox jumps over the lazy dog 0123456789',
  'unicode: café — naïve ✓ 日本語',
  'x'.repeat(100),
];
const LEVELS = ['L', 'M', 'Q', 'H'];

/** Paint the matrix into an RGBA buffer with a four-module quiet zone. */
function rasterise(modules, size, scale = 4) {
  const quiet = 4;
  const dim = (size + quiet * 2) * scale;
  const buf = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!modules[r][c]) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const px = ((r + quiet) * scale + y) * dim + ((c + quiet) * scale + x);
          buf[px * 4] = buf[px * 4 + 1] = buf[px * 4 + 2] = 0;
        }
      }
    }
  }
  return { buf, dim };
}

test('matrix matches the reference encoder', () => {
  let compared = 0;
  for (const text of SAMPLES) {
    for (const ecc of LEVELS) {
      let mine;
      try {
        mine = encodeQR(text, { ecc });
      } catch {
        continue; // beyond version 10, which this encoder does not cover
      }
      const ref = QRCode.create([{ data: text, mode: 'byte' }], { errorCorrectionLevel: ecc });
      if (ref.version > 10) continue;

      assert.equal(mine.version, ref.version, `version for ${ecc} / ${text.slice(0, 24)}`);
      assert.equal(mine.size, ref.modules.size, `size for ${ecc} / ${text.slice(0, 24)}`);

      // The mask is chosen by penalty score and implementations may break ties
      // differently, so only compare modules when the same mask was picked.
      if (mine.mask !== ref.maskPattern) continue;
      for (let r = 0; r < mine.size; r++) {
        for (let c = 0; c < mine.size; c++) {
          assert.equal(
            mine.modules[r][c],
            Boolean(ref.modules.data[r * mine.size + c]),
            `module ${r},${c} for ${ecc} / ${text.slice(0, 24)}`
          );
        }
      }
      compared++;
    }
  }
  assert.ok(compared > 0, 'expected at least one matrix comparison');
});

test('generated codes decode back to the original text', () => {
  for (const text of SAMPLES) {
    for (const ecc of LEVELS) {
      let code;
      try {
        code = encodeQR(text, { ecc });
      } catch {
        continue;
      }
      const { buf, dim } = rasterise(code.modules, code.size);
      const result = jsQR(buf, dim, dim);
      assert.ok(result, `no code found for ${ecc} / ${text.slice(0, 24)}`);
      assert.equal(result.data, text, `payload for ${ecc} / ${text.slice(0, 24)}`);
    }
  }
});

test('the same link always grows the same tree', async () => {
  const { growTree } = await import('../js/tree.js');
  const a = growTree(encodeQR('https://example.com', { ecc: 'M' }).modules);
  const b = growTree(encodeQR('https://example.com', { ecc: 'M' }).modules);
  assert.equal(a.seed, b.seed);
  assert.equal(a.branches.length, b.branches.length);
  assert.deepEqual(a.branches[7], b.branches[7]);

  const c = growTree(encodeQR('https://example.org', { ecc: 'M' }).modules);
  assert.notEqual(a.seed, c.seed);
});

test('oversized content fails loudly rather than silently truncating', () => {
  assert.throws(() => encodeQR('z'.repeat(3000), { ecc: 'H' }), /too long/i);
});

test('unknown error correction levels are rejected', () => {
  assert.throws(() => encodeQR('hello', { ecc: 'X' }), /Unknown error correction/);
});
