import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// PENTING: ganti "telehub-landingpage-web-id" di bawah kalau nama repo GitHub lu beda.
// Ini dibutuhin biar asset (JS/CSS) ke-load bener pas di-hosting di GitHub Pages
// (karena GitHub Pages project site jalan di subpath /nama-repo/, bukan di root domain).
export default defineConfig({
  plugins: [react()],
  base: "/telehub-landingpage-web-id/",
});
