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
  const qualitySelect = document.getElementById("quality");

  // --- elemen mockup hp ---
  const phoneScreen = document.querySelector(".phone__screen");
  const phoneGradient = document.querySelector(".phone__gradient");
  const phoneUi = document.querySelector(".phone__ui");
  const spillCard = document.querySelector(".spill-card");

  let activePlatform = "tiktok";

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
        activePlatform === "tiktok"
          ? "Tempel link TikTok di sini…"
          : "Tempel link Instagram Reels/Post di sini…";
    });
  });

  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    btnLabel.textContent = isLoading ? "Memproses…" : "Ambil Video";
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

  // Isi mockup hp dengan hasil video asli (sudah dalam bentuk URL ter-proxy)
  function renderPhonePreview(data) {
    if (!phoneScreen) return;

    // sembunyikan skeleton/gradient placeholder
    if (phoneGradient) phoneGradient.style.display = "none";
    if (phoneUi) phoneUi.style.display = "none";

    const mediaWrap = document.createElement("div");
    mediaWrap.className = "phone__media";

    if (data.downloadUrl) {
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
      if (thumb && data.thumbnail) {
        thumb.style.backgroundImage = `url("${data.thumbnail}")`;
        thumb.style.backgroundSize = "cover";
        thumb.style.backgroundPosition = "center";
      }
      const lines = spillCard.querySelectorAll(".spill-line");
      if (lines[0]) lines[0].textContent = data.title ? truncate(data.title, 22) : "Video siap";
      if (lines[1]) lines[1].textContent = data.author ? "@" + data.author : "";
      const badge = spillCard.querySelector(".spill-card__badge");
      if (badge) {
        badge.textContent = (qualitySelect.value === "sd" ? "SD" : "HD") +
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

    resultArea.hidden = false;
    resultCard.innerHTML = `
      <img class="result__thumb" src="${proxiedThumb || ""}" alt="" onerror="this.style.display='none'">
      <div class="result__info">
        <h3>${escapeHtml(data.title || "Video siap diunduh")}</h3>
        <p>${escapeHtml(data.author ? "Oleh " + data.author : "")}</p>
      </div>
      <div class="result__actions">
        ${proxiedDownload ? `<a href="${proxiedDownload}" target="_blank" rel="noopener">Unduh</a>` : ""}
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
    setHint("Mengambil data video…");
    setLoading(true);

    const payload = {
      url,
      platform: activePlatform,
      quality: qualitySelect.value,
      removeWatermark: noWatermarkChk.checked,
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
      setHint("Berhasil! Video siap diunduh.", "is-ok");
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
