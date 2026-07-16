// Admin session primitives — pure Web Crypto, no Next.js imports, so both the
// root proxy (middleware) and server actions can use them. The session is an
// HMAC-signed expiry timestamp: no DB, no user table — there is exactly one
// admin (the operator), gated by ADMIN_PASSWORD.

const SESSION_TTL_MS = 7 * 24 * 3600_000; // 7 days

export const ADMIN_COOKIE = "scarlett_admin";

function secret(): string {
  // Read process.env directly (not lib/env) so this module stays importable
  // from the proxy without dragging the rest of the env surface along.
  return process.env.ADMIN_SESSION_SECRET ?? "";
}

async function hmacHex(payload: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Constant-time string compare (both hex/ascii).
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Cookie value: "<expiryEpochMs>.<hmac(expiry)>".
export async function createSessionValue(): Promise<string> {
  const expiry = String(Date.now() + SESSION_TTL_MS);
  return `${expiry}.${await hmacHex(expiry, secret())}`;
}

export async function verifySessionValue(
  value: string | undefined | null,
): Promise<boolean> {
  if (!value || !secret()) return false;
  const dot = value.indexOf(".");
  if (dot < 1) return false;
  const expiry = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^\d+$/.test(expiry) || Number(expiry) < Date.now()) return false;
  return safeEqual(sig, await hmacHex(expiry, secret()));
}

export async function verifyAdminPassword(pw: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!expected) return false;
  // Compare HMACs of both values — constant-time regardless of length skew.
  const key = secret() || "no-secret";
  return safeEqual(await hmacHex(pw, key), await hmacHex(expected, key));
}
