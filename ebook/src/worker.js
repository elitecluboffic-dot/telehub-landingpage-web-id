/**
 * Telehub Ebook API worker — scoped entirely under /ebook.
 *
 * This Worker is meant to be attached to a Route like:
 *   telehub.web.id/ebook*
 * so it NEVER touches requests to your root site (index.html, about.html).
 *
 * Because the Route still sends the full path (e.g. "/ebook/admin"), this
 * worker strips the "/ebook" prefix before looking up static files or
 * matching API routes, since the files inside this folder don't have that
 * prefix themselves (index.html, admin/index.html, etc).
 *
 * Routes (after stripping "/ebook"):
 *   GET    /api/books        -> public, list all books (+ cover presets)
 *   POST   /api/books        -> admin only, create/update a book
 *   DELETE /api/books/:id    -> admin only, remove a book
 *   POST   /api/login        -> checks a password against env.ADMIN_PASSWORD
 *   anything else            -> served from static files in this folder
 */

const BASE_PATH = "/ebook";

const SEED_BOOKS = [
  {
    id: "filosofi-kucing",
    title: "Filosofi Kucing",
    tagline: "Belajar hidup tenang dari makhluk yang tak pernah terburu-buru",
    author: "BIMXR",
    description:
      "15 bab renungan tentang istirahat, batas diri, kehilangan, dan ketenangan — dipinjam dari kebiasaan seekor kucing.",
    priceLabel: "Ebook · PDF",
    waNumber: "6285746866023",
    waMessage: "Halo, saya mau pesan ebook Filosofi Kucing",
    cover: "twilight",
    order: 1,
  },
];

const COVER_PRESETS = {
  twilight: ["#241633", "#6b2a49", "#d9722f"],
  dawn: ["#1c2438", "#3d4f7a", "#e0a45c"],
  moss: ["#122019", "#264d3b", "#9fc98a"],
  ash: ["#17171a", "#3a3a3f", "#c9c1b8"],
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function unauthorized() {
  return json({ error: "unauthorized" }, 401);
}

function requireAuth(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return Boolean(token) && Boolean(env.ADMIN_PASSWORD) && token === env.ADMIN_PASSWORD;
}

async function getBooks(env) {
  const raw = await env.EBOOK_KV.get("books");
  if (!raw) return SEED_BOOKS;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : SEED_BOOKS;
  } catch {
    return SEED_BOOKS;
  }
}

async function saveBooks(env, books) {
  await env.EBOOK_KV.put("books", JSON.stringify(books));
}

function slugify(text) {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return base || `buku-${Date.now()}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let pathname = url.pathname;

    // Strip the "/ebook" prefix that the Cloudflare Route still includes.
    // Handles "/ebook", "/ebook/", "/ebook/admin", etc.
    if (pathname === BASE_PATH) {
      pathname = "/";
    } else if (pathname.startsWith(BASE_PATH + "/")) {
      pathname = pathname.slice(BASE_PATH.length);
    }
    // If the request didn't have the /ebook prefix at all (e.g. local dev
    // with `wrangler dev` run from inside the ebook/ folder), leave as-is.

    try {
      if (pathname === "/api/login" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const ok = Boolean(env.ADMIN_PASSWORD) && body.password === env.ADMIN_PASSWORD;
        return json({ ok });
      }

      if (pathname === "/api/books" && request.method === "GET") {
        const books = await getBooks(env);
        const sorted = [...books].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        return json({ books: sorted, covers: COVER_PRESETS });
      }

      if (pathname === "/api/books" && request.method === "POST") {
        if (!requireAuth(request, env)) return unauthorized();
        const body = await request.json().catch(() => null);
        if (!body || !body.title || !body.title.trim()) {
          return json({ error: "Judul buku wajib diisi" }, 400);
        }

        const books = await getBooks(env);
        const id = body.id || slugify(body.title);
        const existingIndex = books.findIndex((b) => b.id === id);

        const record = {
          id,
          title: body.title.trim(),
          tagline: (body.tagline || "").trim(),
          author: (body.author || "BIMXR").trim(),
          description: (body.description || "").trim(),
          priceLabel: (body.priceLabel || "Ebook · PDF").trim(),
          waNumber: (body.waNumber || "").replace(/[^0-9]/g, ""),
          waMessage: (body.waMessage || `Halo, saya mau pesan ebook ${body.title}`).trim(),
          cover: COVER_PRESETS[body.cover] ? body.cover : "twilight",
          order: typeof body.order === "number" ? body.order : existingIndex >= 0 ? books[existingIndex].order : books.length + 1,
        };

        if (existingIndex >= 0) {
          books[existingIndex] = record;
        } else {
          books.push(record);
        }
        await saveBooks(env, books);
        return json({ ok: true, book: record });
      }

      if (pathname.startsWith("/api/books/") && request.method === "DELETE") {
        if (!requireAuth(request, env)) return unauthorized();
        const id = decodeURIComponent(pathname.split("/").pop());
        const books = await getBooks(env);
        const next = books.filter((b) => b.id !== id);
        await saveBooks(env, next);
        return json({ ok: true });
      }

      // Not an API route -> serve static files (index.html, admin/index.html, images)
      // using the prefix-stripped path.
      const assetUrl = new URL(request.url);
      assetUrl.pathname = pathname;
      const assetRequest = new Request(assetUrl.toString(), request);
      return env.ASSETS.fetch(assetRequest);
    } catch (err) {
      return json({ error: "Server error", detail: String(err) }, 500);
    }
  },
};
