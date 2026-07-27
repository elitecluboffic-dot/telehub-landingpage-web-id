import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "/discord/" karena Worker Cloudflare nangkep semua path di bawah
// telehub.web.id/discord/* (lihat wrangler.toml [assets] + route Cloudflare
// yang di-set di dashboard: telehub.web.id/discord* -> worker telehub-api).
//
// outDir di-set ke "dist/discord" (bukan cuma "dist") supaya struktur folder
// hasil build MATCH dengan path URL-nya: request ke
// telehub.web.id/discord/assets/xxx.js harus nemu file fisik di
// web/dist/discord/assets/xxx.js. Kalau outDir cuma "dist", filenya
// ada di web/dist/assets/xxx.js (tanpa folder discord), jadi Cloudflare
// gak nemu filenya dan malah fallback ke index.html (SPA) -- makanya
// browser dapet HTML padahal minta JS/CSS (error MIME type).
export default defineConfig({
  plugins: [react()],
  base: "/discord/",
  build: {
    outDir: "dist/discord",
    emptyOutDir: true,
  },
});
