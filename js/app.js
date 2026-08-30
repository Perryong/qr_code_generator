/**
 * Entry point: reads the link, builds the code, grows the tree, and keeps
 * the shareable URL in sync with what is on screen.
 *
 * State lives in the query string (`?u=`, `?s=`, `?p=`) so a shared link
 * reproduces the exact scene the sender was looking at. Nothing is uploaded;
 * the encoder runs in the page.
 */

import { encodeQR } from './qr.js';
import { createScene } from './scene.js';
import { SEASONS, PALETTES, DEFAULT_SEASON, DEFAULT_PALETTE, resolveTheme } from './seasons.js';

const canvas = document.getElementById('scene');
const form = document.getElementById('link-form');
const input = document.getElementById('link-input');
const errorEl = document.getElementById('error');
const statsEl = document.getElementById('stats');
const flattenBtn = document.getElementById('flatten');
const hintEl = document.getElementById('hint');
const seasonRow = document.getElementById('seasons');
const paletteRow = document.getElementById('palettes');
const eccSelect = document.getElementById('ecc');

const scene = createScene(canvas);

const state = {
  url: '',
  season: DEFAULT_SEASON,
  palette: DEFAULT_PALETTE,
  ecc: 'M',
};

// ── Controls ─────────────────────────────────────────────────────────────
function buildChips(container, entries, key) {
  container.innerHTML = '';
  Object.entries(entries).forEach(([id, def]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.value = id;
    btn.textContent = def.label;
    btn.addEventListener('click', () => {
      state[key] = id;
      syncChips();
      rebuild();
      writeUrl();
    });
    container.appendChild(btn);
  });
}

function syncChips() {
  seasonRow.querySelectorAll('.chip').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.value === state.season);
  });
  paletteRow.querySelectorAll('.chip').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.value === state.palette);
  });
}

buildChips(seasonRow, SEASONS, 'season');
buildChips(paletteRow, PALETTES, 'palette');

// ── Build ────────────────────────────────────────────────────────────────
function normaliseUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // Bare domains are common input; assume https rather than rejecting them.
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed) && !/^[a-z]+:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function rebuild() {
  const value = state.url;
  if (!value) return;
  try {
    const code = encodeQR(value, { ecc: state.ecc });
    const theme = resolveTheme(state.season, state.palette);
    const tree = scene.build(code.modules, theme);
    errorEl.textContent = '';
    errorEl.hidden = true;
    statsEl.textContent = `Version ${code.version} · ${code.size}×${code.size} · level ${code.ecc} · ${tree.branches.length} branches · ${tree.blossoms.length} blossoms`;
    document.body.dataset.ready = 'true';
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
}

// ── URL state ────────────────────────────────────────────────────────────
function writeUrl() {
  const params = new URLSearchParams();
  params.set('u', state.url);
  if (state.season !== DEFAULT_SEASON) params.set('s', state.season);
  if (state.palette !== DEFAULT_PALETTE) params.set('p', state.palette);
  if (state.ecc !== 'M') params.set('e', state.ecc);
  history.replaceState(null, '', `${location.pathname}?${params}`);
}

function readUrl() {
  const params = new URLSearchParams(location.search);
  state.url = params.get('u') || 'https://github.com';
  if (SEASONS[params.get('s')]) state.season = params.get('s');
  if (PALETTES[params.get('p')]) state.palette = params.get('p');
  const e = params.get('e');
  if (['L', 'M', 'Q', 'H'].includes(e)) state.ecc = e;
  input.value = state.url;
  eccSelect.value = state.ecc;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const next = normaliseUrl(input.value);
  if (!next) return;
  state.url = next;
  input.value = next;
  rebuild();
  writeUrl();
});

eccSelect.addEventListener('change', () => {
  state.ecc = eccSelect.value;
  rebuild();
  writeUrl();
});

// ── Flatten ──────────────────────────────────────────────────────────────
function setFlattenLabel(p) {
  const flat = p > 0.5;
  flattenBtn.textContent = flat ? 'Back to the tree' : 'Flatten to scan';
  flattenBtn.setAttribute('aria-pressed', String(flat));
  document.body.dataset.flat = flat;
  hintEl.textContent = flat
    ? 'Point a camera at the screen to scan.'
    : 'Tap the scene to flatten it into a scannable code.';
}

flattenBtn.addEventListener('click', () => setFlattenLabel(scene.toggle()));
canvas.addEventListener('click', () => setFlattenLabel(scene.toggle()));
window.addEventListener('keydown', (e) => {
  if (e.key === ' ' && !e.target.matches('input, button, select')) {
    e.preventDefault();
    setFlattenLabel(scene.toggle());
  }
});

// ── Copy and download ────────────────────────────────────────────────────
document.getElementById('copy').addEventListener('click', async (e) => {
  try {
    await navigator.clipboard.writeText(location.href);
    const btn = e.currentTarget;
    const old = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => {
      btn.textContent = old;
    }, 1400);
  } catch {
    errorEl.textContent = 'Could not reach the clipboard — copy the address bar instead.';
    errorEl.hidden = false;
  }
});

document.getElementById('download').addEventListener('click', () => {
  // Render on demand: the canvas has no preserveDrawingBuffer, so grab the
  // frame straight after an explicit draw.
  scene.renderer.render(scene.scene, scene.camera);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'qr-tree.png';
    a.click();
    URL.revokeObjectURL(a.href);
  }, 'image/png');
});

// ── Go ───────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => scene.resize());
readUrl();
syncChips();
scene.resize();
rebuild();
setFlattenLabel(0);
scene.start();
