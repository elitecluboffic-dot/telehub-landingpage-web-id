import { PhotonImage, watermark } from "@cf-wasm/photon";

let cachedLogo = null;

async function getWatermarkImage(env) {
  if (cachedLogo) return cachedLogo;
  const obj = await env.NFT_R2.get("_assets/watermark-logo.png");
  if (!obj) throw new Error("Watermark logo tidak ditemukan di R2 (_assets/watermark-logo.png)");
  const bytes = new Uint8Array(await obj.arrayBuffer());
  cachedLogo = PhotonImage.new_from_byteslice(bytes);
  return cachedLogo;
}

export async function renderWatermarked(imageBody, ext, env) {
  const inputBytes = new Uint8Array(await new Response(imageBody).arrayBuffer());
  const inputImage = PhotonImage.new_from_byteslice(inputBytes);

  try {
    const logo = await getWatermarkImage(env);

    const w = inputImage.get_width();
    const h = inputImage.get_height();
    const logoW = Math.floor(w * 0.25);
    const x = w - logoW - 12;
    const y = h - Math.floor(logoW * 0.4) - 12;

    watermark(inputImage, logo, BigInt(x), BigInt(y));

    const outBytes =
      ext === "png" ? inputImage.get_bytes() : inputImage.get_bytes_jpeg(75);

    return outBytes;
  } finally {
    inputImage.free();
  }
}
