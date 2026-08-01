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

async function refreshGateStatus() {
  try {
    const res = await papi("/api/payment/status");
    if (res.is_paid) {
      window.location.reload();
      return;
    }
    if (res.latest_payment?.status === "pending") showGateState("pending");
    else if (res.latest_payment?.status === "rejected") {
      document.getElementById("reject-note").textContent = res.latest_payment.admin_note
        ? `Catatan admin: ${res.latest_payment.admin_note}`
        : "Bukti pembayaran tidak valid, silakan upload ulang.";
      showGateState("rejected");
    } else {
      showGateState("form");
    }
  } catch (e) { /* belum login atau error lain, biarkan game.js yang handle redirect */ }
}

// Cek status begitu halaman dimuat (kalau overlay memang tampil)
refreshGateStatus();
