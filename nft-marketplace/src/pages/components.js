import { escapeHtml } from "../lib/render.js";

export function publicNav(username) {
  const rightLinks = username
    ? `<span style="color:var(--text-muted)">Hai, ${escapeHtml(username)}</span>
       <a href="#" onclick="logoutUser();return false;" class="btn btn-ghost" style="padding:8px 14px;font-size:13px;">Keluar</a>`
    : `<a href="/nft/login">Masuk</a>
       <a href="/nft/register" class="btn btn-primary" style="padding:9px 16px;font-size:13px;">Daftar</a>`;

  return `
  <div class="nav">
    <a href="/nft" class="brand"><span class="brand-dot"></span> Telehub NFT</a>
    <div class="nav-links">
      <a href="/nft">Koleksi</a>
      ${rightLinks}
    </div>
  </div>
  <script>
    function logoutUser(){
      fetch('/nft/api/logout', { method:'POST' }).then(()=> location.href = '/nft');
    }
  </script>`;
}

export function publicFooter() {
  return `<div class="footer">Telehub NFT Marketplace &middot; Based on NFT.</div>`;
}
