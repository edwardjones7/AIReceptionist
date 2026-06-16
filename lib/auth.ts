import { env } from "./env";

// Vapi sends a configurable secret header on server requests. We verify it so
// our endpoints can't be hit by anyone who finds the URL.
//
// `soft` mode (used on /api/llm): Vapi does not reliably forward the secret
// header to the custom-LLM URL, so we allow a request that carries NO secret,
// but still reject one that carries a WRONG secret. The tool + webhook routes
// stay strict (Vapi always sends the secret there).
export function verifyVapiSecret(req: Request, opts: { soft?: boolean } = {}): boolean {
  const expected = env.vapiServerSecret;
  if (!expected) {
    console.warn("VAPI_SERVER_SECRET not set — skipping auth (dev only)");
    return true;
  }
  const got =
    req.headers.get("x-vapi-secret") ??
    req.headers.get("x-vapi-signature") ??
    "";
  if (!got && opts.soft) {
    console.warn("No secret on request — allowing (soft auth, /api/llm)");
    return true;
  }
  return got === expected;
}
