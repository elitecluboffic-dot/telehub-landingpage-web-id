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

  function currentSubmitLabel() {
    return PLATFORM_SUBMIT_LABELS[activePlatform] || "Ambil Video";
  }

  function updateWatermarkOptionVisibility() {
    if (!watermarkChip) return;
    const shouldShow = PLATFORMS_WITH_WATERMARK_OPTION.has(activePlatform);
    watermarkChip.hidden = !shouldShow;
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
    submitBtn.disabled = isLoading;
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

  // Bungkus URL asli lewat endpoint proxy backend sendiri,
  // supaya browser tidak pernah menghubungi domain sumber (mis. dl.tiktokio.com) secara langsung.
  function proxied(url) {
    if (!url) return url;
    return `${API_BASE_URL}/api/proxy?url=${encodeURIComponent(url)}`;
  }

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

  // Isi mockup hp dengan hasil video/gambar asli (sudah dalam bentuk URL ter-proxy).
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
    const proxiedThumb = proxied(data.thumbnail);
    const proxiedDownload = proxied(data.downloadUrl);
    const proxiedAudio = proxied(data.audioUrl);

    // Untuk Pinterest, data.isVideo bisa false kalau pin-nya cuma gambar biasa
    // (bukan video/idea pin) -> label tombol & teks default disesuaikan.
    const isImageOnly = data.isVideo === false;
    const downloadLabel = isImageOnly ? "Unduh Gambar" : "Unduh";
    const defaultTitle = isImageOnly ? "Gambar siap diunduh" : "Video siap diunduh";

    resultArea.hidden = false;
    resultCard.innerHTML = `
      <img class="result__thumb" src="${proxiedThumb || proxiedDownload || ""}" alt="" onerror="this.style.display='none'">
      <div class="result__info">
        <h3>${escapeHtml(data.title || defaultTitle)}</h3>
        <p>${escapeHtml(data.author ? "Oleh " + data.author : "")}</p>
      </div>
      <div class="result__actions">
        ${proxiedDownload ? `<a href="${proxiedDownload}" target="_blank" rel="noopener">${escapeHtml(downloadLabel)}</a>` : ""}
        ${proxiedAudio ? `<a class="secondary" href="${proxiedAudio}" target="_blank" rel="noopener">Unduh audio (MP3)</a>` : ""}
      </div>
    `;
    resultArea.scrollIntoView({ behavior: "smooth", block: "start" });

    // Kirim versi ter-proxy ke preview hp, bukan URL asli
    renderPhonePreview({
      ...data,
      thumbnail: proxiedThumb,
      downloadUrl: proxiedDownload,
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();

    if (!isLikelyValidUrl(url)) {
      setHint("Link tidak valid. Pastikan link diawali dengan https://", "is-error");
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
    }
  });
})();
