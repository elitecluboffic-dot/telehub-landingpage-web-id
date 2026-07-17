import { r2Key } from "../lib/store.js";
import { getUserFromRequest, isAdminRequest } from "../lib/session.js";

const CONTENT_TYPES = {
  gif: "image/gif",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

// GET /nft/asset/:encoded  ->  :encoded adalah base64url dari filename asli
// (mis. "ChillFlame.gif" -> "Q2hpbGxGbGFtZS5naWY"). Ini menyembunyikan nama
// file asli dari URL yang terlihat di address bar/Network tab.
//
// PROTEKSI UTAMA: wajib session pembeli (getUserFromRequest) ATAU session
// admin (isAdminRequest) yang valid. Tanpa keduanya -> 401. Base64 di URL
// bukan enkripsi, jadi proteksi session ini yang menutup akses sesungguhnya.

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
  headers.set("Content-Type", CONTENT_TYPES[ext]);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Disposition", "inline");
  headers.set("X-Content-Type-Options", "nosniff");
  if (object.httpEtag) headers.set("ETag", object.httpEtag);

  return new Response(object.body, { headers });
}

export function encodeFilenameToUrl(filename) {
  // Dipakai di lib/render.js untuk generate <img src="/nft/asset/<encoded>">
  const b64 = btoa(filename);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
