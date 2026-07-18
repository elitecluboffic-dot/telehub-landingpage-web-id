import { jsonResponse } from "../lib/render.js";
import {
  createAdminSession,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  destroyAdminSession,
  isAdminRequest,
} from "../lib/session.js";
import {
  createNft,
  updateNftPrice,
  deleteNft,
  getNft,
  r2Key,
  proofR2Key,
  listUnregisteredR2Files,
  listOrders,
  getOrder,
  updateOrderStatus,
  deleteOrder,
} from "../lib/store.js";

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function requireAdmin(request, env) {
  const ok = await isAdminRequest(request, env);
  if (!ok) return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
  return null;
}

export async function handleAdminLogin(request, env) {
  const body = await readJson(request);
  if (!body) return jsonResponse({ ok: false, error: "Body tidak valid." }, 400);

  const username = String(body.username || "");
  const password = String(body.password || "");

  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
    return jsonResponse(
      { ok: false, error: "ADMIN_USERNAME/ADMIN_PASSWORD belum di-set sebagai secret di Worker." },
      500
    );
  }

  if (username !== env.ADMIN_USERNAME || password !== env.ADMIN_PASSWORD) {
    return jsonResponse({ ok: false, error: "Username atau password admin salah." }, 401);
  }

  const { token, ttl } = await createAdminSession(env);
  const headers = new Headers();
  setAdminSessionCookie(headers, token, ttl);
  return jsonResponse({ ok: true }, 200, Object.fromEntries(headers));
}

export async function handleAdminLogout(request, env) {
  await destroyAdminSession(request, env);
  const headers = new Headers();
  clearAdminSessionCookie(headers);
  return jsonResponse({ ok: true }, 200, Object.fromEntries(headers));
}

function sanitizeBaseName(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

async function findAvailableFilename(env, originalName) {
  const dot = originalName.lastIndexOf(".");
  const ext = dot !== -1 ? originalName.slice(dot) : "";
  const base = sanitizeBaseName(dot !== -1 ? originalName.slice(0, dot) : originalName) || "nft";

  let candidate = `${base}${ext}`;
  let attempt = 1;
  while (await env.NFT_R2.head(r2Key(candidate))) {
    attempt += 1;
    candidate = `${base}-${attempt}${ext}`;
  }
  return candidate;
}

export async function handleAdminCreateNft(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse({ ok: false, error: "Form upload tidak valid." }, 400);
  }

  const name = String(form.get("name") || "").trim();
  const price = Number(form.get("price") || 0);
  const description = String(form.get("description") || "").trim();
  const file = form.get("file");

  if (!name) return jsonResponse({ ok: false, error: "Nama NFT wajib diisi." }, 400);
  if (!(file instanceof File) || file.size === 0) {
    return jsonResponse({ ok: false, error: "File gambar/GIF wajib diupload." }, 400);
  }

  const allowedExt = ["gif", "png", "jpg", "jpeg", "webp"];
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!allowedExt.includes(ext)) {
    return jsonResponse({ ok: false, error: "Format file harus gif/png/jpg/jpeg/webp." }, 400);
  }

  const filename = await findAvailableFilename(env, file.name);
  await env.NFT_R2.put(r2Key(filename), file.stream(), {
    httpMetadata: { contentType: file.type || undefined },
  });

  const record = await createNft(env, { name, price, description, filename });
  return jsonResponse({ ok: true, nft: record });
}

// Daftarkan NFT baru dari file GIF/gambar yang SUDAH ada di bucket (folder nft/),
// tanpa upload ulang. Dipakai buat foto-foto yang sudah kamu taruh manual di R2.
export async function handleAdminListAvailableFiles(request, env) {
  const files = await listUnregisteredR2Files(env);
  return jsonResponse({ ok: true, files });
}

export async function handleAdminCreateNftFromExisting(request, env) {
  const body = await readJson(request);
  if (!body) return jsonResponse({ ok: false, error: "Body tidak valid." }, 400);

  const name = String(body.name || "").trim();
  const price = Number(body.price || 0);
  const description = String(body.description || "").trim();
  const filename = String(body.filename || "").trim();

  if (!name) return jsonResponse({ ok: false, error: "Nama NFT wajib diisi." }, 400);
  if (!filename) return jsonResponse({ ok: false, error: "Pilih file dari R2 dulu." }, 400);

  const exists = await env.NFT_R2.head(r2Key(filename));
  if (!exists) {
    return jsonResponse({ ok: false, error: "File tidak ditemukan di bucket (folder nft/)." }, 404);
  }

  const record = await createNft(env, { name, price, description, filename });
  return jsonResponse({ ok: true, nft: record });
}

export async function handleAdminUpdateNft(request, env, id) {
  const body = await readJson(request);
  if (!body || body.price === undefined) {
    return jsonResponse({ ok: false, error: "Harga baru wajib dikirim." }, 400);
  }
  const updated = await updateNftPrice(env, id, body.price);
  if (!updated) return jsonResponse({ ok: false, error: "NFT tidak ditemukan." }, 404);
  return jsonResponse({ ok: true, nft: updated });
}

export async function handleAdminDeleteNft(request, env, id) {
  const existing = await getNft(env, id);
  if (!existing) return jsonResponse({ ok: false, error: "NFT tidak ditemukan." }, 404);
  await deleteNft(env, id);
  return jsonResponse({ ok: true });
}

// --- Order management ---

export async function handleAdminListOrders(request, env) {
  const orders = await listOrders(env, 200);
  return jsonResponse({ ok: true, orders });
}

export async function handleAdminApproveOrder(request, env, id) {
  const existing = await getOrder(env, id);
  if (!existing) return jsonResponse({ ok: false, error: "Order tidak ditemukan." }, 404);
  const updated = await updateOrderStatus(env, id, "approved");
  return jsonResponse({ ok: true, order: updated });
}

const PROOF_CONTENT_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export async function handleAdminGetOrderProof(request, env, id) {
  const order = await getOrder(env, id);
  if (!order || !order.proofFilename) return new Response("Not found", { status: 404 });

  const object = await env.NFT_R2.get(proofR2Key(order.proofFilename));
  if (!object) return new Response("Not found", { status: 404 });

  const ext = (order.proofFilename.split(".").pop() || "").toLowerCase();
  const headers = new Headers();
  headers.set("Content-Type", PROOF_CONTENT_TYPES[ext] || "application/octet-stream");
  headers.set("Cache-Control", "private, no-store");
  return new Response(object.body, { headers });
}

export async function handleAdminRejectOrder(request, env, id) {
  const existing = await getOrder(env, id);
  if (!existing) return jsonResponse({ ok: false, error: "Order tidak ditemukan." }, 404);
  const updated = await updateOrderStatus(env, id, "rejected");
  return jsonResponse({ ok: true, order: updated });
}

export async function handleAdminDeleteOrder(request, env, id) {
  const existing = await getOrder(env, id);
  if (!existing) return jsonResponse({ ok: false, error: "Order tidak ditemukan." }, 404);
  await deleteOrder(env, id);
  return jsonResponse({ ok: true });
}
