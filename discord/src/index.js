// src/index.js
// Backend Telehub - Cloudflare Worker + D1
// Semua endpoint di-prefix "/discord" karena domain telehub.web.id di-route
// khusus buat path /discord/* ke worker ini.
// Endpoint yang tersedia:
//   GET  /discord/servers                    -> list server yang udah approved & paid (publik)
//   POST /discord/servers/submit             -> submit server baru (publik, jadi status "pending")
//   POST /discord/payment/create             -> bikin transaksi Duitku buat 1 submission
//   POST /discord/callback                   -> webhook dari Duitku (jangan diakses manual)
//   GET  /discord/admin/servers?status=...   -> list server per status (butuh x-admin-key)
//   POST /discord/admin/servers/:id/approve  -> approve submission (butuh x-admin-key)
//   POST /discord/admin/servers/:id/reject   -> reject submission (butuh x-admin-key)

import { md5Hex } from "./md5.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-key",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function isAdmin(request, env) {
  const key = request.headers.get("x-admin-key");
  return !!key && key === env.ADMIN_KEY;
}

async function hmacSha256Hex(message, key) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- Handlers ----

async function listApprovedServers(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, invite_link, description, icon_url, tags, verified, created_at
     FROM servers
     WHERE status = 'approved' AND payment_status = 'paid'
     ORDER BY created_at DESC`
  ).all();

  const servers = results.map((s) => ({
    ...s,
    tags: s.tags ? s.tags.split(",").filter(Boolean) : [],
  }));

  return json({ servers });
}

async function submitServer(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Body request tidak valid" }, 400);

  const { name, invite_link, description, icon_url, tags, email } = body;

  if (!name || !invite_link || !email) {
    return json({ error: "Nama server, invite link, dan email wajib diisi" }, 400);
  }

  const id = crypto.randomUUID();
  const tagsString = Array.isArray(tags) ? tags.join(",") : String(tags || "");

  await env.DB.prepare(
    `INSERT INTO servers (id, name, invite_link, description, icon_url, tags, email, status, payment_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'unpaid')`
  )
    .bind(id, name, invite_link, description || "", icon_url || "", tagsString, email)
    .run();

  return json({ id, message: "Server berhasil disubmit, lanjut ke pembayaran." });
}

async function createPayment(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.serverId) return json({ error: "serverId wajib diisi" }, 400);

  const server = await env.DB.prepare(`SELECT * FROM servers WHERE id = ?`)
    .bind(body.serverId)
    .first();

  if (!server) return json({ error: "Server tidak ditemukan" }, 404);
  if (server.payment_status === "paid") {
    return json({ error: "Server ini sudah dibayar sebelumnya" }, 400);
  }

  const paymentAmount = 25000; // harga tetap: 25k per channel/server
  const merchantOrderId = `TH-${server.id.slice(0, 8)}-${Date.now()}`;
  const stringToSign = `${env.DUITKU_MERCHANT_CODE}${merchantOrderId}${paymentAmount}`;
  const signature = await hmacSha256Hex(stringToSign, env.DUITKU_API_KEY);

  const payload = {
    merchantCode: env.DUITKU_MERCHANT_CODE,
    paymentAmount,
    merchantOrderId,
    productDetails: `Promosi server Discord di Telehub: ${server.name}`,
    email: server.email,
    customerVaName: server.name.slice(0, 20) || "Telehub User",
    callbackUrl: env.DUITKU_CALLBACK_URL,
    returnUrl: env.DUITKU_RETURN_URL,
    expiryPeriod: 60, // menit
    signature,
  };

  const duitkuUrl =
    env.DUITKU_ENV === "production"
      ? "https://passport.duitku.com/webapi/api/merchant/v2/inquiry"
      : "https://sandbox.duitku.com/webapi/api/merchant/v2/inquiry";

  const res = await fetch(duitkuUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);

  if (!data || data.statusCode !== "00") {
    return json({ error: (data && data.statusMessage) || "Gagal membuat transaksi Duitku" }, 400);
  }

  await env.DB.prepare(`UPDATE servers SET merchant_order_id = ? WHERE id = ?`)
    .bind(merchantOrderId, server.id)
    .run();

  return json({ paymentUrl: data.paymentUrl, reference: data.reference });
}

async function paymentCallback(request, env) {
  // Duitku ngirim callback sebagai application/x-www-form-urlencoded ATAU json
  // tergantung setup. Kita coba handle dua-duanya biar aman.
  const contentType = request.headers.get("content-type") || "";
  let data;

  if (contentType.includes("application/json")) {
    data = await request.json().catch(() => ({}));
  } else {
    const formData = await request.formData().catch(() => null);
    data = {};
    if (formData) {
      for (const [k, v] of formData.entries()) data[k] = v;
    }
  }

  const { merchantCode, amount, merchantOrderId, resultCode, signature } = data;

  if (!merchantCode || !merchantOrderId || !signature) {
    return new Response("Bad request", { status: 400 });
  }

  const expectedSignature = md5Hex(
    `${merchantCode}${amount}${merchantOrderId}${env.DUITKU_API_KEY}`
  );

  if (signature !== expectedSignature) {
    return new Response("Invalid signature", { status: 400 });
  }

  if (resultCode === "00" || resultCode === 0 || resultCode === "0") {
    await env.DB.prepare(
      `UPDATE servers SET payment_status = 'paid' WHERE merchant_order_id = ?`
    )
      .bind(merchantOrderId)
      .run();
  }

  // Duitku expects the literal text "OK" as response
  return new Response("OK", { status: 200 });
}

async function adminListServers(request, env) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized" }, 401);

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "pending";

  const { results } = await env.DB.prepare(
    `SELECT * FROM servers WHERE status = ? ORDER BY created_at DESC`
  )
    .bind(status)
    .all();

  const servers = results.map((s) => ({
    ...s,
    tags: s.tags ? s.tags.split(",").filter(Boolean) : [],
  }));

  return json({ servers });
}

async function adminApprove(request, env, id) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized" }, 401);

  const server = await env.DB.prepare(`SELECT * FROM servers WHERE id = ?`).bind(id).first();
  if (!server) return json({ error: "Server tidak ditemukan" }, 404);

  if (server.payment_status !== "paid") {
    return json(
      { error: "Server ini belum bayar, belum bisa di-approve jadi verified." },
      400
    );
  }

  await env.DB.prepare(`UPDATE servers SET status = 'approved', verified = 1 WHERE id = ?`)
    .bind(id)
    .run();

  return json({ success: true });
}

async function adminReject(request, env, id) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized" }, 401);

  await env.DB.prepare(`UPDATE servers SET status = 'rejected' WHERE id = ?`).bind(id).run();

  return json({ success: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      if (pathname === "/discord/servers" && request.method === "GET") {
        return await listApprovedServers(env);
      }

      if (pathname === "/discord/servers/submit" && request.method === "POST") {
        return await submitServer(request, env);
      }

      if (pathname === "/discord/payment/create" && request.method === "POST") {
        return await createPayment(request, env);
      }

      if (pathname === "/discord/callback" && request.method === "POST") {
        return await paymentCallback(request, env);
      }

      if (pathname === "/discord/admin/servers" && request.method === "GET") {
        return await adminListServers(request, env);
      }

      const approveMatch = pathname.match(/^\/discord\/admin\/servers\/([^/]+)\/approve$/);
      if (approveMatch && request.method === "POST") {
        return await adminApprove(request, env, approveMatch[1]);
      }

      const rejectMatch = pathname.match(/^\/discord\/admin\/servers\/([^/]+)\/reject$/);
      if (rejectMatch && request.method === "POST") {
        return await adminReject(request, env, rejectMatch[1]);
      }

      // Nggak match API route manapun -> anggap ini request buat halaman/file
      // statis React (index.html, JS, CSS, dll), lempar ke asset handler.
      if (env.ASSETS) {
        return await env.ASSETS.fetch(request);
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: err.message || "Internal error" }, 500);
    }
  },
};
