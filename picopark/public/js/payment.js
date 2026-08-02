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
//
// CATATAN FIX (sebelumnya `position:fixed` + `92vw`):
// Fixed positioning bikin kotak ini lepas total dari alur .gate-card
// dan nempel di koordinat viewport tetap — begitu tinggi konten
// gate-card berubah, kotak ini malah numpuk/overlap di atas konten
// lain (itu penyebab tampilan kepotong & bertabrakan di HP kemarin,
// diperparah `92vw` yang di beberapa in-app browser dihitung dari
// layout viewport, bukan visual viewport, jadi lebih lebar dari layar).
// Sekarang di-append sebagai elemen statis di DALAM .gate-card, ikut
// alur dokumen normal, dan styling-nya dipindah ke style.css
// (#invite-box) supaya konsisten & gampang di-maintain.
// ---------------------------------------------------------------
function injectInviteBox() {
  const gateCard = document.querySelector("#gate-overlay .gate-card");
  if (!gateCard || document.getElementById("invite-box")) return;

  const box = document.createElement("div");
  box.id = "invite-box";
  box.innerHTML = `
    <div class="invite-desc">
      Punya kode undangan dari temen? Masukin di sini, main gratis tanpa bayar.
    </div>
    <div class="invite-row">
      <input id="invite-code-input" placeholder="DUO-XXXX" maxlength="20">
      <button id="invite-code-submit">Masuk</button>
    </div>
    <div id="invite-code-error"></div>
  `;
  gateCard.appendChild(box);

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
