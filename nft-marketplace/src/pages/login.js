import { layout } from "../lib/render.js";
import { publicNav } from "./components.js";

export function renderLoginPage({ next = "/nft" } = {}) {
  const body = `
  ${publicNav(null)}
  <div class="auth-wrap">
    <div class="panel">
      <h2>Masuk</h2>
      <p class="sub">Masuk untuk mengajukan pembelian NFT.</p>
      <div class="alert alert-error" id="err"></div>
      <form id="loginForm">
        <div class="field">
          <label>Username</label>
          <input type="text" name="username" required autocomplete="username" />
        </div>
        <div class="field">
          <label>Password</label>
          <input type="password" name="password" required autocomplete="current-password" />
        </div>
        <button type="submit" class="btn btn-primary btn-block">Masuk</button>
      </form>
      <p class="form-note">Belum punya akun? <a href="/nft/register">Daftar di sini</a></p>
    </div>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const errBox = document.getElementById('err');
      errBox.classList.remove('show');
      try {
        const res = await fetch('/nft/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: form.username.value.trim(), password: form.password.value }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Login gagal.');
        location.href = ${JSON.stringify(next)};
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.add('show');
      }
    });
  </script>
  `;
  return layout({ title: "Masuk - Telehub NFT", body });
}
