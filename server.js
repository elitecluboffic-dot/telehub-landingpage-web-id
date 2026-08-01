import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { ttdl, igdl } from 'btch-downloader';

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
// Route ini HARUS ditaruh sebelum static middleware & catch-all '*' di
// bawah, supaya tidak "ketiban" index.html landing page utama.
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



app.get(['/ttsaveig', '/ttsaveig/'], (req, res) => {
  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'ttsaveig', 'index.html'));
});

/* =========================================================
   PICOPARK / DUOJUMP — redirect ke Cloudflare Workers
   Game co-op "DuoJump" (Pico Park clone) DIHOSTING TERPISAH di
   Cloudflare Workers (pakai D1 database + Workers Assets binding,
   yang tidak bisa jalan di server Express/Node biasa ini). Jadi di
   sini kita cuma redirect '/picopark' (dan semua sub-path/query di
   bawahnya) ke domain Worker tersebut, BUKAN nge-serve filenya
   langsung dari server ini.

   GANTI nilai PICOPARK_WORKER_URL di bawah sesuai domain Worker
   kamu yang sebenarnya, contoh:
     - default Cloudflare:  https://picopark-clone.<subdomain-kamu>.workers.dev
     - kalau pakai custom domain/subdomain, misal: https://main.telehub.web.id
   Bisa juga di-override lewat environment variable PICOPARK_WORKER_URL
   tanpa perlu ubah kode ini.

   Route ini HARUS ditaruh sebelum static middleware & catch-all '*'
   di bawah, sama seperti route /indexing, /ebook, /ttsaveig di atas,
   supaya tidak "ketiban" index.html landing page utama.
========================================================= */
const PICOPARK_WORKER_URL =
  process.env.PICOPARK_WORKER_URL || 'https://picopark.telehub.web.id';

app.get(['/picopark', '/picopark/*'], (req, res) => {
  // req.originalUrl contoh: "/picopark/game.html?foo=bar"
  // Kita buang prefix "/picopark" saja, sisanya (path + query string)
  // diteruskan apa adanya ke Worker, supaya deep link tetap kebawa.
  const remainder = req.originalUrl.replace(/^\/picopark/, '') || '/';
  const target = PICOPARK_WORKER_URL.replace(/\/+$/, '') + remainder;
  res.redirect(302, target);
});

/* =========================================================
   TTSAVEIG — TikTok & Instagram Downloader (backend)
   Frontend statisnya (folder ttsaveig/, di-deploy terpisah lewat
   Cloudflare Workers) manggil endpoint POST /api/download di sini
   lewat fetch(), sesuai kontrak di API_CONTRACT.md yang sudah dibikin
   bareng frontend-nya. Route ini HARUS ditaruh sebelum static
   middleware & catch-all '*' di bawah, sama seperti route lain di
   file ini, supaya tidak "ketiban" index.html landing page utama.

   Pakai package "btch-downloader" (npm i btch-downloader) yang di
   baliknya manggil service pihak ketiga untuk ambil link video HD
   tanpa watermark — bukan scraping langsung dari server kita. Kalau
   service itu down/berubah format, endpoint ini bisa gagal; sudah
   dibungkus try/catch supaya errornya rapi ke frontend, bukan crash
   server.
========================================================= */

// Rate limiter khusus & lebih ketat untuk endpoint download, di atas
// rate limiter global (100/menit) yang sudah ada di atas — proses
// download ke service pihak ketiga lebih berat, jadi dibatasi lebih
// kencang: 20 request per menit per IP.
const downloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Terlalu banyak permintaan unduh, coba lagi sebentar lagi.' },
});

app.use('/api/download', express.json());

// Validasi dasar: link harus benar-benar dari domain TikTok atau
// Instagram sesuai platform yang dipilih user, supaya endpoint ini
// tidak dipakai untuk hal lain di luar tujuannya.
function isValidPlatformUrl(url, platform) {
  try {
    const { hostname } = new URL(url);
    const host = hostname.replace(/^www\./, '');
    if (platform === 'tiktok') {
      return /(^|\.)tiktok\.com$/.test(host) || /(^|\.)vt\.tiktok\.com$/.test(host) || /(^|\.)vm\.tiktok\.com$/.test(host);
    }
    if (platform === 'instagram') {
      return /(^|\.)instagram\.com$/.test(host);
    }
    return false;
  } catch {
    return false;
  }
}

// Ambil url dari beberapa kemungkinan nama field, karena skema JSON
// dari btch-downloader tidak didokumentasikan lengkap dan bisa beda
// antar versi. Kalau kamu jalanin console.log(rawResult) sekali dan
// nama field-nya ternyata beda, tinggal tambahin di daftar ini.
function pickFirst(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key]) return obj[key];
  }
  return null;
}

function normalizeTikTok(raw, wantAudioOnly) {
  // ttdl() umumnya mengembalikan object langsung, atau array berisi
  // satu object hasil (tergantung versi). Kita handle dua-duanya.
  const item = Array.isArray(raw) ? raw[0] : raw;
  if (!item) return null;

  const noWatermarkUrl = pickFirst(item, ['video', 'play', 'nowm', 'no_watermark', 'hd', 'video_hd']);
  const audioUrl = pickFirst(item, ['audio', 'music', 'mp3']);
  const thumbnail = pickFirst(item, ['thumbnail', 'cover', 'image']);
  const title = pickFirst(item, ['title', 'desc', 'caption']);
  const author = pickFirst(item, ['author', 'username', 'nickname']);

  const downloadUrl = Array.isArray(noWatermarkUrl) ? noWatermarkUrl[0] : noWatermarkUrl;
  const resolvedAudioUrl = Array.isArray(audioUrl) ? audioUrl[0] : audioUrl;

  if (!downloadUrl && !resolvedAudioUrl) return null;

  return {
    title: title || 'Video TikTok',
    author: author || '',
    thumbnail: Array.isArray(thumbnail) ? thumbnail[0] : thumbnail || '',
    downloadUrl: wantAudioOnly ? null : downloadUrl || null,
    audioUrl: resolvedAudioUrl || null,
  };
}

function normalizeInstagram(raw) {
  // igdl() umumnya mengembalikan array of media (karena satu post bisa
  // berisi beberapa foto/video sekaligus / carousel). Kita ambil item
  // pertama yang punya url video/gambar.
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const item = list.find((i) => pickFirst(i, ['url', 'video', 'download_url', 'play']));
  if (!item) return null;

  const downloadUrl = pickFirst(item, ['url', 'video', 'download_url', 'play']);
  const thumbnail = pickFirst(item, ['thumbnail', 'cover', 'image']);
  const title = pickFirst(item, ['title', 'caption', 'desc']);
  const author = pickFirst(item, ['author', 'username']);

  return {
    title: title || 'Video/Foto Instagram',
    author: author || '',
    thumbnail: Array.isArray(thumbnail) ? thumbnail[0] : thumbnail || '',
    downloadUrl: Array.isArray(downloadUrl) ? downloadUrl[0] : downloadUrl,
    audioUrl: null,
  };
}

app.post('/api/download', downloadLimiter, async (req, res) => {
  const { url, platform, quality, removeWatermark } = req.body || {};

  if (!url || !platform) {
    return res.status(400).json({ success: false, message: 'url dan platform wajib diisi.' });
  }
  if (platform !== 'tiktok' && platform !== 'instagram') {
    return res.status(400).json({ success: false, message: 'platform harus "tiktok" atau "instagram".' });
  }
  if (!isValidPlatformUrl(url, platform)) {
    return res.status(400).json({
      success: false,
      message: `Link ini bukan link ${platform === 'tiktok' ? 'TikTok' : 'Instagram'} yang valid.`,
    });
  }

  const wantAudioOnly = quality === 'audio';

  try {
    let normalized = null;

    if (platform === 'tiktok') {
      const raw = await ttdl(url);
      normalized = normalizeTikTok(raw, wantAudioOnly);
    } else {
      const raw = await igdl(url);
      normalized = normalizeInstagram(raw);
    }

    if (!normalized || (!normalized.downloadUrl && !normalized.audioUrl)) {
      return res.status(404).json({
        success: false,
        message: 'Video tidak ditemukan. Pastikan link publik (bukan akun privat) dan masih tersedia.',
      });
    }

    // removeWatermark dari body saat ini informatif saja — ttdl() dari
    // btch-downloader defaultnya sudah mengembalikan versi tanpa
    // watermark, jadi tidak ada langkah tambahan yang perlu dilakukan
    // di sini. Diteruskan ke response supaya frontend tahu preferensi
    // user tetap tercatat.
    res.json({
      success: true,
      data: {
        ...normalized,
        removeWatermark: !!removeWatermark,
      },
    });
  } catch (err) {
    console.error('[/api/download] error:', err);
    res.status(500).json({
      success: false,
      message: 'Gagal memproses link ini sekarang. Coba lagi beberapa saat lagi.',
    });
  }
});

/* =========================================================
   TELEHUB DISCORD DIRECTORY — data & config
   Data disimpen di file JSON lokal (data/telehub-servers.json),
   BUKAN database eksternal — cukup buat skala kecil-menengah dan
   gak butuh setup Cloudflare D1 / database terpisah sama sekali.
========================================================= */
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'telehub-servers.json');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(DATA_FILE)) writeFileSync(DATA_FILE, '[]', 'utf-8');

function loadServers() {
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveServers(servers) {
  writeFileSync(DATA_FILE, JSON.stringify(servers, null, 2), 'utf-8');
}

// Config Duitku & admin key — WAJIB di-set lewat environment variable di
// server (misal file .env atau env config hosting lo), JANGAN ditulis
// langsung di file ini.
// Set di server, contoh:
//   export DUITKU_MERCHANT_CODE="D1234"
//   export DUITKU_API_KEY="apikey_rahasia_dari_duitku"
//   export DUITKU_ENV="sandbox"   (ganti "production" kalau udah live)
//   export ADMIN_KEY="password_admin_bikinan_lo_sendiri"
const DUITKU_MERCHANT_CODE = process.env.DUITKU_MERCHANT_CODE || '';
const DUITKU_API_KEY = process.env.DUITKU_API_KEY || '';
const DUITKU_ENV = process.env.DUITKU_ENV || 'sandbox';
const DUITKU_CALLBACK_URL = process.env.DUITKU_CALLBACK_URL || `${SITE.url}/discord/callback`;
const DUITKU_RETURN_URL = process.env.DUITKU_RETURN_URL || `${SITE.url}/discord#/selesai`;
const ADMIN_KEY = process.env.ADMIN_KEY || '';

function isAdmin(req) {
  const key = req.headers['x-admin-key'];
  return !!key && key === ADMIN_KEY;
}

function hmacSha256Hex(message, key) {
  return crypto.createHmac('sha256', key).update(message).digest('hex');
}

function md5Hex(message) {
  return crypto.createHash('md5').update(message).digest('hex');
}

/* =========================================================
   TELEHUB DISCORD DIRECTORY — API routes
   Semua endpoint di bawah "/discord/...". Route ini HARUS ditaruh
   sebelum static middleware & catch-all '*' di bawah, dan sebelum
   route serving SPA-nya sendiri, biar API kepanggil duluan.
========================================================= */
app.use('/discord/servers', express.json());
app.use('/discord/payment', express.json());
app.use('/discord/callback', express.urlencoded({ extended: true }));
app.use('/discord/callback', express.json());
app.use('/discord/admin', express.json());

app.get('/discord/servers', (req, res) => {
  const servers = loadServers()
    .filter((s) => s.status === 'approved' && s.payment_status === 'paid')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((s) => ({
      id: s.id,
      name: s.name,
      invite_link: s.invite_link,
      description: s.description,
      icon_url: s.icon_url,
      tags: s.tags || [],
      verified: s.verified,
      created_at: s.created_at,
    }));
  res.json({ servers });
});

app.post('/discord/servers/submit', (req, res) => {
  const { name, invite_link, description, icon_url, tags, email } = req.body || {};

  if (!name || !invite_link || !email) {
    return res.status(400).json({ error: 'Nama server, invite link, dan email wajib diisi' });
  }

  const servers = loadServers();
  const newServer = {
    id: crypto.randomUUID(),
    name,
    invite_link,
    description: description || '',
    icon_url: icon_url || '',
    tags: Array.isArray(tags) ? tags : [],
    email,
    status: 'pending',
    payment_status: 'unpaid',
    merchant_order_id: null,
    verified: false,
    created_at: new Date().toISOString(),
  };
  servers.push(newServer);
  saveServers(servers);

  res.json({ id: newServer.id, message: 'Server berhasil disubmit, lanjut ke pembayaran.' });
});

app.post('/discord/payment/create', async (req, res) => {
  const { serverId } = req.body || {};
  if (!serverId) return res.status(400).json({ error: 'serverId wajib diisi' });

  const servers = loadServers();
  const server = servers.find((s) => s.id === serverId);
  if (!server) return res.status(404).json({ error: 'Server tidak ditemukan' });
  if (server.payment_status === 'paid') {
    return res.status(400).json({ error: 'Server ini sudah dibayar sebelumnya' });
  }

  const paymentAmount = 25000; // harga tetap: 25k per channel/server
  const merchantOrderId = `TH-${server.id.slice(0, 8)}-${Date.now()}`;
  const stringToSign = `${DUITKU_MERCHANT_CODE}${merchantOrderId}${paymentAmount}`;
  const signature = hmacSha256Hex(stringToSign, DUITKU_API_KEY);

  const payload = {
    merchantCode: DUITKU_MERCHANT_CODE,
    paymentAmount,
    merchantOrderId,
    productDetails: `Promosi server Discord di Telehub: ${server.name}`,
    email: server.email,
    customerVaName: server.name.slice(0, 20) || 'Telehub User',
    callbackUrl: DUITKU_CALLBACK_URL,
    returnUrl: DUITKU_RETURN_URL,
    expiryPeriod: 60,
    signature,
  };

  const duitkuUrl =
    DUITKU_ENV === 'production'
      ? 'https://passport.duitku.com/webapi/api/merchant/v2/inquiry'
      : 'https://sandbox.duitku.com/webapi/api/merchant/v2/inquiry';

  try {
    const duitkuRes = await fetch(duitkuUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await duitkuRes.json();

    if (data.statusCode !== '00') {
      return res.status(400).json({ error: data.statusMessage || 'Gagal membuat transaksi Duitku' });
    }

    server.merchant_order_id = merchantOrderId;
    saveServers(servers);

    res.json({ paymentUrl: data.paymentUrl, reference: data.reference });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Gagal menghubungi Duitku' });
  }
});

app.post('/discord/callback', (req, res) => {
  const { merchantCode, amount, merchantOrderId, resultCode, signature } = req.body || {};

  if (!merchantCode || !merchantOrderId || !signature) {
    return res.status(400).send('Bad request');
  }

  const expectedSignature = md5Hex(`${merchantCode}${amount}${merchantOrderId}${DUITKU_API_KEY}`);
  if (signature !== expectedSignature) {
    return res.status(400).send('Invalid signature');
  }

  if (resultCode === '00' || resultCode === 0 || resultCode === '0') {
    const servers = loadServers();
    const server = servers.find((s) => s.merchant_order_id === merchantOrderId);
    if (server) {
      server.payment_status = 'paid';
      saveServers(servers);
    }
  }

  // Duitku expects the literal text "OK" as response
  res.status(200).send('OK');
});

app.get('/discord/admin/servers', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  const status = req.query.status || 'pending';
  const servers = loadServers()
    .filter((s) => s.status === status)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json({ servers });
});

app.post('/discord/admin/servers/:id/approve', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  const servers = loadServers();
  const server = servers.find((s) => s.id === req.params.id);
  if (!server) return res.status(404).json({ error: 'Server tidak ditemukan' });

  if (server.payment_status !== 'paid') {
    return res
      .status(400)
      .json({ error: 'Server ini belum bayar, belum bisa di-approve jadi verified.' });
  }

  server.status = 'approved';
  server.verified = true;
  saveServers(servers);

  res.json({ success: true });
});

app.post('/discord/admin/servers/:id/reject', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  const servers = loadServers();
  const server = servers.find((s) => s.id === req.params.id);
  if (!server) return res.status(404).json({ error: 'Server tidak ditemukan' });

  server.status = 'rejected';
  saveServers(servers);

  res.json({ success: true });
});

/* =========================================================
   TELEHUB DISCORD DIRECTORY — serving SPA frontend-nya
   Hasil `npm run build` dari folder discord/web ditaruh di
   ./discord/dist relatif ke server ini (sudah diatur lewat
   outDir di web/vite.config.js). Static assets (JS/CSS) disajikan
   lewat express.static, sisanya (termasuk /discord itu sendiri dan
   semua sub-path karena SPA-nya pakai hash routing #/admin dst)
   jatuh ke index.html.
   HARUS ditaruh setelah semua route API /discord/... di atas
   (biar API kepanggil duluan), dan SEBELUM static middleware &
   catch-all '*' di bawah supaya tidak "ketiban" index.html landing
   page utama.
========================================================= */
app.use(
  '/discord',
  express.static(path.join(__dirname, 'discord', 'dist'), {
    index: false,
    etag: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      }
    },
  })
);

app.get(['/discord', '/discord/*'], (req, res) => {
  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'discord', 'dist', 'index.html'));
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
  if (!DUITKU_MERCHANT_CODE || !DUITKU_API_KEY || !ADMIN_KEY) {
    console.log('PERINGATAN: DUITKU_MERCHANT_CODE / DUITKU_API_KEY / ADMIN_KEY belum di-set — fitur Discord Directory belum akan berfungsi penuh.');
  }
  if (PICOPARK_WORKER_URL.includes('GANTI-SUBDOMAIN-KAMU')) {
    console.log('PERINGATAN: PICOPARK_WORKER_URL masih placeholder — ganti ke domain Worker DuoJump kamu yang sebenarnya.');
  }
});
