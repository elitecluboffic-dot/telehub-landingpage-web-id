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
 *   GET    /read/:id         -> public, server-rendered "read online" page
 *                                built from a book's `chapters` field
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
    chapters: [],
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

function html(markup, status = 200) {
  return new Response(markup, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
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

// Chapters are plain { title, content } objects filled in from the admin
// panel. Keep only well-formed entries, and trim whitespace so empty
// rows left in the admin form don't get persisted.
function normalizeChapters(rawChapters) {
  if (!Array.isArray(rawChapters)) return [];
  return rawChapters
    .map((c) => ({
      title: typeof c?.title === "string" ? c.title.trim() : "",
      content: typeof c?.content === "string" ? c.content.trim() : "",
    }))
    .filter((c) => c.title);
}

/* ---------------------------------------------------------------------- *
 * "Baca Online" reader page — fully server-rendered from a book's
 * `chapters` field, so the content is readable straight from the URL
 * (no PDF download, no client-side fetch needed, good for SEO/sharing).
 * ---------------------------------------------------------------------- */

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Turn plain-text chapter content into paragraphs. Blank lines separate
// paragraphs; single line breaks inside a paragraph become <br>.
function contentToHtml(content) {
  const paragraphs = String(content ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (!paragraphs.length) return "";

  return paragraphs
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function renderReaderPage(book, baseUrl) {
  const chapters = Array.isArray(book.chapters) ? book.chapters : [];
  const waLink = book.waNumber
    ? `https://wa.me/${book.waNumber}?text=${encodeURIComponent(
        book.waMessage || `Halo, saya mau pesan ebook ${book.title}`
      )}`
    : "https://wa.me/6285746866023";

  const tocItems = chapters
    .map((c, i) => `<a href="#bab-${i}">${escapeHtml(c.title)}</a>`)
    .join("\n");

  const chapterSections = chapters
    .map(
      (c, i) => `
      <section class="chapter" id="bab-${i}">
        <h2>${escapeHtml(c.title)}</h2>
        ${contentToHtml(c.content) || "<p><em>Isi bab ini belum ditulis.</em></p>"}
      </section>`
    )
    .join("\n");

  const emptyState = `
    <div class="empty-reader">
      <h2>Preview belum tersedia</h2>
      <p>Isi baca online untuk "${escapeHtml(book.title)}" sedang disiapkan. Sementara itu, kamu bisa pesan versi lengkapnya lewat WhatsApp.</p>
      <a class="cta-btn" href="${waLink}" target="_blank" rel="noopener">Pesan via WhatsApp</a>
    </div>`;

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(book.title)} — Baca Online · BIMXR</title>
<meta name="description" content="${escapeHtml(book.tagline || book.description || book.title)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${baseUrl}/read/${encodeURIComponent(book.id)}">

<meta property="og:type" content="article" />
<meta property="og:title" content="${escapeHtml(book.title)} — BIMXR" />
<meta property="og:description" content="${escapeHtml(book.tagline || book.description || "")}" />
<meta property="og:url" content="${baseUrl}/read/${encodeURIComponent(book.id)}" />

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --ink:#120b19;
    --card:#1c1327;
    --card-line:#3a2b42;
    --cream:#f6ead9;
    --gold:#e7c26a;
    --muted:#b9a8b8;
  }
  *{ box-sizing:border-box; }
  html{ scroll-behavior:smooth; }
  body{
    margin:0;
    background:var(--ink);
    color:var(--cream);
    font-family:'Manrope', sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  h1,h2,h3{ font-family:'Fraunces', serif; font-weight:600; margin:0 0 0.6em; }
  a{ color:inherit; }

  .reader-nav{
    position:sticky;
    top:0;
    z-index:20;
    background:rgba(18,11,25,0.92);
    backdrop-filter:blur(6px);
    border-bottom:1px solid var(--card-line);
    padding:16px 24px;
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:16px;
  }
  .reader-nav a.back{
    font-size:0.88rem;
    color:var(--muted);
    text-decoration:none;
    display:flex;
    align-items:center;
    gap:8px;
  }
  .reader-nav a.back:hover{ color:var(--cream); }
  .reader-nav .brand{
    font-family:'Fraunces', serif;
    font-size:1rem;
    font-weight:600;
    color:var(--gold);
    white-space:nowrap;
  }

  .reader-wrap{
    max-width:960px;
    margin:0 auto;
    padding:48px 24px 120px;
    display:grid;
    grid-template-columns:240px 1fr;
    gap:48px;
    align-items:start;
  }
  @media (max-width:800px){
    .reader-wrap{ grid-template-columns:1fr; gap:28px; padding:32px 20px 90px; }
  }

  .toc{
    position:sticky;
    top:76px;
    background:var(--card);
    border:1px solid var(--card-line);
    border-radius:16px;
    padding:24px;
  }
  @media (max-width:800px){
    .toc{ position:static; }
  }
  .toc .book-title{ font-size:1.2rem; margin-bottom:4px; }
  .toc .book-author{
    font-size:0.78rem;
    letter-spacing:0.1em;
    text-transform:uppercase;
    color:var(--gold);
    display:block;
    margin-bottom:18px;
  }
  .toc nav{ display:flex; flex-direction:column; gap:2px; margin-bottom:20px; }
  .toc nav a{
    font-size:0.86rem;
    color:var(--muted);
    text-decoration:none;
    padding:8px 10px;
    border-radius:8px;
    line-height:1.4;
  }
  .toc nav a:hover{ background:rgba(231,194,106,0.08); color:var(--cream); }

  .toc .cta-btn{
    display:block;
    text-align:center;
    background:var(--gold);
    color:#241708;
    font-weight:700;
    font-size:0.86rem;
    padding:12px 16px;
    border-radius:999px;
    text-decoration:none;
  }

  .content .chapter{
    padding-bottom:56px;
    margin-bottom:56px;
    border-bottom:1px solid var(--card-line);
  }
  .content .chapter:last-child{
    border-bottom:none;
    margin-bottom:0;
  }
  .content h2{ font-size:1.5rem; }
  .content p{
    font-size:1.04rem;
    line-height:1.85;
    color:#e9dccb;
    margin:0 0 1.1em;
  }

  .empty-reader{
    text-align:center;
    padding:60px 20px;
    background:var(--card);
    border:1px solid var(--card-line);
    border-radius:16px;
  }
  .empty-reader p{
    color:var(--muted);
    max-width:42ch;
    margin:14px auto 26px;
    line-height:1.7;
  }
  .empty-reader .cta-btn{
    display:inline-block;
    background:var(--gold);
    color:#241708;
    font-weight:700;
    font-size:0.9rem;
    padding:12px 24px;
    border-radius:999px;
    text-decoration:none;
  }

  .reader-footer{
    max-width:960px;
    margin:0 auto;
    padding:0 24px 60px;
    text-align:center;
  }
  .reader-footer .cta-btn{
    display:inline-block;
    border:1px solid rgba(246,234,217,0.35);
    color:var(--cream);
    font-size:0.9rem;
    padding:12px 24px;
    border-radius:999px;
    text-decoration:none;
  }
</style>
</head>
<body>

<header class="reader-nav">
  <a class="back" href="${baseUrl}/">&larr; Kembali ke Rak Buku</a>
  <span class="brand">BIMXR &middot; Ebook</span>
</header>

<div class="reader-wrap">
  <aside class="toc">
    <h2 class="book-title">${escapeHtml(book.title)}</h2>
    <span class="book-author">${escapeHtml(book.author || "BIMXR")}</span>
    ${chapters.length ? `<nav>${tocItems}</nav>` : ""}
    <a class="cta-btn" href="${waLink}" target="_blank" rel="noopener">Pesan Versi Lengkap</a>
  </aside>

  <main class="content">
    ${chapters.length ? chapterSections : emptyState}
  </main>
</div>

${
  chapters.length
    ? `<div class="reader-footer">
        <a class="cta-btn" href="${waLink}" target="_blank" rel="noopener">Suka dengan bab-bab di atas? Pesan versi lengkapnya</a>
      </div>`
    : ""
}

</body>
</html>`;
}

function renderNotFoundPage(baseUrl) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>Buku tidak ditemukan · BIMXR</title>
<meta name="robots" content="noindex">
<style>
  body{ margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
        background:#120b19; color:#f6ead9; font-family:sans-serif; text-align:center; padding:24px; }
  a{ color:#e7c26a; }
</style>
</head>
<body>
  <div>
    <h1>Buku tidak ditemukan</h1>
    <p><a href="${baseUrl}/">Kembali ke Rak Buku</a></p>
  </div>
</body>
</html>`;
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

    const baseUrl = `${url.origin}${BASE_PATH}`;

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
          chapters: normalizeChapters(body.chapters),
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

      // "Baca Online" reader page — server-rendered straight from the
      // book's `chapters` field. Public, no auth required.
      if (pathname.startsWith("/read/") && request.method === "GET") {
        const id = decodeURIComponent(pathname.slice("/read/".length).replace(/\/$/, ""));
        const books = await getBooks(env);
        const book = books.find((b) => b.id === id);
        if (!book) {
          return html(renderNotFoundPage(baseUrl), 404);
        }
        return html(renderReaderPage(book, baseUrl));
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
