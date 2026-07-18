import { r2Key, getNftOwnerByFilename } from "../lib/store.js";
import { getUserFromRequest, isAdminRequest } from "../lib/session.js";
import { renderWatermarked, renderGifPreview } from "../lib/watermark.js";

const CONTENT_TYPES = {
  gif: "image/gif",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const WATERMARKABLE_EXT = new Set(["png", "jpg", "jpeg", "webp"]);

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

  // Non-owner: PNG/JPG/WEBP dapat watermark tiled versi format asli.
  // GIF dapat watermark tiled versi frame pertama, selalu sebagai PNG statis.
  try {
    if (WATERMARKABLE_EXT.has(ext)) {
      const watermarked = await renderWatermarked(object.body, ext, env);
      headers.set("Content-Type", CONTENT_TYPES[ext]);
      return new Response(watermarked, { headers });
    }
    if (ext === "gif") {
      const preview = await renderGifPreview(object.body, env);
      headers.set("Content-Type", "image/png");
      return new Response(preview, { headers });
    }
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  return new Response("Forbidden", { status: 403 });
}

export function encodeFilenameToUrl(filename) {
  const b64 = btoa(filename);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
