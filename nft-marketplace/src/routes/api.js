import { jsonResponse } from "../lib/render.js";
import { createPasswordRecord, verifyPassword } from "../lib/crypto.js";
import {
  createUserSession,
  setUserSessionCookie,
  getUserFromRequest,
  clearUserSessionCookie,
  destroyUserSession,
} from "../lib/session.js";
import { getNft, createOrder } from "../lib/store.js";
import { sendTelegramMessage, escapeHtmlForTelegram } from "../lib/telegram.js";

const USER_PREFIX = "user:";

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function handleRegister(request, env) {
  const body = await readJson(request);
  if (!body) return jsonResponse({ ok: false, error: "Body tidak valid." }, 400);

  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!/^[a-z0-9_]{3,32}$/.test(username)) {
    return jsonResponse({ ok: false, error: "Username 3-32 karakter, huruf/angka/underscore saja." }, 400);
  }
  if (password.length < 6) {
    return jsonResponse({ ok: false, error: "Password minimal 6 karakter." }, 400);
  }

  const existing = await env.NFT_KV.get(USER_PREFIX + username);
  if (existing) {
    return jsonResponse({ ok: false, error: "Username sudah terdaftar." }, 409);
  }

  const { salt, hash } = await createPasswordRecord(password);
  await env.NFT_KV.put(
    USER_PREFIX + username,
    JSON.stringify({ username, salt, hash, createdAt: Date.now() })
  );

  const { token, ttl } = await createUserSession(env, username);
  const headers = new Headers();
  setUserSessionCookie(headers, token, ttl);
  return jsonResponse({ ok: true, username }, 200, Object.fromEntries(headers));
}

export async function handleLogin(request, env) {
  const body = await readJson(request);
  if (!body) return jsonResponse({ ok: false, error: "Body tidak valid." }, 400);

  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");

  const raw = await env.NFT_KV.get(USER_PREFIX + username);
  if (!raw) return jsonResponse({ ok: false, error: "Username atau password salah." }, 401);

  const user = JSON.parse(raw);
  const valid = await verifyPassword(password, user.salt, user.hash);
  if (!valid) return jsonResponse({ ok: false, error: "Username atau password salah." }, 401);

  const { token, ttl } = await createUserSession(env, username);
  const headers = new Headers();
  setUserSessionCookie(headers, token, ttl);
  return jsonResponse({ ok: true, username }, 200, Object.fromEntries(headers));
}

export async function handleLogout(request, env) {
  await destroyUserSession(request, env);
  const headers = new Headers();
  clearUserSessionCookie(headers);
  return jsonResponse({ ok: true }, 200, Object.fromEntries(headers));
}

export async function handleSubmitPurchase(request, env) {
  const username = await getUserFromRequest(request, env);
  if (!username) {
    return jsonResponse({ ok: false, error: "Silakan masuk terlebih dahulu." }, 401);
  }

  const body = await readJson(request);
  if (!body) return jsonResponse({ ok: false, error: "Body tidak valid." }, 400);

  const telegram = String(body.telegram || "").trim();
  const whatsapp = String(body.whatsapp || "").trim();
  const email = String(body.email || "").trim();
  const payment = String(body.payment || "").trim().toUpperCase();
  const nftId = String(body.nftId || "").trim();

  if (!telegram || !whatsapp) {
    return jsonResponse({ ok: false, error: "Username Telegram dan nomor WhatsApp wajib diisi." }, 400);
  }
  if (!["DANA", "SEABANK"].includes(payment)) {
    return jsonResponse({ ok: false, error: "Metode pembayaran tidak valid." }, 400);
  }

  const nft = await getNft(env, nftId);
  if (!nft) return jsonResponse({ ok: false, error: "NFT tidak ditemukan." }, 404);

  const order = await createOrder(env, {
    nftId: nft.id,
    nftName: nft.name,
    price: nft.price,
    buyerUsername: username,
    telegram,
    whatsapp,
    email,
    payment,
  });

  const priceFmt = "Rp " + Number(nft.price || 0).toLocaleString("id-ID");
  const text = [
    "<b>\uD83D\uDED2 Pengajuan Pembelian NFT Baru</b>",
    `NFT: <b>${escapeHtmlForTelegram(nft.name)}</b>`,
    `Harga: ${escapeHtmlForTelegram(priceFmt)}`,
    `Akun: ${escapeHtmlForTelegram(username)}`,
    `Telegram: ${escapeHtmlForTelegram(telegram)}`,
    `WhatsApp: ${escapeHtmlForTelegram(whatsapp)}`,
    email ? `Email: ${escapeHtmlForTelegram(email)}` : null,
    `Metode Bayar: ${escapeHtmlForTelegram(payment)}`,
    `Order ID: ${escapeHtmlForTelegram(order.id)}`,
  ]
    .filter(Boolean)
    .join("\n");

  await sendTelegramMessage(env, text);

  return jsonResponse({ ok: true });
}
