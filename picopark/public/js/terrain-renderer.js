/**
 * terrain-renderer.js
 * -----------------------------------------------------------------------
 * Drop-in Canvas2D renderer that replaces flat gray platform rectangles
 * with seamless, varied ground/mountain terrain — for ALL 100 levels.
 *
 * THEME STRATEGY
 * Each level gets ONE primary biome, assigned by a "world" grouping so
 * the game feels like it progresses through distinct zones. With
 * WORLD_SIZE = 10 and 10 biomes defined, every block of 10 levels gets
 * its own fully distinct look:
 *   Level    1–10  -> grass     (green plains)
 *   Level   11–20  -> forest    (deep woodland floor)
 *   Level   21–30  -> desert    (sand / dunes)
 *   Level   31–40  -> canyon    (red sandstone)
 *   Level   41–50  -> rock      (gray mountains)
 *   Level   51–60  -> swamp     (murky bog)
 *   Level   61–70  -> snow      (white peaks)
 *   Level   71–80  -> tundra    (blue ice)
 *   Level   81–90  -> volcanic  (red-black)
 *   Level   91–100 -> void      (final stretch, cosmic purple-black)
 * Within a single level, platforms don't switch biome — they only get
 * subtle shade variation (base/alt) so it stays cohesive, while the
 * ground silhouette is still one continuous curve so every platform
 * boundary lines up with its neighbor. Change WORLD_SIZE or BIOME_ORDER
 * below if you want a different grouping.
 *
 * HOW TO USE
 *   import { buildTerrain, drawTerrain } from './terrain-renderer.js';
 *   // once per level load (works for any level object from levels.json):
 *   const terrain = buildTerrain(level);
 *   // every frame, replace your old gray-rect platform loop with:
 *   ctx.save();
 *   ctx.translate(-cameraX, 0);
 *   drawTerrain(ctx, terrain, cameraX, canvas.width);
 *   ctx.restore();
 *
 * Zero images required -- everything is procedural, so it costs nothing
 * extra to load and scales from Level 1 (2492px) to Level 100 (8652px).
 * -----------------------------------------------------------------------
 */

// ---------------------------------------------------------------------
// 1. BIOME DEFINITIONS
// ---------------------------------------------------------------------
// Each biome has a "base" and "alt" shade so adjacent platforms inside
// the same biome still read as slightly different rather than one flat
// color block.

const BIOMES = {
  grass: {
    base: { top: '#6b8f4e', topEdge: '#4f7238', body: '#8a6d4a', bodyDark: '#75593a' },
    alt:  { top: '#7ea15e', topEdge: '#5c8446', body: '#93764f', bodyDark: '#7d6242' },
    detail: 'tufts',
  },
  forest: {
    base: { top: '#3f6b3a', topEdge: '#2c4d29', body: '#5a4531', bodyDark: '#473627' },
    alt:  { top: '#4c7a45', topEdge: '#375c33', body: '#63503a', bodyDark: '#4f3f2d' },
    detail: 'tufts',
  },
  desert: {
    base: { top: '#c9a45c', topEdge: '#a9813f', body: '#b78f52', bodyDark: '#96733d' },
    alt:  { top: '#d4b06c', topEdge: '#b3904d', body: '#c39c5f', bodyDark: '#a17f47' },
    detail: 'pebbles',
  },
  canyon: {
    base: { top: '#b1552f', topEdge: '#8c3f20', body: '#8f4530', bodyDark: '#733523' },
    alt:  { top: '#c1653c', topEdge: '#9c4b28', body: '#9c5138', bodyDark: '#7f3d29' },
    detail: 'cracks',
  },
  rock: {
    base: { top: '#8a8f96', topEdge: '#6b7280', body: '#6b7280', bodyDark: '#565c66' },
    alt:  { top: '#9a9fa6', topEdge: '#7b828c', body: '#7b828c', bodyDark: '#656c76' },
    detail: 'cracks',
  },
  swamp: {
    base: { top: '#5c6b3a', topEdge: '#414c29', body: '#4a4530', bodyDark: '#38341f' },
    alt:  { top: '#6a7a44', topEdge: '#4d5a30', body: '#544f38', bodyDark: '#413d26' },
    detail: 'pebbles',
  },
  snow: {
    base: { top: '#e7edf2', topEdge: '#b9c6d1', body: '#8a8f96', bodyDark: '#6b7280' },
    alt:  { top: '#f2f6f9', topEdge: '#c9d4dd', body: '#9aa0a8', bodyDark: '#7b828c' },
    detail: 'cracks',
  },
  tundra: {
    base: { top: '#cfe7f2', topEdge: '#9dc3d9', body: '#5f7d8c', bodyDark: '#4b6470' },
    alt:  { top: '#ddf0f8', topEdge: '#aed2e6', body: '#6c8c9c', bodyDark: '#57727e' },
    detail: 'cracks',
  },
  volcanic: {
    base: { top: '#7a2e21', topEdge: '#571e15', body: '#3d3230', bodyDark: '#2b231f' },
    alt:  { top: '#8f3a25', topEdge: '#6b281a', body: '#4a3d3a', bodyDark: '#362d29' },
    detail: 'cracks',
  },
  void: {
    base: { top: '#4b2e73', topEdge: '#331f52', body: '#241a33', bodyDark: '#181225' },
    alt:  { top: '#5c3a89', topEdge: '#402963', body: '#2d2140', bodyDark: '#20182e' },
    detail: 'cracks',
  },
};

const BIOME_ORDER = [
  'grass', 'forest', 'desert', 'canyon', 'rock',
  'swamp', 'snow', 'tundra', 'volcanic', 'void',
];
const WORLD_SIZE = 10; // levels per biome -- 10 biomes x 10 levels = 100

export function biomeForLevel(levelId) {
  const idx = Math.min(
    BIOME_ORDER.length - 1,
    Math.floor((levelId - 1) / WORLD_SIZE)
  );
  return BIOME_ORDER[idx];
}

// ---------------------------------------------------------------------
// 2. CONTINUOUS GROUND-LINE NOISE
// ---------------------------------------------------------------------
// Cheap smooth pseudo-noise (sum of sine waves) so the top surface
// undulates naturally. Deterministic per level via `seed`, so the same
// level always renders the same terrain shape.

function ridgeOffset(worldX, seed) {
  const s = seed * 0.0173;
  return (
    Math.sin(worldX * 0.006 + s) * 10 +
    Math.sin(worldX * 0.017 + s * 2.1) * 5 +
    Math.sin(worldX * 0.041 + s * 3.7) * 2.5
  );
}

// Extra amplitude for jagged peaks -- used for rugged/mountainous biomes.
function peakOffset(worldX, seed) {
  const s = seed * 0.0091;
  return Math.max(0, Math.sin(worldX * 0.004 + s) * 34 - 10);
}

function usesPeaks(biomeName) {
  return (
    biomeName === 'rock' ||
    biomeName === 'snow' ||
    biomeName === 'tundra' ||
    biomeName === 'volcanic' ||
    biomeName === 'canyon' ||
    biomeName === 'void'
  );
}

// ---------------------------------------------------------------------
// 3. COLOR HELPERS (base/alt shade alternation within one biome)
// ---------------------------------------------------------------------

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function lerpColor(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r},${g},${bl})`;
}

// Smoothly blends base -> alt -> base as x increases, purely for subtle
// platform-to-platform variety inside a single biome (no hard theme switch).
function shadeAt(worldX, biomeName, key, seed) {
  const biome = BIOMES[biomeName];
  const wobble = (Math.sin(worldX * 0.0021 + seed * 0.5) + 1) / 2; // 0..1
  return lerpColor(biome.base[key], biome.alt[key], wobble);
}

// ---------------------------------------------------------------------
// 4. BUILD TERRAIN DATA FROM A LEVEL OBJECT
// ---------------------------------------------------------------------

export function buildTerrain(level) {
  const seed = level.id || 1;
  const biomeName = biomeForLevel(seed);
  const platforms = level.platforms.map((p) => ({
    ...p,
    decorations: buildDecorations(p, seed),
  }));
  return { seed, biomeName, platforms, width: level.width };
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildDecorations(platform, seed) {
  const rand = mulberry32(Math.floor(platform.x * 7 + platform.y * 13 + seed));
  const count = Math.max(2, Math.round(platform.w / 90));
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push({
      x: platform.x + rand() * platform.w,
      y: platform.y + 25 + rand() * (platform.h - 45),
      r: 4 + rand() * 6,
    });
  }
  return items;
}

// ---------------------------------------------------------------------
// 5. DRAW
// ---------------------------------------------------------------------

export function drawTerrain(ctx, terrain, cameraX = 0, viewW = 1920) {
  const margin = 60;
  const visibleLeft = cameraX - margin;
  const visibleRight = cameraX + viewW + margin;

  for (const p of terrain.platforms) {
    if (p.x + p.w < visibleLeft || p.x > visibleRight) continue;
    drawPlatform(ctx, p, terrain.seed, terrain.biomeName);
  }
}

const STEP = 6; // px resolution of the top ridge line

function drawPlatform(ctx, p, seed, biomeName) {
  const isTall = p.h > 250; // vertical shafts render as sheer rock face, no grass cap
  const peaked = usesPeaks(biomeName);
  const points = [];

  // IMPORTANT: ridge is clamped to <= 0 (never dips below the flat
  // collision line at p.y). Collision (this.platforms in engine.js)
  // stays a flat rectangle at p.y -- it is NOT changed. If the visual
  // ridge were allowed to dip below p.y, the ground would visually sink
  // away from a standing player's feet at that x, making them look like
  // they're floating over a gap even though they're still solidly on
  // the (invisible, flat) collision surface. Clamping to <= 0 means the
  // grass/rock skin only ever bulges UP into small hills, or sits
  // exactly at the collision line -- so a player's feet always touch or
  // sink slightly into visible ground, never hover above empty space.
  for (let x = p.x; x <= p.x + p.w; x += STEP) {
    const ridge = Math.min(0, ridgeOffset(x, seed));
    const peak = peaked ? peakOffset(x, seed) : 0;
    points.push({ x, y: p.y + ridge - peak });
  }
  const lastRidge = Math.min(0, ridgeOffset(p.x + p.w, seed));
  points.push({ x: p.x + p.w, y: p.y + lastRidge });

  // --- body fill ---
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const pt of points) ctx.lineTo(pt.x, pt.y);
  ctx.lineTo(p.x + p.w, p.y + p.h);
  ctx.lineTo(p.x, p.y + p.h);
  ctx.closePath();
  ctx.fillStyle = shadeAt(p.x + p.w / 2, biomeName, isTall ? 'bodyDark' : 'body', seed);
  ctx.fill();

  if (!isTall) {
    // --- flat baseline strip exactly at the collision line (p.y) ---
    // Even with the ridge clamp above, this makes doubly sure there is
    // always solid-looking ground drawn right at the height a standing
    // player's feet sit at -- no reliance on the curve alone.
    ctx.fillStyle = shadeAt(p.x + p.w / 2, biomeName, 'top', seed);
    ctx.fillRect(p.x, p.y - 2, p.w, 6);

    // --- thin cap layer (grass/snow/sand/ash skin) ---
    const capH = 16;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const pt of points) ctx.lineTo(pt.x, pt.y);
    for (let i = points.length - 1; i >= 0; i--) {
      ctx.lineTo(points[i].x, points[i].y + capH);
    }
    ctx.closePath();
    ctx.fillStyle = shadeAt(p.x + p.w / 2, biomeName, 'top', seed);
    ctx.fill();

    // --- ridge outline ---
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const pt of points) ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = shadeAt(p.x + p.w / 2, biomeName, 'topEdge', seed);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawDecorations(ctx, p, seed, biomeName);
}

function drawDecorations(ctx, p, seed, biomeName) {
  const detail = BIOMES[biomeName].detail;
  ctx.fillStyle = shadeAt(p.x + p.w / 2, biomeName, 'bodyDark', seed);
  for (const d of p.decorations) {
    if (d.y > p.y + p.h - 10) continue;
    if (detail === 'tufts') drawTuft(ctx, d.x, d.y, d.r);
    else if (detail === 'pebbles') {
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * 0.6, 0, Math.PI * 2);
      ctx.fill();
    } else drawCrack(ctx, d.x, d.y, d.r);
  }
}

function drawTuft(ctx, x, y, r) {
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = 1.5;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * 3, y);
    ctx.lineTo(x + i * 3 + i * 2, y - r);
    ctx.stroke();
  }
}

function drawCrack(ctx, x, y, r) {
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x, y + r * 0.6);
  ctx.lineTo(x + r * 0.4, y - r * 0.3);
  ctx.lineTo(x + r, y + r * 0.4);
  ctx.stroke();
}

// ---------------------------------------------------------------------
// 6. INTEGRATION NOTE
// ---------------------------------------------------------------------
// This file needs nothing from your levels.json except `id`, `width`,
// and `platforms` -- so it works unchanged for every one of your 100
// levels the moment you call buildTerrain(level) with whichever level
// object is currently loaded. No per-level setup needed.
//
// If your old code was:
//   for (const p of level.platforms) {
//     ctx.fillStyle = '#4b5563';
//     ctx.fillRect(p.x - cameraX, p.y, p.w, p.h);
//   }
// replace the WHOLE loop with:
//   const terrain = buildTerrain(level); // once, on level load
//   ...
//   ctx.save();
//   ctx.translate(-cameraX, 0);
//   drawTerrain(ctx, terrain, cameraX, canvas.width);
//   ctx.restore();
