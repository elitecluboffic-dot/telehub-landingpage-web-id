(function () {
  "use strict";

  const form = document.getElementById("grabForm");
  const urlInput = document.getElementById("videoUrl");
  const submitBtn = document.getElementById("submitBtn");
  const btnLabel = submitBtn.querySelector(".btn-label");
  const btnSpinner = submitBtn.querySelector(".btn-spinner");
  const statusHint = document.getElementById("statusHint");
  const resultArea = document.getElementById("resultArea");
  const resultCard = document.getElementById("resultCard");
  const platformBtns = document.querySelectorAll(".platform-btn");
  const noWatermarkChk = document.getElementById("noWatermark");
  const watermarkChip = noWatermarkChk.closest(".chip");
  const qualitySelect = document.getElementById("quality");

  // --- elemen mockup hp ---
  const phoneScreen = document.querySelector(".phone__screen");
  const phoneGradient = document.querySelector(".phone__gradient");
  const phoneUi = document.querySelector(".phone__ui");
  const spillCard = document.querySelector(".spill-card");

  // Placeholder input & label tombol disesuaikan per platform.
  // Pinterest kebanyakan berupa pin GAMBAR (bukan video), jadi label
  // tombolnya beda dari TikTok/Instagram yang defaultnya video.
  const PLATFORM_PLACEHOLDERS = {
    tiktok: "Tempel link TikTok di sini…",
    instagram: "Tempel link Instagram Reels/Post di sini…",
    pinterest: "Tempel link pin Pinterest di sini…",
  };

  const PLATFORM_SUBMIT_LABELS = {
    tiktok: "Ambil Video",
    instagram: "Ambil Video",
    pinterest: "Ambil Gambar",
  };

  // Opsi "Tanpa watermark" cuma relevan untuk TikTok & Instagram, yang
  // memang punya watermark aplikasi di video aslinya. Pin Pinterest
  // (gambar/video) tidak punya watermark yang bisa dihapus, jadi
  // opsi ini disembunyikan waktu tab Pinterest aktif.
  const PLATFORMS_WITH_WATERMARK_OPTION = new Set(["tiktok", "instagram"]);

  let activePlatform = "tiktok";

  // ---------- State Cloudflare Turnstile (CAPTCHA) ----------
  let turnstileToken = null;
  let turnstileWidgetId = null;
  let isSubmitting = false;

  function currentSubmitLabel() {
    return PLATFORM_SUBMIT_LABELS[activePlatform] || "Ambil Video";
  }

  // Tombol submit HANYA aktif kalau: (1) tidak sedang proses request, DAN
  // (2) captcha Turnstile sudah diselesaikan (turnstileToken terisi).
  function refreshSubmitAvailability() {
    submitBtn.disabled = isSubmitting || !turnstileToken;
  }

  // Dipanggil otomatis oleh script Cloudflare Turnstile lewat parameter
  // ?onload=onTurnstileLoad di URL <script> pada index.html. Nama fungsi
  // ini HARUS persis "onTurnstileLoad" dan HARUS global (di window),
  // karena itu yang dipanggil oleh script eksternal Cloudflare.
  function initTurnstileWidget() {
    if (!window.turnstile) return;

    const container = document.getElementById("turnstileWidget");
    if (!container) return;

    const siteKey = window.TURNSTILE_SITE_KEY;
    if (!siteKey) {
      // Site key wajib diisi di config.js sebagai window.TURNSTILE_SITE_KEY
      // (site key itu PUBLIC, aman ditaruh di frontend -- yang rahasia
      // cuma secret key-nya, dan itu cuma ada di sisi backend Worker).
      console.error(
        "TURNSTILE_SITE_KEY belum diisi di config.js (window.TURNSTILE_SITE_KEY kosong)."
      );
      setHint(
        "Captcha belum dikonfigurasi (site key kosong). Hubungi admin situs ini.",
        "is-error"
      );
      return;
    }

    turnstileWidgetId = window.turnstile.render(container, {
      sitekey: siteKey,
      callback: (token) => {
        turnstileToken = token;
        refreshSubmitAvailability();
        // Bersihkan pesan error captcha sebelumnya (kalau ada) begitu
        // berhasil diselesaikan.
        if (statusHint.classList.contains("is-error")) {
          setHint("");
        }
      },
      "expired-callback": () => {
        turnstileToken = null;
        refreshSubmitAvailability();
        setHint("Captcha kedaluwarsa, selesaikan lagi sebelum mengunduh.", "is-error");
      },
      "error-callback": () => {
        turnstileToken = null;
        refreshSubmitAvailability();
        setHint("Captcha gagal dimuat. Coba refresh halaman.", "is-error");
      },
    });

    refreshSubmitAvailability();
  }

  // Fungsi ini WAJIB global (window.onTurnstileLoad), dipanggil oleh
  // script Cloudflare Turnstile setelah selesai dimuat.
  window.onTurnstileLoad = initTurnstileWidget;

  // Jaga-jaga race condition: kalau script Turnstile (yang di-load async)
  // ternyata SUDAH selesai duluan sebelum baris ini sempat jalan (jarang
  // tapi mungkin di koneksi sangat cepat/cache), window.turnstile sudah
  // tersedia tapi callback onload-nya sudah lewat -> render manual di sini.
  if (window.turnstile) {
    initTurnstileWidget();
  }

  // Tombol submit nonaktif dari awal sampai captcha selesai diselesaikan.
  refreshSubmitAvailability();

  function updateWatermarkOptionVisibility() {
    if (!watermarkChip) return;
    const shouldShow = PLATFORMS_WITH_WATERMARK_OPTION.has(activePlatform);
    // PENTING: pakai style.display langsung, BUKAN atribut `hidden`.
    // Atribut `hidden` cuma didukung lewat CSS bawaan browser
    // `[hidden] { display: none }` yang prioritasnya rendah — kalau
    // style.css punya aturan seperti `.chip { display: flex }` (buat
    // naro checkbox & teks sejajar), aturan itu MENANG dari [hidden]
    // sehingga elemen tetap kelihatan walau hidden=true. Inline style
    // di bawah ini selalu menang dari CSS class manapun.
    watermarkChip.style.setProperty("display", shouldShow ? "" : "none", "important");
  }

  platformBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      platformBtns.forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");
      activePlatform = btn.dataset.platform;
      urlInput.placeholder =
        PLATFORM_PLACEHOLDERS[activePlatform] || "Tempel link di sini…";
      updateWatermarkOptionVisibility();
      // Update label tombol submit sesuai platform yang baru dipilih
      // (hanya kalau sedang tidak dalam proses "Memproses…").
      if (!submitBtn.disabled) {
        btnLabel.textContent = currentSubmitLabel();
      }
    });
  });

  // Set kondisi awal saat halaman dimuat (platform default: tiktok),
  // supaya chip watermark tampil/sembunyi sesuai tab yang aktif dari awal.
  updateWatermarkOptionVisibility();

  function setLoading(isLoading) {
    isSubmitting = isLoading;
    refreshSubmitAvailability();
    btnLabel.textContent = isLoading ? "Memproses…" : currentSubmitLabel();
    btnSpinner.hidden = !isLoading;
  }

  function setHint(message, type) {
    statusHint.textContent = message || "";
    statusHint.classList.remove("is-error", "is-ok");
    if (type) statusHint.classList.add(type);
  }

  function isLikelyValidUrl(value) {
    try {
      const u = new URL(value);
      return /^https?:$/.test(u.protocol);
    } catch (e) {
      return false;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // [DICABUT] Sebelumnya ada fungsi proxied() di sini yang membungkus
  // semua URL media (thumbnail, video/gambar preview, DAN link download)
  // lewat backend (/api/proxy?url=...). Endpoint itu sudah dihapus dari
  // backend karena bikin Worker kelewat resource limit (error 1102) saat
  // menampung seluruh isi video ke memory. Sekarang thumbnail & preview
  // video/gambar pakai URL ASLI dari sumber langsung (dl.tiktokio.com,
  // cdninstagram.com, i.pinimg.com dst.) tanpa proxy sama sekali.

  // [DICABUT] Sebelumnya ada fungsi downloadLink(url, filename) di sini
  // yang MENYUSUN SENDIRI URL ke `${API_BASE_URL}/api/download-file?url=...`
  // dari downloadUrl/audioUrl mentah. Backend lama memvalidasi request ke
  // /api/download-file itu cuma lewat cek header Origin/Referer
  // (isRequestFromOwnSite di backend) -- di lapangan ini KELIHATAN gagal
  // random: klik tombol "Unduh" kadang malah dapat balasan JSON
  // {"success":false,"message":"Permintaan hanya diizinkan dari situs
  // Reelgrab."} padahal user memang klik dari situs asli. Penyebabnya,
  // Origin/Referer TIDAK SELALU dikirim browser untuk navigasi <a> biasa
  // (bisa hilang karena Referrer-Policy, rel="noreferrer", ekstensi
  // privasi, atau memang Origin tidak dikirim untuk navigasi GET biasa).
  //
  // SOLUSI (sinkron dengan update backend poin 12): backend sekarang
  // membuat SIGNED TOKEN (HMAC) untuk tiap downloadUrl/audioUrl, dan
  // langsung mengembalikan URL SIAP PAKAI lewat field
  // `data.downloadFileUrl` / `data.audioDownloadFileUrl` di response
  // /api/download -- sudah berupa URL absolut lengkap dengan token &
  // filename, tidak perlu dirakit lagi di frontend. Frontend TINGGAL
  // PAKAI LANGSUNG field itu sebagai href tombol unduh (lihat
  // renderResult() di bawah).

  // Reset mockup hp balik ke tampilan skeleton awal
  function resetPhonePreview() {
    if (!phoneScreen) return;
    phoneScreen.querySelectorAll(".phone__media").forEach((el) => el.remove());
    if (phoneGradient) phoneGradient.style.display = "";
    if (phoneUi) phoneUi.style.display = "";
    if (spillCard) {
      spillCard.classList.remove("is-filled");
      const thumb = spillCard.querySelector(".spill-card__thumb");
      if (thumb) thumb.style.backgroundImage = "";
      spillCard.querySelectorAll(".spill-line").forEach((el) => (el.textContent = ""));
    }
  }

  // Isi mockup hp dengan hasil video/gambar asli (URL langsung dari sumber,
  // tidak lagi lewat proxy backend).
  // data.isVideo (opsional, dikirim backend untuk Pinterest) menentukan apakah
  // media dirender sebagai <video> atau langsung sebagai gambar diam.
  function renderPhonePreview(data) {
    if (!phoneScreen) return;

    // sembunyikan skeleton/gradient placeholder
    if (phoneGradient) phoneGradient.style.display = "none";
    if (phoneUi) phoneUi.style.display = "none";

    const mediaWrap = document.createElement("div");
    mediaWrap.className = "phone__media";

    const treatAsImage = data.isVideo === false;

    if (data.downloadUrl && !treatAsImage) {
      const video = document.createElement("video");
      video.className = "phone__media-video";
      video.src = data.downloadUrl;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.autoplay = true;
      video.poster = data.thumbnail || "";

      // Kalau video gagal dimuat/diputar, otomatis fallback ke thumbnail gambar diam.
      video.addEventListener("error", () => {
        mediaWrap.innerHTML = "";
        appendThumbFallback(mediaWrap, data);
      });

      mediaWrap.appendChild(video);
    } else if (treatAsImage && data.downloadUrl) {
      // Pin Pinterest berupa gambar biasa -> downloadUrl-nya sendiri adalah gambar.
      appendThumbFallback(mediaWrap, { thumbnail: data.downloadUrl });
    } else if (data.thumbnail) {
      appendThumbFallback(mediaWrap, data);
    } else {
      // tidak ada media sama sekali, tampilkan gradient lagi
      if (phoneGradient) phoneGradient.style.display = "";
      return;
    }

    phoneScreen.appendChild(mediaWrap);

    // update kartu kecil (spill card) di luar hp
    if (spillCard) {
      spillCard.classList.add("is-filled");
      const thumb = spillCard.querySelector(".spill-card__thumb");
      const thumbSrc = data.thumbnail || (treatAsImage ? data.downloadUrl : "");
      if (thumb && thumbSrc) {
        thumb.style.backgroundImage = `url("${thumbSrc}")`;
        thumb.style.backgroundSize = "cover";
        thumb.style.backgroundPosition = "center";
      }
      const lines = spillCard.querySelectorAll(".spill-line");
      if (lines[0])
        lines[0].textContent = data.title
          ? truncate(data.title, 22)
          : treatAsImage
          ? "Gambar siap"
          : "Video siap";
      if (lines[1]) lines[1].textContent = data.author ? "@" + data.author : "";
      const badge = spillCard.querySelector(".spill-card__badge");
      if (badge) {
        badge.textContent =
          (qualitySelect.value === "sd" ? "SD" : "HD") +
          (noWatermarkChk.checked ? " · No WM" : "");
      }
    }
  }

  function appendThumbFallback(container, data) {
    const img = document.createElement("img");
    img.className = "phone__media-img";
    img.src = data.thumbnail;
    img.alt = "";
    container.appendChild(img);
  }

  function truncate(str, max) {
    return str.length > max ? str.slice(0, max - 1) + "…" : str;
  }

  function renderResult(data) {
    // Preview (thumbnail) tetap pakai URL asli langsung dari sumber.
    const thumb = data.thumbnail;
    const rawDownloadUrl = data.downloadUrl;

    // Untuk Pinterest, data.isVideo bisa false kalau pin-nya cuma gambar biasa
    // (bukan video/idea pin) -> label tombol & teks default disesuaikan.
    const isImageOnly = data.isVideo === false;
    const downloadLabel = isImageOnly ? "Unduh Gambar" : "Unduh";
    const defaultTitle = isImageOnly ? "Gambar siap diunduh" : "Video siap diunduh";

    // Link download SEKARANG langsung dipakai dari response backend
    // (data.downloadFileUrl / data.audioDownloadFileUrl) -- ini URL
    // absolut ke /api/download-file yang SUDAH berisi signed token &
    // filename, dibuat oleh backend saat /api/download diproses.
    // Tidak lagi dirakit manual di frontend (lihat catatan di atas,
    // dekat komentar "[DICABUT] downloadLink()").
    const downloadHref = data.downloadFileUrl || null;
    const audioHref = data.audioDownloadFileUrl || null;

    resultArea.hidden = false;
    resultCard.innerHTML = `
      <img class="result__thumb" src="${thumb || rawDownloadUrl || ""}" alt="" onerror="this.style.display='none'">
      <div class="result__info">
        <h3>${escapeHtml(data.title || defaultTitle)}</h3>
        <p>${escapeHtml(data.author ? "Oleh " + data.author : "")}</p>
      </div>
      <div class="result__actions">
        ${downloadHref ? `<a href="${downloadHref}" rel="noopener">${escapeHtml(downloadLabel)}</a>` : ""}
        ${audioHref ? `<a class="secondary" href="${audioHref}" rel="noopener">Unduh audio (MP3)</a>` : ""}
      </div>
    `;
    resultArea.scrollIntoView({ behavior: "smooth", block: "start" });

    // Preview mockup hp tetap pakai URL asli (bukan link /api/download-file),
    // karena elemen <video>/<img> di sini untuk DITONTON di halaman, bukan
    // didownload -- browser tetap bisa render langsung dari URL sumber.
    renderPhonePreview({
      ...data,
      thumbnail: thumb,
      downloadUrl: rawDownloadUrl,
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();

    if (!isLikelyValidUrl(url)) {
      setHint("Link tidak valid. Pastikan link diawali dengan https://", "is-error");
      return;
    }

    // Jaga-jaga tambahan di luar disabled state tombol (mis. submit
    // ke-trigger lewat cara lain selain klik tombol) -> captcha tetap
    // wajib ada sebelum request dikirim ke backend.
    if (!turnstileToken) {
      setHint("Selesaikan captcha di bawah terlebih dahulu.", "is-error");
      return;
    }

    resultArea.hidden = true;
    resetPhonePreview();
    setHint(
      activePlatform === "pinterest" ? "Mengambil data pin…" : "Mengambil data video…"
    );
    setLoading(true);

    const payload = {
      url,
      platform: activePlatform,
      quality: qualitySelect.value,
      // Opsi watermark disembunyikan untuk Pinterest (lihat
      // PLATFORMS_WITH_WATERMARK_OPTION di atas) -> paksa false
      // supaya nilai checkbox dari platform sebelumnya tidak
      // ikut terkirim tanpa sengaja.
      removeWatermark: PLATFORMS_WITH_WATERMARK_OPTION.has(activePlatform)
        ? noWatermarkChk.checked
        : false,
      // Token Turnstile diverifikasi ulang di backend (siteverify)
      // sebelum request diproses sama sekali -> lihat verifyTurnstileToken()
      // di index.js backend.
      turnstileToken,
    };

    try {
      // Endpoint & format request/response dijelaskan di API_CONTRACT.md
      const res = await fetch(`${API_BASE_URL}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message || `Server merespons dengan status ${res.status}`);
      }

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.message || "Video tidak ditemukan atau link tidak didukung.");
      }

      renderResult(data.data);
      setHint(
        data.data && data.data.isVideo === false
          ? "Berhasil! Gambar siap diunduh."
          : "Berhasil! Video siap diunduh.",
        "is-ok"
      );
    } catch (err) {
      console.error(err);
      resetPhonePreview();
      setHint(
        err.message || "Terjadi kesalahan. Coba lagi beberapa saat lagi.",
        "is-error"
      );
    } finally {
      setLoading(false);

      // Token Turnstile SEKALI PAKAI (Cloudflare menolak token yang sama
      // dipakai dua kali, error-code "timeout-or-duplicate") -> reset
      // widget setelah tiap percobaan submit, apa pun hasilnya, supaya
      // user harus menyelesaikan captcha baru sebelum bisa submit lagi.
      turnstileToken = null;
      if (window.turnstile && turnstileWidgetId !== null) {
        window.turnstile.reset(turnstileWidgetId);
      }
      refreshSubmitAvailability();
    }
  });
})();
