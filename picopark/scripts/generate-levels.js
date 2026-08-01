/**
 * Generator 100 level co-op puzzle (gaya Pico Park) dari template segmen acak.
 * Deterministik: level N selalu menghasilkan layout yang sama (seeded by N),
 * tapi tiap level unik karena kombinasi & urutan segmen berbeda.
 *
 * Cara pakai: node scripts/generate-levels.js
 * Output: public/js/levels.json
 */

const fs = require("fs");
const path = require("path");

// ---------- Seeded RNG (mulberry32) supaya hasil reproducible per level ----------
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// ---------- Konstanta layout ----------
const GROUND_Y = 520; // y atas lantai
const FLOOR_THICK = 120;
const GAP_MIN = 90;
const GAP_MAX = 150;
const PLATFORM_H = 20;

let doorIdCounter = 0;
let plateIdCounter = 0;
let keyIdCounter = 0;
function nextId(prefix, counter) {
  return `${prefix}_${counter}`;
}

// ============================================================
// SEGMENT TEMPLATES
// Tiap segmen: menerima startX, mengembalikan { width, platforms, boxes,
// plates, doors, keys, movingPlatforms } dengan koordinat absolut.
// Semua segmen dijamin bisa dilewati (solvable by construction) karena
// selalu menyediakan cukup box/mekanisme untuk menutup gap yang dibuat.
// ============================================================

function segFlat(startX, rng, widthOverride) {
  const width = widthOverride || 260 + Math.floor(rng() * 160);
  return {
    width,
    platforms: [{ x: startX, y: GROUND_Y, w: width, h: FLOOR_THICK }],
    boxes: [], plates: [], doors: [], keys: [], movingPlatforms: [],
  };
}

// Jurang biasa (butuh lompat pas-pasan, tanpa mekanisme). Dipakai level awal.
function segGap(startX, rng) {
  const preW = 160 + Math.floor(rng() * 60);
  const gap = GAP_MIN + Math.floor(rng() * (GAP_MAX - GAP_MIN));
  const postW = 200 + Math.floor(rng() * 100);
  return {
    width: preW + gap + postW,
    platforms: [
      { x: startX, y: GROUND_Y, w: preW, h: FLOOR_THICK },
      { x: startX + preW + gap, y: GROUND_Y, w: postW, h: FLOOR_THICK },
    ],
    boxes: [], plates: [], doors: [], keys: [], movingPlatforms: [],
  };
}

// Pijakan tinggi yang butuh box ditumpuk buat naik (kerja sama dorong box).
function segBoxClimb(startX, rng) {
  const preW = 180;
  const ledgeH = 130 + Math.floor(rng() * 40); // lebih tinggi dari lompatan biasa
  const ledgeW = 220 + Math.floor(rng() * 100);
  const width = preW + 40 + ledgeW;
  return {
    width,
    platforms: [
      { x: startX, y: GROUND_Y, w: preW, h: FLOOR_THICK },
      { x: startX + preW + 40, y: GROUND_Y - ledgeH, w: ledgeW, h: PLATFORM_H },
      { x: startX + preW + 40, y: GROUND_Y - ledgeH, w: ledgeW, h: ledgeH + FLOOR_THICK }, // dinding penuh di bawah ledge (biar box bisa ditumpuk di depan dinding)
    ],
    boxes: [
      { x: startX + preW + 20, y: GROUND_Y - 40 },
      { x: startX + preW + 60, y: GROUND_Y - 40 },
    ],
    plates: [], doors: [], keys: [], movingPlatforms: [],
  };
}

// Pintu yang terbuka selama plate ditekan. Disediakan box supaya bisa jadi
// pemberat permanen sehingga kedua pemain bisa lewat bersamaan.
function segPlateDoor(startX, rng) {
  const plateId = nextId("plate", plateIdCounter++);
  const doorId = nextId("door", doorIdCounter++);

  const zone1 = 200;
  const plateW = 60;
  const corridor = 40;
  const doorW = 50;
  const zone2 = 220;
  const width = zone1 + plateW + corridor + doorW + zone2;

  return {
    width,
    platforms: [{ x: startX, y: GROUND_Y, w: width, h: FLOOR_THICK }],
    boxes: [{ x: startX + 60, y: GROUND_Y - 40 }],
    plates: [{ x: startX + zone1, y: GROUND_Y - 12, w: plateW, h: 12, id: plateId }],
    doors: [{ x: startX + zone1 + plateW + corridor, y: GROUND_Y - 100, w: doorW, h: 100, id: doorId, plateIds: [plateId] }],
    keys: [], movingPlatforms: [],
  };
}

// Dua plate harus ditekan BERSAMAAN untuk buka satu pintu bersama - inti kerja
// sama 2 pemain. Disediakan 2 box (satu per plate) supaya tetap solvable
// walau salah satu pemain "terpaksa" pergi duluan.
function segDualPlateDoor(startX, rng) {
  const plateA = nextId("plate", plateIdCounter++);
  const plateB = nextId("plate", plateIdCounter++);
  const doorId = nextId("door", doorIdCounter++);

  const zone1 = 160;
  const plateW = 60;
  const gapBetween = 90;
  const corridor = 40;
  const doorW = 60;
  const zone2 = 220;
  const width = zone1 + plateW + gapBetween + plateW + corridor + doorW + zone2;

  const plateAx = startX + zone1;
  const plateBx = plateAx + plateW + gapBetween;

  return {
    width,
    platforms: [{ x: startX, y: GROUND_Y, w: width, h: FLOOR_THICK }],
    boxes: [
      { x: startX + 40, y: GROUND_Y - 40 },
      { x: startX + 90, y: GROUND_Y - 40 },
    ],
    plates: [
      { x: plateAx, y: GROUND_Y - 12, w: plateW, h: 12, id: plateA },
      { x: plateBx, y: GROUND_Y - 12, w: plateW, h: 12, id: plateB },
    ],
    doors: [
      {
        x: plateBx + plateW + corridor, y: GROUND_Y - 100, w: doorW, h: 100,
        id: doorId, plateIds: [plateA, plateB],
      },
    ],
    keys: [], movingPlatforms: [],
  };
}

// Kunci di atas ledge kecil (perlu box atau lompat) buat buka pintu di depan.
function segKeyDoor(startX, rng) {
  const keyId = nextId("key", keyIdCounter++);
  const doorId = nextId("door", doorIdCounter++);

  const zone1 = 180;
  const doorW = 60;
  const zone2 = 220;
  const width = zone1 + doorW + zone2;
  const keyLedgeH = 90 + Math.floor(rng() * 30);

  return {
    width,
    platforms: [
      { x: startX, y: GROUND_Y, w: width, h: FLOOR_THICK },
      { x: startX + 60, y: GROUND_Y - keyLedgeH, w: 90, h: PLATFORM_H },
    ],
    boxes: [{ x: startX + 100, y: GROUND_Y - 40 }],
    plates: [], keys: [{ x: startX + 90, y: GROUND_Y - keyLedgeH - 30, id: keyId, doorId }],
    doors: [{ x: startX + zone1, y: GROUND_Y - 100, w: doorW, h: 100, id: doorId, plateIds: [] }],
    movingPlatforms: [],
  };
}

// Platform goyang horizontal buat nyebrang jurang lebar, timing-based.
function segMovingPlatform(startX, rng) {
  const preW = 160;
  const gap = 320 + Math.floor(rng() * 120);
  const postW = 200;
  const width = preW + gap + postW;
  const platW = 90;
  const range = gap - platW - 20;

  return {
    width,
    platforms: [
      { x: startX, y: GROUND_Y, w: preW, h: FLOOR_THICK },
      { x: startX + preW + gap, y: GROUND_Y, w: postW, h: FLOOR_THICK },
    ],
    boxes: [], plates: [], doors: [], keys: [],
    movingPlatforms: [
      {
        x: startX + preW + 10, y: GROUND_Y - 20, w: platW, h: 20,
        axis: "x", range: Math.max(range, 60), speed: 60 + rng() * 30,
      },
    ],
  };
}

// Kombinasi berat: plate ganda + moving platform, dipakai level akhir.
function segHardCombo(startX, rng) {
  const dual = segDualPlateDoor(startX, rng);
  const afterX = startX + dual.width;
  const moving = segMovingPlatform(afterX, rng);
  return {
    width: dual.width + moving.width,
    platforms: [...dual.platforms, ...moving.platforms],
    boxes: [...dual.boxes, ...moving.boxes],
    plates: [...dual.plates, ...moving.plates],
    doors: [...dual.doors, ...moving.doors],
    keys: [...dual.keys, ...moving.keys],
    movingPlatforms: [...dual.movingPlatforms, ...moving.movingPlatforms],
  };
}

// ============================================================
// SEGMENT POOLS PER TIER (makin tinggi level, makin banyak variasi & panjang)
// ============================================================
const TIERS = [
  { maxLevel: 10, pool: [segFlat, segGap], segCount: [3, 4] },
  { maxLevel: 25, pool: [segFlat, segGap, segPlateDoor, segBoxClimb], segCount: [4, 5] },
  { maxLevel: 40, pool: [segGap, segPlateDoor, segBoxClimb, segDualPlateDoor], segCount: [5, 6] },
  { maxLevel: 55, pool: [segPlateDoor, segKeyDoor, segBoxClimb, segDualPlateDoor], segCount: [5, 7] },
  { maxLevel: 70, pool: [segDualPlateDoor, segKeyDoor, segMovingPlatform, segBoxClimb], segCount: [6, 7] },
  { maxLevel: 85, pool: [segDualPlateDoor, segMovingPlatform, segKeyDoor, segHardCombo], segCount: [6, 8] },
  { maxLevel: 100, pool: [segHardCombo, segMovingPlatform, segDualPlateDoor, segKeyDoor], segCount: [7, 9] },
];

function tierFor(level) {
  return TIERS.find((t) => level <= t.maxLevel);
}

function generateLevel(levelNum) {
  const rng = mulberry32(levelNum * 7919 + 13);
  const tier = tierFor(levelNum);
  const [minSeg, maxSeg] = tier.segCount;
  const segCount = minSeg + Math.floor(rng() * (maxSeg - minSeg + 1));

  let x = 0;
  const platforms = [];
  const boxes = [];
  const plates = [];
  const doors = [];
  const keys = [];
  const movingPlatforms = [];

  // Segmen spawn awal (selalu datar & lega)
  const spawnSeg = segFlat(x, rng, 320);
  platforms.push(...spawnSeg.platforms);
  x += spawnSeg.width;
  const spawn = { p1: { x: x - 280, y: GROUND_Y - 60 }, p2: { x: x - 220, y: GROUND_Y - 60 } };

  for (let i = 0; i < segCount; i++) {
    const builder = pick(rng, tier.pool);
    const seg = builder(x, rng);
    platforms.push(...seg.platforms);
    boxes.push(...seg.boxes);
    plates.push(...seg.plates);
    doors.push(...seg.doors);
    keys.push(...seg.keys);
    movingPlatforms.push(...seg.movingPlatforms);
    x += seg.width;
  }

  // Segmen akhir + goal
  const endSeg = segFlat(x, rng, 300);
  platforms.push(...endSeg.platforms);
  x += endSeg.width;
  const goal = { x: x - 140, y: GROUND_Y - 90, w: 60, h: 90 };

  return {
    id: levelNum,
    name: `Level ${levelNum}`,
    width: x,
    height: 600,
    spawn,
    goal,
    platforms,
    boxes,
    plates,
    doors,
    keys,
    movingPlatforms,
  };
}

// ---------- Generate semua 100 level ----------
const levels = [];
for (let n = 1; n <= 100; n++) {
  levels.push(generateLevel(n));
}

const outDir = path.join(__dirname, "..", "public", "js");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "levels.json"), JSON.stringify(levels));

console.log(`Berhasil generate ${levels.length} level -> public/js/levels.json`);
console.log(`Ukuran file: ${(fs.statSync(path.join(outDir, "levels.json")).size / 1024).toFixed(1)} KB`);
