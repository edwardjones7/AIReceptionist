import { env } from "./env";

// Vapi sends a configurable secret header on every server request. We verify it
// so our endpoints can't be hit by anyone who finds the URL. If no secret is
// configured (local dev), allow through but warn.
export function verifyVapiSecret(req: Request): boolean {
  const expected = env.vapiServerSecret;
  if (!expected) {
    console.warn("VAPI_SERVER_SECRET not set — skipping auth (dev only)");
    return true;
  }
  const got =
    req.headers.get("x-vapi-secret") ??
    req.headers.get("x-vapi-signature") ??
    "";
  return got === expected;
}
