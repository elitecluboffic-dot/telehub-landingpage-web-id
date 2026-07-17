import { layout } from "../lib/render.js";

export function renderAdminLoginPage() {
  const body = `
  <div class="auth-wrap" style="margin-top:120px;">
    <div class="panel">
      <h2>Admin Login</h2>
      <p class="sub">Khusus tim Telehub. Kelola harga &amp; upload NFT baru.</p>
      <div class="alert alert-error" id="err"></div>
      <form id="adminLoginForm">
        <div class="field">
          <label>Username Admin</label>
          <input type="text" name="username" required autocomplete="username" />
        </div>
        <div class="field">
          <label>Password Admin</label>
          <input type="password" name="password" required autocomplete="current-password" />
        </div>
        <button type="submit" class="btn btn-primary btn-block">Masuk sebagai Admin</button>
      </form>
    </div>
  </div>
  <script>
    document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const errBox = document.getElementById('err');
      errBox.classList.remove('show');
      try {
        const res = await fetch('/nft/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: form.username.value.trim(), password: form.password.value }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Login admin gagal.');
        location.href = '/nft/admin';
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.add('show');
      }
    });
  </script>
  `;
  return layout({ title: "Admin Login - Telehub NFT", body });
}
