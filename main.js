import * as THREE from 'three';

/* =========================================================
   SCROLL RESET ON LOAD / REFRESH
   Browsers auto-restore the previous scroll position on reload.
   Since every reload also resets our JS state to 'loading' (fresh
   intro screen, sound not played yet), a stale restored scroll
   position would desync from that fresh state — the plane would
   jump straight to wherever it crashed before. Force scroll back
   to the very top and stop the browser from restoring it.
========================================================= */
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
window.scrollTo(0, 0);
window.addEventListener('load', () => window.scrollTo(0, 0));

/* =========================================================
   STATE
========================================================= */
let state = 'loading'; // loading | intro | experience | end
let hasSpoken = false;
const FLIGHT_LENGTH = 900;

/* =========================================================
   RENDERER / SCENE / CAMERA
========================================================= */
const canvas = document.getElementById('scene-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x17307a);
scene.fog = new THREE.FogExp2(0x17307a, 0.012);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 3, 14);
camera.lookAt(0, 1, 0);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (window.ScrollTrigger) window.ScrollTrigger.refresh();
});

/* =========================================================
   LIGHTS
========================================================= */
const hemi = new THREE.HemisphereLight(0xdfe6ff, 0x0a1030, 0.9);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(8, 12, 6);
scene.add(sun);

const fill = new THREE.PointLight(0x8c93e8, 0.6, 60);
fill.position.set(-6, -2, 4);
scene.add(fill);

/* =========================================================
   REAL LOADING PIPELINE
   -----------------------------------------------------------
   This project doesn't fetch any external textures, models, or
   audio files — the plane and clouds are procedural, and the
   voice line uses speechSynthesis. So there is no "bytes
   downloaded" progress to report; a bar driven by a fake timer
   (like the old fakeLoad()) is the only option for that kind of
   fiction.

   What IS real, measurable work that happens exactly once per
   page load:
     1. web fonts finishing (document.fonts.ready)
     2. actually constructing the scene graph (clouds, route,
        debris, plane) — done in chunks below so each chunk only
        reports progress once it has truly been built
     3. asking the GPU to actually compile every material/shader
        used in the scene (renderer.compileAsync) before we ever
        show a frame — this is genuine, variable-duration GPU work

   Each step below flips its own "done" flag only at the exact
   point that work finishes. Nothing here is time-based or eased.
========================================================= */
const loadingScreenEl = document.getElementById('loading-screen');
const introScreenEl = document.getElementById('intro-screen');
const barFill = document.getElementById('loading-bar-fill');
const pctEl = document.getElementById('loading-percent');

const loadSteps = [
  { label: 'fonts', weight: 15, done: 0 },
  { label: 'plane', weight: 10, done: 0 },
  { label: 'route', weight: 15, done: 0 },
  { label: 'debris', weight: 10, done: 0 },
  { label: 'clouds', weight: 30, done: 0 },
  { label: 'shaders', weight: 20, done: 0 },
];
const loadTotalWeight = loadSteps.reduce((sum, s) => sum + s.weight, 0);

function renderLoadProgress() {
  const doneWeight = loadSteps.reduce((sum, s) => sum + s.weight * s.done, 0);
  const pct = Math.round((doneWeight / loadTotalWeight) * 100);
  barFill.style.width = pct + '%';
  pctEl.textContent = pct + '%';
  return pct;
}

// Marks a step's real completion fraction (0..1) and repaints the bar
// immediately. Only ever called from an actual completion point below —
// never from setInterval/setTimeout ticking upward on its own.
function setStep(label, fraction) {
  const step = loadSteps.find((s) => s.label === label);
  if (!step) return;
  step.done = Math.max(step.done, Math.min(1, fraction));
  return renderLoadProgress();
}

// Yields control back to the browser for one frame. Used to break up
// heavier construction loops (the cloud field) into visible chunks so the
// bar can actually repaint between them, instead of the whole scene being
// built in one blocking tick and the bar just jumping 0 -> 100.
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

renderLoadProgress(); // paint the true starting state: 0%

/* =========================================================
   PLANE
========================================================= */
function buildPlane() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: 0xf3f6ff, metalness: 0.35, roughness: 0.22, clearcoat: 0.7, clearcoatRoughness: 0.2
  });
  const accentMat = new THREE.MeshPhysicalMaterial({
    color: 0x33489e, metalness: 0.5, roughness: 0.3
  });

  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.5, 6, 20), bodyMat);
  fuselage.rotation.x = Math.PI / 2;
  group.add(fuselage);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.7, 20), bodyMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = 3.8;
  group.add(nose);

  const tailCone = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.3, 20), bodyMat);
  tailCone.rotation.x = Math.PI / 2;
  tailCone.position.z = -3.6;
  group.add(tailCone);

  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.lineTo(4.2, -0.6);
  wingShape.lineTo(4.4, -1.0);
  wingShape.lineTo(0.6, -1.4);
  wingShape.lineTo(0, -0.9);
  wingShape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 });
  const wingR = new THREE.Mesh(wingGeo, accentMat);
  wingR.rotation.x = Math.PI / 2;
  wingR.position.set(0.5, -0.1, 0.2);
  group.add(wingR);
  const wingL = wingR.clone();
  wingL.scale.x = -1;
  wingL.position.x = -0.5;
  group.add(wingL);

  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(0.1, 1.1);
  finShape.lineTo(-1.1, 1.0);
  finShape.lineTo(-0.9, 0.1);
  finShape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.1, bevelEnabled: false });
  const fin = new THREE.Mesh(finGeo, accentMat);
  fin.position.set(-0.05, 0.5, -3.4);
  fin.rotation.y = Math.PI / 2;
  group.add(fin);

  const stab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.5), accentMat);
  stab.position.set(0, 0, -3.5);
  group.add(stab);

  const engineGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.9, 14);
  const engineR = new THREE.Mesh(engineGeo, accentMat);
  engineR.rotation.x = Math.PI / 2;
  engineR.position.set(1.6, -0.5, 0.6);
  group.add(engineR);
  const engineL = engineR.clone();
  engineL.position.x = -1.6;
  group.add(engineL);

  group.scale.setScalar(0.95);
  return group;
}

// `plane` is created lazily inside the loading pipeline (see buildPlaneIntoScene
// below) instead of at import time, so its construction can be tracked as a
// real loading step. It stays undefined/unused until state leaves 'loading'.
let plane;

function buildPlaneIntoScene() {
  plane = buildPlane();
  scene.add(plane);
  setStep('plane', 1);
}

/* =========================================================
   CLOUDS
========================================================= */
const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.92 });

function buildCloudCluster() {
  const group = new THREE.Group();
  const n = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    const r = 0.6 + Math.random() * 1.3;
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), cloudMat);
    m.position.set((Math.random() - 0.5) * 3.2, (Math.random() - 0.5) * 1.0, (Math.random() - 0.5) * 2.4);
    group.add(m);
  }
  return group;
}

const cloudField = new THREE.Group();
const CLOUD_COUNT = 90;
const CLOUDS_PER_CHUNK = 6; // how many clusters get built before we yield a frame

// Builds the cloud field a few clusters at a time and reports real,
// incremental progress after each cluster actually exists — as opposed to
// building all 90 in one blocking loop and only reporting 100% at the end.
async function buildCloudField() {
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const c = buildCloudCluster();
    const t = i / CLOUD_COUNT;
    c.position.set((Math.random() - 0.5) * 44, (Math.random() - 0.5) * 16 + 2, -t * FLIGHT_LENGTH - 8);
    c.scale.setScalar(0.8 + Math.random() * 1.6);
    cloudField.add(c);
    setStep('clouds', (i + 1) / CLOUD_COUNT);
    if (i % CLOUDS_PER_CHUNK === CLOUDS_PER_CHUNK - 1) await nextFrame();
  }
  scene.add(cloudField);
}

/* =========================================================
   SKY GRADIENT
========================================================= */
const skyStops = [
  { p: 0.00, c: new THREE.Color(0x17307a) },
  { p: 0.25, c: new THREE.Color(0x3358d6) },
  { p: 0.55, c: new THREE.Color(0x5f86e6) },
  { p: 0.80, c: new THREE.Color(0xe2986b) },
  { p: 1.00, c: new THREE.Color(0x0a1636) }
];
const tmpColor = new THREE.Color();
function sampleSky(p) {
  for (let i = 0; i < skyStops.length - 1; i++) {
    const a = skyStops[i], b = skyStops[i + 1];
    if (p >= a.p && p <= b.p) {
      const local = (p - a.p) / (b.p - a.p || 1);
      return tmpColor.copy(a.c).lerp(b.c, local);
    }
  }
  return tmpColor.copy(skyStops[skyStops.length - 1].c);
}

/* =========================================================
   FLIGHT PATH — the plane doesn't fly straight, it winds
   left/right and up/down along a curve, like a real route
========================================================= */
const PATH_TURN_X = 3;      // how many left-right turns across the whole journey
const PATH_TURN_Y = 2.1;    // vertical undulation frequency (kept off-sync with X on purpose)
const PATH_WIDTH = 11;      // how far the plane swings left/right
const PATH_HEIGHT = 3.4;    // how far it swings up/down
const PATH_BASE_Y = 4;      // average cruise altitude

// The track physically ends here (as a fraction of total scroll progress).
// Everything from FALL_START_P to 1 is the plane falling off the broken route,
// not more winding — the road runs out, then gravity takes over.
const FALL_START_P = 0.94;

const pathVec = new THREE.Vector3();
function flightPath(p, out = pathVec) {
  const z = -p * FLIGHT_LENGTH;
  const x = Math.sin(p * Math.PI * 2 * PATH_TURN_X) * PATH_WIDTH;
  const y = PATH_BASE_Y + Math.sin(p * Math.PI * 2 * PATH_TURN_Y + 0.6) * PATH_HEIGHT;
  return out.set(x, y, z);
}

const tangentVecA = new THREE.Vector3();
const tangentVecB = new THREE.Vector3();
function flightTangent(p, out) {
  const eps = 0.0015;
  flightPath(Math.max(0, p - eps), tangentVecA);
  flightPath(Math.min(1, p + eps), tangentVecB);
  return out.copy(tangentVecB).sub(tangentVecA).normalize();
}

// visible route line the plane follows — a thin winding streak through the sky.
// This represents the FULL track (all 3 turns), and it terminates exactly where
// the plane will fall off it — see the broken-edge debris built right after it.
// Built lazily (see buildRouteIntoScene) so it counts as a real loading step.
function buildRouteIntoScene() {
  const routeSamples = [];
  const ROUTE_RESOLUTION = 400;
  for (let i = 0; i <= ROUTE_RESOLUTION; i++) {
    routeSamples.push(flightPath(i / ROUTE_RESOLUTION, new THREE.Vector3()));
  }
  const routeCurve = new THREE.CatmullRomCurve3(routeSamples);
  const routeGeo = new THREE.TubeGeometry(routeCurve, 500, 0.045, 6, false);
  const routeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
  const routeLine = new THREE.Mesh(routeGeo, routeMat);
  scene.add(routeLine);
  setStep('route', 1);
}

/* =========================================================
   BROKEN TRACK EDGE — a scatter of jagged debris marking
   exactly where the route physically ends
========================================================= */
const debrisChunks = [];
function buildBrokenEdge() {
  const group = new THREE.Group();
  const endPos = flightPath(1, new THREE.Vector3());
  const endTangent = flightTangent(1, new THREE.Vector3());

  // a rough "up" and "side" basis around the break point, so shards
  // scatter naturally around the tube instead of floating randomly in space
  const side = new THREE.Vector3().crossVectors(endTangent, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(side, endTangent).normalize();

  const shardMat = new THREE.MeshPhysicalMaterial({
    color: 0xdfe6ff, metalness: 0.4, roughness: 0.35, transparent: true, opacity: 0.85
  });
  const shardGeos = [
    () => new THREE.TetrahedronGeometry(0.18 + Math.random() * 0.22),
    () => new THREE.BoxGeometry(0.15 + Math.random() * 0.25, 0.08 + Math.random() * 0.15, 0.15 + Math.random() * 0.2),
    () => new THREE.ConeGeometry(0.1 + Math.random() * 0.12, 0.25 + Math.random() * 0.2, 5)
  ];

  const SHARD_COUNT = 16;
  for (let i = 0; i < SHARD_COUNT; i++) {
    const geo = shardGeos[Math.floor(Math.random() * shardGeos.length)]();
    const mesh = new THREE.Mesh(geo, shardMat);

    const alongTrack = (Math.random() - 0.35) * 1.4; // mostly clustered right at / just past the break
    const spreadSide = (Math.random() - 0.5) * 1.6;
    const spreadUp = (Math.random() - 0.5) * 1.2;

    mesh.position.copy(endPos)
      .addScaledVector(endTangent, alongTrack)
      .addScaledVector(side, spreadSide)
      .addScaledVector(up, spreadUp);

    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    mesh.userData.spin = new THREE.Vector3(
      (Math.random() - 0.5) * 0.6,
      (Math.random() - 0.5) * 0.6,
      (Math.random() - 0.5) * 0.6
    );
    mesh.userData.driftSpeed = 0.15 + Math.random() * 0.25;
    mesh.userData.baseY = mesh.position.y;
    mesh.userData.phase = Math.random() * Math.PI * 2;

    group.add(mesh);
    debrisChunks.push(mesh);
  }

  return group;
}

function buildDebrisIntoScene() {
  scene.add(buildBrokenEdge());
  setStep('debris', 1);
}

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  cloudField.rotation.y = Math.sin(t * 0.01) * 0.02;

  // slow independent tumble/drift on the broken-track debris, so it reads as
  // loose, crumbling wreckage rather than a static decoration
  for (let i = 0; i < debrisChunks.length; i++) {
    const d = debrisChunks[i];
    d.rotation.x += d.userData.spin.x * 0.01;
    d.rotation.y += d.userData.spin.y * 0.01;
    d.rotation.z += d.userData.spin.z * 0.01;
    d.position.y = d.userData.baseY + Math.sin(t * d.userData.driftSpeed + d.userData.phase) * 0.15;
  }

  if (state === 'intro' && plane) {
    plane.position.y = Math.sin(t * 0.6) * 0.15;
    plane.position.z = 0;
    plane.position.x = 0;
    plane.rotation.set(Math.sin(t * 0.4) * 0.015, 0, Math.sin(t * 0.5) * 0.03);
    camera.position.set(0, 3, 14);
    camera.lookAt(plane.position.x, plane.position.y + 0.6, plane.position.z);
  }
  // 'experience' state orientation & position are driven by updateFlight(), called from
  // the scroll ticker — keeping a single source of truth avoids the two fighting each other.

  renderer.render(scene, camera);
}
animate();

/* =========================================================
   SCROLL-DRIVEN FLIGHT
========================================================= */
function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const factPanels = Array.from(document.querySelectorAll('.fact-panel'));
const factRanges = [
  [0.03, 0.22],
  [0.30, 0.47],
  [0.55, 0.72],
  [0.78, 0.94]
];
const scrollCueEl = document.getElementById('scroll-cue');

function updateFactPanels(p) {
  factPanels.forEach((el, i) => {
    const range = factRanges[i];
    let op = 0;
    if (p >= range[0] - 0.03 && p <= range[1] + 0.03) {
      const fadeIn = smoothstep(range[0], range[0] + 0.03, p);
      const fadeOut = 1 - smoothstep(range[1] - 0.03, range[1], p);
      op = Math.max(0, Math.min(fadeIn, fadeOut));
    }
    el.style.opacity = op;
    el.style.pointerEvents = op > 0.5 ? 'auto' : 'none';
  });
}

/* =========================================================
   SCROLL SPEED WARP — slow the flight down while a fact panel
   is on screen, so the text has time to actually be read, then
   speed back up in the gaps between panels. This does NOT change
   how much you have to physically scroll (still the full 700vh) —
   it reshapes how fast the flight progress advances relative to
   that scroll, using the same zones as the fact panels.
========================================================= */
const SLOWDOWN_ZONES = factRanges;
const SLOWDOWN_MARGIN = 0.05;    // how gradually speed ramps down/up at each zone's edge (wider = gentler)
const SLOWDOWN_FACTOR = 0.12;    // flight speed inside a zone, as a fraction of normal (lower = slower)

function zoneWeight(p) {
  let w = 0;
  for (const [a, b] of SLOWDOWN_ZONES) {
    let zw = 0;
    if (p >= a && p <= b) {
      zw = 1;
    } else if (p < a && p > a - SLOWDOWN_MARGIN) {
      zw = smoothstep(a - SLOWDOWN_MARGIN, a, p);
    } else if (p > b && p < b + SLOWDOWN_MARGIN) {
      zw = 1 - smoothstep(b, b + SLOWDOWN_MARGIN, p);
    }
    w = Math.max(w, zw);
  }
  return w;
}

function speedAt(p) {
  return 1 - (1 - SLOWDOWN_FACTOR) * zoneWeight(p);
}

// Precompute a lookup table that converts raw scroll progress (linear, tied
// directly to pixels scrolled) into "flight" progress (non-linear, slower
// through the zones above). Built once, since the zones never change at runtime.
const PROGRESS_MAP_RES = 2000;
const progressMap = new Float32Array(PROGRESS_MAP_RES + 1);
(function buildProgressMap() {
  let acc = 0;
  progressMap[0] = 0;
  const step = 1 / PROGRESS_MAP_RES;
  for (let i = 1; i <= PROGRESS_MAP_RES; i++) {
    const p = i * step;
    acc += speedAt(p) * step;
    progressMap[i] = acc;
  }
  const total = progressMap[PROGRESS_MAP_RES] || 1;
  for (let i = 0; i <= PROGRESS_MAP_RES; i++) progressMap[i] /= total;
})();

function mapProgress(rawP) {
  const clamped = Math.min(1, Math.max(0, rawP));
  const idx = clamped * PROGRESS_MAP_RES;
  const i0 = Math.floor(idx);
  const i1 = Math.min(PROGRESS_MAP_RES, i0 + 1);
  const frac = idx - i0;
  return progressMap[i0] + (progressMap[i1] - progressMap[i0]) * frac;
}

const forwardAxis = new THREE.Vector3(0, 0, 1);
const chaseOffset = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const baseQuat = new THREE.Quaternion();
const tangentNow = new THREE.Vector3();
const tangentPrev = new THREE.Vector3();
const tangentNext = new THREE.Vector3();

// crash is triggered once the (already speed-warped) flight progress passes this point
const CRASH_P = 0.995;

function updateFlight(p) {
  if (!plane) return; // scene not built yet (still loading) — nothing to drive

  // trackP is the plane's progress ALONG THE ACTUAL ROUTE (0..1), which finishes
  // exactly at FALL_START_P worth of (warped) progress — every turn still plays
  // out in full, it's just compressed into the first 94% instead of 100%.
  const trackP = Math.min(p, FALL_START_P) / FALL_START_P;
  const pos = flightPath(trackP, pathVec);
  flightTangent(trackP, tangentNow);

  // orientation: always derived from the track's tangent at trackP (which freezes
  // at the end-of-track tangent once p > FALL_START_P) — this stays continuous and
  // scrub-reversible in both directions
  baseQuat.setFromUnitVectors(forwardAxis, tangentNow);
  plane.quaternion.copy(baseQuat);

  flightTangent(Math.max(0, trackP - 0.012), tangentPrev);
  flightTangent(Math.min(1, trackP + 0.012), tangentNext);
  const turnRate = tangentNext.x - tangentPrev.x;
  const bankAngle = THREE.MathUtils.clamp(-turnRate * 9, -0.9, 0.9);
  plane.rotateZ(bankAngle);
  plane.rotateX(Math.sin(clock.getElapsedTime() * 1.6) * 0.01);

  // how far past the broken edge we are, 0 (still on track) to 1 (fully fallen)
  const fallT = p <= FALL_START_P ? 0 : smoothstep(FALL_START_P, 1, p);

  if (fallT <= 0) {
    // still riding the track normally
    plane.position.copy(pos);
  } else {
    // the track ran out — plane coasts forward on its last heading while
    // gravity takes over and it starts tumbling
    const forwardDrift = tangentNow.clone().multiplyScalar(fallT * 10);
    const dropAmount = fallT * fallT * 55; // accelerating fall, not linear
    const wobbleX = Math.sin(fallT * 9) * 1.2 * fallT;

    plane.position.set(
      pos.x + forwardDrift.x + wobbleX,
      pos.y + forwardDrift.y - dropAmount,
      pos.z + forwardDrift.z
    );

    plane.rotateX(fallT * 1.8);           // nose pitches down as it falls
    plane.rotateZ(Math.sin(fallT * 5) * 0.4 * fallT); // tumbling roll
  }

  // chase camera: normally hugs the track ahead; once the plane starts falling,
  // it pulls back further and tilts down to watch the fall instead of looking ahead
  const chaseBack = -13 - fallT * 7;
  const chaseUp = 3.2 + fallT * 4.5;
  chaseOffset.copy(tangentNow).multiplyScalar(chaseBack);
  camera.position.set(
    plane.position.x + chaseOffset.x,
    plane.position.y + chaseOffset.y + chaseUp,
    plane.position.z + chaseOffset.z
  );

  if (fallT <= 0) {
    flightPath(Math.min(1, trackP + 0.04), lookTarget);
    camera.lookAt(lookTarget.x, lookTarget.y + 0.6, lookTarget.z);
  } else {
    camera.lookAt(plane.position.x, plane.position.y - 1.5, plane.position.z);
  }

  const col = sampleSky(Math.min(p, 1));
  scene.background.copy(col);
  scene.fog.color.copy(col);

  updateFactPanels(p);

  if (scrollCueEl) scrollCueEl.classList.toggle('hidden', p > 0.015);

  if (p > CRASH_P && state !== 'end') {
    triggerEnd();
  } else if (p < CRASH_P - 0.03 && state === 'end') {
    resumeFromEnd();
  }
}

let scrollTriggerInstance = null;
function initScrollFlight() {
  if (scrollTriggerInstance || !window.gsap || !window.ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);
  scrollTriggerInstance = ScrollTrigger.create({
    trigger: document.documentElement,
    start: 'top top',
    end: 'bottom bottom',
    scrub: 1.4,
    onUpdate: (self) => updateFlight(mapProgress(self.progress))
  });
  updateFlight(mapProgress(0));
}

/* =========================================================
   END / CRASH SEQUENCE
   Position & rotation during the fall are already fully driven by
   updateFlight(p) every frame, so this only needs to manage the
   end-screen UI — no separate GSAP tween fighting the scroll scrub.
========================================================= */
const endScreenEl = document.getElementById('end-screen');
let endTimeout = null;

function triggerEnd() {
  state = 'end';
  endTimeout = setTimeout(() => {
    endScreenEl.classList.add('visible');
  }, 400);
}

function resumeFromEnd() {
  state = 'experience';
  endScreenEl.classList.remove('visible');
  if (endTimeout) clearTimeout(endTimeout);
}

function resetToIntro() {
  // stop any pending end-screen visuals/timers
  if (endTimeout) clearTimeout(endTimeout);
  endScreenEl.classList.remove('visible');

  // hide the experience layer and lock scrolling again — same state as the very
  // first page load, before ENTER was ever pressed
  experienceEl.classList.remove('visible');
  experienceEl.setAttribute('aria-hidden', 'true');
  document.documentElement.style.overflowY = 'hidden';
  document.body.style.overflowY = 'hidden';

  // snap scroll back to the top instantly so the flight path resets cleanly
  // underneath the intro screen (no smooth-scroll animation to wait through)
  window.scrollTo(0, 0);
  updateFlight(mapProgress(0));

  // bring back the intro gate screen
  introScreenEl.classList.remove('fading-out');
  introScreenEl.classList.add('visible');
  introScreenEl.removeAttribute('aria-hidden');

  // let the welcome voice line play again the next time ENTER is pressed
  hasSpoken = false;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();

  state = 'intro';
}

document.getElementById('restart-btn').addEventListener('click', resetToIntro);

/* =========================================================
   LOADING BOOT SEQUENCE
   Orchestrates the real steps declared in the "REAL LOADING
   PIPELINE" block above. Fonts and scene construction run
   concurrently (neither depends on the other); shader
   compilation only starts once every mesh/material that will
   ever appear in the intro/experience actually exists in the
   scene graph, since compileAsync needs the real scene to walk.
========================================================= */

// Purely cosmetic: keeps the finished (100%) bar on screen for a brief beat
// before the intro gate appears, so it doesn't just flash and vanish on fast
// devices. It does NOT affect what percentage is shown — the bar always
// reflects genuinely completed work. Set to 0 to disable entirely.
const MIN_VISIBLE_MS_AFTER_100 = 250;

async function boot() {
  const fontsPromise = (document.fonts ? document.fonts.ready : Promise.resolve())
    .then(() => setStep('fonts', 1));

  buildPlaneIntoScene();
  buildRouteIntoScene();
  buildDebrisIntoScene();

  await buildCloudField(); // reports incremental progress internally

  // Every object that will ever be rendered now exists in the scene graph —
  // ask the GPU to actually compile its shaders/materials up front, instead
  // of hitching on the very first real frame the user sees.
  if (typeof renderer.compileAsync === 'function') {
    await renderer.compileAsync(scene, camera);
  } else {
    renderer.compile(scene, camera);
  }
  setStep('shaders', 1);

  await fontsPromise;

  // Every real task above has now genuinely finished (renderLoadProgress()
  // will read 100% at this point) — reveal the gate screen.
  if (MIN_VISIBLE_MS_AFTER_100 > 0) {
    await new Promise((res) => setTimeout(res, MIN_VISIBLE_MS_AFTER_100));
  }

  loadingScreenEl.classList.add('hidden');
  introScreenEl.classList.add('visible');
  introScreenEl.removeAttribute('aria-hidden');
  state = 'intro';
}

boot();

/* =========================================================
   ENTER EXPERIENCE + VOICE INTRO
========================================================= */
const experienceEl = document.getElementById('experience');

function speakWelcome() {
  if (hasSpoken || !('speechSynthesis' in window)) return;
  hasSpoken = true;
  const line = "Hello passenger, and welcome aboard Telehub. Please sit back, relax, and enjoy the journey as we take you through the network that connects everything.";
  const utter = new SpeechSynthesisUtterance(line);
  utter.lang = 'en-US';
  utter.rate = 0.96;
  utter.pitch = 1.0;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

function enterExperience() {
  // safety net: make sure we're starting the flight from the very top of the
  // page, even in the unlikely case something nudged scrollTop before this
  window.scrollTo(0, 0);

  speakWelcome();

  introScreenEl.classList.add('fading-out');
  introScreenEl.classList.remove('visible');
  setTimeout(() => introScreenEl.setAttribute('aria-hidden', 'true'), 1000);

  experienceEl.classList.add('visible');
  experienceEl.removeAttribute('aria-hidden');

  document.documentElement.style.overflowY = 'auto';
  document.body.style.overflowY = 'auto';

  state = 'experience';
  initScrollFlight();
}

document.getElementById('enter-btn').addEventListener('click', enterExperience);

/* =========================================================
   CONTACT MODAL
========================================================= */
const contactModal = document.getElementById('contact-modal');
document.getElementById('contact-btn').addEventListener('click', () => {
  contactModal.classList.add('visible');
  contactModal.removeAttribute('aria-hidden');
});
document.getElementById('contact-close').addEventListener('click', closeContact);
document.getElementById('contact-backdrop').addEventListener('click', closeContact);
function closeContact() {
  contactModal.classList.remove('visible');
  contactModal.setAttribute('aria-hidden', 'true');
}
