import { r2Key } from "../lib/store.js";

const CONTENT_TYPES = {
  gif: "image/gif",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

// GET /nft/:filename  ->  streaming langsung dari R2 lewat binding, tidak pernah
// mengekspos domain publik bucket R2 (mis. api.telehub.web.id/...). Yang terlihat
// oleh browser hanya path di bawah telehub.web.id/nft/... .
// Objek aslinya disimpan di bucket "photos-telehub" di dalam folder/prefix "nft/",
// jadi key R2-nya "nft/<filename>" walau URL publiknya tetap "/nft/<filename>".
export async function handleAssetProxy(request, env, filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (!CONTENT_TYPES[ext]) {
    return new Response("Not found", { status: 404 });
  }

  const object = await env.NFT_R2.get(r2Key(filename));
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", CONTENT_TYPES[ext]);
  headers.set("Cache-Control", "public, max-age=86400");
  if (object.httpEtag) headers.set("ETag", object.httpEtag);

  return new Response(object.body, { headers });
}
