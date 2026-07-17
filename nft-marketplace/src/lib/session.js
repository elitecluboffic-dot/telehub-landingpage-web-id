import { parseCookies, buildSetCookie } from "./cookies.js";
import { randomToken } from "./crypto.js";

const USER_COOKIE = "telehub_session";
const ADMIN_COOKIE = "telehub_admin_session";

export async function createUserSession(env, username) {
  const token = randomToken(24);
  const ttl = Number(env.SESSION_TTL_SECONDS || 604800);
  await env.NFT_KV.put(`session:${token}`, username, { expirationTtl: ttl });
  return { token, ttl };
}

export async function getUserFromRequest(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[USER_COOKIE];
  if (!token) return null;
  const username = await env.NFT_KV.get(`session:${token}`);
  return username || null;
}

export function setUserSessionCookie(headers, token, ttl) {
  headers.append("Set-Cookie", buildSetCookie(USER_COOKIE, token, { maxAge: ttl }));
}

export function clearUserSessionCookie(headers) {
  headers.append("Set-Cookie", buildSetCookie(USER_COOKIE, "", { clear: true }));
}

export async function destroyUserSession(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[USER_COOKIE];
  if (token) await env.NFT_KV.delete(`session:${token}`);
}

export async function createAdminSession(env) {
  const token = randomToken(24);
  const ttl = Number(env.ADMIN_SESSION_TTL_SECONDS || 43200);
  await env.NFT_KV.put(`admin_session:${token}`, "1", { expirationTtl: ttl });
  return { token, ttl };
}

export async function isAdminRequest(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[ADMIN_COOKIE];
  if (!token) return false;
  const val = await env.NFT_KV.get(`admin_session:${token}`);
  return val === "1";
}

export function setAdminSessionCookie(headers, token, ttl) {
  headers.append("Set-Cookie", buildSetCookie(ADMIN_COOKIE, token, { maxAge: ttl }));
}

export function clearAdminSessionCookie(headers) {
  headers.append("Set-Cookie", buildSetCookie(ADMIN_COOKIE, "", { clear: true }));
}

export async function destroyAdminSession(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[ADMIN_COOKIE];
  if (token) await env.NFT_KV.delete(`admin_session:${token}`);
}
