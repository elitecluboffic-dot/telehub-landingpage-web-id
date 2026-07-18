import { PhotonImage, draw_text, resize, SamplingFilter } from "@cf-wasm/photon/workerd";

// Batas dimensi maksimum untuk preview watermark. Gambar preview memang
// tidak perlu resolusi penuh, dan ini penting untuk menjaga proses tiling
// tetap ringan agar tidak melebihi batas CPU time Cloudflare Workers.
const MAX_PREVIEW_DIM = 800;

// Teks watermark yang di-tile berulang. Tidak butuh file logo eksternal
// sama sekali -> tidak ada dependency ke R2 asset yang bisa gagal/hilang.
const WATERMARK_TEXT = "TELEHUB PREVIEW";

// Menempelkan teks watermark berulang (tiled) di seluruh permukaan gambar,
// dengan pola offset baris supaya membentuk grid diagonal/staggered. Ini
// jauh lebih sulit dihilangkan lewat crop atau clone-stamp dibanding satu
// watermark di pojok, karena menutupi semua bagian gambar secara merata
// dan polanya tidak lurus.
function tileWatermarkText(workingImage) {
  const imgW = workingImage.get_width();
  const imgH = workingImage.get_height();

  // Perkiraan lebar & tinggi blok teks pada ukuran font default photon,
  // dipakai untuk menentukan jarak antar tile.
  const approxTextW = WATERMARK_TEXT.length * 14;
  const approxTextH = 40;

  const stepX = Math.max(approxTextW + 20, 40);
  const stepY = Math.max(approxTextH + 30, 40);

  // Batas pengaman jumlah tile maksimum, supaya proses tidak meledak
  // jumlah panggilan draw_text()-nya dan berisiko kena limit CPU time.
  const MAX_TILES = 200;
  let tileCount = 0;

  let rowIndex = 0;
  outer:
  for (let y = 0; y < imgH; y += stepY) {
    // Offset horizontal berselang-seling per baris supaya polanya membentuk
    // grid diagonal/staggered, bukan grid lurus yang gampang "dibaca"
    // polanya dan di-clone-stamp hilang.
    const rowOffset = rowIndex % 2 === 0 ? 0 : Math.floor(stepX / 2);
    rowIndex++;

    for (let x = -approxTextW + rowOffset; x < imgW; x += stepX) {
      if (tileCount >= MAX_TILES) break outer;
      const drawX = Math.max(0, Math.min(x, imgW - 1));
      const drawY = Math.max(0, Math.min(y, imgH - 1));
      draw_text(workingImage, WATERMARK_TEXT, drawX, drawY);
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

    tileWatermarkText(workingImage);

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

    tileWatermarkText(workingImage);

    return workingImage.get_bytes(); // selalu PNG
  } finally {
    workingImage.free();
  }
}
