// api.js
// Base URL = domain custom lu. Cloudflare Worker di-route khusus buat
// path "/discord/*" ke domain ini, jadi SEMUA path di bawah harus mulai
// dengan "/discord/...".
export const API_BASE = "https://telehub.web.id";
async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Terjadi kesalahan, coba lagi.");
  }
  return data;
}
export function getServers() {
  return request("/discord/servers");
}
export function submitServer(payload) {
  return request("/discord/servers/submit", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
export function createPayment(serverId, paymentMethod) {
  return request("/discord/payment/create", {
    method: "POST",
    body: JSON.stringify({ serverId, paymentMethod }),
  });
}
export function adminGetServers(status, adminKey) {
  return request(`/discord/admin/servers?status=${encodeURIComponent(status)}`, {
    headers: { "x-admin-key": adminKey },
  });
}
export function adminApprove(id, adminKey) {
  return request(`/discord/admin/servers/${id}/approve`, {
    method: "POST",
    headers: { "x-admin-key": adminKey },
  });
}
export function adminReject(id, adminKey) {
  return request(`/discord/admin/servers/${id}/reject`, {
    method: "POST",
    headers: { "x-admin-key": adminKey },
  });
}
export function adminDelete(id, adminKey) {
  return request(`/discord/admin/servers/${id}`, {
    method: "DELETE",
    headers: { "x-admin-key": adminKey },
  });
}
