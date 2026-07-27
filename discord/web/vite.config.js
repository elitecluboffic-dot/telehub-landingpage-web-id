import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// PENTING: base di-set "/discord/" karena SPA ini nanti dilayani Express
// dari path /discord di server telehub.web.id (lihat server.js: app.use('/discord', ...)).
// build.outDir diarahin ke ../dist supaya hasil build (index.html, JS, CSS)
// jatuh persis di folder discord/dist — sesuai yang dibaca server.js.
export default defineConfig({
  plugins: [react()],
  base: "/discord/",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
