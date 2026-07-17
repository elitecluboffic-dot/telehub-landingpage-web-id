import { layout, escapeHtml } from "../lib/render.js";
import { encodeFilenameToUrl } from "../routes/proxy.js";

function formatPrice(price) {
  const n = Number(price) || 0;
  return "Rp " + n.toLocaleString("id-ID");
}

function nftRow(nft) {
  const asset = encodeFilenameToUrl(nft.filename);
  return `
  <tr data-id="${escapeHtml(nft.id)}">
    <td><div class="thumb protected-media" data-asset="${asset}" oncontextmenu="return false;"></div></td>
    <td>${escapeHtml(nft.name)}</td>
    <td><code style="color:var(--text-muted)">${escapeHtml(nft.filename)}</code></td>
    <td>
      <input type="number" class="price-input" value="${escapeHtml(String(nft.price))}"
        style="width:120px;padding:6px 8px;font-size:13px;" />
    </td>
    <td class="row-actions">
      <button class="icon-btn save-price">Simpan</button>
      <button class="icon-btn danger delete-nft">Hapus</button>
    </td>
  </tr>`;
}

function orderRow(order) {
  const date = new Date(order.createdAt).toLocaleString("id-ID");
  return `
  <tr>
    <td>${escapeHtml(order.nftName || order.nftId)}</td>
    <td>${escapeHtml(order.telegram)}</td>
    <td>${escapeHtml(order.whatsapp)}</td>
    <td>${escapeHtml(order.payment)}</td>
    <td style="color:var(--text-muted);font-size:12px;">${escapeHtml(date)}</td>
  </tr>`;
}

export function renderAdminPage({ nfts, orders, availableFiles = [] }) {
  const rows = nfts.length
    ? nfts.map(nftRow).join("\n")
    : `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">Belum ada NFT.</td></tr>`;

  const orderRows = orders.length
    ? orders.map(orderRow).join("\n")
    : `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">Belum ada pengajuan pembelian.</td></tr>`;

  const fileOptions = availableFiles.length
    ? availableFiles.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("\n")
    : "";

  const body = `
  <div class="admin-shell">
    <div class="admin-side">
      <a href="/nft" class="brand" style="margin-bottom:8px;"><span class="brand-dot"></span> Telehub NFT</a>
      <a href="/nft/admin" class="active">Dashboard</a>
      <a href="/nft" target="_blank">Lihat Marketplace</a>
      <a href="#" onclick="adminLogout();return false;">Keluar</a>
    </div>
    <div class="admin-main">
      <h1>Kelola NFT</h1>
      <p class="sub">Upload NFT baru, atur harga, dan pantau pengajuan pembelian.</p>

      <div class="upload-card">
        <h3>Upload NFT Baru</h3>
        <div class="alert alert-error" id="uploadErr"></div>
        <div class="alert alert-success" id="uploadOk"></div>
        <form id="uploadForm">
          <div class="grid-2">
            <div class="field">
              <label>Nama NFT</label>
              <input type="text" name="name" required />
            </div>
            <div class="field">
              <label>Harga (IDR)</label>
              <input type="number" name="price" min="0" required />
            </div>
          </div>
          <div class="field">
            <label>Deskripsi (opsional)</label>
            <input type="text" name="description" />
          </div>
          <div class="field">
            <label>File GIF/Gambar</label>
            <input type="file" name="file" accept=".gif,.png,.jpg,.jpeg,.webp" required />
          </div>
          <button type="submit" class="btn btn-primary" id="uploadBtn">Upload</button>
        </form>
      </div>

      <div class="upload-card">
        <h3>Pakai File yang Sudah Ada di R2 (folder <code>nft/</code>)</h3>
        <p class="sub" style="margin:-8px 0 16px;">
          File yang sudah kamu upload manual ke bucket <code>photos-telehub/nft/</code> dan belum
          terdaftar di marketplace akan muncul di dropdown ini.
        </p>
        <div class="alert alert-error" id="existingErr"></div>
        <div class="alert alert-success" id="existingOk"></div>
        <form id="existingForm">
          <div class="grid-2">
            <div class="field">
              <label>Nama NFT</label>
              <input type="text" name="name" required />
            </div>
            <div class="field">
              <label>Harga (IDR)</label>
              <input type="number" name="price" min="0" required />
            </div>
          </div>
          <div class="field">
            <label>Deskripsi (opsional)</label>
            <input type="text" name="description" />
          </div>
          <div class="field">
            <label>Pilih File</label>
            <select name="filename" id="existingFileSelect" required>
              <option value="">-- pilih file --</option>
              ${fileOptions}
            </select>
            ${
              availableFiles.length === 0
                ? `<p style="font-size:12px;color:var(--text-muted);margin-top:6px;">Semua file di folder nft/ sudah terdaftar, atau belum ada file baru.</p>`
                : ""
            }
          </div>
          <button type="submit" class="btn btn-primary" id="existingBtn">Daftarkan NFT</button>
        </form>
      </div>

      <h3 style="font-family:var(--font-display);margin:0 0 12px;">Daftar NFT</h3>
      <table style="margin-bottom:36px;">
        <thead>
          <tr><th>Preview</th><th>Nama</th><th>File (R2 key)</th><th>Harga</th><th>Aksi</th></tr>
        </thead>
        <tbody id="nftTableBody">${rows}</tbody>
      </table>

      <h3 style="font-family:var(--font-display);margin:0 0 12px;">Pengajuan Pembelian Terbaru</h3>
      <table>
        <thead>
          <tr><th>NFT</th><th>Telegram</th><th>WhatsApp</th><th>Metode</th><th>Waktu</th></tr>
        </thead>
        <tbody>${orderRows}</tbody>
      </table>
    </div>
  </div>

  <script>
    async function loadProtectedImages() {
      const els = document.querySelectorAll('.protected-media');
      for (const el of els) {
        try {
          const res = await fetch('/nft/asset/' + el.dataset.asset, { credentials: 'same-origin' });
          if (!res.ok) continue;
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          el.style.backgroundImage = 'url(' + url + ')';
          el.style.backgroundSize = 'cover';
          el.style.backgroundPosition = 'center';
        } catch (e) {
          // biarkan kosong kalau gagal
        }
      }
    }
    loadProtectedImages();

    function adminLogout(){
      fetch('/nft/api/admin/logout', { method:'POST' }).then(()=> location.href = '/nft/admin/login');
    }

    document.getElementById('uploadForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const errBox = document.getElementById('uploadErr');
      const okBox = document.getElementById('uploadOk');
      errBox.classList.remove('show'); okBox.classList.remove('show');
      document.getElementById('uploadBtn').disabled = true;
      try {
        const fd = new FormData(form);
        const res = await fetch('/nft/api/admin/nft', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Upload gagal.');
        okBox.textContent = 'NFT berhasil diupload.';
        okBox.classList.add('show');
        setTimeout(() => location.reload(), 700);
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.add('show');
      } finally {
        document.getElementById('uploadBtn').disabled = false;
      }
    });

    document.getElementById('existingForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const errBox = document.getElementById('existingErr');
      const okBox = document.getElementById('existingOk');
      errBox.classList.remove('show'); okBox.classList.remove('show');
      document.getElementById('existingBtn').disabled = true;
      try {
        const payload = {
          name: form.name.value.trim(),
          price: form.price.value,
          description: form.description.value.trim(),
          filename: form.filename.value,
        };
        const res = await fetch('/nft/api/admin/nft-existing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal mendaftarkan NFT.');
        okBox.textContent = 'NFT berhasil didaftarkan.';
        okBox.classList.add('show');
        setTimeout(() => location.reload(), 700);
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.add('show');
      } finally {
        document.getElementById('existingBtn').disabled = false;
      }
    });

    document.querySelectorAll('.save-price').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tr = btn.closest('tr');
        const id = tr.dataset.id;
        const price = tr.querySelector('.price-input').value;
        btn.textContent = '...';
        try {
          const res = await fetch('/nft/api/admin/nft/' + encodeURIComponent(id), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ price }),
          });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal update harga.');
          btn.textContent = 'Tersimpan';
          setTimeout(() => (btn.textContent = 'Simpan'), 1200);
        } catch (err) {
          alert(err.message);
          btn.textContent = 'Simpan';
        }
      });
    });

    document.querySelectorAll('.delete-nft').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Hapus NFT ini beserta filenya di R2?')) return;
        const tr = btn.closest('tr');
        const id = tr.dataset.id;
        try {
          const res = await fetch('/nft/api/admin/nft/' + encodeURIComponent(id), { method: 'DELETE' });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal hapus.');
          tr.remove();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  </script>
  `;
  return layout({ title: "Admin - Telehub NFT", body });
}
