import { GameLevel } from "./engine.js";
import { NetSession } from "./net.js";

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
const btnResetProgress = document.getElementById("btn-reset-progress");

let levelsData = [];
let currentLevel = null;
let currentLevelId = 1;
let progressMap = {};
let running = false;
let lastTime = 0;

// ---------------- MULTIPLAYER (WebRTC, 2 device beda) ----------------
const net = new NetSession();
let myRole = null; // null = solo/local co-op, "host" = P1 di device ini, "client" = P2 di device ini
let latestRemoteState = null; // dipakai oleh client, diisi tiap kali host kirim state
let clientRunning = false;
let clientCompletedHandled = false;
let netSendCounter = 0;

// Kode room yang lagi aktif dipakai device ini (baik sebagai host yang
// baru generate, maupun client yang baru join). Dipakai buat trigger
// "leave" ke backend supaya baris room-nya kehapus permanen begitu
// koneksi terputus / device ini keluar.
let currentRoomCode = null;

// True kalau device ini adalah user yang diundang gratis (redeem kode
// di gate) dan otomatis di-connect-kan sebagai Player 2 ke room host,
// TANPA pernah melihat layar pilih level (dia cuma numpang main sesi
// host, bukan punya progress/level pilihan sendiri).
let isForcedInviteeClient = false;

const input = {
  p1: { left: false, right: false, jump: false },
  p2: { left: false, right: false, jump: false },
};

// ============================================================
// CANVAS SCALING (FIX: layar HP kepotong / cuma keliatan segitu)
// ------------------------------------------------------------
// Sebelumnya canvas.width/height langsung disamain sama ukuran
// elemen pembungkus (dalam device pixel campur-aduk sama CSS
// pixel), jadi di HP yang punya devicePixelRatio tinggi (2x, 3x)
// hasilnya nge-blur / area gambar jadi nggak sesuai layar asli,
// dan karena resize kadang telat/nggak ke-trigger pas address bar
// HP nongol-ilang, ukurannya bisa nyangkut di nilai lama (kecil).
//
// FIX (canvas size limit — INI YANG BIKIN OBJEK "ILANG"):
// canvas.width/height (buffer piksel device) sebelumnya dihitung
// dari viewW*dpr / viewH*dpr TANPA batas atas sama sekali. Di device
// dengan display scaling tinggi (Windows 150%/200%/250%, atau HP
// dengan devicePixelRatio 2-3), buffer ini bisa melebihi batas
// maksimum ukuran canvas yang didukung browser (beda-beda tiap
// browser/GPU, biasanya sekitar 4096-16384px per sisi atau ada
// batas total area piksel juga). Begitu limit itu terlampaui,
// browser DIAM-DIAM tidak menggambar apa pun ke canvas — tidak ada
// error di console, cuma layar kosong. Ini persis match dengan gejala
// "objek nongol lagi kalau browser di-zoom ke 25%" — karena zoom
// browser di Chrome ikut mengecilkan devicePixelRatio efektif,
// sehingga buffer canvas ikut mengecil di bawah limit lagi.
//
// Sekarang devicePixelRatio DIBATASI (capped) ke maksimum aman, dan
// hasil akhir width/height canvas juga di-clamp supaya tidak pernah
// melebihi batas aman, sambil scale/pan yang dipakai untuk render()
// tetap dihitung dari viewW/viewH (satuan logis / CSS px) seperti
// biasa jadi tidak mempengaruhi gameplay sama sekali.
// ============================================================
let viewW = 0;
let viewH = 0;
let dpr = Math.max(1, window.devicePixelRatio || 1);

// Dpr di atas 2 nyaris tidak menambah ketajaman yang kelihatan mata,
// tapi risiko kena limit ukuran canvas naik drastis. 2 adalah nilai
// aman yang dipakai kebanyakan game canvas 2D di web.
const MAX_DPR = 2;

// Batas aman total piksel buffer canvas (lebar x tinggi dalam device
// pixel). 16,777,216 = setara 4096x4096. Ini jauh di bawah limit
// hampir semua browser desktop maupun mobile modern, jadi aman.
const MAX_CANVAS_AREA = 16 * 1024 * 1024;

function resizeCanvas() {
  const wrap = canvas.parentElement;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  if (w <= 0 || h <= 0) return; // layout belum siap, tunggu observer trigger lagi

  viewW = w;
  viewH = h;

  // Cap dpr ke MAX_DPR dulu.
  let effectiveDpr = Math.min(Math.max(1, window.devicePixelRatio || 1), MAX_DPR);

  let pixelW = Math.round(viewW * effectiveDpr);
  let pixelH = Math.round(viewH * effectiveDpr);

  // Kalau tetap kelewat batas area aman (mis. viewW/viewH sendiri
  // sudah besar sebelum dikali dpr), turunkan effectiveDpr lebih jauh
  // supaya buffer canvas selalu di bawah MAX_CANVAS_AREA. Ini jaring
  // pengaman terakhir supaya canvas TIDAK PERNAH blank karena limit
  // ukuran, apa pun kombinasi device scaling / ukuran layar user.
  const area = pixelW * pixelH;
  if (area > MAX_CANVAS_AREA) {
    const shrink = Math.sqrt(MAX_CANVAS_AREA / area);
    effectiveDpr = Math.max(1, effectiveDpr * shrink);
    pixelW = Math.round(viewW * effectiveDpr);
    pixelH = Math.round(viewH * effectiveDpr);
  }

  dpr = effectiveDpr;

  // Cuma sentuh atribut width/height kalau memang berubah, biar
  // nggak reset state canvas terus-terusan tanpa perlu.
  if (canvas.width !== pixelW || canvas.height !== pixelH) {
    canvas.width = pixelW;
    canvas.height = pixelH;
    console.log(
      `[resizeCanvas] viewport=${viewW}x${viewH} rawDpr=${(window.devicePixelRatio || 1).toFixed(2)} ` +
      `effectiveDpr=${effectiveDpr.toFixed(2)} bufferPx=${pixelW}x${pixelH} (area=${pixelW * pixelH})`
    );
  }
  canvas.style.width = viewW + "px";
  canvas.style.height = viewH + "px";

  // Semua ctx.fillRect/arc/dst di engine.js jalan di satuan logis (CSS px)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// window resize tetap dipasang buat browser desktop/lama...
window.addEventListener("resize", resizeCanvas);
window.addEventListener("orientationchange", () => {
  // kasih sedikit delay, di banyak HP ukuran viewport baru settle
  // beberapa ms setelah event orientationchange ditembak
  setTimeout(resizeCanvas, 50);
  setTimeout(resizeCanvas, 300);
});
// ...tapi di HP, ResizeObserver + visualViewport jauh lebih diandalkan
// buat nangkep perubahan tinggi viewport pas address bar muncul/ilang.
if (window.ResizeObserver) {
  const ro = new ResizeObserver(() => resizeCanvas());
  ro.observe(canvas.parentElement);
}
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", resizeCanvas);
  window.visualViewport.addEventListener("scroll", resizeCanvas);
}

// ---------------- KEYBOARD INPUT ----------------
// Mode solo (1 device, 2 pemain): Player 1 = A/D/W/Space, Player 2 = panah.
// Mode multiplayer sebagai CLIENT (device ini cuma kontrol P2): SEMUA
// tombol (A/D/W/Space ATAU panah) otomatis diarahkan ke P2, karena di
// device ini cuma ada 1 pemain yang perlu dikontrol.
const KEY_MAP = {
  KeyA: ["p1", "left"], KeyD: ["p1", "right"], KeyW: ["p1", "jump"], Space: ["p1", "jump"],
  ArrowLeft: ["p2", "left"], ArrowRight: ["p2", "right"], ArrowUp: ["p2", "jump"],
};
window.addEventListener("keydown", (e) => {
  const m = KEY_MAP[e.code];
  if (!m) return;
  const player = myRole === "client" ? "p2" : m[0];
  input[player][m[1]] = true;
  e.preventDefault();
});
window.addEventListener("keyup", (e) => {
  const m = KEY_MAP[e.code];
  if (!m) return;
  const player = myRole === "client" ? "p2" : m[0];
  input[player][m[1]] = false;
  e.preventDefault();
});

// ---------------- TOUCH INPUT ----------------
function bindTouchButton(id, player, key) {
  const el = document.getElementById(id);
  if (!el) return;
  const set = (v) => (input[player][key] = v);
  el.addEventListener("touchstart", (e) => { e.preventDefault(); set(true); }, { passive: false });
  el.addEventListener("touchend", (e) => { e.preventDefault(); set(false); }, { passive: false });
  el.addEventListener("touchcancel", (e) => { e.preventDefault(); set(false); }, { passive: false });
  el.addEventListener("mousedown", () => set(true));
  el.addEventListener("mouseup", () => set(false));
  el.addEventListener("mouseleave", () => set(false));
}
["p1-left", "p1-right", "p1-jump", "p2-left", "p2-right", "p2-jump"].forEach((id) => {
  const [player, key] = id.startsWith("p1") ? ["p1", id.split("-")[1]] : ["p2", id.split("-")[1]];
  bindTouchButton(id, player, key);
});

// ============================================================
// LAYOUT ULANG TOMBOL SENTUH DI HP
// ------------------------------------------------------------
// Permintaan: jangan taruh kiri-tengah(loncat)-kanan berjejer jadi
// satu (susah dipencet pakai 1 jempol). Sekarang:
// - Tombol LONCAT (jump) -> pojok KIRI bawah, sendirian, ukuran
//   lebih besar biar gampang dijempol kiri.
// - Tombol KIRI & KANAN -> pojok KANAN bawah, berdampingan, biar
//   jempol kanan tinggal geser dikit buat gerak dua arah.
// Diterapkan lewat <style> yang di-inject (pakai !important) biar
// override CSS lama apapun struktur HTML aslinya, dan cuma aktif
// di device yang mendukung touch (nggak ganggu tampilan desktop).
// ============================================================
function applyMobileControlLayout() {
  const isTouchDevice = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  if (!isTouchDevice) return;
  if (document.getElementById("mobile-control-layout-style")) return;

  const style = document.createElement("style");
  style.id = "mobile-control-layout-style";
  style.textContent = `
    #p1-jump, #p2-jump,
    #p1-left, #p1-right,
    #p2-left, #p2-right {
      position: fixed !important;
      top: auto !important;
      margin: 0 !important;
      width: 66px !important;
      height: 66px !important;
      border-radius: 50% !important;
      z-index: 4000 !important;
      /* PENTING: "display" SENGAJA tidak dikasih !important. Kalau
         dipaksa !important, dia bakal override style.display="none"
         yang di-set applyControlVisibility() buat nyembunyiin tombol
         P1 pas kita jadi client (P2) — itu penyebab bug tombol P1
         ikut nongol padahal harusnya cuma tombol P2 yang tampil.
         Tanpa !important, inline style dari JS tetap menang. */
      display: flex;
      align-items: center !important;
      justify-content: center !important;
      touch-action: none !important;
      -webkit-user-select: none !important;
      user-select: none !important;
    }

    /* --- Tombol LONCAT: pojok kiri bawah --- */
    #p1-jump, #p2-jump {
      left: 22px !important;
      right: auto !important;
      bottom: 28px !important;
      width: 76px !important;
      height: 76px !important;
    }
    /* Kalau P1 & P2 dua-duanya aktif (co-op 1 device), tumpuk jangan nindih */
    #p2-jump { bottom: 118px !important; }

    /* --- Tombol KIRI/KANAN: pojok kanan bawah, berdampingan --- */
    #p1-left, #p1-right, #p2-left, #p2-right {
      left: auto !important;
      bottom: 34px !important;
    }
    #p1-right { right: 22px !important; }
    #p1-left  { right: 96px !important; }
    #p2-right { right: 22px !important; bottom: 124px !important; }
    #p2-left  { right: 96px !important; bottom: 124px !important; }
  `;
  document.head.appendChild(style);
}
applyMobileControlLayout();

// Sembunyikan tombol yang bukan tanggung jawab device ini:
// - Client (device ini = P2): tombol P1 disembunyikan.
// - Host yang sudah terhubung ke client (device ini = P1, P2 dikontrol jarak jauh): tombol P2 disembunyikan.
// - Solo/local co-op (belum connect siapa-siapa): dua-duanya tetap tampil, seperti semula.
function applyControlVisibility() {
  const showP1 = myRole !== "client";
  const showP2 = !(myRole === "host" && net.connected);
  ["p1-left", "p1-right", "p1-jump"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = showP1 ? "" : "none";
  });
  ["p2-left", "p2-right", "p2-jump"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = showP2 ? "" : "none";
  });
}

// ---------------- VISIBILITY TOMBOL "MAIN BERDUA" ----------------
// Tombol & badge status koneksi ini cuma relevan di layar PILIH LEVEL
// (#select-screen). Begitu user masuk main level (#play-screen), kedua
// elemen ini WAJIB disembunyikan supaya tidak numpang di atas area
// game. Dipanggil manual di setiap transisi layar (startLevel,
// startLevelAsClient, backToSelect) karena elemen ini di-inject lewat
// JS langsung ke <body>, jadi tidak otomatis ikut ke-hide bareng
// #select-screen lewat class "hidden".
function hideMultiplayerUI() {
  const btn = document.getElementById("mp-toggle-btn");
  const badge = document.getElementById("mp-badge");
  if (btn) btn.style.display = "none";
  if (badge) badge.style.display = "none";
}

function restoreMultiplayerUI() {
  const btn = document.getElementById("mp-toggle-btn");
  const badge = document.getElementById("mp-badge");
  // Invitee paksa (numpang sesi host) memang tidak pernah boleh lihat
  // tombol ini sama sekali, apapun state-nya.
  if (isForcedInviteeClient) return;

  if (net.connected) {
    // Sudah terhubung ke temen: yang muncul cukup badge status,
    // tombol toggle tetap disembunyikan (perilaku aslinya).
    if (badge) badge.style.display = "block";
  } else {
    if (btn) btn.style.display = "block";
  }
}

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
    // has_access = sudah bayar (is_paid) ATAU lagi jadi invitee aktif
    // di room seorang host (akses gratis lewat kode undangan).
    if (!me.user.has_access) {
      gateOverlay.classList.remove("hidden");
      window.PaymentGate?.refreshGateStatus?.();
      return;
    }
    const levelsRes = await api("/api/levels");
    progressMap = levelsRes.progress || {};
    const res = await fetch("/js/levels.json");
    levelsData = await res.json();

    // User yang diundang gratis (belum bayar, tapi lagi aktif jadi
    // invitee di room seorang host): langsung sambungkan otomatis
    // sebagai Player 2, JANGAN tampilkan halaman pilih level sama
    // sekali. Dia cuma ikut sesi host, levelnya host yang pilih.
    if (me.user.free_room_code && !me.user.is_paid) {
      isForcedInviteeClient = true;
      initMultiplayerUI();
      document.getElementById("mp-toggle-btn").style.display = "none";
      document.getElementById("select-screen").classList.add("hidden");

      const waitScreen = document.getElementById("mp-wait-screen");
      document.getElementById("mp-wait-title").textContent = "Menghubungkan ke room host...";
      document.getElementById("mp-wait-sub").textContent = "Mohon tunggu sebentar";
      waitScreen.style.display = "flex";

      try {
        currentRoomCode = me.user.free_room_code;
        await net.joinRoom(currentRoomCode);
      } catch (e) {
        document.getElementById("mp-wait-title").textContent = "Gagal terhubung ke room host";
        document.getElementById("mp-wait-sub").textContent = "Coba refresh halaman, atau minta host generate kode baru.";
      }
      return;
    }

    document.getElementById("select-screen").classList.remove("hidden");
    renderLevelSelect();
    initMultiplayerUI();
    restoreMultiplayerUI();
    initResetProgressUI();
  } catch (err) {
    if (err.status === 402) {
      gateOverlay.classList.remove("hidden");
      window.PaymentGate?.refreshGateStatus?.();
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
    btn.addEventListener("click", () => {
      startLevel(i);
      // Kalau device ini Host dan sudah terhubung ke temen, kasih tau
      // dia harus mulai level yang sama juga di device-nya.
      if (net.connected && net.isHost()) net.sendStart(i);
    });
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
  hideMultiplayerUI();
  resizeCanvas();
  running = true;
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function backToSelect() {
  running = false;
  clientRunning = false;
  victoryModal.classList.add("hidden");
  document.getElementById("play-screen").classList.add("hidden");

  if (myRole === "client") {
    // Client tidak memilih level sendiri; balik ke layar "menunggu host".
    document.getElementById("mp-wait-screen").style.display = "flex";
    hideMultiplayerUI();
    return;
  }

  document.getElementById("select-screen").classList.remove("hidden");
  renderLevelSelect();
  restoreMultiplayerUI();
}

async function onLevelComplete() {
  running = false;
  clientRunning = false;
  try {
    await api("/api/progress", {
      method: "POST",
      body: JSON.stringify({ level_id: currentLevelId, time_ms: Math.round(currentLevel.elapsedMs) }),
    });
    progressMap[currentLevelId] = { completed: 1, best_time_ms: Math.round(currentLevel.elapsedMs) };
  } catch (e) { /* biar tetap bisa lanjut walau gagal simpan progress */ }

  // Di mode multiplayer, cuma Host yang boleh pilih "ulang" / "level
  // berikutnya" (biar levelnya tetap sinkron buat berdua). Client
  // tinggal menunggu Host memulai level berikutnya.
  const isClient = myRole === "client";
  btnNextLevel.disabled = isClient;
  btnRestart.disabled = isClient;

  victoryModal.classList.remove("hidden");
}

// ============================================================
// FIX (kamera kezoom kegedean di HP, rintangan nggak keliatan):
// ------------------------------------------------------------
// Sebelumnya scale = viewH / currentLevel.height (fit-to-height
// murni). Di HP viewport tinggi (viewH besar, mis. ~1900+ px logis
// karena address bar nyembul-ilang dihitung ResizeObserver), scale
// yang dihasilkan jadi cukup besar sehingga dunia game "dizoom
// dekat" -- yang kelihatan di layar cuma sepotong kecil area dekat
// pemain (tanah + karakter), sementara rintangan yang sedikit lebih
// jauh (kiri/kanan/atas) ke-crop di luar frame kamera.
//
// getCameraScale() menambahkan faktor ZOOM_OUT (<1) supaya area
// dunia yang tampil di layar lebih luas (kamera ditarik mundur),
// dipakai KONSISTEN oleh host (loop) maupun client (clientLoop)
// supaya framing di kedua device sama-sama proporsional.
// ============================================================
const ZOOM_OUT = 0.62; // <1 = kamera ditarik mundur (area terlihat lebih luas)

function getCameraScale() {
  return (viewH / currentLevel.height) * ZOOM_OUT;
}

function computeCamera(level, scale) {
  const viewWorldWidth = viewW / scale;
  // Kamera dipusatkan berdasar titik tengah kedua pemain secara
  // horizontal, dan digeser vertikal sedikit ke bawah supaya area di
  // ATAS pemain (tempat rintangan/platform sering ditaruh) tetap
  // masuk frame, bukan cuma area persis di bawah kaki pemain.
  const camX = Math.max(0, Math.min(
    (level.player1.x + level.player2.x) / 2 - viewWorldWidth / 2,
    Math.max(0, level.width - viewWorldWidth)
  ));
  return { camX, viewWorldWidth };
}

function loop(now) {
  if (!running) return;
  const dt = Math.min((now - lastTime) / 1000, 1 / 30);
  lastTime = now;

  // Kalau device ini Host dan sudah terhubung, input P2 diambil dari
  // data yang dikirim client lewat WebRTC (bukan dari tombol lokal),
  // supaya P2 beneran dikontrol dari device lain.
  const frameInput = {
    p1: input.p1,
    p2: (net.connected && net.isHost()) ? net.remoteInput : input.p2,
  };

  currentLevel.update(dt, frameInput);

  const scale = getCameraScale();
  const { camX } = computeCamera(currentLevel, scale);
  currentLevel.render(ctx, { x: camX, scale });

  const secs = currentLevel.elapsedMs / 1000;
  hudTimer.textContent = `${secs.toFixed(1)}s`;

  // Host mengirim snapshot posisi ke client sekitar 30x/detik
  // (dibagi 2 dari rAF 60fps) supaya hemat bandwidth tapi tetap halus.
  // NOTE: camX & scale tetap dikirim di snapshot untuk kompatibilitas /
  // debugging, TAPI client menghitung kamera miliknya sendiri
  // berdasarkan ukuran layarnya sendiri (lihat clientLoop di bawah).
  if (net.connected && net.isHost()) {
    netSendCounter++;
    if (netSendCounter % 2 === 0) {
      net.sendState(snapshotState(currentLevel, camX, scale));
    }
  }

  if (currentLevel.completed) {
    onLevelComplete();
    return;
  }
  requestAnimationFrame(loop);
}

// ---------------- CLIENT-SIDE RENDER LOOP (device P2) ----------------
// Client TIDAK menjalankan currentLevel.update() sendiri (supaya tidak
// selisih/drift dengan host). Client cuma: kirim input lokalnya ke host,
// lalu render ulang berdasarkan snapshot posisi yang diterima dari host.

function startLevelAsClient(levelId) {
  currentLevelId = levelId;
  const def = levelsData.find((l) => l.id === levelId);
  currentLevel = new GameLevel(def);
  hudLevelName.textContent = `Level ${levelId}`;
  document.getElementById("select-screen")?.classList.add("hidden");
  document.getElementById("mp-wait-screen").style.display = "none";
  document.getElementById("play-screen").classList.remove("hidden");
  hideMultiplayerUI();
  resizeCanvas();
  clientCompletedHandled = false;
  clientRunning = true;
  requestAnimationFrame(clientLoop);
}

function clientLoop() {
  if (!clientRunning) return;

  // Kirim input lokal device ini (selalu berperan sebagai P2) ke host.
  net.sendInput(input.p2);

  if (latestRemoteState) {
    applyStateToLevel(currentLevel, latestRemoteState);
    const secs = currentLevel.elapsedMs / 1000;
    hudTimer.textContent = `${secs.toFixed(1)}s`;

    // ============================================================
    // FIX (kamera client ikut layar sendiri, BUKAN layar host):
    // ------------------------------------------------------------
    // Client TIDAK memakai camX/scale kiriman host (yang dihitung
    // memakai viewW/viewH milik HOST), karena rasio layar bisa beda
    // jauh (mis. HP portrait vs laptop lebar) sehingga framing "pas"
    // buat host belum tentu mencakup posisi karakter di layar client.
    // Kamera dihitung ULANG secara lokal di sini, memakai fungsi
    // getCameraScale()/computeCamera() yang SAMA dengan host, tapi
    // dengan viewW/viewH milik device client sendiri. Ini juga
    // otomatis membereskan kasus P1 & P2 terpisah jauh.
    // ============================================================
    const scale = getCameraScale();
    const { camX } = computeCamera(currentLevel, scale);
    currentLevel.render(ctx, { x: camX, scale });

    if (currentLevel.completed && !clientCompletedHandled) {
      clientCompletedHandled = true;
      clientRunning = false;
      onLevelComplete();
      return;
    }
  }

  requestAnimationFrame(clientLoop);
}

function snapshotState(level, camX, scale) {
  return {
    camX,
    scale,
    elapsedMs: level.elapsedMs,
    completed: level.completed,
    player1: { x: level.player1.x, y: level.player1.y, facing: level.player1.facing },
    player2: { x: level.player2.x, y: level.player2.y, facing: level.player2.facing },
    boxes: level.boxes.map((b) => ({ x: b.x, y: b.y })),
    movingPlatforms: level.movingPlatforms.map((m) => ({ x: m.x, y: m.y })),
    plateState: level.plateState,
    keysCollected: Array.from(level.keysCollected),
    doorOpenOverride: Array.from(level.doorOpenOverride),
  };
}

function applyStateToLevel(level, state) {
  level.player1.x = state.player1.x; level.player1.y = state.player1.y; level.player1.facing = state.player1.facing;
  level.player2.x = state.player2.x; level.player2.y = state.player2.y; level.player2.facing = state.player2.facing;
  state.boxes.forEach((b, i) => { if (level.boxes[i]) { level.boxes[i].x = b.x; level.boxes[i].y = b.y; } });
  state.movingPlatforms.forEach((m, i) => { if (level.movingPlatforms[i]) { level.movingPlatforms[i].x = m.x; level.movingPlatforms[i].y = m.y; } });
  level.plateState = state.plateState;
  level.keysCollected = new Set(state.keysCollected);
  level.doorOpenOverride = new Set(state.doorOpenOverride);
  level.elapsedMs = state.elapsedMs;
  level.completed = state.completed;
}

// ---------------- UI MULTIPLAYER (dibuat lewat JS, tanpa perlu ubah HTML) ----------------
function initMultiplayerUI() {
  const btn = document.createElement("button");
  btn.id = "mp-toggle-btn";
  btn.textContent = "🔗 Main Berdua";
  Object.assign(btn.style, {
    position: "fixed", top: "64px", right: "14px", zIndex: "9999",
    padding: "10px 16px", borderRadius: "10px", border: "none",
    background: "#ff8c3b", color: "#1a1200", fontWeight: "700",
    fontFamily: "sans-serif", fontSize: "13px", cursor: "pointer",
    boxShadow: "0 6px 18px rgba(0,0,0,.25)",
  });
  document.body.appendChild(btn);

  const modal = document.createElement("div");
  modal.id = "mp-modal";
  Object.assign(modal.style, {
    position: "fixed", inset: "0", background: "rgba(10,8,16,.72)",
    display: "none", alignItems: "center", justifyContent: "center", zIndex: "10000",
  });
  modal.innerHTML = `
    <div style="background:#201c33;border:1px solid #372f52;border-radius:14px;padding:24px;max-width:360px;width:90vw;font-family:sans-serif;color:#eeeaf7;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <b style="font-size:15px;">Main Berdua (beda device)</b>
        <span id="mp-close" style="cursor:pointer;color:#a29dc2;">✕</span>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:16px;">
        <button id="mp-tab-host" style="flex:1;padding:8px;border-radius:8px;border:1px solid #372f52;background:#262040;color:#eeeaf7;cursor:pointer;">Buat Room</button>
        <button id="mp-tab-join" style="flex:1;padding:8px;border-radius:8px;border:1px solid #372f52;background:#262040;color:#eeeaf7;cursor:pointer;">Join Room</button>
      </div>
      <div id="mp-pane-host">
        <p style="font-size:13px;color:#a29dc2;margin:0 0 10px;">Bikin room, lalu kirim kode ini ke temen kamu. Kode ini juga bisa dipakai temenmu buat main gratis tanpa bayar.</p>
        <button id="mp-btn-create" style="width:100%;padding:12px;border-radius:9px;border:none;background:#ff8c3b;color:#1a1200;font-weight:700;cursor:pointer;">BUAT ROOM</button>
        <div id="mp-room-code" style="display:none;text-align:center;margin-top:14px;padding:14px;border:1px dashed #ff8c3b;border-radius:10px;font-family:monospace;font-size:20px;letter-spacing:2px;color:#ff8c3b;"></div>
        <div id="mp-host-status" style="margin-top:10px;font-size:13px;color:#a29dc2;"></div>
      </div>
      <div id="mp-pane-join" style="display:none;">
        <p style="font-size:13px;color:#a29dc2;margin:0 0 10px;">Masukin kode room dari temen kamu.</p>
        <input id="mp-join-input" placeholder="DUO-XXXX" style="width:100%;padding:12px;border-radius:9px;border:1px solid #372f52;background:#12101c;color:#eeeaf7;font-family:monospace;font-size:14px;box-sizing:border-box;">
        <button id="mp-btn-join" style="width:100%;margin-top:10px;padding:12px;border-radius:9px;border:none;background:#ff8c3b;color:#1a1200;font-weight:700;cursor:pointer;">CONNECT</button>
        <div id="mp-join-status" style="margin-top:10px;font-size:13px;color:#a29dc2;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const badge = document.createElement("div");
  badge.id = "mp-badge";
  Object.assign(badge.style, {
    position: "fixed", top: "64px", right: "14px", zIndex: "9999",
    display: "none", padding: "10px 16px", borderRadius: "10px",
    background: "#201c33", border: "1px solid #372f52", color: "#7ee08a",
    fontFamily: "monospace", fontSize: "12.5px",
  });
  document.body.appendChild(badge);

  const waitScreen = document.createElement("div");
  waitScreen.id = "mp-wait-screen";
  Object.assign(waitScreen.style, {
    display: "none", position: "fixed", inset: "0", background: "#12101c",
    color: "#eeeaf7", alignItems: "center", justifyContent: "center",
    flexDirection: "column", fontFamily: "sans-serif", zIndex: "500",
    textAlign: "center", padding: "20px",
  });
  waitScreen.innerHTML = `
    <div id="mp-wait-title" style="font-size:16px;margin-bottom:8px;">Terhubung sebagai Player 2 🎮</div>
    <div id="mp-wait-sub" style="color:#a29dc2;font-size:13px;">Menunggu host memilih level...</div>
  `;
  document.body.appendChild(waitScreen);

  btn.addEventListener("click", () => { modal.style.display = "flex"; });
  document.getElementById("mp-close").addEventListener("click", () => { modal.style.display = "none"; });
  document.getElementById("mp-tab-host").addEventListener("click", () => {
    document.getElementById("mp-pane-host").style.display = "block";
    document.getElementById("mp-pane-join").style.display = "none";
  });
  document.getElementById("mp-tab-join").addEventListener("click", () => {
    document.getElementById("mp-pane-host").style.display = "none";
    document.getElementById("mp-pane-join").style.display = "block";
  });

  document.getElementById("mp-btn-create").addEventListener("click", async () => {
    const statusEl = document.getElementById("mp-host-status");
    statusEl.textContent = "Membuat room...";
    try {
      // Kode room sekarang di-generate & disimpan lewat backend (bukan
      // random di client lagi), supaya invitee bisa redeem akses gratis
      // lewat /api/room/join pakai kode yang sama persis.
      const created = await api("/api/room/create", { method: "POST" });
      currentRoomCode = created.code;
      const code = await net.hostRoom(created.code);
      document.getElementById("mp-room-code").style.display = "block";
      document.getElementById("mp-room-code").textContent = code;
      statusEl.textContent = "Room siap. Menunggu temen connect...";
    } catch (e) {
      statusEl.textContent = e.error || "Gagal membuat room, coba lagi.";
    }
  });

  document.getElementById("mp-btn-join").addEventListener("click", async () => {
    const code = document.getElementById("mp-join-input").value.trim().toUpperCase();
    const statusEl = document.getElementById("mp-join-status");
    if (!code) { statusEl.textContent = "Isi kode room dulu."; return; }
    statusEl.textContent = "Menghubungkan...";
    try {
      currentRoomCode = code;
      await net.joinRoom(code);
      statusEl.textContent = "Terhubung!";
    } catch (e) {
      statusEl.textContent = "Gagal connect. Cek lagi kode room-nya.";
    }
  });

  net.onPeerConnected = () => {
    myRole = net.role; // "host" atau "client"
    modal.style.display = "none";
    badge.textContent = net.isHost() ? "🟢 Terhubung — kamu Host (P1)" : "🟢 Terhubung — kamu Player 2";
    btn.style.display = "none";
    applyControlVisibility();

    // Badge status cuma dimunculkan kalau memang lagi di layar pilih
    // level. Kalau koneksi ini kebentuk pas user udah di play-screen
    // (mis. host baru selesai share kode di modal sambil level jalan),
    // biarkan hideMultiplayerUI() yang sedang aktif tetap berlaku.
    const inSelectScreen = !document.getElementById("select-screen")?.classList.contains("hidden");
    badge.style.display = inSelectScreen ? "block" : "none";

    if (net.isClient()) {
      document.getElementById("select-screen")?.classList.add("hidden");
      document.getElementById("mp-wait-title").textContent = "Terhubung sebagai Player 2 🎮";
      document.getElementById("mp-wait-sub").textContent = "Menunggu host memilih level...";
      waitScreen.style.display = "flex";
      badge.style.display = "none";
    }
  };

  net.onPeerDisconnected = () => {
    badge.style.display = "none";
    waitScreen.style.display = "none";
    applyControlVisibility();
    restoreMultiplayerUI();

    // Kalau device ini HOST dan sempat punya room aktif, anggap
    // temannya baru saja keluar/disconnect: hapus baris room di
    // database secara permanen supaya kode itu otomatis hangus.
    // Host wajib klik "Buat Room" lagi untuk dapat kode baru.
    if (myRole === "host" && currentRoomCode) {
      const codeToRevoke = currentRoomCode;
      currentRoomCode = null;
      document.getElementById("mp-room-code").style.display = "none";
      document.getElementById("mp-host-status").textContent = "Temanmu keluar, kode room ini sudah hangus.";
      api("/api/room/leave", { method: "POST", body: JSON.stringify({ code: codeToRevoke }) }).catch(() => {});
    }

    // Device ini invitee gratis yang otomatis di-connect-kan: begitu
    // host disconnect, aksesnya kemungkinan sudah dicabut juga
    // (room-nya dihapus dari sisi host). Reload supaya /api/me
    // dicek ulang dan dia balik ke gate kalau memang sudah dicabut.
    if (isForcedInviteeClient) {
      window.location.reload();
    }
  };

  net.onStartReceived = (levelId) => {
    startLevelAsClient(levelId);
  };

  net.onStateReceived = (state) => {
    latestRemoteState = state;
  };
}

// Fallback best-effort: kalau sisi CLIENT (invitee) yang nutup tab/
// keluar duluan (bukan host yang mendeteksi disconnect), coba beri
// tahu backend juga supaya room-nya kehapus lebih cepat. Ini cuma
// jaring pengaman tambahan — jalur utama tetap lewat onPeerDisconnected
// di sisi host.
window.addEventListener("beforeunload", () => {
  if (myRole === "client" && currentRoomCode) {
    try {
      navigator.sendBeacon(
        "/api/room/leave",
        new Blob([JSON.stringify({ code: currentRoomCode })], { type: "application/json" })
      );
    } catch (e) { /* abaikan, ini cuma best-effort */ }
  }
});

// ---------------- RESET SEMUA LEVEL ----------------
// Konfirmasi pakai modal custom (bukan confirm() bawaan browser) biar
// konsisten sama tampilan lain di halaman ini. Endpoint yang dipanggil:
// POST /api/progress/reset — HARUS ada di backend, efeknya hapus semua
// baris progress milik user yang lagi login. Kalau backend belum punya
// endpoint ini, sesuaikan URL/method di bawah.
function initResetProgressUI() {
  if (!btnResetProgress || document.getElementById("reset-confirm-modal")) return;

  const modal = document.createElement("div");
  modal.id = "reset-confirm-modal";
  modal.className = "modal-overlay hidden";
  modal.innerHTML = `
    <div class="modal-card">
      <h2>⚠️ Reset Semua Level?</h2>
      <p style="color:var(--text-dim)">Semua progress level yang udah kamu selesaikan bakal dihapus dan gak bisa dibalikin lagi. Yakin mau lanjut?</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="reset-confirm-cancel">Batal</button>
        <button class="btn btn-danger" id="reset-confirm-ok">Ya, Reset</button>
      </div>
      <div class="error-msg" id="reset-confirm-error"></div>
    </div>
  `;
  document.body.appendChild(modal);

  const errEl = document.getElementById("reset-confirm-error");

  btnResetProgress.addEventListener("click", () => {
    errEl.textContent = "";
    modal.classList.remove("hidden");
  });

  document.getElementById("reset-confirm-cancel").addEventListener("click", () => {
    modal.classList.add("hidden");
  });

  document.getElementById("reset-confirm-ok").addEventListener("click", async () => {
    const okBtn = document.getElementById("reset-confirm-ok");
    okBtn.disabled = true;
    errEl.textContent = "";
    try {
      await api("/api/progress/reset", { method: "POST" });
      progressMap = {};
      modal.classList.add("hidden");
      renderLevelSelect();
    } catch (e) {
      errEl.textContent = e.error || "Gagal reset progress, coba lagi.";
    } finally {
      okBtn.disabled = false;
    }
  });
}


btnBackToSelect.addEventListener("click", backToSelect);
btnRestart.addEventListener("click", () => {
  victoryModal.classList.add("hidden");
  if (myRole === "client") return; // client menunggu host yang mulai ulang
  startLevel(currentLevelId);
  if (net.connected && net.isHost()) net.sendStart(currentLevelId);
});
btnNextLevel.addEventListener("click", () => {
  victoryModal.classList.add("hidden");
  if (myRole === "client") return; // client menunggu host yang pilih level berikutnya
  const next = Math.min(currentLevelId + 1, 100);
  startLevel(next);
  if (net.connected && net.isHost()) net.sendStart(next);
});

init();
