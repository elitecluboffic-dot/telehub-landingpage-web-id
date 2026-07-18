import { htmlResponse } from "./lib/render.js";
import { getUserFromRequest, isAdminRequest } from "./lib/session.js";
import { listNfts, listOrders } from "./lib/store.js";
import { renderMarketplacePage } from "./pages/marketplace.js";
import { renderLoginPage } from "./pages/login.js";
import { renderRegisterPage } from "./pages/register.js";
import { renderAdminLoginPage } from "./pages/adminLogin.js";
import { renderAdminPage } from "./pages/admin.js";
import { handleAssetProxy } from "./routes/proxy.js";
import {
  handleRegister,
  handleLogin,
  handleLogout,
  handleSubmitPurchase,
} from "./routes/api.js";
import {
  requireAdmin,
  handleAdminLogin,
  handleAdminLogout,
  handleAdminCreateNft,
  handleAdminUpdateNft,
  handleAdminDeleteNft,
  handleAdminListAvailableFiles,
  handleAdminCreateNftFromExisting,
  handleAdminListOrders,
  handleAdminApproveOrder,
  handleAdminRejectOrder,
  handleAdminGetOrderProof,
} from "./routes/adminApi.js";
import { listUnregisteredR2Files } from "./lib/store.js";

const ASSET_PREFIX = "/nft/asset/";

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      let path = url.pathname;
      // normalisasi: buang trailing slash kecuali root "/nft"
      if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
      const method = request.method.toUpperCase();

      // ---------- Halaman utama marketplace ----------
      if (path === "/nft" && method === "GET") {
        const [nfts, username] = await Promise.all([
          listNfts(env),
          getUserFromRequest(request, env),
        ]);
        return htmlResponse(renderMarketplacePage({ nfts, username }));
      }

      // ---------- Auth pembeli ----------
      if (path === "/nft/login" && method === "GET") {
        const next = url.searchParams.get("next") || "/nft";
        return htmlResponse(renderLoginPage({ next }));
      }
      if (path === "/nft/register" && method === "GET") {
        return htmlResponse(renderRegisterPage());
      }

      // ---------- Admin ----------
      if (path === "/nft/admin/login" && method === "GET") {
        return htmlResponse(renderAdminLoginPage());
      }
      if (path === "/nft/admin" && method === "GET") {
        const isAdmin = await isAdminRequest(request, env);
        if (!isAdmin) {
          return Response.redirect(`${url.origin}/nft/admin/login`, 302);
        }
        const [nfts, orders, availableFiles] = await Promise.all([
          listNfts(env),
          listOrders(env),
          listUnregisteredR2Files(env),
        ]);
        return htmlResponse(renderAdminPage({ nfts, orders, availableFiles }));
      }

      // ---------- API publik (pembeli) ----------
      if (path === "/nft/api/register" && method === "POST") {
        return handleRegister(request, env);
      }
      if (path === "/nft/api/login" && method === "POST") {
        return handleLogin(request, env);
      }
      if (path === "/nft/api/logout" && method === "POST") {
        return handleLogout(request, env);
      }
      if (path === "/nft/api/submit" && method === "POST") {
        return handleSubmitPurchase(request, env);
      }

      // ---------- API admin ----------
      if (path === "/nft/api/admin/login" && method === "POST") {
        return handleAdminLogin(request, env);
      }
      if (path === "/nft/api/admin/logout" && method === "POST") {
        return handleAdminLogout(request, env);
      }
      if (path === "/nft/api/admin/nft" && method === "POST") {
        const unauthorized = await requireAdmin(request, env);
        if (unauthorized) return unauthorized;
        return handleAdminCreateNft(request, env);
      }
      if (path === "/nft/api/admin/r2-files" && method === "GET") {
        const unauthorized = await requireAdmin(request, env);
        if (unauthorized) return unauthorized;
        return handleAdminListAvailableFiles(request, env);
      }
      if (path === "/nft/api/admin/nft-existing" && method === "POST") {
        const unauthorized = await requireAdmin(request, env);
        if (unauthorized) return unauthorized;
        return handleAdminCreateNftFromExisting(request, env);
      }
      if (path.startsWith("/nft/api/admin/nft/") && (method === "PUT" || method === "DELETE")) {
        const unauthorized = await requireAdmin(request, env);
        if (unauthorized) return unauthorized;
        const id = decodeURIComponent(path.slice("/nft/api/admin/nft/".length));
        if (method === "PUT") return handleAdminUpdateNft(request, env, id);
        return handleAdminDeleteNft(request, env, id);
      }

      // ---------- API admin: order management ----------
      if (path === "/nft/api/admin/orders" && method === "GET") {
        const unauthorized = await requireAdmin(request, env);
        if (unauthorized) return unauthorized;
        return handleAdminListOrders(request, env);
      }
      if (path.startsWith("/nft/api/admin/orders/") && path.endsWith("/approve") && method === "POST") {
        const unauthorized = await requireAdmin(request, env);
        if (unauthorized) return unauthorized;
        const id = decodeURIComponent(
          path.slice("/nft/api/admin/orders/".length, -"/approve".length)
        );
        return handleAdminApproveOrder(request, env, id);
      }
      if (path.startsWith("/nft/api/admin/orders/") && path.endsWith("/reject") && method === "POST") {
        const unauthorized = await requireAdmin(request, env);
        if (unauthorized) return unauthorized;
        const id = decodeURIComponent(
          path.slice("/nft/api/admin/orders/".length, -"/reject".length)
        );
        return handleAdminRejectOrder(request, env, id);
      }
      if (path.startsWith("/nft/api/admin/orders/") && path.endsWith("/proof") && method === "GET") {
        const unauthorized = await requireAdmin(request, env);
        if (unauthorized) return unauthorized;
        const id = decodeURIComponent(
          path.slice("/nft/api/admin/orders/".length, -"/proof".length)
        );
        return handleAdminGetOrderProof(request, env, id);
      }

      // ---------- Proxy asset R2 (GIF/gambar NFT) ----------
      // Skema baru: GET /nft/asset/<base64url-encoded-filename>
      // Nama file asli TIDAK PERNAH muncul di URL yang terlihat browser.
      // Wajib login (pembeli ATAU admin) sebelum file di-stream, DAN kepemilikan
      // spesifik per-file dicek lewat order berstatus "approved" - dicek di
      // dalam handleAssetProxy. Domain publik bucket R2 tetap tidak pernah
      // terekspos ke browser.
      if (method === "GET" && path.startsWith(ASSET_PREFIX)) {
        const encoded = path.slice(ASSET_PREFIX.length);
        return handleAssetProxy(request, env, encoded);
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      console.error("Unhandled error:", err && err.stack ? err.stack : err);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};
