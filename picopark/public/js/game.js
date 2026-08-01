import { GameLevel } from "./engine.js";

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
const levelSelectEl = document.getElementById("level-select");
const hudLevelName = document.getElementById("hud-level-name");
const hudTimer = document.getElementById("hud-timer");
const victoryModal = document.getElementById("victory-modal");
const btnBackToSelect = document.getElementById("btn-back-select");
const btnNextLevel = document.getElementById("btn-next-level");
const btnRestart = document.getElementById("btn-restart");
const gateOverlay = document.getElementById("gate-overlay");

let levelsData = [];
let currentLevel = null;
let currentLevelId = 1;
let progressMap = {};
let running = false;
let lastTime = 0;

const input = {
  p1: { left: false, right: false, jump: false },
  p2: { left: false, right: false, jump: false },
};

function resizeCanvas() {
  const wrap = canvas.parentElement;
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
}
window.addEventListener("resize", resizeCanvas);

// ---------------- KEYBOARD INPUT (2 pemain berbagi 1 keyboard) ----------------
// Player 1: A / D gerak, W / Space lompat
// Player 2: Panah kiri/kanan gerak, Panah atas lompat
const KEY_MAP = {
  KeyA: ["p1", "left"], KeyD: ["p1", "right"], KeyW: ["p1", "jump"], Space: ["p1", "jump"],
  ArrowLeft: ["p2", "left"], ArrowRight: ["p2", "right"], ArrowUp: ["p2", "jump"],
};
window.addEventListener("keydown", (e) => {
  const m = KEY_MAP[e.code];
  if (m) { input[m[0]][m[1]] = true; e.preventDefault(); }
});
window.addEventListener("keyup", (e) => {
  const m = KEY_MAP[e.code];
  if (m) { input[m[0]][m[1]] = false; e.preventDefault(); }
});

// ---------------- TOUCH INPUT (layar dibagi 2: kiri = P1, kanan = P2) ----------------
function bindTouchButton(id, player, key) {
  const el = document.getElementById(id);
  if (!el) return;
  const set = (v) => (input[player][key] = v);
  el.addEventListener("touchstart", (e) => { e.preventDefault(); set(true); }, { passive: false });
  el.addEventListener("touchend", (e) => { e.preventDefault(); set(false); }, { passive: false });
  el.addEventListener("mousedown", () => set(true));
  el.addEventListener("mouseup", () => set(false));
  el.addEventListener("mouseleave", () => set(false));
}
["p1-left", "p1-right", "p1-jump", "p2-left", "p2-right", "p2-jump"].forEach((id) => {
  const [player, key] = id.startsWith("p1") ? ["p1", id.split("-")[1]] : ["p2", id.split("-")[1]];
  bindTouchButton(id, player, key);
});

// ---------------- API ----------------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}

async function init() {
  resizeCanvas();
  try {
    const me = await api("/api/me");
    if (!me.user) { window.location.href = "/"; return; }
    if (!me.user.is_paid) {
      gateOverlay.classList.remove("hidden");
      return;
    }
    const levelsRes = await api("/api/levels");
    progressMap = levelsRes.progress || {};
    const res = await fetch("/js/levels.json");
    levelsData = await res.json();
    document.getElementById("select-screen").classList.remove("hidden");
    renderLevelSelect();
  } catch (err) {
    if (err.status === 402) {
      gateOverlay.classList.remove("hidden");
    } else {
      window.location.href = "/";
    }
  }
}

function renderLevelSelect() {
  levelSelectEl.innerHTML = "";
  const unlockedUpTo = Math.max(1, ...Object.keys(progressMap).map((k) => {
    return progressMap[k].completed ? parseInt(k, 10) + 1 : 0;
  }), 1);

  for (let i = 1; i <= 100; i++) {
    const btn = document.createElement("button");
    const completed = progressMap[i]?.completed;
    const locked = i > unlockedUpTo;
    btn.className = "level-btn" + (completed ? " completed" : "") + (locked ? " locked" : "");
    btn.textContent = i;
    btn.disabled = locked;
    btn.addEventListener("click", () => startLevel(i));
    levelSelectEl.appendChild(btn);
  }
}

function startLevel(id) {
  currentLevelId = id;
  const def = levelsData.find((l) => l.id === id);
  currentLevel = new GameLevel(def);
  hudLevelName.textContent = `Level ${id}`;
  document.getElementById("select-screen").classList.add("hidden");
  document.getElementById("play-screen").classList.remove("hidden");
  resizeCanvas();
  running = true;
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function backToSelect() {
  running = false;
  victoryModal.classList.add("hidden");
  document.getElementById("play-screen").classList.add("hidden");
  document.getElementById("select-screen").classList.remove("hidden");
  renderLevelSelect();
}

async function onLevelComplete() {
  running = false;
  try {
    const res = await api("/api/progress", {
      method: "POST",
      body: JSON.stringify({ level_id: currentLevelId, time_ms: Math.round(currentLevel.elapsedMs) }),
    });
    progressMap[currentLevelId] = { completed: 1, best_time_ms: Math.round(currentLevel.elapsedMs) };
  } catch (e) { /* biar tetap bisa lanjut walau gagal simpan progress */ }
  victoryModal.classList.remove("hidden");
}

function loop(now) {
  if (!running) return;
  const dt = Math.min((now - lastTime) / 1000, 1 / 30);
  lastTime = now;

  currentLevel.update(dt, input);

  const camX = Math.max(0, Math.min(
    (currentLevel.player1.x + currentLevel.player2.x) / 2 - canvas.width / 2,
    currentLevel.width - canvas.width
  ));
  currentLevel.render(ctx, { x: camX });

  const secs = currentLevel.elapsedMs / 1000;
  hudTimer.textContent = `${secs.toFixed(1)}s`;

  if (currentLevel.completed) {
    onLevelComplete();
    return;
  }
  requestAnimationFrame(loop);
}

btnBackToSelect.addEventListener("click", backToSelect);
btnRestart.addEventListener("click", () => startLevel(currentLevelId));
btnNextLevel.addEventListener("click", () => {
  victoryModal.classList.add("hidden");
  const next = Math.min(currentLevelId + 1, 100);
  startLevel(next);
});

init();
