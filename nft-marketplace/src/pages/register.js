import { layout } from "../lib/render.js";
import { publicNav } from "./components.js";

export function renderRegisterPage() {
  const body = `
  ${publicNav(null)}
  <div class="auth-wrap">
    <div class="panel">
      <h2>Daftar</h2>
      <p class="sub">Buat akun untuk mulai mengoleksi NFT Telehub.</p>
      <div class="alert alert-error" id="err"></div>
      <form id="registerForm">
        <div class="field">
          <label>Username</label>
          <input type="text" name="username" minlength="3" required autocomplete="username" />
        </div>
        <div class="field">
          <label>Password</label>
          <input type="password" name="password" minlength="6" required autocomplete="new-password" />
        </div>
        <button type="submit" class="btn btn-primary btn-block">Daftar</button>
      </form>
      <p class="form-note">Sudah punya akun? <a href="/nft/login">Masuk di sini</a></p>
    </div>
  </div>
  <script>
    document.getElementById('registerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const errBox = document.getElementById('err');
      errBox.classList.remove('show');
      try {
        const res = await fetch('/nft/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: form.username.value.trim(), password: form.password.value }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Registrasi gagal.');
        location.href = '/nft';
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.add('show');
      }
    });
  </script>
  `;
  return layout({ title: "Daftar - Telehub NFT", body });
}
