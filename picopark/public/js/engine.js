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
//
// UPDATE (goal jadi gerbang kerajaan): kotak biru polos "GOAL" diganti
// drawGoalGate() -- gerbang batu dengan dua menara + lengkungan +
// daun pintu kayu berukir + obor + bendera. Lihat drawGoalGate() dan
// helper drawGateTower/drawGateFlag/drawGateTorch/roundRectPath di
// bawah untuk detailnya.
//
// UPDATE (terrain bervariasi): platform abu-abu solid diganti terrain
// prosedural (rumput/gurun/batu/salju/vulkanik) lewat terrain-renderer.js.
// Tema dipilih otomatis per level (lihat biomeForLevel di file itu),
// permukaan tanah digambar sebagai kurva menyambung supaya antar-platform
// tidak terlihat terpotong-potong. Collision TIDAK berubah -- this.platforms
// tetap array datar {x,y,w,h} yang sama seperti sebelumnya, cuma cara
// gambarnya yang beda (this.terrain terpisah, khusus visual).
//
// UPDATE (langit dinamis): background flat putih/biru muda polos
// (fillRect "#eef3fb") diganti drawSky() dari sky-renderer.js -- gradasi
// langit + matahari/bulan + awan melayang, tema mengikuti biome level
// yang sama persis dengan terrain (grass/forest/desert/canyon/rock/
// swamp/snow/tundra/volcanic/void). Sky digambar di screen-space
// SEBELUM transform pan+zoom kamera diterapkan (makanya drawSky
// dipanggil di luar blok ctx.translate/ctx.scale), supaya langit selalu
// menutupi seluruh viewport dan awan punya parallax halus terhadap
// pergerakan kamera, bukan ikut ter-scale/pan sama seperti terrain.
//
// UPDATE (tali penghubung P1<->P2, visual): ditambahkan drawRope() --
// tali digambar sebagai SATU kurva bezier utuh (satu beginPath/stroke),
// bukan segmen-segmen kecil berjajar, supaya tidak pernah kelihatan
// "kepotong-potong" di jarak/ketinggian berapa pun. Kurva punya sag
// (kendur) otomatis proporsional ke jarak antar player. Dipanggil di
// render() sebelum drawPlayer, supaya badan dino digambar di atas tali.
//
// UPDATE (tali jadi mekanik rescue, fisik): ditambahkan ROPE_MAX_LENGTH
// + enforceRope() yang jalan tiap frame di update(), SETELAH fisika
// player biasa tapi SEBELUM pengecekan PIT_Y.
//
// UPDATE (rombak besar: climb-back + fisika jatuh realistis, BUKAN
// slow-motion, + tali diperpanjang):
//  - ROPE_MAX_LENGTH dinaikkan dari 140 -> 190px, jadi ada sedikit lebih
//    banyak ruang gerak/ayun sebelum tali kencang.
//  - enforceRope() sekarang menerima (dt, input). Peran "jangkar" (siapa
//    yang berpijak) vs "faller" (siapa yang menggantung) masih dihitung
//    sama seperti sebelumnya, tapi cara menahan faller total dirombak:
//    dulu pakai pullTowardAnchor() yang teleport posisi persis ke radius
//    tali LALU mengalikan vy/vx dengan faktor kecil (vy *= 0.2, vx *= 0.5)
//    tiap frame -- efeknya karakter yang jatuh keliatan "macet"/lambat
//    tiap kali nyentuh batas tali, kayak slow-motion, karena kecepatan
//    jatuhnya terus-menerus diredam paksa.
//    Sekarang dipakai resolveRopeConstraint(): posisi tetap diklem ke
//    radius tali (supaya tidak pernah melebihi panjang tali / tidak
//    pernah lewat PIT_Y), TAPI kecepatan cuma dibuang komponen radialnya
//    saja (bagian yang narik menjauhi jangkar) -- komponen tangensial
//    (yang bikin karakter berayun ke samping seperti pendulum/bandul)
//    dibiarkan utuh. Hasilnya jatuh & tertahan tali terasa natural &
//    bertenaga penuh (kecepatan gravitasi GRAVITY=1400px/s^2 tetap apa
//    adanya, tidak pernah di-slow-down), bukan macet/lambat.
//  - Mekanik CLIMB BACK: selama player sedang menggantung (faller),
//    tombol jump (yang saat di udara sebelumnya tidak dipakai apa-apa)
//    sekarang berfungsi untuk "manjat tali": tiap frame tombol jump
//    ditahan, climbOffset player itu bertambah (CLIMB_SPEED px/s) yang
//    artinya panjang tali efektif (ropeLen = ROPE_MAX_LENGTH - climbOffset)
//    mengecil, menarik dia lebih dekat ke rekannya (jangkar) sedikit demi
//    sedikit lewat resolveRopeConstraint() di frame yang sama. Begitu dia
//    cukup dekat ke platform tempat rekannya berpijak, collision normal
//    di updatePlayer() akan mendaratkannya (onGround jadi true) dan
//    climbOffset di-reset -- selesai "diselamatkan".
//    Kalau tombol jump DILEPAS saat masih menggantung, climbOffset malah
//    perlahan berkurang lagi (SLIP_SPEED px/s, lebih lambat dari climb)
//    -- jadi pemain harus benar-benar terus berusaha (nahan jump) buat
//    naik, bukan sekali pencet lalu otomatis nyampe; kalau berhenti dia
//    pelan-pelan merosot turun lagi (tapi tidak pernah sampai lepas total
//    dari radius ROPE_MAX_LENGTH, karena itu tetap jadi batas atas tali).
//  - Kasus dua-duanya sama-sama menggantung (tidak ada yang jadi jangkar)
//    tetap dijaga jaraknya lewat soft constraint simetris, tapi versi
//    baru ini juga membuang komponen kecepatan RELATIF yang searah
//    menjauh (bukan sekadar redam angka), supaya tetap terasa fisikal.
// ============================================================

import { buildTerrain, drawTerrain } from "./terrain-renderer.js";
import { buildSky, drawSky } from "./sky-renderer.js";

const GRAVITY = 1400; // px/s^2
const MOVE_SPEED = 220; // px/s
const JUMP_VELOCITY = -560; // px/s
const PLAYER_W = 30;
const PLAYER_H = 44;
const BOX_SIZE = 40;
const PIT_Y = 900; // jatuh di bawah ini = respawn

const ROPE_MAX_LENGTH = 190; // px -- jarak maksimum "tali" antara P1 dan P2 (diperpanjang dari 140)
const ROPE_MIN_LENGTH = 40; // px -- sedekat apapun manjat, faller tidak akan sampai menempel pas di jangkar
const CLIMB_SPEED = 95; // px/s -- seberapa cepat panjang tali efektif mengecil selama tombol jump ditahan (manjat naik)
const CLIMB_SLIP_SPEED = 40; // px/s -- seberapa cepat merosot balik kalau tombol jump dilepas saat masih menggantung

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
    this.climbOffset = 0; // seberapa banyak tali "digulung" lewat manjat (0 = tali penuh)
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

    // Data terrain visual (tema rumput/gurun/batu/salju/vulkanik sesuai
    // level.id, dihitung sekali di sini). Ini terpisah dari this.platforms
    // di atas -- this.platforms tetap dipakai apa adanya untuk collision,
    // this.terrain cuma dipakai buat menggambar.
    this.terrain = buildTerrain(levelDef);

    // Data langit visual (gradasi + matahari/bulan + awan, tema mengikuti
    // biome yang sama dengan this.terrain di atas). Dihitung sekali di
    // sini juga, dipakai tiap frame lewat render() -> drawSky().
    this.sky = buildSky(levelDef);

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

    // Tali penghubung P1<->P2 sebagai constraint fisik (lihat komentar
    // besar di atas file, bagian "ROMBAK BESAR"). Dijalankan SETELAH
    // fisika normal player, SEBELUM cek PIT_Y -- supaya kalau salah satu
    // ketahan tali, dia tidak sempat "kehitung" jatuh ke pit di bawah.
    // Butuh dt (buat laju climb/slip) dan input (buat baca tombol jump
    // dari sisi yang sedang menggantung).
    this.enforceRope(dt, input);

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

    // Respawn kalau jatuh (kalau tali sempat "menyelamatkan" salah satu
    // player di enforceRope() di atas, y-nya sudah tertahan duluan
    // sebelum sampai sini, jadi tidak akan kena kondisi ini).
    for (const p of [this.player1, this.player2]) {
      if (p.y > PIT_Y) {
        p.x = p.spawnX; p.y = p.spawnY; p.vx = 0; p.vy = 0;
        p.climbOffset = 0;
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

    // Tali cuma relevan selama masih menggantung -- begitu berpijak lagi,
    // reset climbOffset supaya lain kali jatuh, tali kembali mulai dari
    // panjang penuh (bukan nyambung dari sisa manjat sebelumnya).
    if (p.onGround) p.climbOffset = 0;
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
  // enforceRope(dt, input)
  // Constraint fisik yang menjaga jarak P1<->P2 tidak pernah melebihi
  // panjang tali efektif, DITAMBAH mekanik climb-back:
  //  - Satu grounded (jangkar), satu jatuh (faller) -> faller ditahan
  //    persis di radius tali dari jangkar lewat resolveRopeConstraint()
  //    (posisi diklem, tapi cuma komponen kecepatan RADIAL yang dibuang
  //    -- bukan seluruh kecepatan diredam, jadi tidak kelihatan slow-mo).
  //    Sebelum itu, updateClimb() dipanggil dulu: kalau faller sedang
  //    menahan tombol jump, panjang tali efektifnya mengecil sedikit
  //    demi sedikit (manjat naik); kalau dilepas, merosot balik pelan.
  //  - Dua-duanya jatuh bareng (tidak ada jangkar) -> soft constraint
  //    simetris, jarak tidak boleh melebihi ROPE_MAX_LENGTH, komponen
  //    kecepatan relatif yang searah menjauh dibuang sebagian.
  //  - Dua-duanya grounded -> kalau kebetulan sudah lebih jauh dari
  //    ROPE_MAX_LENGTH (misal jalan berlawanan arah), ditarik pelan
  //    50/50 tanpa mempengaruhi kecepatan (mereka toh sedang berjalan
  //    normal di darat, bukan menggantung).
  // ============================================================
  enforceRope(dt, input) {
    const p1 = this.player1;
    const p2 = this.player2;

    const ax = p1.x + p1.w / 2, ay = p1.y + p1.h / 2;
    const bx = p2.x + p2.w / 2, by = p2.y + p2.h / 2;

    if (p1.onGround && !p2.onGround) {
      // P1 jadi jangkar, P2 menggantung -- bisa manjat balik lewat jump
      this.updateClimb(p2, dt, !!(input.p2 && input.p2.jump));
      const ropeLen = ROPE_MAX_LENGTH - p2.climbOffset;
      this.resolveRopeConstraint(p2, ax, ay, ropeLen);
    } else if (p2.onGround && !p1.onGround) {
      // P2 jadi jangkar, P1 menggantung -- bisa manjat balik lewat jump
      this.updateClimb(p1, dt, !!(input.p1 && input.p1.jump));
      const ropeLen = ROPE_MAX_LENGTH - p1.climbOffset;
      this.resolveRopeConstraint(p1, bx, by, ropeLen);
    } else if (!p1.onGround && !p2.onGround) {
      // Dua-duanya jatuh bareng: tidak ada jangkar buat dipegang/dipanjat,
      // cuma jaga jarak supaya tidak melar tanpa batas.
      const dx = bx - ax, dy = by - ay;
      const dist = Math.hypot(dx, dy);
      if (dist > ROPE_MAX_LENGTH && dist > 0) {
        const nx = dx / dist, ny = dy / dist;
        const excess = dist - ROPE_MAX_LENGTH;
        const half = excess / 2;
        p1.x += nx * half; p1.y += ny * half;
        p2.x -= nx * half; p2.y -= ny * half;

        // Buang sebagian komponen kecepatan RELATIF yang searah menjauh
        // (bukan mematikan kecepatan masing-masing individu), supaya
        // jatuhnya tetap terasa penuh tenaga, cuma tidak makin melar.
        const rvx = p2.vx - p1.vx, rvy = p2.vy - p1.vy;
        const relDotN = rvx * nx + rvy * ny;
        if (relDotN > 0) {
          p1.vx += nx * relDotN * 0.5; p1.vy += ny * relDotN * 0.5;
          p2.vx -= nx * relDotN * 0.5; p2.vy -= ny * relDotN * 0.5;
        }
      }
    } else {
      // Dua-duanya grounded -- tali cuma dijaga jangan sampai kepanjangan.
      const dx = bx - ax, dy = by - ay;
      const dist = Math.hypot(dx, dy);
      if (dist > ROPE_MAX_LENGTH && dist > 0) {
        const nx = dx / dist, ny = dy / dist;
        const excess = dist - ROPE_MAX_LENGTH;
        const half = excess / 2;
        p1.x += nx * half; p1.y += ny * half;
        p2.x -= nx * half; p2.y -= ny * half;
      }
    }
  }

  // Naik/turunnya panjang tali efektif untuk faller yang sedang
  // menggantung. Ditahan jump -> manjat naik (climbOffset bertambah,
  // tali efektif memendek). Dilepas -> merosot pelan (climbOffset
  // berkurang, tali efektif memanjang lagi), tapi tidak pernah sampai
  // di bawah 0 (artinya tidak akan pernah lebih panjang dari
  // ROPE_MAX_LENGTH) atau di atas batas maksimum manjat.
  updateClimb(faller, dt, jumpHeld) {
    if (jumpHeld) {
      faller.climbOffset += CLIMB_SPEED * dt;
    } else {
      faller.climbOffset -= CLIMB_SLIP_SPEED * dt;
    }
    const maxOffset = ROPE_MAX_LENGTH - ROPE_MIN_LENGTH;
    faller.climbOffset = Math.max(0, Math.min(maxOffset, faller.climbOffset));
  }

  // Menahan `faller` supaya tidak pernah lebih jauh dari `ropeLen` dari
  // titik jangkar (anchorX, anchorY). Ini KONSTRAIN FISIK, bukan damping
  // buatan: posisi diklem persis ke lingkaran radius ropeLen (supaya
  // tali tidak pernah "melar" dan faller tidak pernah lewat PIT_Y lewat
  // jangkar yang berpijak), tapi kecepatan HANYA dibuang komponen
  // radialnya (bagian yang menjauhi jangkar) -- komponen tangensialnya
  // (yang bikin faller berayun ke kiri/kanan seperti bandul) dibiarkan
  // utuh sepenuhnya. Makanya jatuh & tertahan tali terasa natural &
  // bertenaga penuh, bukan macet/lambat kayak slow-motion.
  resolveRopeConstraint(faller, anchorX, anchorY, ropeLen) {
    const fx = faller.x + faller.w / 2;
    const fy = faller.y + faller.h / 2;
    const dx = fx - anchorX;
    const dy = fy - anchorY;
    const dist = Math.hypot(dx, dy);
    if (dist <= ropeLen || dist === 0) return;

    const nx = dx / dist, ny = dy / dist;

    // Klem posisi ke radius tali efektif
    const targetX = anchorX + nx * ropeLen;
    const targetY = anchorY + ny * ropeLen;
    faller.x = targetX - faller.w / 2;
    faller.y = targetY - faller.h / 2;

    // Buang cuma komponen kecepatan yang searah radial keluar (menjauhi
    // jangkar); sisanya (tangensial, buat ayunan) tetap utuh.
    const vDotN = faller.vx * nx + faller.vy * ny;
    if (vDotN > 0) {
      faller.vx -= vDotN * nx;
      faller.vy -= vDotN * ny;
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

    // Langit (background) -- digambar di screen-space MURNI, sebelum
    // pan/zoom kamera diterapkan. Ini disengaja: langit harus selalu
    // menutupi seluruh viewport apa pun posisi kamera/level width-nya,
    // dan awan di dalamnya punya parallax sendiri (lebih lambat dari
    // dunia game) yang dihitung manual dari camera.x di dalam drawSky,
    // bukan lewat ctx.translate seperti layer dunia game di bawah.
    drawSky(ctx, this.sky, ctx.canvas.width, ctx.canvas.height, this.elapsedMs, camera.x * scale);

    ctx.restore();

    ctx.save();
    // Urutan: pan horizontal dulu (dalam satuan world, makanya dikali
    // scale supaya konsisten dengan ctx.scale di bawah), baru zoom.
    ctx.translate(-camera.x * scale, 0);
    ctx.scale(scale, scale);

    // Platforms — terrain bervariasi (rumput/gurun/batu/salju/vulkanik
    // sesuai tema level, lihat biomeForLevel di terrain-renderer.js).
    // viewW dipakai cuma buat culling performa; kita kasih this.width
    // penuh supaya tidak ada platform yang salah kepotong pas dipanggil
    // dari kondisi kamera manapun.
    drawTerrain(ctx, this.terrain, camera.x, this.width);

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

    // Goal — gerbang kerajaan (menara + lengkungan + daun pintu + obor + bendera)
    this.drawGoalGate(ctx, this.def.goal, this.completed);

    // Tali penghubung P1 <-> P2 -- digambar SEBELUM drawPlayer supaya
    // badan dino ada di atas tali (nutupin titik ikat di pinggang),
    // dan tali selalu berupa satu kurva utuh (lihat drawRope() di bawah).
    this.drawRope(ctx, this.player1, this.player2);

    // Players (dino couple)
    this.drawPlayer(ctx, this.player1);
    this.drawPlayer(ctx, this.player2);

    ctx.restore();
  }

  // ============================================================
  // drawGoalGate(ctx, g, completed)
  // Menggambar goal sebagai gerbang kerajaan: dua menara batu bata
  // dengan merlon (gerigi benteng), lengkungan batu penghubung
  // dengan batu kunci di puncak, daun pintu kayu berukir + paku besi
  // yang sedikit terkuak (kesan "gerbang terbuka mengundang"), obor
  // menyala di kedua menara, bendera di puncak, dan cahaya ambient
  // di belakangnya. g = {x,y,w,h} tetap dipakai persis sebagai area
  // trigger goal (collision TIDAK berubah), gerbang cuma digambar
  // meluas ke atas/samping dari area itu secara visual.
  // ============================================================
  drawGoalGate(ctx, g, completed) {
    const x = g.x, y = g.y, w = g.w, h = g.h;
    const pillarW = Math.max(10, w * 0.26);
    const towerH = h * 1.6;
    const topY = y + h - towerH;
    const leftPillarX = x - pillarW * 0.12;
    const rightPillarX = x + w - pillarW * 0.88;

    const stoneLight = "#aab0bd";
    const stoneMid = "#7c8291";
    const stoneDark = "#575d6b";
    const mortar = "#454b57";

    ctx.save();

    // --- Cahaya ambient di belakang gerbang ---
    const glowColor = completed ? "rgba(250,204,21,0.5)" : "rgba(56,189,248,0.3)";
    const gcx = x + w / 2, gcy = y + h * 0.55;
    const glow = ctx.createRadialGradient(gcx, gcy, w * 0.05, gcx, gcy, w * 1.7);
    glow.addColorStop(0, glowColor);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - w * 1.3, topY - h * 0.7, w * 3.6, h * 2.8);

    // --- Menara kiri & kanan ---
    this.drawGateTower(ctx, leftPillarX, topY, pillarW, towerH, stoneLight, stoneMid, stoneDark, mortar);
    this.drawGateTower(ctx, rightPillarX, topY, pillarW, towerH, stoneLight, stoneMid, stoneDark, mortar);

    // --- Lengkungan atas menghubungkan dua menara ---
    const archLeft = leftPillarX;
    const archRight = rightPillarX + pillarW;
    const archBaseY = topY + h * 0.14;
    const archTopY = topY - w * 0.2;
    ctx.fillStyle = stoneMid;
    ctx.beginPath();
    ctx.moveTo(archLeft, archBaseY);
    ctx.lineTo(archLeft, topY + h * 0.02);
    ctx.quadraticCurveTo((archLeft + archRight) / 2, archTopY, archRight, topY + h * 0.02);
    ctx.lineTo(archRight, archBaseY);
    ctx.quadraticCurveTo((archLeft + archRight) / 2, archTopY + h * 0.18, archLeft, archBaseY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = mortar;
    ctx.lineWidth = Math.max(1, w * 0.015);
    ctx.stroke();

    // batu kunci (keystone) di puncak lengkungan
    ctx.fillStyle = stoneDark;
    const kcx = (archLeft + archRight) / 2;
    ctx.beginPath();
    ctx.moveTo(kcx - w * 0.07, archTopY + h * 0.05);
    ctx.lineTo(kcx + w * 0.07, archTopY + h * 0.05);
    ctx.lineTo(kcx + w * 0.045, archTopY + h * 0.2);
    ctx.lineTo(kcx - w * 0.045, archTopY + h * 0.2);
    ctx.closePath();
    ctx.fill();

    // --- Lubang pintu (portal bercahaya) ---
    const doorGrad = ctx.createLinearGradient(x, y, x, y + h);
    if (completed) {
      doorGrad.addColorStop(0, "#fff7d6");
      doorGrad.addColorStop(1, "#f4b93f");
    } else {
      doorGrad.addColorStop(0, "#dff6ff");
      doorGrad.addColorStop(1, "#0ea5e9");
    }
    ctx.fillStyle = doorGrad;
    this.roundRectPath(ctx, x, y, w, h, w * 0.18);
    ctx.fill();

    // --- Daun pintu kayu berukir dengan paku besi, sedikit terkuak ---
    const leafW = w / 2;
    const openGap = w * 0.06;
    ctx.save();
    ctx.beginPath();
    this.roundRectPath(ctx, x, y, w, h, w * 0.18);
    ctx.clip();

    for (let side = 0; side < 2; side++) {
      const lx = side === 0 ? x : x + leafW + openGap * 0;
      const leafX = side === 0 ? x : x + leafW;
      const drawX = side === 0 ? leafX - (leafW - openGap) : leafX + openGap;
      const woodGrad = ctx.createLinearGradient(drawX, y, drawX + (leafW - openGap), y);
      if (completed) {
        woodGrad.addColorStop(0, "#e8a63a");
        woodGrad.addColorStop(1, "#c97f1d");
      } else {
        woodGrad.addColorStop(0, "#9a6a34");
        woodGrad.addColorStop(1, "#6b4420");
      }
      ctx.fillStyle = woodGrad;
      const actualX = side === 0 ? x : x + leafW + openGap;
      ctx.fillRect(actualX, y, leafW - openGap, h);

      // garis serat kayu vertikal
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = Math.max(1, w * 0.01);
      for (let i = 1; i < 3; i++) {
        const px = actualX + (leafW - openGap) * (i / 3);
        ctx.beginPath();
        ctx.moveTo(px, y + h * 0.05);
        ctx.lineTo(px, y + h * 0.95);
        ctx.stroke();
      }

      // bingkai tepi daun pintu
      ctx.strokeStyle = "rgba(0,0,0,0.28)";
      ctx.lineWidth = Math.max(1, w * 0.02);
      ctx.strokeRect(actualX + w * 0.03, y + h * 0.04, (leafW - openGap) - w * 0.06, h * 0.92);

      // paku-paku besi (studs)
      ctx.fillStyle = "#2b2b2b";
      const studCols = 2, studRows = 3;
      for (let r = 0; r < studRows; r++) {
        for (let c = 0; c < studCols; c++) {
          const sx = actualX + (leafW - openGap) * ((c + 1) / (studCols + 1));
          const sy = y + h * ((r + 1) / (studRows + 1));
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(1, w * 0.02), 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#5a5a5a";
          ctx.beginPath();
          ctx.arc(sx - w * 0.005, sy - w * 0.005, Math.max(0.5, w * 0.007), 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#2b2b2b";
        }
      }
    }
    ctx.restore();

    // --- Bendera di puncak masing-masing menara ---
    const flagColor = completed ? "#facc15" : "#38bdf8";
    this.drawGateFlag(ctx, leftPillarX + pillarW / 2, topY, flagColor);
    this.drawGateFlag(ctx, rightPillarX + pillarW / 2, topY, flagColor);

    // --- Obor menyala di kedua menara ---
    this.drawGateTorch(ctx, leftPillarX + pillarW * 0.5, topY + h * 0.6, w);
    this.drawGateTorch(ctx, rightPillarX + pillarW * 0.5, topY + h * 0.6, w);

    // --- Label teks ---
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = Math.max(1, w * 0.035);
    ctx.font = `bold ${Math.max(9, Math.round(w * 0.17))}px sans-serif`;
    ctx.textAlign = "center";
    const label = completed ? "SELESAI!" : "GOAL";
    const labelY = topY - h * 0.14;
    ctx.strokeText(label, x + w / 2, labelY);
    ctx.fillText(label, x + w / 2, labelY);
    ctx.textAlign = "left";

    ctx.restore();
  }

  // Menara gerbang: badan batu bata bertekstur (garis mortar) + shading
  // kiri-terang/kanan-gelap biar ada kesan volume + merlon (gerigi
  // benteng) di puncaknya.
  drawGateTower(ctx, x, topY, w, h, light, mid, dark, mortar) {
    ctx.fillStyle = mid;
    ctx.fillRect(x, topY, w, h);

    // garis batu bata horizontal
    ctx.strokeStyle = mortar;
    ctx.lineWidth = Math.max(1, w * 0.05);
    const rows = 6;
    for (let i = 1; i < rows; i++) {
      const ly = topY + (h / rows) * i;
      ctx.beginPath();
      ctx.moveTo(x, ly);
      ctx.lineTo(x + w, ly);
      ctx.stroke();
    }

    // shading kiri terang / kanan gelap biar ada volume 3D semu
    ctx.fillStyle = light;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(x, topY, w * 0.26, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = dark;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x + w * 0.76, topY, w * 0.24, h);
    ctx.globalAlpha = 1;

    // merlon (gerigi benteng) di puncak menara
    const merlonCount = 3;
    const merlonW = w / (merlonCount * 2 - 1);
    ctx.fillStyle = mid;
    for (let i = 0; i < merlonCount; i++) {
      const mx = x + i * merlonW * 2;
      ctx.fillRect(mx, topY - merlonW * 1.15, merlonW, merlonW * 1.15);
    }
    ctx.strokeStyle = mortar;
    ctx.lineWidth = Math.max(1, w * 0.03);
    ctx.strokeRect(x, topY, w, h);
  }

  // Bendera segitiga kecil di ujung tiang, dipasang di puncak menara.
  drawGateFlag(ctx, poleX, topY, color) {
    const poleH = 22;
    const poleTopY = topY - poleH - 6;
    ctx.strokeStyle = "#4b5563";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(poleX, topY - 6);
    ctx.lineTo(poleX, poleTopY);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(poleX, poleTopY);
    ctx.lineTo(poleX + 16, poleTopY + 5);
    ctx.lineTo(poleX, poleTopY + 10);
    ctx.closePath();
    ctx.fill();
  }

  // Obor menyala nempel di dinding menara, apinya sedikit "flicker"
  // (pakai this.elapsedMs supaya tiap obor punya fase berbeda tapi
  // tetap deterministik, tanpa butuh Math.random per-frame).
  drawGateTorch(ctx, tx, ty, w) {
    // Tangkai obor
    ctx.fillStyle = "#3f3f46";
    ctx.fillRect(tx - w * 0.02, ty, w * 0.04, w * 0.22);
    // Mangkuk obor
    ctx.fillStyle = "#57534e";
    ctx.beginPath();
    ctx.moveTo(tx - w * 0.05, ty);
    ctx.lineTo(tx + w * 0.05, ty);
    ctx.lineTo(tx + w * 0.03, ty - w * 0.06);
    ctx.lineTo(tx - w * 0.03, ty - w * 0.06);
    ctx.closePath();
    ctx.fill();
    // Api (flicker halus berdasarkan waktu, beda fase tiap obor)
    const flick = Math.sin(this.elapsedMs / 120 + tx) * 0.15;
    const flameGrad = ctx.createRadialGradient(tx, ty - w * 0.14, 1, tx, ty - w * 0.14, w * 0.13);
    flameGrad.addColorStop(0, "#fff7c2");
    flameGrad.addColorStop(0.5, "#fbbf24");
    flameGrad.addColorStop(1, "rgba(249,115,22,0)");
    ctx.fillStyle = flameGrad;
    ctx.beginPath();
    ctx.ellipse(tx, ty - w * (0.14 + flick), w * 0.065, w * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Helper: path persegi dengan sudut membulat (dipakai buat lubang
  // pintu gerbang supaya terasa lebih "arsitektural" daripada kotak
  // tajam biasa).
  roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  // ============================================================
  // drawRope(ctx, p1, p2)
  // Menggambar tali penghubung P1<->P2 sebagai SATU kurva utuh
  // (satu beginPath/quadraticCurveTo/stroke per lapisan), bukan
  // segmen-segmen kecil berjajar -- ini yang bikin rope tidak
  // pernah kelihatan "kepotong-potong" walau jaraknya jauh atau
  // player lagi di ketinggian beda.
  //
  // Kurva pakai bezier kuadratik dengan sag (kendur) yang besarnya
  // mengikuti jarak antar player, supaya terasa seperti tali/tambang
  // beneran (nunduk di tengah) bukan garis lurus kaku. Sag juga
  // dikasih sedikit ayunan halus dari this.elapsedMs biar tali
  // kelihatan hidup, bukan statis. (Rope ini murni visual -- fisika
  // "penariknya" ada di enforceRope(), dipanggil terpisah di update().)
  // ============================================================
  drawRope(ctx, p1, p2) {
    // Titik ikat: dari sekitar pinggang masing-masing dino (bukan
    // pojok atas bounding box), biar keliatan nyambung ke badan.
    const ax = p1.x + p1.w / 2;
    const ay = p1.y + p1.h * 0.55;
    const bx = p2.x + p2.w / 2;
    const by = p2.y + p2.h * 0.55;

    const dx = bx - ax;
    const dy = by - ay;
    const dist = Math.hypot(dx, dy);

    // Sag dasar proporsional ke jarak (dibatasi biar tidak berlebihan
    // di level yang lebar banget), plus ayunan halus deterministik.
    const baseSag = Math.min(60, dist * 0.18);
    const sway = Math.sin(this.elapsedMs / 500) * Math.min(6, dist * 0.03);
    const sag = baseSag + sway;

    const midX = (ax + bx) / 2;
    const midY = (ay + by) / 2 + sag;

    ctx.save();

    // Lapisan bawah: warna tali gelap (memberi kesan ketebalan/bayangan)
    ctx.strokeStyle = "#6b4420";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(midX, midY, bx, by);
    ctx.stroke();

    // Lapisan atas: highlight tipis di tengah tali biar kelihatan
    // bervolume (masih satu path yang sama, cuma digambar tipis
    // di atasnya -- bukan segmen terpisah).
    ctx.strokeStyle = "#a9743f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(midX, midY, bx, by);
    ctx.stroke();

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
