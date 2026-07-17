import { r2Key, getNftOwnerByFilename } from "../lib/store.js";
import { getUserFromRequest, isAdminRequest } from "../lib/session.js";
import { renderWatermarked } from "../lib/watermark.js";

const CONTENT_TYPES = {
  gif: "image/gif",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const WATERMARKABLE_EXT = new Set(["png", "jpg", "jpeg", "webp"]);

// GET /nft/asset/:encoded  ->  :encoded adalah base64url dari filename asli
// (mis. "ChillFlame.gif" -> "Q2hpbGxGbGFtZS5naWY"). Ini menyembunyikan nama
// file asli dari URL yang terlihat di address bar/Network tab.
//
// PROTEKSI:
// 1. Wajib login (getUserFromRequest) ATAU admin (isAdminRequest). Tanpa
//    keduanya -> 401.
// 2. Kepemilikan SPESIFIK per-file dicek lewat getNftOwnerByFilename(),
//    yang hanya menganggap sah kalau ada order berstatus "approved".
//    Login saja TIDAK cukup untuk dapat file asli.
// 3. User yang login tapi bukan pemilik file ini tetap dikasih preview,
//    versi watermark, bukan 403 polos -> supaya listing marketplace tetap
//    bisa menampilkan gambar ke calon pembeli.
function decodeBase64Url(encoded) {
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    return atob(padded + pad);
  } catch {
    return null;
  }
}

export async function handleAssetProxy(request, env, encodedFilename) {
  const filename = decodeBase64Url(encodedFilename);
  if (!filename) {
    return new Response("Not found", { status: 404 });
  }

  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (!CONTENT_TYPES[ext]) {
    return new Response("Not found", { status: 404 });
  }

  const [username, isAdmin] = await Promise.all([
    getUserFromRequest(request, env),
    isAdminRequest(request, env),
  ]);

  if (!username && !isAdmin) {
    return new Response("Unauthorized", { status: 401 });
  }

  const object = await env.NFT_R2.get(r2Key(filename));
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Disposition", "inline");
  headers.set("X-Content-Type-Options", "nosniff");
  if (object.httpEtag) headers.set("ETag", object.httpEtag);

  const owner = isAdmin ? null : await getNftOwnerByFilename(filename, env);
  const isOwner = Boolean(username) && owner === username;

  if (isOwner || isAdmin) {
    headers.set("Content-Type", CONTENT_TYPES[ext]);
    return new Response(object.body, { headers });
  }

  if (WATERMARKABLE_EXT.has(ext)) {
    try {
      const watermarked = await renderWatermarked(object.body, ext, env);
      headers.set("Content-Type", CONTENT_TYPES[ext]);
      return new Response(watermarked, { headers });
    } catch {
      return new Response("Forbidden", { status: 403 });
    }
  }

  return new Response("Forbidden", { status: 403 });
}

export function encodeFilenameToUrl(filename) {
  // Dipakai di lib/render.js untuk generate <img src="/nft/asset/<encoded>">
  const b64 = btoa(filename);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
