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
 *   POST   /api/upload       -> admin only, upload a cover image to R2,
 *                                returns its public URL
 *   GET    /covers/:filename -> public, serves the uploaded cover image
 *                                straight from the R2 bucket
 *   anything else            -> served from static files in this folder
 */

const BASE_PATH = "/ebook";

// Public base URL for the R2 bucket "photos-telehub" (custom domain).
// Files are uploaded under the "ebook/covers/" prefix inside that bucket,
// so the final public URL looks like:
//   https://api.telehub.web.id/ebook/covers/167xxxxx-ab12cd.jpg
const COVERS_PUBLIC_BASE = "https://api.telehub.web.id";
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB

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

// Legacy gradient presets — kept for backward-compat with books that were
// created before image upload existed. New books can instead set `cover`
// to a full image URL returned by POST /api/upload.
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

// A cover value is either a legacy preset key ("twilight", "dawn", ...)
// or a full image URL (from an upload). Anything that isn't a known
// preset is treated as an image URL/path and passed through as-is.
function normalizeCover(rawCover) {
  if (typeof rawCover !== "string" || !rawCover.trim()) {
    return "twilight";
  }
  const value = rawCover.trim();
  if (COVER_PRESETS[value]) return value;
  // Treat anything else (http(s) URL or /ebook/covers/... path) as an image.
  return value;
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
          cover: normalizeCover(body.cover),
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

      // Upload a cover image -> stored in R2 bucket "photos-telehub" under
      // "ebook/covers/", returns the public URL so the admin panel can save
      // it straight into a book's `cover` field.
      if (pathname === "/api/upload" && request.method === "POST") {
        if (!requireAuth(request, env)) return unauthorized();

        const formData = await request.formData().catch(() => null);
        const file = formData ? formData.get("file") : null;
        if (!file || typeof file === "string") {
          return json({ error: "File tidak ditemukan. Pastikan field bernama 'file'." }, 400);
        }
        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
          return json({ error: "Format harus JPG, PNG, WEBP, atau GIF" }, 400);
        }
        if (file.size > MAX_UPLOAD_SIZE) {
          return json({ error: "Ukuran file maksimal 5MB" }, 400);
        }

        const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
        const key = `ebook/covers/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

        await env.COVERS_BUCKET.put(key, await file.arrayBuffer(), {
          httpMetadata: { contentType: file.type },
        });

        return json({ ok: true, url: `${COVERS_PUBLIC_BASE}/${key}` });
      }

      // Serve cover images directly from R2 (photos-telehub bucket).
      // Uploaded files live under the "ebook/covers/" key prefix, and by
      // this point `pathname` has already had the "/ebook" prefix
      // stripped off (see top of fetch()), so a request for
      //   https://api.telehub.web.id/ebook/covers/167xxxxx-ab12cd.jpg
      // arrives here as pathname === "/covers/167xxxxx-ab12cd.jpg".
      // Re-add "ebook" to rebuild the exact R2 key used at upload time.
      if (pathname.startsWith("/covers/") && request.method === "GET") {
        const key = "ebook" + pathname; // -> "ebook/covers/167xxxxx-ab12cd.jpg"
        const object = await env.COVERS_BUCKET.get(key);

        if (!object) {
          return new Response("Not found", { status: 404 });
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("etag", object.httpEtag);
        headers.set("cache-control", "public, max-age=31536000, immutable");

        return new Response(object.body, { headers });
      }

      // Not an API route -> serve static files (index.html, admin/index.html, images)
      // using the prefix-stripped path.
      const assetUrl = new URL(request.url);
      assetUrl.pathname = pathname;
      const assetRequest = new Request(assetUrl.toString(), request);
      const assetResponse = await env.ASSETS.fetch(assetRequest);

      // Workers Assets issues its own redirects for directory paths (e.g.
      // "/admin" -> "/admin/" so it can resolve "admin/index.html"). That
      // redirect is built from the prefix-stripped path, so it would send
      // the browser to "telehub.web.id/admin/" instead of
      // "telehub.web.id/ebook/admin/" — landing on the wrong server
      // entirely. Re-add the "/ebook" prefix to any such redirect so it
      // stays correctly scoped under this Route.
      if (assetResponse.status >= 300 && assetResponse.status < 400) {
        const location = assetResponse.headers.get("location");
        if (location) {
          const locUrl = new URL(location, request.url);
          if (locUrl.pathname !== BASE_PATH && !locUrl.pathname.startsWith(BASE_PATH + "/")) {
            locUrl.pathname = BASE_PATH + (locUrl.pathname === "/" ? "/" : locUrl.pathname);
          }
          const fixedHeaders = new Headers(assetResponse.headers);
          fixedHeaders.set("location", locUrl.toString());
          return new Response(assetResponse.body, {
            status: assetResponse.status,
            statusText: assetResponse.statusText,
            headers: fixedHeaders,
          });
        }
      }

      return assetResponse;
    } catch (err) {
      return json({ error: "Server error", detail: String(err) }, 500);
    }
  },
};
