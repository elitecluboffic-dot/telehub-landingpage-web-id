import { PhotonImage, watermark, resize, SamplingFilter } from "@cf-wasm/photon/workerd";

let cachedLogo = null;

// Batas dimensi maksimum untuk preview watermark. Gambar preview memang
// tidak perlu resolusi penuh, dan ini penting untuk menjaga proses tiling
// tetap ringan agar tidak melebihi batas CPU time Cloudflare Workers.
const MAX_PREVIEW_DIM = 800;

async function getWatermarkImage(env) {
  if (cachedLogo) return cachedLogo;
  const obj = await env.NFT_R2.get("_assets/watermark-logo.png");
  if (!obj) {
    throw new Error("Watermark logo tidak ditemukan di R2 (_assets/watermark-logo.png)");
  }
  const bytes = new Uint8Array(await obj.arrayBuffer());
  cachedLogo = PhotonImage.new_from_byteslice(bytes);
  return cachedLogo;
}

// Menempelkan watermark berulang (tiled) di seluruh permukaan gambar, dengan
// pola offset baris supaya membentuk grid diagonal/staggered. Ini jauh lebih
// sulit dihilangkan lewat crop atau clone-stamp dibanding satu logo di
// pojok, karena watermark menutupi semua bagian gambar secara merata dan
// polanya tidak lurus.
function tileWatermark(workingImage, logo) {
  const imgW = workingImage.get_width();
  const imgH = workingImage.get_height();
  const logoW = logo.get_width();
  const logoH = logo.get_height();

  // Jarak antar tile. Dibuat < ukuran logo supaya ada sedikit overlap,
  // memastikan tidak ada celah kosong tanpa watermark di gambar.
  const stepX = Math.max(Math.floor(logoW * 0.85), 1);
  const stepY = Math.max(Math.floor(logoH * 0.85), 1);

  // Batas pengaman jumlah tile maksimum, supaya untuk kasus logo sangat
  // kecil relatif ke gambar, proses tetap tidak meledak jumlah panggilan
  // watermark()-nya dan berisiko kena limit CPU time Worker.
  const MAX_TILES = 400;
  let tileCount = 0;

  let rowIndex = 0;
  outer:
  for (let y = -logoH; y < imgH + logoH; y += stepY) {
    // Offset horizontal berselang-seling per baris supaya polanya membentuk
    // grid diagonal/staggered, bukan grid lurus yang gampang "dibaca"
    // polanya dan di-clone-stamp hilang.
    const rowOffset = rowIndex % 2 === 0 ? 0 : Math.floor(stepX / 2);
    rowIndex++;

    for (let x = -logoW + rowOffset; x < imgW + logoW; x += stepX) {
      if (tileCount >= MAX_TILES) break outer;
      watermark(workingImage, logo, BigInt(x), BigInt(y));
      tileCount++;
    }
  }
}

// Dipakai untuk PNG/JPG/WEBP: watermark tiled, output format sama seperti
// aslinya (tetap png/jpg/webp).
export async function renderWatermarked(imageBody, ext, env) {
  const inputBytes = new Uint8Array(await new Response(imageBody).arrayBuffer());
  let workingImage = PhotonImage.new_from_byteslice(inputBytes);

  try {
    const originalW = workingImage.get_width();
    const originalH = workingImage.get_height();

    // Resize dulu kalau gambar lebih besar dari batas preview, supaya
    // proses tiling watermark tidak butuh terlalu banyak panggilan dan
    // tetap ringan di Worker.
    if (originalW > MAX_PREVIEW_DIM || originalH > MAX_PREVIEW_DIM) {
      const scale = MAX_PREVIEW_DIM / Math.max(originalW, originalH);
      const resized = resize(
        workingImage,
        Math.max(1, Math.floor(originalW * scale)),
        Math.max(1, Math.floor(originalH * scale)),
        SamplingFilter.Nearest
      );
      workingImage.free();
      workingImage = resized;
    }

    const logo = await getWatermarkImage(env);
    tileWatermark(workingImage, logo);

    const outBytes =
      ext === "png" ? workingImage.get_bytes() : workingImage.get_bytes_jpeg(80);

    return outBytes;
  } finally {
    workingImage.free();
  }
}

// Untuk GIF: PhotonImage.new_from_byteslice hanya membaca FRAME PERTAMA dari
// GIF (bukan animasi penuh). Ini kita manfaatkan untuk bikin preview statis
// ber-watermark, supaya calon pembeli tetap bisa lihat gambaran NFT sebelum
// beli, tapi animasi penuhnya tetap eksklusif untuk pemilik/admin. Preview
// GIF SELALU dikembalikan sebagai PNG statis (bukan gif), supaya jelas beda
// dari file asli.
export async function renderGifPreview(imageBody, env) {
  const inputBytes = new Uint8Array(await new Response(imageBody).arrayBuffer());
  let workingImage = PhotonImage.new_from_byteslice(inputBytes);

  try {
    const originalW = workingImage.get_width();
    const originalH = workingImage.get_height();

    if (originalW > MAX_PREVIEW_DIM || originalH > MAX_PREVIEW_DIM) {
      const scale = MAX_PREVIEW_DIM / Math.max(originalW, originalH);
      const resized = resize(
        workingImage,
        Math.max(1, Math.floor(originalW * scale)),
        Math.max(1, Math.floor(originalH * scale)),
        SamplingFilter.Nearest
      );
      workingImage.free();
      workingImage = resized;
    }

    const logo = await getWatermarkImage(env);
    tileWatermark(workingImage, logo);

    return workingImage.get_bytes(); // selalu PNG
  } finally {
    workingImage.free();
  }
}
