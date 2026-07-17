import { layout, escapeHtml } from "../lib/render.js";
import { publicNav, publicFooter } from "./components.js";

function formatPrice(price) {
  const n = Number(price) || 0;
  return "Rp " + n.toLocaleString("id-ID");
}

function nftCard(nft) {
  const img = `/nft/${encodeURIComponent(nft.filename)}`;
  return `
  <div class="card" data-id="${escapeHtml(nft.id)}" data-name="${escapeHtml(nft.name)}" data-price="${escapeHtml(String(nft.price))}">
    <img class="card-media" src="${img}" alt="${escapeHtml(nft.name)}" loading="lazy" />
    <div class="card-body">
      <p class="card-name">${escapeHtml(nft.name)}</p>
      <p class="card-desc">${escapeHtml(nft.description || "Koleksi eksklusif Telehub.")}</p>
      <div class="card-footer">
        <span class="price-tag">${formatPrice(nft.price)}</span>
        <button class="btn btn-primary buy-btn" style="padding:8px 14px;font-size:13px;">Beli</button>
      </div>
    </div>
  </div>`;
}

export function renderMarketplacePage({ nfts, username }) {
  const cards = nfts.length
    ? nfts.map(nftCard).join("\n")
    : `<div class="empty-state">Belum ada NFT yang dirilis. Cek lagi nanti ya.</div>`;

  const loggedIn = Boolean(username);

  const body = `
  ${publicNav(username)}

  <div class="hero">
    <div class="container">
      <span class="eyebrow">Drop Terbaru</span>
      <h1>Koleksi NFT GIF eksklusif dari Telehub</h1>
      <p>Pilih koleksi favoritmu, isi form pemesanan, dan tim kami akan menghubungimu langsung untuk proses pembayaran manual.</p>
    </div>
  </div>

  <div class="grid">${cards}</div>

  ${publicFooter()}

  <div class="modal-backdrop" id="buyModal">
    <div class="modal">
      <button class="modal-close" onclick="closeModal()">&times;</button>
      <h2 style="font-family:var(--font-display);margin:0 0 4px;font-size:20px;">Ajukan Pembelian</h2>
      <p style="color:var(--text-muted);font-size:13px;margin:0 0 20px;" id="modalNftLabel"></p>

      <div class="alert alert-error" id="buyError"></div>
      <div class="alert alert-success" id="buySuccess"></div>

      <form id="buyForm">
        <div class="field">
          <label>Username Telegram <span class="req">*wajib</span></label>
          <input type="text" name="telegram" placeholder="@username_telegram" required />
        </div>
        <div class="field">
          <label>Nomor WhatsApp <span class="req">*wajib</span></label>
          <input type="tel" name="whatsapp" placeholder="08xxxxxxxxxx" required />
        </div>
        <div class="field">
          <label>Email (opsional)</label>
          <input type="email" name="email" placeholder="email@contoh.com" />
        </div>
        <div class="field">
          <label>Metode Pembayaran <span class="req">*wajib</span></label>
          <div class="pay-options">
            <label class="pay-option active" id="opt-DANA">
              <input type="radio" name="payment" value="DANA" checked /> DANA
            </label>
            <label class="pay-option" id="opt-SEABANK">
              <input type="radio" name="payment" value="SEABANK" /> SeaBank
            </label>
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-block" id="buySubmitBtn">Kirim Pengajuan</button>
      </form>
    </div>
  </div>

  <script>
    const isLoggedIn = ${loggedIn ? "true" : "false"};
    let currentNftId = null;

    document.querySelectorAll('.buy-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const card = e.target.closest('.card');
        if (!isLoggedIn) {
          location.href = '/nft/login?next=/nft';
          return;
        }
        currentNftId = card.dataset.id;
        document.getElementById('modalNftLabel').textContent =
          card.dataset.name + ' \u2014 Rp ' + Number(card.dataset.price).toLocaleString('id-ID');
        document.getElementById('buyError').classList.remove('show');
        document.getElementById('buySuccess').classList.remove('show');
        document.getElementById('buyForm').style.display = 'block';
        document.getElementById('buyModal').classList.add('open');
      });
    });

    function closeModal(){
      document.getElementById('buyModal').classList.remove('open');
    }

    document.querySelectorAll('.pay-option').forEach(opt => {
      opt.addEventListener('click', () => {
        document.querySelectorAll('.pay-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
      });
    });

    document.getElementById('buyForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const errBox = document.getElementById('buyError');
      const okBox = document.getElementById('buySuccess');
      errBox.classList.remove('show');
      okBox.classList.remove('show');

      const payload = {
        nftId: currentNftId,
        telegram: form.telegram.value.trim(),
        whatsapp: form.whatsapp.value.trim(),
        email: form.email.value.trim(),
        payment: form.querySelector('input[name=payment]:checked').value,
      };

      if (!payload.telegram || !payload.whatsapp) {
        errBox.textContent = 'Username Telegram dan nomor WhatsApp wajib diisi.';
        errBox.classList.add('show');
        return;
      }

      document.getElementById('buySubmitBtn').disabled = true;
      try {
        const res = await fetch('/nft/api/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error || 'Gagal mengirim pengajuan.');
        }
        form.style.display = 'none';
        okBox.textContent = 'Terima kasih telah mengajukan pembelian NFT - Tim kami akan menghubungi Anda Secepat mungkin.';
        okBox.classList.add('show');
      } catch (err) {
        errBox.textContent = err.message || 'Terjadi kesalahan, coba lagi.';
        errBox.classList.add('show');
      } finally {
        document.getElementById('buySubmitBtn').disabled = false;
      }
    });
  </script>
  `;

  return layout({ title: "Telehub NFT Marketplace", body });
}
