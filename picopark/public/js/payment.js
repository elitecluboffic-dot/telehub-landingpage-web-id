async function papi(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data;
  return data;
}

const uploadBox = document.getElementById("upload-box");
const fileInput = document.getElementById("file-input");
const uploadPreview = document.getElementById("upload-preview");
const uploadPlaceholder = document.getElementById("upload-placeholder");
const gateForm = document.getElementById("gate-form");
const gatePending = document.getElementById("gate-pending");
const gateRejected = document.getElementById("gate-rejected");
const paymentError = document.getElementById("payment-error");

let compressedImageData = null;

uploadBox?.addEventListener("click", () => fileInput.click());

fileInput?.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  compressedImageData = await compressImage(file, 1000, 0.8);
  uploadPreview.src = compressedImageData;
  uploadPreview.classList.remove("hidden");
  uploadPlaceholder.classList.add("hidden");
});

// Resize + compress gambar di browser supaya ukuran base64 kecil (hemat kuota D1)
function compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) { height *= maxDim / width; width = maxDim; }
      else if (height > maxDim) { width *= maxDim / height; height = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.getElementById("btn-submit-payment")?.addEventListener("click", async () => {
  paymentError.textContent = "";
  if (!compressedImageData) { paymentError.textContent = "Upload bukti pembayaran dulu"; return; }
  const note = document.getElementById("payment-note").value.trim();
  try {
    await papi("/api/payment/upload", { method: "POST", body: JSON.stringify({ image_data: compressedImageData, note }) });
    showGateState("pending");
  } catch (e) {
    paymentError.textContent = e.error || "Gagal upload";
  }
});

document.getElementById("btn-refresh-status")?.addEventListener("click", refreshGateStatus);
document.getElementById("btn-retry-payment")?.addEventListener("click", () => showGateState("form"));

document.getElementById("btn-logout-gate")?.addEventListener("click", doLogout);
document.getElementById("btn-logout")?.addEventListener("click", doLogout);

async function doLogout() {
  try { await papi("/api/logout", { method: "POST" }); } catch (e) {}
  window.location.href = "/";
}

function showGateState(state) {
  gateForm.classList.toggle("hidden", state !== "form");
  gatePending.classList.toggle("hidden", state !== "pending");
  gateRejected.classList.toggle("hidden", state !== "rejected");
}

// ---------------------------------------------------------------
// KOTAK "PUNYA KODE UNDANGAN?" — dibuat lewat JS (tanpa perlu ubah
// HTML), sama seperti pola tombol "Main Berdua" di game.js. Ini
// SELALU tampil di gate overlay, apapun state form/pending/rejected
// di atasnya, karena user yang punya kode dari temannya harus bisa
// langsung masuk gratis kapan saja tanpa nunggu approval admin.
// ---------------------------------------------------------------
function injectInviteBox() {
  const gateOverlay = document.getElementById("gate-overlay");
  if (!gateOverlay || document.getElementById("invite-box")) return;

  const box = document.createElement("div");
  box.id = "invite-box";
  // PENTING: posisi "fixed" + width dalam % (bukan ikut layout flex/grid
  // punya gate-overlay yang aslinya). Ini sengaja dilepas total dari
  // struktur layout halaman supaya TIDAK ikut numpang/rusak kalau
  // gate-overlay pakai flex-row tanpa wrap (penyebab overflow horizontal
  // di HP kemarin). Selalu jadi 1 baris terpisah, mengambang di bawah,
  // dan lebarnya dibatasi max-width supaya rapi juga di desktop.
  box.style.cssText =
    "position:fixed;left:50%;bottom:14px;transform:translateX(-50%);" +
    "width:92vw;max-width:420px;box-sizing:border-box;z-index:99999;" +
    "padding:14px;border:1px dashed #ff8c3b;border-radius:10px;" +
    "background:#151225;font-family:sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35);";
  box.innerHTML = `
    <div style="font-size:13px;color:#a29dc2;margin-bottom:8px;">
      Punya kode undangan dari temen? Masukin di sini, main gratis tanpa bayar.
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <input id="invite-code-input" placeholder="DUO-XXXX" maxlength="20"
        style="flex:1 1 160px;min-width:0;padding:10px;border-radius:8px;border:1px solid #372f52;
        background:#12101c;color:#eeeaf7;font-family:monospace;font-size:14px;
        box-sizing:border-box;text-transform:uppercase;">
      <button id="invite-code-submit"
        style="flex:0 0 auto;padding:10px 16px;border-radius:8px;border:none;background:#ff8c3b;
        color:#1a1200;font-weight:700;cursor:pointer;white-space:nowrap;">Masuk</button>
    </div>
    <div id="invite-code-error" style="margin-top:6px;font-size:12.5px;color:#ff6b6b;"></div>
  `;
  gateOverlay.appendChild(box);

  const input = document.getElementById("invite-code-input");
  const errEl = document.getElementById("invite-code-error");

  const submit = async () => {
    errEl.textContent = "";
    const code = input.value.trim().toUpperCase();
    if (!code) { errEl.textContent = "Isi kode dulu"; return; }
    try {
      await papi("/api/room/join", { method: "POST", body: JSON.stringify({ code }) });
      window.location.reload();
    } catch (e) {
      errEl.textContent = e.error || "Kode tidak valid atau sudah hangus";
    }
  };

  document.getElementById("invite-code-submit").addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
}

injectInviteBox();

// ---------------------------------------------------------------
// PENTING: fungsi ini TIDAK dipanggil otomatis lagi di bagian bawah
// file ini. Sebelumnya ada `refreshGateStatus();` di baris terakhir
// yang jalan setiap kali script di-load (termasuk setelah reload),
// dan begitu is_paid true dia reload() lagi -> reload lagi -> infinite
// loop. Sekarang pemanggilannya dipindah supaya cuma terjadi:
//   1. Saat user klik tombol "Cek status" (listener di atas), atau
//   2. Sekali, dan HANYA ketika gate overlay memang sedang
//      ditampilkan (dipanggil dari game.js lewat window.PaymentGate).
//
// Ditambahin juga circuit breaker berbasis sessionStorage: kalaupun
// suatu saat ada bug lain yang memicu reload berulang, ini membatasi
// jumlah auto-reload jadi maksimal 1x per tab/session, jadi tidak
// akan pernah lagi sampai ribuan request seperti kemarin.
// ---------------------------------------------------------------
const RELOAD_GUARD_KEY = "tali_gate_auto_reload_done";

async function refreshGateStatus() {
  try {
    const res = await papi("/api/payment/status");

    // has_access mencakup is_paid=1 ATAU sedang jadi invitee aktif di
    // sebuah room (akses gratis lewat kode host).
    if (res.has_access) {
      const alreadyReloaded = sessionStorage.getItem(RELOAD_GUARD_KEY) === "1";
      if (alreadyReloaded) {
        // Sudah pernah auto-reload sekali di session ini tapi has_access
        // masih true dan kita masih di halaman gate — berarti ada
        // masalah lain (misal game.js belum sempat baca status baru).
        // Jangan reload lagi, biar tidak infinite loop; cukup
        // sembunyikan overlay manual lewat reload biasa oleh user
        // via tombol, atau tampilkan pesan.
        console.warn("[PaymentGate] has_access=true tapi sudah pernah auto-reload sebelumnya. Reload dihentikan untuk cegah loop.");
        return;
      }
      sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
      window.location.reload();
      return;
    }

    if (res.latest_payment?.status === "pending") {
      showGateState("pending");
    } else if (res.latest_payment?.status === "rejected") {
      document.getElementById("reject-note").textContent = res.latest_payment.admin_note
        ? `Catatan admin: ${res.latest_payment.admin_note}`
        : "Bukti pembayaran tidak valid, silakan upload ulang.";
      showGateState("rejected");
    } else {
      showGateState("form");
    }
  } catch (e) {
    /* belum login atau error lain, biarkan game.js yang handle redirect */
  }
}

// Dipakai oleh game.js: hanya dipanggil sekali, dan hanya ketika
// gate overlay memang sedang ditampilkan (user belum bayar / status
// belum jelas). Lihat catatan integrasi di bawah.
window.PaymentGate = { refreshGateStatus, showGateState };
