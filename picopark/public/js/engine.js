// ============================================================
// Engine fisika + rendering sederhana buat game co-op 2 pemain.
// Semua unit dalam pixel "logical" (canvas di-scale otomatis).
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
  constructor(x, y, color, label) {
    super(x, y, PLAYER_W, PLAYER_H);
    this.color = color;
    this.label = label;
    this.facing = 1;
    this.spawnX = x; this.spawnY = y;
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

    this.player1 = new Player(levelDef.spawn.p1.x, levelDef.spawn.p1.y, "#3aa0ff", "P1");
    this.player2 = new Player(levelDef.spawn.p2.x, levelDef.spawn.p2.y, "#ff59a8", "P2");

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

  render(ctx, camera) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    ctx.save();
    ctx.translate(-camera.x, 0);

    // Background grid ringan
    ctx.fillStyle = "#eef3fb";
    ctx.fillRect(camera.x, 0, ctx.canvas.width, ctx.canvas.height);

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

    // Players
    this.drawPlayer(ctx, this.player1);
    this.drawPlayer(ctx, this.player2);

    ctx.restore();
  }

  drawPlayer(ctx, p) {
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = "#111";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText(p.label, p.x, p.y - 6);
  }
}

export { PLAYER_W, PLAYER_H };
