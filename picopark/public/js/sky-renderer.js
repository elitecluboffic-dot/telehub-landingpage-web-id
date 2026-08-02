/**
 * sky-renderer.js
 * -----------------------------------------------------------------------
 * Drop-in Canvas2D background renderer that replaces a flat white/plain
 * canvas background with a soft gradient sky (+ sun/moon/stars + drifting
 * clouds) that matches the biome of the current level.
 *
 * Designed as a companion to terrain-renderer.js -- it uses the exact
 * same 10-biome / WORLD_SIZE=10 grouping so the sky and the ground
 * always agree on which "world" you're in:
 *   Level    1–10  -> grass     (clear blue day sky)
 *   Level   11–20  -> forest    (deep green-teal canopy sky)
 *   Level   21–30  -> desert    (warm orange/sand haze)
 *   Level   31–40  -> canyon    (dusty dusk orange-red)
 *   Level   41–50  -> rock      (cool grey-blue mountain sky)
 *   Level   51–60  -> swamp     (murky yellow-green fog)
 *   Level   61–70  -> snow      (pale icy blue-white)
 *   Level   71–80  -> tundra    (cold deep blue)
 *   Level   81–90  -> volcanic  (dark smoky red sky)
 *   Level   91–100 -> void      (night, purple-black, starfield)
 *
 * HOW TO USE
 *   import { buildSky, drawSky } from './sky-renderer.js';
 *   // once per level load:
 *   const sky = buildSky(level);
 *   // every frame, BEFORE you draw terrain/players/etc (and BEFORE any
 *   // ctx.translate(-cameraX, 0) you use for world-space drawing --
 *   // the sky is drawn in plain screen space, not world space):
 *   drawSky(ctx, sky, canvas.width, canvas.height, performance.now());
 *   // ... then your existing terrain / entities draw calls follow.
 *
 * If your current code does something like:
 *   ctx.fillStyle = '#ffffff';
 *   ctx.fillRect(0, 0, canvas.width, canvas.height);
 * just delete those two lines and call drawSky(...) in their place.
 * -----------------------------------------------------------------------
 */

// ---------------------------------------------------------------------
// 1. SKY DEFINITIONS (must stay in sync with terrain-renderer.js biomes)
// ---------------------------------------------------------------------

const SKIES = {
  grass: {
    gradient: ['#8fd3f4', '#e8f8ff'],
    sun: { color: '#fff6c8', glow: '#fff2a8', type: 'sun' },
    cloudColor: 'rgba(255,255,255,0.85)',
    starCount: 0,
  },
  forest: {
    gradient: ['#4d8f7b', '#bfe6d6'],
    sun: { color: '#fdf3b0', glow: '#e9f7c9', type: 'sun' },
    cloudColor: 'rgba(230,255,240,0.55)',
    starCount: 0,
  },
  desert: {
    gradient: ['#f2a65a', '#ffe8c2'],
    sun: { color: '#fff2d0', glow: '#ffdca0', type: 'sun' },
    cloudColor: 'rgba(255,240,220,0.5)',
    starCount: 0,
  },
  canyon: {
    gradient: ['#d1592f', '#f4b183'],
    sun: { color: '#ffe3b0', glow: '#ff9d5c', type: 'sun' },
    cloudColor: 'rgba(255,220,190,0.45)',
    starCount: 0,
  },
  rock: {
    gradient: ['#5c6b7a', '#a9b9c6'],
    sun: { color: '#eef3f7', glow: '#cfd9e2', type: 'sun' },
    cloudColor: 'rgba(255,255,255,0.4)',
    starCount: 0,
  },
  swamp: {
    gradient: ['#5e6b3f', '#a3ab72'],
    sun: { color: '#e9e6a8', glow: '#c7c98a', type: 'sun' },
    cloudColor: 'rgba(210,215,170,0.4)',
    starCount: 0,
  },
  snow: {
    gradient: ['#a9c9e0', '#f2f8fc'],
    sun: { color: '#ffffff', glow: '#e3f0fb', type: 'sun' },
    cloudColor: 'rgba(255,255,255,0.7)',
    starCount: 0,
  },
  tundra: {
    gradient: ['#274b6b', '#7fb2d4'],
    sun: { color: '#eaf6ff', glow: '#bfe3f7', type: 'moon' },
    cloudColor: 'rgba(220,240,255,0.35)',
    starCount: 40,
  },
  volcanic: {
    gradient: ['#2b1210', '#7a2e21'],
    sun: { color: '#ffb060', glow: '#ff5a2e', type: 'sun' },
    cloudColor: 'rgba(60,30,25,0.4)',
    starCount: 0,
  },
  void: {
    gradient: ['#0c0716', '#2e1a4d'],
    sun: { color: '#e8e4ff', glow: '#8a6fd8', type: 'moon' },
    cloudColor: 'rgba(120,100,180,0.25)',
    starCount: 120,
  },
};

const BIOME_ORDER = [
  'grass', 'forest', 'desert', 'canyon', 'rock',
  'swamp', 'snow', 'tundra', 'volcanic', 'void',
];
const WORLD_SIZE = 10; // keep identical to terrain-renderer.js

export function skyBiomeForLevel(levelId) {
  const idx = Math.min(
    BIOME_ORDER.length - 1,
    Math.floor((levelId - 1) / WORLD_SIZE)
  );
  return BIOME_ORDER[idx];
}

// ---------------------------------------------------------------------
// 2. DETERMINISTIC RANDOM (same approach as terrain-renderer.js)
// ---------------------------------------------------------------------

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------
// 3. BUILD SKY DATA FROM A LEVEL OBJECT
// ---------------------------------------------------------------------
// Clouds and stars are generated once in *normalized* 0..1 space so they
// scale cleanly to any canvas size, and are deterministic per level id
// (same level always looks the same).

export function buildSky(level) {
  const seed = level.id || 1;
  const biomeName = skyBiomeForLevel(seed);
  const config = SKIES[biomeName];
  const rand = mulberry32(seed * 9973 + 17);

  const cloudCount = 5 + Math.floor(rand() * 3);
  const clouds = [];
  for (let i = 0; i < cloudCount; i++) {
    clouds.push({
      nx: rand(),                       // normalized x (0..1), wraps
      ny: 0.08 + rand() * 0.42,         // stay in upper half of sky
      scale: 0.6 + rand() * 1.1,
      speed: 4 + rand() * 10,           // px/sec drift, world feel
      seedOffset: rand() * 1000,
    });
  }

  const stars = [];
  for (let i = 0; i < config.starCount; i++) {
    stars.push({
      nx: rand(),
      ny: rand() * 0.65,
      r: 0.6 + rand() * 1.6,
      twinkleSeed: rand() * Math.PI * 2,
    });
  }

  return {
    seed,
    biomeName,
    config,
    clouds,
    stars,
    sunNx: 0.12 + rand() * 0.14, // sun/moon sits near upper-left, subtle per-level variance
    sunNy: 0.14 + rand() * 0.08,
  };
}

// ---------------------------------------------------------------------
// 4. DRAW
// ---------------------------------------------------------------------
// Pure screen-space draw -- call this BEFORE any ctx.translate(-cameraX)
// you use for world-space layers, so the sky stays fixed to the viewport
// (parallax handled separately for clouds below).

export function drawSky(ctx, sky, viewW, viewH, timeMs = 0, cameraX = 0) {
  const { config, clouds, stars } = sky;

  // --- gradient backdrop ---
  const grad = ctx.createLinearGradient(0, 0, 0, viewH);
  grad.addColorStop(0, config.gradient[0]);
  grad.addColorStop(1, config.gradient[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, viewW, viewH);

  // --- stars (only present in dark biomes; twinkle via sine) ---
  if (stars.length) {
    for (const s of stars) {
      const twinkle = 0.5 + 0.5 * Math.sin(timeMs * 0.002 + s.twinkleSeed);
      ctx.globalAlpha = 0.35 + twinkle * 0.65;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.nx * viewW, s.ny * viewH, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // --- sun / moon with soft glow ---
  drawSunOrMoon(ctx, sky, viewW, viewH);

  // --- drifting clouds, gentle parallax against camera ---
  const t = timeMs * 0.001;
  ctx.fillStyle = config.cloudColor;
  for (const c of clouds) {
    const driftPx = t * c.speed;
    const parallax = cameraX * 0.05; // clouds move slower than world
    let x = ((c.nx * viewW + driftPx - parallax) % (viewW + 200)) - 100;
    if (x < -200) x += viewW + 200;
    const y = c.ny * viewH;
    drawCloudPuff(ctx, x, y, 42 * c.scale);
  }
}

function drawSunOrMoon(ctx, sky, viewW, viewH) {
  const { config, sunNx, sunNy } = sky;
  const cx = sunNx * viewW;
  const cy = sunNy * viewH;
  const r = Math.min(viewW, viewH) * 0.045;

  // soft glow halo
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 4);
  glow.addColorStop(0, config.sun.glow);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 4, 0, Math.PI * 2);
  ctx.fill();

  // disc
  ctx.fillStyle = config.sun.color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  if (config.sun.type === 'moon') {
    // carve a crescent by subtracting an offset circle in the bg gradient tone
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(cx + r * 0.55, cy - r * 0.25, r * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawCloudPuff(ctx, x, y, size) {
  ctx.beginPath();
  ctx.ellipse(x, y, size, size * 0.55, 0, 0, Math.PI * 2);
  ctx.ellipse(x + size * 0.6, y + size * 0.08, size * 0.65, size * 0.4, 0, 0, Math.PI * 2);
  ctx.ellipse(x - size * 0.55, y + size * 0.1, size * 0.55, size * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------
// 5. INTEGRATION NOTE
// ---------------------------------------------------------------------
// Typical per-frame draw order becomes:
//
//   const sky = buildSky(level);        // once, on level load
//   ...
//   function renderFrame(timeMs) {
//     drawSky(ctx, sky, canvas.width, canvas.height, timeMs, cameraX);
//
//     ctx.save();
//     ctx.translate(-cameraX, 0);
//     drawTerrain(ctx, terrain, cameraX, canvas.width); // from terrain-renderer.js
//     // ...draw boxes, plates, doors, keys, players, moving platforms...
//     ctx.restore();
//   }
//
// If your canvas element or its CSS currently sets a white background
// (e.g. `canvas { background: #fff; }` or `background-color: white` on
// the wrapping div), remove that too -- otherwise it'll show through on
// any frame where drawSky hasn't painted yet (e.g. very first paint).
