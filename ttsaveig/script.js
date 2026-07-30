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

  function renderResult(data) {
    resultArea.hidden = false;
    resultCard.innerHTML = `
      <img class="result__thumb" src="${data.thumbnail || ""}" alt="" onerror="this.style.display='none'">
      <div class="result__info">
        <h3>${escapeHtml(data.title || "Video siap diunduh")}</h3>
        <p>${escapeHtml(data.author ? "Oleh " + data.author : "")}</p>
      </div>
      <div class="result__actions">
        ${data.downloadUrl ? `<a href="${data.downloadUrl}" target="_blank" rel="noopener">Unduh</a>` : ""}
        ${data.audioUrl ? `<a class="secondary" href="${data.audioUrl}" target="_blank" rel="noopener">Unduh audio (MP3)</a>` : ""}
      </div>
    `;
    resultArea.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();

    if (!isLikelyValidUrl(url)) {
      setHint("Link tidak valid. Pastikan link diawali dengan https://", "is-error");
      return;
    }

    resultArea.hidden = true;
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
      setHint(
        err.message || "Terjadi kesalahan. Coba lagi beberapa saat lagi.",
        "is-error"
      );
    } finally {
      setLoading(false);
    }
  });
})();
