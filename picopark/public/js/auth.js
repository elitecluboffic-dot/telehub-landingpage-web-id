async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data;
  return data;
}
// Kalau sudah login, langsung redirect ke game (atau admin kalau role admin)
(async function checkSession() {
  try {
    const me = await api("/api/me");
    if (me.user) {
      window.location.href = me.user.role === "admin" ? "/admin.html" : "/game.html";
    }
  } catch (e) { /* belum login, tetap di halaman ini */ }
})();
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
document.getElementById("show-register").addEventListener("click", () => {
  loginForm.classList.add("hidden");
  registerForm.classList.remove("hidden");
});
document.getElementById("show-login").addEventListener("click", () => {
  registerForm.classList.add("hidden");
  loginForm.classList.remove("hidden");
});
document.getElementById("btn-login").addEventListener("click", async () => {
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error");
  errEl.textContent = "";
  try {
    const res = await api("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
    window.location.href = res.user.role === "admin" ? "/admin.html" : "/game.html";
  } catch (e) {
    errEl.textContent = e.error || "Gagal login";
  }
});
document.getElementById("btn-register").addEventListener("click", async () => {
  const username = document.getElementById("reg-username").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;
  const errEl = document.getElementById("register-error");
  errEl.textContent = "";
  try {
    await api("/api/register", { method: "POST", body: JSON.stringify({ username, email, password }) });
    window.location.href = "/game.html";
  } catch (e) {
    errEl.textContent = e.error || "Gagal daftar";
  }
});
