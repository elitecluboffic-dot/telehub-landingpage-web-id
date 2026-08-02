// ============================================================
// Engine fisika + rendering sederhana buat game co-op 2 pemain.
// Semua unit dalam pixel "logical" (canvas di-scale otomatis).
// Karakter player digambar sebagai dino couple (bukan kotak lagi).
//
// FIX (scale-to-fit-height): sebelumnya render() menggambar dunia
// game 1:1 piksel tanpa scaling sama sekali. Karena tinggi dunia
// level (height, biasanya 600) jauh lebih pendek dari tinggi canvas
// asli di HP (viewH bisa 600-1000+ px), area tanah/karakter cuma
// nongol sebagai sliver tipis di bagian bawah canvas, sisanya kosong.
// Sekarang render() menerima camera.scale (dihitung di game.js
// sebagai viewH / level.height) supaya seluruh tinggi dunia selalu
// pas mengisi tinggi canvas, baru di-pan horizontal seperti biasa.
// ============================================================

const GRAVITY = 1400; // px/s^2
const MOVE_SPEED = 220; // px/s
const JUMP_VELOCITY = -560; // px/s
const PLAYER_W = 30;
const PLAYER_H = 44;
const BOX_SIZE = 40;
const PIT_Y = 900; // jatuh di bawah ini = respawn

function aabbOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

class Entity {
  constructor(x, y, w, h) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.vx = 0; this.vy = 0;
    this.onGround = false;
  }
  get rect() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
}

class Player extends Entity {
  constructor(x, y, color, bellyColor, label) {
    super(x, y, PLAYER_W, PLAYER_H);
    this.color = color;
    this.bellyColor = bellyColor;
    this.label = label;
    this.facing = 1;
    this.spawnX = x; this.spawnY = y;
    this.walkCycle = 0; // buat animasi kaki jalan ringan
  }
}

class Box extends Entity {
  constructor(x, y) {
    super(x, y, BOX_SIZE, BOX_SIZE);
  }
}

class MovingPlatform extends Entity {
  constructor(def) {
    super(def.x, def.y, def.w, def.h);
    this.axis = def.axis || "x";
    this.range = def.range;
    this.speed = def.speed;
    this.origin = { x: def.x, y: def.y };
    this.t = 0;
    this.prevX = def.x; this.prevY = def.y;
  }
  update(dt) {
    this.prevX = this.x; this.prevY = this.y;
    this.t += dt;
    const offset = (Math.sin(this.t * (this.speed / 100)) + 1) / 2 * this.range;
    if (this.axis === "x") this.x = this.origin.x + offset;
    else this.y = this.origin.y + offset;
  }
  get dx() { return this.x - this.prevX; }
  get dy() { return this.y - this.prevY; }
}

export class GameLevel {
  constructor(levelDef) {
    this.def = levelDef;
    this.width = levelDef.width;
    this.height = levelDef.height;

    this.platforms = levelDef.platforms.map((p) => ({ ...p }));
    this.boxes = levelDef.boxes.map((b) => new Box(b.x, b.y));
    this.movingPlatforms = levelDef.movingPlatforms.map((m) => new MovingPlatform(m));

    this.plateState = {}; // plateId -> weighted bool
    for (const p of levelDef.plates) this.plateState[p.id] = false;

    this.keysCollected = new Set();
    this.doorOpenOverride = new Set(); // doorId dibuka permanen kalau punya key match

    // P1 = dino biru, P2 = dino pink (masing-masing punya warna perut lebih terang)
    this.player1 = new Player(levelDef.spawn.p1.x, levelDef.spawn.p1.y, "#3aa0ff", "#bfe6ff", "P1");
    this.player2 = new Player(levelDef.spawn.p2.x, levelDef.spawn.p2.y, "#ff59a8", "#ffd3e6", "P2");

    this.completed = false;
    this.elapsedMs = 0;
  }

  isDoorOpen(door) {
    if (this.doorOpenOverride.has(door.id)) return true;
    if (!door.plateIds || door.plateIds.length === 0) return false;
    return door.plateIds.every((pid) => this.plateState[pid]);
  }

  solidRects() {
    // Platform statis + pintu tertutup + moving platform (moving platform ditangani terpisah krn bisa gendong player)
    const rects = [...this.platforms];
    for (const d of this.def.doors) {
      if (!this.isDoorOpen(d)) rects.push(d);
    }
    return rects;
  }

  update(dt, input) {
    if (this.completed) return;
    this.elapsedMs += dt * 1000;

    for (const mp of this.movingPlatforms) mp.update(dt);

    this.updatePlayer(this.player1, dt, input.p1);
    this.updatePlayer(this.player2, dt, input.p2);
    this.updateBoxes(dt);

    // Update plate state
    for (const plate of this.def.plates) {
      const zone = { x: plate.x, y: plate.y - 20, w: plate.w, h: plate.h + 20 };
      const weighted =
        aabbOverlap(this.player1.rect, zone) ||
        aabbOverlap(this.player2.rect, zone) ||
        this.boxes.some((b) => aabbOverlap(b.rect, zone));
      this.plateState[plate.id] = weighted;
    }

    // Key pickup
    for (const key of this.def.keys) {
      if (this.keysCollected.has(key.id)) continue;
      const zone = { x: key.x, y: key.y, w: 24, h: 24 };
      if (aabbOverlap(this.player1.rect, zone) || aabbOverlap(this.player2.rect, zone)) {
        this.keysCollected.add(key.id);
        this.doorOpenOverride.add(key.doorId);
      }
    }

    // Respawn kalau jatuh
    for (const p of [this.player1, this.player2]) {
      if (p.y > PIT_Y) {
        p.x = p.spawnX; p.y = p.spawnY; p.vx = 0; p.vy = 0;
      }
    }

    // Cek goal
    const goal = this.def.goal;
    if (aabbOverlap(this.player1.rect, goal) && aabbOverlap(this.player2.rect, goal)) {
      this.completed = true;
    }
  }

  updatePlayer(p, dt, keys) {
    p.vx = 0;
    if (keys.left) { p.vx = -MOVE_SPEED; p.facing = -1; }
    if (keys.right) { p.vx = MOVE_SPEED; p.facing = 1; }
    if (keys.jump && p.onGround) { p.vy = JUMP_VELOCITY; p.onGround = false; }

    // Update walk cycle buat animasi kaki (hanya jalan kalau nempel tanah & gerak)
    if (p.onGround && p.vx !== 0) {
      p.walkCycle += dt * 10;
    } else {
      p.walkCycle = 0;
    }

    p.vy += GRAVITY * dt;

    // Horizontal move + collision + dorong box
    let newX = p.x + p.vx * dt;
    const testRectX = { x: newX, y: p.y, w: p.w, h: p.h };
    let blockedX = false;
    for (const r of this.solidRects()) {
      if (aabbOverlap(testRectX, r)) { blockedX = true; break; }
    }
    if (!blockedX) {
      for (const box of this.boxes) {
        if (aabbOverlap(testRectX, box.rect)) {
          const pushDx = p.vx * dt;
          if (this.tryMoveBox(box, pushDx, 0)) {
            newX = p.x + pushDx;
          } else {
            newX = p.x;
          }
        }
      }
      p.x = newX;
    }
    // Clamp ke batas level
    p.x = Math.max(0, Math.min(p.x, this.width - p.w));

    // Vertical move + collision
    let newY = p.y + p.vy * dt;
    const testRectY = { x: p.x, y: newY, w: p.w, h: p.h };
    p.onGround = false;
    for (const r of this.solidRects()) {
      if (aabbOverlap(testRectY, r)) {
        if (p.vy > 0) { newY = r.y - p.h; p.onGround = true; }
        else { newY = r.y + r.h; }
        p.vy = 0;
        break;
      }
    }
    for (const box of this.boxes) {
      if (aabbOverlap(testRectY, box.rect)) {
        if (p.vy > 0) { newY = box.y - p.h; p.onGround = true; }
        else { newY = box.y + box.h; }
        p.vy = 0;
      }
    }
    for (const mp of this.movingPlatforms) {
      if (aabbOverlap(testRectY, mp.rect)) {
        if (p.vy > 0) { newY = mp.y - p.h; p.onGround = true; }
        else { newY = mp.y + mp.h; }
        p.vy = 0;
      }
    }
    p.y = newY;

    // Ikut kebawa moving platform kalau berdiri di atasnya
    for (const mp of this.movingPlatforms) {
      const feetZone = { x: p.x, y: p.y + p.h, w: p.w, h: 4 };
      if (aabbOverlap(feetZone, { x: mp.x, y: mp.y, w: mp.w, h: 4 })) {
        p.x += mp.dx;
        p.y += mp.dy;
      }
    }
  }

  tryMoveBox(box, dx, dy) {
    const testRect = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
    for (const r of this.solidRects()) {
      if (aabbOverlap(testRect, r)) return false;
    }
    for (const other of this.boxes) {
      if (other === box) continue;
      if (aabbOverlap(testRect, other.rect)) return false;
    }
    box.x += dx; box.y += dy;
    return true;
  }

  updateBoxes(dt) {
    for (const box of this.boxes) {
      box.vy = (box.vy || 0) + GRAVITY * dt;
      let dy = box.vy * dt;
      const testRect = { x: box.x, y: box.y + dy, w: box.w, h: box.h };
      let landed = false;
      for (const r of this.solidRects()) {
        if (aabbOverlap(testRect, r)) {
          dy = r.y - (box.y + box.h);
          box.vy = 0; landed = true; break;
        }
      }
      if (!landed) {
        for (const other of this.boxes) {
          if (other === box) continue;
          if (aabbOverlap(testRect, other.rect)) {
            dy = other.y - (box.y + box.h);
            box.vy = 0; landed = true; break;
          }
        }
      }
      box.y += dy;
    }
  }

  // ============================================================
  // render(ctx, camera)
  // camera = { x: <world-x kamera>, scale: <faktor zoom> }
  // scale WAJIB diisi dari game.js sebagai viewH / level.height,
  // supaya tinggi dunia level selalu pas mengisi tinggi canvas
  // (tidak ada lagi area kosong di atas / konten kegencet di bawah).
  // Kalau camera.scale tidak diisi, default 1 (perilaku lama).
  // ============================================================
  render(ctx, camera) {
    const scale = camera.scale || 1;

    // Clear pakai koordinat device-pixel murni (reset transform dulu)
    // supaya tidak salah kali dengan dpr transform yang sudah aktif
    // dari resizeCanvas() di game.js.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();

    ctx.save();
    // Urutan: pan horizontal dulu (dalam satuan world, makanya dikali
    // scale supaya konsisten dengan ctx.scale di bawah), baru zoom.
    ctx.translate(-camera.x * scale, 0);
    ctx.scale(scale, scale);

    // Background — dibuat jauh lebih besar dari area world manapun
    // supaya selalu menutupi seluruh viewport terlepas dari posisi
    // kamera / level width berapa pun.
    ctx.fillStyle = "#eef3fb";
    ctx.fillRect(-50000, -50000, 200000, 200000);

    // Platforms
    ctx.fillStyle = "#4b5563";
    for (const p of this.platforms) ctx.fillRect(p.x, p.y, p.w, p.h);

    // Doors
    for (const d of this.def.doors) {
      if (this.isDoorOpen(d)) continue;
      ctx.fillStyle = "#b45309";
      ctx.fillRect(d.x, d.y, d.w, d.h);
    }

    // Plates
    for (const plate of this.def.plates) {
      ctx.fillStyle = this.plateState[plate.id] ? "#22c55e" : "#9ca3af";
      ctx.fillRect(plate.x, plate.y, plate.w, plate.h);
    }

    // Keys
    for (const key of this.def.keys) {
      if (this.keysCollected.has(key.id)) continue;
      ctx.fillStyle = "#facc15";
      ctx.beginPath();
      ctx.arc(key.x + 12, key.y + 12, 12, 0, Math.PI * 2);
      ctx.fill();
    }

    // Moving platforms
    ctx.fillStyle = "#7c3aed";
    for (const mp of this.movingPlatforms) ctx.fillRect(mp.x, mp.y, mp.w, mp.h);

    // Boxes
    ctx.fillStyle = "#c2410c";
    for (const box of this.boxes) ctx.fillRect(box.x, box.y, box.w, box.h);

    // Goal
    const g = this.def.goal;
    ctx.fillStyle = this.completed ? "#16a34a" : "#0ea5e9";
    ctx.fillRect(g.x, g.y, g.w, g.h);
    ctx.fillStyle = "#fff";
    ctx.font = "12px sans-serif";
    ctx.fillText("GOAL", g.x + 6, g.y + g.h / 2);

    // Players (dino couple)
    this.drawPlayer(ctx, this.player1);
    this.drawPlayer(ctx, this.player2);

    ctx.restore();
  }

  // ============================================================
  // Render karakter dino (menggantikan kotak polos P1/P2).
  // Digambar full pakai path canvas, jadi tidak butuh file gambar
  // eksternal dan tidak terpotong di bounding box player.
  // ============================================================
  drawPlayer(ctx, p) {
    const x = p.x, y = p.y, w = p.w, h = p.h;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const facing = p.facing >= 0 ? 1 : -1;
    const bodyColor = p.color;
    const bellyColor = p.bellyColor;

    // Sedikit "bounce" halus kalau lagi jalan biar kelihatan hidup
    const bob = p.onGround && p.vx !== 0 ? Math.sin(p.walkCycle) * 1.5 : 0;

    ctx.save();
    ctx.translate(cx, cy + bob);
    ctx.scale(facing, 1); // flip horizontal sesuai arah hadap
    // Mulai dari sini, +x = arah depan dino, origin = titik tengah badan

    // --- Kaki (belakang dulu biar badan nutup sambungannya) ---
    ctx.fillStyle = shade(bodyColor, -20);
    const legSwing = Math.sin(p.walkCycle) * 3;
    // kaki belakang
    ctx.fillRect(-w * 0.26, h * 0.30 - legSwing, w * 0.16, h * 0.24);
    // kaki depan
    ctx.fillRect(w * 0.06, h * 0.30 + legSwing, w * 0.16, h * 0.24);

    // --- Ekor ---
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.moveTo(-w * 0.42, h * 0.02);
    ctx.quadraticCurveTo(-w * 0.85, -h * 0.05, -w * 0.95, -h * 0.28);
    ctx.quadraticCurveTo(-w * 0.65, -h * 0.02, -w * 0.38, h * 0.20);
    ctx.closePath();
    ctx.fill();

    // --- Badan (oval gempal) ---
    ctx.beginPath();
    ctx.ellipse(0, h * 0.04, w * 0.46, h * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();

    // --- Perut (warna lebih terang) ---
    ctx.fillStyle = bellyColor;
    ctx.beginPath();
    ctx.ellipse(w * 0.02, h * 0.20, w * 0.28, h * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();

    // --- Duri-duri di punggung ---
    ctx.fillStyle = bodyColor;
    for (let i = 0; i < 3; i++) {
      const sx = -w * 0.22 + i * w * 0.18;
      const spikeH = h * (0.16 + (i === 1 ? 0.06 : 0)); // duri tengah sedikit lebih tinggi
      ctx.beginPath();
      ctx.moveTo(sx - w * 0.05, -h * 0.24);
      ctx.lineTo(sx + w * 0.03, -h * 0.24 - spikeH);
      ctx.lineTo(sx + w * 0.11, -h * 0.24);
      ctx.closePath();
      ctx.fill();
    }

    // --- Leher/kepala (lingkaran di depan) ---
    ctx.beginPath();
    ctx.ellipse(w * 0.34, -h * 0.10, w * 0.30, h * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();

    // --- Moncong ---
    ctx.beginPath();
    ctx.ellipse(w * 0.56, -h * 0.02, w * 0.16, h * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();

    // --- Duri kecil di kepala ---
    ctx.beginPath();
    ctx.moveTo(w * 0.22, -h * 0.32);
    ctx.lineTo(w * 0.30, -h * 0.44);
    ctx.lineTo(w * 0.36, -h * 0.30);
    ctx.closePath();
    ctx.fill();

    // --- Mata (putih + pupil) ---
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(w * 0.40, -h * 0.14, h * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#111111";
    ctx.beginPath();
    ctx.arc(w * 0.44, -h * 0.13, h * 0.045, 0, Math.PI * 2);
    ctx.fill();
    // kilau mata biar lucu
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(w * 0.455, -h * 0.145, h * 0.015, 0, Math.PI * 2);
    ctx.fill();

    // --- Lubang hidung ---
    ctx.fillStyle = "#111111";
    ctx.beginPath();
    ctx.arc(w * 0.64, -h * 0.02, h * 0.02, 0, Math.PI * 2);
    ctx.fill();

    // --- Senyum kecil ---
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = Math.max(1, h * 0.02);
    ctx.beginPath();
    ctx.arc(w * 0.52, -h * 0.02, w * 0.08, 0.1 * Math.PI, 0.6 * Math.PI);
    ctx.stroke();

    ctx.restore();

    // Label nama (tidak ikut di-flip supaya teksnya selalu tegak & terbaca)
    ctx.fillStyle = "#111";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(p.label, cx, y - 8);
    ctx.textAlign = "left";
  }
}

// Util kecil buat menggelapkan/menerangkan warna hex, dipakai buat warna kaki dino
function shade(hexColor, percent) {
  const num = parseInt(hexColor.slice(1), 16);
  let r = (num >> 16) + Math.round((percent / 100) * 255);
  let g = ((num >> 8) & 0x00ff) + Math.round((percent / 100) * 255);
  let b = (num & 0x0000ff) + Math.round((percent / 100) * 255);
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `#${(0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1)}`;
}

export { PLAYER_W, PLAYER_H };
