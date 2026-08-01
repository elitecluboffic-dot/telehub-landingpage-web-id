import {
  hashPassword,
  verifyPassword,
  randomToken,
  sessionCookieHeader,
  clearCookieHeader,
  getUserFromSession,
  json,
} from "./auth.js";

const SESSION_DAYS = 30;
const MAX_PAYMENT_IMAGE_BASE64_LENGTH = 2_000_000; // ~1.5MB gambar asli, cukup untuk foto bukti transfer

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path.startsWith("/api/")) {
        return await handleApi(request, env, path);
      }
      // Semua request non-/api di-serve sebagai file statis (index.html, game.html, dsb)
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return json({ error: "Internal server error", detail: String(err) }, 500);
    }
  },
};

async function handleApi(request, env, path) {
  const method = request.method;

  // ---------- AUTH ----------
  if (path === "/api/register" && method === "POST") return handleRegister(request, env);
  if (path === "/api/login" && method === "POST") return handleLogin(request, env);
  if (path === "/api/logout" && method === "POST") return handleLogout(request, env);
  if (path === "/api/me" && method === "GET") return handleMe(request, env);

  // ---------- PAYMENT ----------
  if (path === "/api/payment/upload" && method === "POST") return handlePaymentUpload(request, env);
  if (path === "/api/payment/status" && method === "GET") return handlePaymentStatus(request, env);

  // ---------- ADMIN ----------
  if (path === "/api/admin/payments" && method === "GET") return handleAdminListPayments(request, env);
  if (path.match(/^\/api\/admin\/payments\/\d+\/approve$/) && method === "POST")
    return handleAdminReview(request, env, path, "approved");
  if (path.match(/^\/api\/admin\/payments\/\d+\/reject$/) && method === "POST")
    return handleAdminReview(request, env, path, "rejected");

  // ---------- LEVELS / PROGRESS ----------
  if (path === "/api/levels" && method === "GET") return handleGetLevelsMeta(request, env);
  if (path.match(/^\/api\/levels\/\d+$/) && method === "GET") return handleGetLevel(request, env, path);
  if (path === "/api/progress" && method === "POST") return handleSaveProgress(request, env);

  return json({ error: "Not found" }, 404);
}

// ============================================================
// AUTH HANDLERS
// ============================================================

async function handleRegister(request, env) {
  const body = await safeJson(request);
  const username = (body?.username || "").trim();
  const password = body?.password || "";

  if (username.length < 3 || username.length > 32) {
    return json({ error: "Username harus 3-32 karakter" }, 400);
  }
  if (password.length < 6) {
    return json({ error: "Password minimal 6 karakter" }, 400);
  }

  const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
    .bind(username)
    .first();
  if (existing) return json({ error: "Username sudah dipakai" }, 409);

  const { hash, salt } = await hashPassword(password);
  const result = await env.DB.prepare(
    "INSERT INTO users (username, password_hash, password_salt) VALUES (?, ?, ?)"
  )
    .bind(username, hash, salt)
    .run();

  const userId = result.meta.last_row_id;
  return await createSessionResponse(env, userId, { username, role: "user", is_paid: 0 });
}

async function handleLogin(request, env) {
  const body = await safeJson(request);
  const username = (body?.username || "").trim();
  const password = body?.password || "";

  const user = await env.DB.prepare(
    "SELECT id, username, password_hash, password_salt, role, is_paid FROM users WHERE username = ?"
  )
    .bind(username)
    .first();

  if (!user) return json({ error: "Username atau password salah" }, 401);

  const valid = await verifyPassword(password, user.password_salt, user.password_hash);
  if (!valid) return json({ error: "Username atau password salah" }, 401);

  return await createSessionResponse(env, user.id, user);
}

async function createSessionResponse(env, userId, user) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(token, userId, expires)
    .run();

  return json(
    { ok: true, user: { username: user.username, role: user.role, is_paid: !!user.is_paid } },
    200,
    { "Set-Cookie": sessionCookieHeader(token, SESSION_DAYS * 86400) }
  );
}

async function handleLogout(request, env) {
  const token = getCookieRaw(request);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return json({ ok: true }, 200, { "Set-Cookie": clearCookieHeader() });
}

function getCookieRaw(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|; )session=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function handleMe(request, env) {
  const user = await getUserFromSession(request, env);
  if (!user) return json({ user: null }, 200);
  return json({
    user: {
      username: user.username,
      role: user.role,
      is_paid: !!user.is_paid,
      current_level: user.current_level,
      levels_completed: user.levels_completed,
    },
  });
}

// ============================================================
// PAYMENT HANDLERS
// ============================================================

async function handlePaymentUpload(request, env) {
  const user = await getUserFromSession(request, env);
  if (!user) return json({ error: "Harus login dulu" }, 401);

  const body = await safeJson(request);
  const imageData = body?.image_data || ""; // base64 data URL, misal "data:image/jpeg;base64,...."
  const note = (body?.note || "").slice(0, 300);

  if (!imageData.startsWith("data:image/")) {
    return json({ error: "Format gambar tidak valid" }, 400);
  }
  if (imageData.length > MAX_PAYMENT_IMAGE_BASE64_LENGTH) {
    return json({ error: "Ukuran gambar terlalu besar, maksimal sekitar 1.5MB" }, 400);
  }

  // Cegah spam: cek apakah masih ada pending
  const pending = await env.DB.prepare(
    "SELECT id FROM payments WHERE user_id = ? AND status = 'pending'"
  )
    .bind(user.id)
    .first();
  if (pending) return json({ error: "Kamu masih punya pembayaran yang sedang direview" }, 409);

  await env.DB.prepare(
    "INSERT INTO payments (user_id, image_data, note, status) VALUES (?, ?, ?, 'pending')"
  )
    .bind(user.id, imageData, note)
    .run();

  return json({ ok: true, message: "Bukti pembayaran terkirim, tunggu review admin" });
}

async function handlePaymentStatus(request, env) {
  const user = await getUserFromSession(request, env);
  if (!user) return json({ error: "Harus login dulu" }, 401);

  const latest = await env.DB.prepare(
    "SELECT status, admin_note, created_at, reviewed_at FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 1"
  )
    .bind(user.id)
    .first();

  return json({ is_paid: !!user.is_paid, latest_payment: latest || null });
}

// ============================================================
// ADMIN HANDLERS
// ============================================================

async function requireAdmin(request, env) {
  const user = await getUserFromSession(request, env);
  if (!user || user.role !== "admin") return null;
  return user;
}

async function handleAdminListPayments(request, env) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: "Forbidden" }, 403);

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") || "pending";

  const { results } = await env.DB.prepare(
    `SELECT p.id, p.user_id, u.username, p.image_data, p.note, p.status, p.created_at
     FROM payments p JOIN users u ON u.id = p.user_id
     WHERE p.status = ?
     ORDER BY p.created_at ASC`
  )
    .bind(statusFilter)
    .all();

  return json({ payments: results });
}

async function handleAdminReview(request, env, path, newStatus) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: "Forbidden" }, 403);

  const paymentId = path.match(/\/payments\/(\d+)\//)[1];
  const body = await safeJson(request);
  const adminNote = (body?.admin_note || "").slice(0, 300);

  const payment = await env.DB.prepare("SELECT id, user_id, status FROM payments WHERE id = ?")
    .bind(paymentId)
    .first();
  if (!payment) return json({ error: "Payment tidak ditemukan" }, 404);
  if (payment.status !== "pending") return json({ error: "Payment sudah direview" }, 409);

  await env.DB.prepare(
    "UPDATE payments SET status = ?, admin_note = ?, reviewed_at = datetime('now') WHERE id = ?"
  )
    .bind(newStatus, adminNote, paymentId)
    .run();

  if (newStatus === "approved") {
    await env.DB.prepare("UPDATE users SET is_paid = 1 WHERE id = ?").bind(payment.user_id).run();
  }

  return json({ ok: true });
}

// ============================================================
// LEVELS & PROGRESS
// ============================================================

async function handleGetLevelsMeta(request, env) {
  const user = await getUserFromSession(request, env);
  if (!user) return json({ error: "Harus login dulu" }, 401);
  if (!user.is_paid) return json({ error: "Akun belum aktif, selesaikan pembayaran dulu" }, 402);

  const { results } = await env.DB.prepare(
    "SELECT level_id, completed, best_time_ms FROM level_progress WHERE user_id = ?"
  )
    .bind(user.id)
    .all();

  const progressMap = {};
  for (const r of results) progressMap[r.level_id] = r;

  return json({ total_levels: 100, progress: progressMap });
}

async function handleGetLevel(request, env, path) {
  const user = await getUserFromSession(request, env);
  if (!user) return json({ error: "Harus login dulu" }, 401);
  if (!user.is_paid) return json({ error: "Akun belum aktif, selesaikan pembayaran dulu" }, 402);

  // Level data sendiri disajikan statis dari /public/js/levels.json di frontend
  // supaya tidak perlu round-trip berat lewat Worker. Endpoint ini cuma validasi akses.
  const levelId = parseInt(path.match(/\/levels\/(\d+)/)[1], 10);
  if (levelId < 1 || levelId > 100) return json({ error: "Level tidak valid" }, 404);

  return json({ ok: true, level_id: levelId });
}

async function handleSaveProgress(request, env) {
  const user = await getUserFromSession(request, env);
  if (!user) return json({ error: "Harus login dulu" }, 401);
  if (!user.is_paid) return json({ error: "Akun belum aktif" }, 402);

  const body = await safeJson(request);
  const levelId = parseInt(body?.level_id, 10);
  const timeMs = parseInt(body?.time_ms, 10) || null;

  if (!(levelId >= 1 && levelId <= 100)) return json({ error: "Level tidak valid" }, 400);

  await env.DB.prepare(
    `INSERT INTO level_progress (user_id, level_id, completed, best_time_ms, completed_at)
     VALUES (?, ?, 1, ?, datetime('now'))
     ON CONFLICT(user_id, level_id) DO UPDATE SET
       completed = 1,
       best_time_ms = CASE WHEN excluded.best_time_ms IS NOT NULL AND (level_progress.best_time_ms IS NULL OR excluded.best_time_ms < level_progress.best_time_ms)
                            THEN excluded.best_time_ms ELSE level_progress.best_time_ms END,
       completed_at = datetime('now')`
  )
    .bind(user.id, levelId, timeMs)
    .run();

  const nextLevel = Math.min(levelId + 1, 100);
  await env.DB.prepare(
    "UPDATE users SET current_level = MAX(current_level, ?), levels_completed = levels_completed + 1 WHERE id = ?"
  )
    .bind(nextLevel, user.id)
    .run();

  return json({ ok: true, next_level: nextLevel });
}

// ============================================================
// UTIL
// ============================================================

async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
