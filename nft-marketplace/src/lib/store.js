import { randomId } from "./crypto.js";

const NFT_PREFIX = "nft:";
const ORDER_PREFIX = "order:";

// Semua file NFT disimpan di bucket "photos-telehub" di dalam folder/prefix "nft/".
// filename yang dipakai di KV/URL publik TIDAK termasuk prefix ini (mis. "SnoopDogg.gif"),
// tapi key aslinya di R2 adalah "nft/SnoopDogg.gif". r2Key() menjembatani keduanya.
const R2_PREFIX = "nft/";

export function r2Key(filename) {
  return R2_PREFIX + filename;
}

// Bukti transfer pembeli disimpan terpisah dari file NFT, di folder/prefix "proof/".
const PROOF_PREFIX = "proof/";

export function proofR2Key(filename) {
  return PROOF_PREFIX + filename;
}

// List file yang sudah ada di bucket (prefix nft/) tapi BELUM punya record NFT di KV,
// supaya admin bisa langsung pilih file lama tanpa upload ulang.
export async function listUnregisteredR2Files(env) {
  const [r2List, nfts] = await Promise.all([
    env.NFT_R2.list({ prefix: R2_PREFIX }),
    listNfts(env),
  ]);
  const used = new Set(nfts.map((n) => n.filename));
  return r2List.objects
    .map((obj) => obj.key.slice(R2_PREFIX.length))
    .filter((name) => name && !used.has(name));
}

export async function listNfts(env) {
  const list = await env.NFT_KV.list({ prefix: NFT_PREFIX });
  const items = await Promise.all(
    list.keys.map(async (k) => {
      const raw = await env.NFT_KV.get(k.name);
      return raw ? JSON.parse(raw) : null;
    })
  );
  return items.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getNft(env, id) {
  const raw = await env.NFT_KV.get(NFT_PREFIX + id);
  return raw ? JSON.parse(raw) : null;
}

// Cari record NFT berdasarkan filename. Dipakai untuk ownership check di proxy.
export async function getNftByFilename(env, filename) {
  const nfts = await listNfts(env);
  return nfts.find((n) => n.filename === filename) || null;
}

export async function createNft(env, { name, price, description, filename }) {
  const id = randomId("nft_");
  const record = {
    id,
    name,
    price: Number(price) || 0,
    description: description || "",
    filename,
    createdAt: Date.now(),
  };
  await env.NFT_KV.put(NFT_PREFIX + id, JSON.stringify(record));
  return record;
}

export async function updateNftPrice(env, id, price) {
  const existing = await getNft(env, id);
  if (!existing) return null;
  existing.price = Number(price) || 0;
  await env.NFT_KV.put(NFT_PREFIX + id, JSON.stringify(existing));
  return existing;
}

export async function deleteNft(env, id) {
  const existing = await getNft(env, id);
  if (!existing) return null;
  await env.NFT_KV.delete(NFT_PREFIX + id);
  if (existing.filename) {
    await env.NFT_R2.delete(r2Key(existing.filename)).catch(() => {});
  }
  return existing;
}

export async function listOrders(env, limit = 50) {
  const list = await env.NFT_KV.list({ prefix: ORDER_PREFIX });
  const items = await Promise.all(
    list.keys.map(async (k) => {
      const raw = await env.NFT_KV.get(k.name);
      return raw ? JSON.parse(raw) : null;
    })
  );
  return items
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export async function getOrder(env, id) {
  const raw = await env.NFT_KV.get(ORDER_PREFIX + id);
  return raw ? JSON.parse(raw) : null;
}

export async function createOrder(env, order) {
  const id = randomId("order_");
  const record = {
    id,
    createdAt: Date.now(),
    status: "pending", // "pending" | "approved" | "rejected"
    ...order,
  };
  await env.NFT_KV.put(ORDER_PREFIX + id, JSON.stringify(record));
  return record;
}

// Ubah status order (dipakai admin untuk approve/reject setelah verifikasi
// pembayaran manual). status: "approved" | "rejected" | "pending"
export async function updateOrderStatus(env, id, status) {
  const existing = await getOrder(env, id);
  if (!existing) return null;
  existing.status = status;
  existing.statusUpdatedAt = Date.now();
  await env.NFT_KV.put(ORDER_PREFIX + id, JSON.stringify(existing));
  return existing;
}

// Mengembalikan username pemilik sah NFT dengan filename tsb, atau null
// kalau belum ada order berstatus "approved" untuk NFT tsb.
export async function getNftOwnerByFilename(filename, env) {
  const nft = await getNftByFilename(env, filename);
  if (!nft) return null;

  const orders = await listOrders(env, 1000);
  const approvedOrder = orders.find(
    (o) => o.nftId === nft.id && o.status === "approved"
  );

  return approvedOrder ? approvedOrder.buyerUsername : null;
}
