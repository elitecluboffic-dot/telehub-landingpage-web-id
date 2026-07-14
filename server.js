import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

/* =========================================================
   SITE METADATA
   title & description are NOT duplicated here — they're read
   straight out of index.html's own <title> and <meta
   description> tags below, so there's exactly one place to
   edit them. url/image aren't in the HTML anywhere, so those
   stay explicit here.
========================================================= */
const SITE = {
  url: 'https://telehub.web.id',
  image: 'https://telehub.web.id/og-image.jpg', // ganti sesuai path gambar preview lo
};

// Baca index.html sekali saat server start (bukan setiap request — lebih cepat).
// Kalau lo sering edit index.html dan pakai `npm run dev` tanpa restart,
// tinggal ganti readFileSync ini jadi dipanggil ulang tiap request.
const indexTemplate = readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
const titleMatch = indexTemplate.match(/<title>(.*?)<\/title>/i);
const descMatch = indexTemplate.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i);
const pageTitle = titleMatch ? titleMatch[1] : 'Telehub';
const pageDescription = descMatch ? descMatch[1] : '';

function renderIndexHtml() {
  // title & description sudah benar di index.html itu sendiri — gak perlu
  // di-replace lagi di sini, cukup ditambahin OG/Twitter tags yang belum ada
  const ogTags = `
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="${pageDescription}">
  <meta property="og:image" content="${SITE.image}">
  <meta property="og:url" content="${SITE.url}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${pageTitle}">
  <meta name="twitter:description" content="${pageDescription}">
  <meta name="twitter:image" content="${SITE.image}">
</head>`;
  return indexTemplate.replace('</head>', ogTags);
}

// static assets disajikan langsung (JS, CSS, gambar, dll) dengan cache header
// biar CDN/browser bisa nyimpen file yang jarang berubah lebih lama
app.use(express.static(__dirname, {
  extensions: ['html'],
  index: false,
  etag: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      // HTML statis (kalau ada) jangan di-cache lama
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      // JS, CSS, gambar, favicon dll — aman di-cache lama
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    }
  }
}));

// semua route lain (termasuk '/') dapet index.html yang sudah disuntik meta tag
app.get('*', (req, res) => {
  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'no-cache'); // HTML ini di-generate ulang tiap request, jangan di-cache lama
  res.send(renderIndexHtml());
});

app.listen(PORT, () => {
  console.log(`TELEHUB running on port ${PORT}`);
});
