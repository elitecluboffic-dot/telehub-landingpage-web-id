import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "/discord/" karena Worker Cloudflare nangkep semua path di bawah
// telehub.web.id/discord/* (lihat wrangler.toml [assets] + route Cloudflare
// yang di-set di dashboard: telehub.web.id/discord* -> worker telehub-api).
// outDir dibiarin default ("dist" di dalam folder web/) karena itu yang
// dibaca wrangler.toml lewat [assets] directory = "./web/dist".
export default defineConfig({
  plugins: [react()],
  base: "/discord/",
});
