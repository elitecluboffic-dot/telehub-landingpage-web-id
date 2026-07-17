import { r2Key } from "../lib/store.js";
import { getUserFromRequest } from "../lib/session.js";

const CONTENT_TYPES = {
  gif: "image/gif",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

// GET /nft/:encoded  ->  :encoded adalah base64url dari filename asli
// (mis. "ChillFlame.gif" -> "Q2hpbGxGbGFtZS5naWY"). Ini menyembunyikan nama
// file asli dari URL yang terlihat di address bar/Network tab, walau bukan
// enkripsi sungguhan — hanya obfuscation tambahan di atas proteksi session.
//
// PROTEKSI UTAMA tetap: wajib session user valid (getUserFromRequest).
// Tanpa login -> 401. Tanpa ini, base64 saja TIDAK aman karena bisa di-decode
// siapa saja.

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

  const username = await getUserFromRequest(request, env);
  if (!username) {
    return new Response("Unauthorized", { status: 401 });
  }

  const object = await env.NFT_R2.get(r2Key(filename));
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", CONTENT_TYPES[ext]);
  headers.set("Cache-Control", "private, no-store");
  // Cegah browser nampilin dialog "Save As" otomatis / nebak nama file asli
  headers.set("Content-Disposition", "inline");
  headers.set("X-Content-Type-Options", "nosniff");
  if (object.httpEtag) headers.set("ETag", object.httpEtag);

  return new Response(object.body, { headers });
}

export function encodeFilenameToUrl(filename) {
  // Dipakai di lib/render.js untuk generate <img src="/nft/<encoded>">
  const b64 = btoa(filename);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
