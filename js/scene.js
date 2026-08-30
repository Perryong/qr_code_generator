/**
 * The scene.
 *
 * Two ideas carry the whole thing:
 *
 * 1. The QR matrix *is* the terrain. Dark modules become raised blocks, light
 *    modules stay low. From an angle it reads as landscape; from directly
 *    above it is an ordinary QR code with ordinary contrast.
 *
 * 2. One number drives the transition. `progress` runs 0 to 1 and everything
 *    follows it: the camera swings from three-quarter view to straight down,
 *    the blocks flatten, the tree shrinks into its own base, grass and petals
 *    fade, and the colours harden to near black and white so a phone camera
 *    has the contrast it needs.
 *
 * Because every raised block is the same height, flattening is a single
 * scale on the instanced mesh rather than 800 matrix updates per frame.
 */

import * as THREE from 'three';
import { growTree, seedPetals } from './tree.js';

// Dark blocks butt up against each other. A gap between two adjacent dark
// modules would show as a pale seam in the flattened view and can cost a
// decoder the read, so only the low light blocks are inset — that keeps a
// visible grid texture on the ground without touching the code itself.
const LIGHT_INSET = 0.07;
const DARK_HEIGHT = 1.0;
const LIGHT_HEIGHT = 0.16;
const FLAT_DARK = 0.05;
const FLAT_LIGHT = 0.02;

const lerp = THREE.MathUtils.lerp;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 500);

  // ── Lighting ─────────────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight(0xffffff, 0x93a58d, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff6e8, 1.6);
  sun.position.set(18, 30, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  scene.add(sun);
  scene.add(sun.target);

  // ── Mutable scene contents ───────────────────────────────────────────
  let world = null;
  let progress = 0;
  let targetProgress = 0;
  let theme = null;
  let orbit = 0;
  let zoom = 1;
  let matrixSize = 25;
  let petalData = [];
  let time = 0;

  const dummy = new THREE.Object3D();
  const colour = new THREE.Color();

  function disposeWorld() {
    if (!world) return;
    scene.remove(world.group);
    world.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    world = null;
  }

  /**
   * Rebuilds everything for a new QR matrix.
   * @param {boolean[][]} modules
   * @param {object} nextTheme  resolved season + palette
   */
  function build(modules, nextTheme) {
    disposeWorld();
    theme = nextTheme;
    matrixSize = modules.length;

    const group = new THREE.Group();
    const half = (matrixSize - 1) / 2;

    // ── Terrain ────────────────────────────────────────────────────────
    const makeBlockGeo = (inset) => {
      const geo = new THREE.BoxGeometry(1 - inset, 1, 1 - inset);
      geo.translate(0, 0.5, 0); // origin at the base, so scaling grows upward
      return geo;
    };
    const darkGeo = makeBlockGeo(0);
    const lightGeo = makeBlockGeo(LIGHT_INSET);

    const darkCells = [];
    const lightCells = [];
    for (let r = 0; r < matrixSize; r++) {
      for (let c = 0; c < matrixSize; c++) {
        (modules[r][c] ? darkCells : lightCells).push([c - half, r - half]);
      }
    }

    const makeTerrain = (geo, cells, colorHex, height, receiveOnly) => {
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex),
        roughness: 0.85,
        metalness: 0,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
      cells.forEach(([x, z], i) => {
        dummy.position.set(x, 0, z);
        dummy.scale.set(1, height, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = !receiveOnly;
      mesh.receiveShadow = true;
      return mesh;
    };

    // Heights live in the mesh scale, not the instance matrices, so the
    // flatten is one property change rather than a full rebuild.
    const darkMesh = makeTerrain(darkGeo, darkCells, theme.dark, 1, false);
    darkMesh.scale.y = DARK_HEIGHT;
    const lightMesh = makeTerrain(lightGeo, lightCells, theme.light, 1, true);
    lightMesh.scale.y = LIGHT_HEIGHT;
    group.add(darkMesh, lightMesh);

    // A base slab so the code reads as a solid object from the side.
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(matrixSize + 1.6, 0.6, matrixSize + 1.6),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.ground), roughness: 0.95 })
    );
    slab.position.y = -0.3;
    slab.receiveShadow = true;
    group.add(slab);

    // ── Tree ───────────────────────────────────────────────────────────
    const tree = growTree(modules);
    const treeGroup = new THREE.Group();

    const barkMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(theme.bark),
      roughness: 0.9,
    });
    const branchGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    branchGeo.translate(0, 0.5, 0); // base at the origin so we can aim it

    const branchMesh = new THREE.InstancedMesh(branchGeo, barkMat, tree.branches.length);
    branchMesh.castShadow = true;
    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);

    tree.branches.forEach((b, i) => {
      start.fromArray(b.start);
      end.fromArray(b.end);
      dir.subVectors(end, start);
      const length = dir.length() || 0.001;
      quat.setFromUnitVectors(yAxis, dir.normalize());
      const radius = (b.radiusStart + b.radiusEnd) / 2;
      dummy.position.copy(start);
      dummy.quaternion.copy(quat);
      dummy.scale.set(radius, length, radius);
      dummy.updateMatrix();
      branchMesh.setMatrixAt(i, dummy.matrix);
    });
    branchMesh.instanceMatrix.needsUpdate = true;
    treeGroup.add(branchMesh);

    // Blossoms — one instanced blob, tinted per instance from the palette.
    const blossomGeo = new THREE.IcosahedronGeometry(1, 0);
    const blossomMat = new THREE.MeshStandardMaterial({ roughness: 0.65, flatShading: true });
    const blossomMesh = new THREE.InstancedMesh(blossomGeo, blossomMat, tree.blossoms.length);
    blossomMesh.castShadow = true;
    const canopyColors = theme.canopy.map((hex) => new THREE.Color(hex));
    tree.blossoms.forEach((b, i) => {
      dummy.position.fromArray(b.position);
      dummy.rotation.set(i * 0.7, i * 1.3, i * 0.4);
      const s = b.size * matrixSize * 0.014;
      dummy.scale.set(s, s * 0.82, s);
      dummy.updateMatrix();
      blossomMesh.setMatrixAt(i, dummy.matrix);
      blossomMesh.setColorAt(i, canopyColors[i % canopyColors.length]);
    });
    blossomMesh.instanceMatrix.needsUpdate = true;
    if (blossomMesh.instanceColor) blossomMesh.instanceColor.needsUpdate = true;
    treeGroup.add(blossomMesh);

    treeGroup.position.y = DARK_HEIGHT;
    group.add(treeGroup);

    // ── Grass ──────────────────────────────────────────────────────────
    const grassGeo = new THREE.ConeGeometry(0.055, 1, 4);
    grassGeo.translate(0, 0.5, 0);
    const grassMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(theme.grass),
      roughness: 0.9,
      transparent: true,
    });
    const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, Math.max(1, tree.grass.length));
    tree.grass.forEach((g, i) => {
      dummy.position.set(g.position[0], DARK_HEIGHT, g.position[2]);
      dummy.rotation.set(g.lean, g.twist, g.lean * 0.6);
      dummy.scale.set(1, g.height, 1);
      dummy.updateMatrix();
      grassMesh.setMatrixAt(i, dummy.matrix);
    });
    grassMesh.instanceMatrix.needsUpdate = true;
    group.add(grassMesh);

    // ── Petals ─────────────────────────────────────────────────────────
    petalData = seedPetals(tree, Math.round(matrixSize * 3.5));
    const petalGeo = new THREE.PlaneGeometry(0.18, 0.12);
    const petalMat = new THREE.MeshStandardMaterial({
      color: canopyColors[0],
      roughness: 0.7,
      side: THREE.DoubleSide,
      transparent: true,
    });
    const petalMesh = new THREE.InstancedMesh(petalGeo, petalMat, petalData.length);
    petalMesh.frustumCulled = false;
    group.add(petalMesh);

    scene.add(group);

    // Colours we interpolate towards as the code flattens.
    world = {
      group,
      darkMesh,
      lightMesh,
      slab,
      treeGroup,
      grassMesh,
      petalMesh,
      tree,
      colours: {
        dark: new THREE.Color(theme.dark),
        light: new THREE.Color(theme.light),
        ground: new THREE.Color(theme.ground),
        flatDark: new THREE.Color('#12100f'),
        flatLight: new THREE.Color('#fbfaf7'),
      },
    };

    scene.background = new THREE.Color(theme.sky);
    scene.fog = new THREE.Fog(new THREE.Color(theme.fog), matrixSize * 2.2, matrixSize * 5.5);
    sun.target.position.set(0, 0, 0);
    sun.shadow.camera.left = -matrixSize;
    sun.shadow.camera.right = matrixSize;
    sun.shadow.camera.top = matrixSize;
    sun.shadow.camera.bottom = -matrixSize;
    sun.shadow.camera.updateProjectionMatrix();

    return tree;
  }

  // ── The transition ─────────────────────────────────────────────────────
  function applyProgress(p) {
    if (!world) return;
    const e = easeInOut(p);
    const { darkMesh, lightMesh, slab, treeGroup, grassMesh, petalMesh, colours } = world;

    // Blocks flatten.
    darkMesh.scale.y = lerp(DARK_HEIGHT, FLAT_DARK, e);
    lightMesh.scale.y = lerp(LIGHT_HEIGHT, FLAT_LIGHT, e);

    // Colours harden towards print contrast.
    darkMesh.material.color.copy(colours.dark).lerp(colours.flatDark, e);
    lightMesh.material.color.copy(colours.light).lerp(colours.flatLight, e);
    slab.material.color.copy(colours.ground).lerp(colours.flatLight, e);

    // The tree retreats into its own base. Squared so it clears the code
    // early and does not hang over the pattern while it is being read.
    const treeScale = Math.max(0.0001, 1 - e * e);
    treeGroup.scale.setScalar(treeScale);
    treeGroup.position.y = lerp(DARK_HEIGHT, FLAT_DARK, e);
    treeGroup.visible = treeScale > 0.02;

    // Grass and petals fade out first of all.
    const fade = Math.max(0, 1 - e * 2.2);
    grassMesh.material.opacity = fade;
    grassMesh.visible = fade > 0.01;
    grassMesh.scale.y = Math.max(0.0001, fade);
    grassMesh.position.y = lerp(0, -DARK_HEIGHT + FLAT_DARK, e);
    petalMesh.material.opacity = fade;
    petalMesh.visible = fade > 0.01;

    // Flat view drops the shadows, which would otherwise darken light modules.
    sun.castShadow = e < 0.65;
    hemi.intensity = lerp(1.05, 1.9, e);
    sun.intensity = lerp(1.6, 0.35, e);
  }

  function updatePetals(dt) {
    if (!world || !world.petalMesh.visible) return;
    petalData.forEach((p, i) => {
      p.position[1] -= p.fallSpeed * dt;
      const sway = Math.sin(time * p.swaySpeed + p.swayPhase) * p.swayAmount;
      if (p.position[1] < 0.2) {
        p.position[1] = world.tree.height * 1.05;
      }
      dummy.position.set(
        p.position[0] + sway,
        p.position[1] + DARK_HEIGHT,
        p.position[2] + sway * 0.6
      );
      dummy.rotation.set(time * p.spin, time * p.spin * 0.7, sway);
      const s = p.size;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      world.petalMesh.setMatrixAt(i, dummy.matrix);
    });
    world.petalMesh.instanceMatrix.needsUpdate = true;
  }

  // ── Camera ─────────────────────────────────────────────────────────────
  function updateCamera() {
    const e = easeInOut(progress);
    const aspect = camera.aspect || 1;
    const fovRad = THREE.MathUtils.degToRad(camera.fov);

    // Distance needed for the whole code to fit, whichever axis is tighter.
    const span = matrixSize + 8; // 4-module quiet zone each side, per spec
    const fitV = span / 2 / Math.tan(fovRad / 2);
    const fitH = fitV / Math.min(aspect, 1.6);
    const topDist = Math.max(fitV, fitH) * 1.02;

    // The three-quarter view also has to hold the tree, which stands well
    // above the code, so it pulls back further than the flat view.
    const treeHeight = world?.tree.height ?? 0;
    const isoSpan = Math.max(span, treeHeight * 1.5);
    const isoFitV = isoSpan / 2 / Math.tan(fovRad / 2);
    const isoDist = Math.max(isoFitV, isoFitV / Math.min(aspect, 1.6)) * 1.06 * zoom;
    const isoY = Math.sin(0.62) * isoDist;
    const isoR = Math.cos(0.62) * isoDist;

    const isoX = Math.cos(orbit) * isoR;
    const isoZ = Math.sin(orbit) * isoR;

    // Straight down at the end, with a hair of offset so `lookAt` stays sane.
    camera.position.set(
      lerp(isoX, 0, e),
      lerp(isoY, topDist, e),
      lerp(isoZ, 0.001, e)
    );
    camera.lookAt(0, lerp(DARK_HEIGHT * 0.5, 0, e), 0);
  }

  // ── Interaction ───────────────────────────────────────────────────────
  let dragging = false;
  let lastX = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    orbit -= (e.clientX - lastX) * 0.006;
    lastX = e.clientX;
  });
  const endDrag = () => {
    dragging = false;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoom = THREE.MathUtils.clamp(zoom * Math.exp(e.deltaY * 0.0015), 0.45, 2.5);
    },
    { passive: false }
  );

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const clock = new THREE.Clock();

  function tick() {
    const dt = Math.min(clock.getDelta(), 0.05);
    time += dt;

    if (Math.abs(targetProgress - progress) > 0.0005) {
      progress += (targetProgress - progress) * Math.min(1, dt * 4.5);
      applyProgress(progress);
    }

    if (!dragging && progress < 0.02) orbit += dt * 0.09;

    updatePetals(dt);
    updateCamera();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  return {
    build,
    resize,
    start: tick,
    toggle: () => {
      targetProgress = targetProgress > 0.5 ? 0 : 1;
      return targetProgress;
    },
    get progress() {
      return progress;
    },
    renderer,
    scene,
    camera,
  };
}
