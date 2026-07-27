// api.js
// API_BASE dikosongin (path relatif) karena sekarang frontend dan backend
// dilayani dari domain yang SAMA (telehub.web.id) lewat server Express yang
// sama — bukan lagi Cloudflare Worker di domain/subdomain terpisah kayak
// versi sebelumnya. Jadi fetch("/discord/servers") otomatis nembak ke
// https://telehub.web.id/discord/servers, gak perlu ditulis domainnya.
export const API_BASE = "";

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

export function createPayment(serverId) {
  return request("/discord/payment/create", {
    method: "POST",
    body: JSON.stringify({ serverId }),
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
