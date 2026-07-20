import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import rateLimit from 'express-rate-limit';

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

// Kalau nanti butuh manggil Cloudflare API dari server (bukan wajib untuk
// DDoS/load balancing — itu tetap diatur di dashboard Cloudflare), token-nya
// dibaca dari environment variable, BUKAN ditulis langsung di file ini.
// Set di server: export CF_API_TOKEN="token_baru_lo"
const CF_API_TOKEN = process.env.CF_API_TOKEN || null;

// Trust Cloudflare's proxy biar req.ip nunjukin IP visitor asli, bukan IP Cloudflare
app.set('trust proxy', 1);

// Rate limiter — lapisan proteksi tambahan di belakang Cloudflare.
// Maksimal 100 request per menit per IP ke semua route.
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 menit
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Terlalu banyak request, coba lagi sebentar lagi.',
});
app.use(limiter);

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

// Health check endpoint — berguna kalau nanti pakai load balancer beneran
// (Cloudflare LB / Nginx / dll) untuk cek apakah instance ini masih hidup
app.get('/health', (req, res) => res.status(200).send('OK'));

// Halaman widget "Ajukan Indexing" — dilayani apa adanya dari
// folder indexing/index.html, tanpa disuntik OG/Twitter tag seperti
// landing page utama, karena ini halaman utilitas internal.
// Route ini HARUS ditaruh sebelum static middleware & catch-all '*'
// di bawah, supaya tidak "ketiban" index.html landing page utama.
app.get('/indexing', (req, res) => {
  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'indexing', 'index.html'));
});

// Halaman "Ebook BIMXR" — dilayani apa adanya dari folder ebook/index.html,
// sama seperti /indexing di atas, supaya tidak "ketiban" index.html landing
// page utama oleh catch-all '*' di bawah.
app.get(['/ebook', '/ebook/'], (req, res) => {
  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'ebook', 'index.html'));
});

// Halaman "Ebook Admin" — dilayani apa adanya dari folder ebook/admin/index.html,
// sama seperti /ebook & /indexing di atas. Route ini WAJIB ada dan HARUS
// ditaruh sebelum static middleware & catch-all '*' di bawah, supaya request
// ke '/ebook/admin/' tidak "ketiban" index.html landing page utama (yang
// sebelumnya kejadian karena route ini belum ada).
app.get(['/ebook/admin', '/ebook/admin/'], (req, res) => {
  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'ebook', 'admin', 'index.html'));
});

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
  if (!CF_API_TOKEN) {
    console.log('CF_API_TOKEN belum di-set (opsional, tidak wajib untuk server ini jalan).');
  }
});
