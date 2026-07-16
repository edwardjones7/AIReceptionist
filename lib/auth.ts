import { env } from "./env";
import { safeEqual } from "./admin-session";

// Vapi sends a configurable secret on server requests. We verify it so our
// endpoints can't be hit by anyone who finds the URL.
//
// The secret is accepted from the x-vapi-secret / x-vapi-signature header OR a
// `?token=` query param. The query param exists because Vapi does not reliably
// forward the secret header to the custom-LLM URL — so provisioning embeds the
// token in model.url (see buildAssistantPayload). Strict everywhere: a request
// with no credential is rejected.
//
// Fail-closed in production: if VAPI_SERVER_SECRET is unset, everything is
// rejected. In dev we skip auth (with a warning) so local tunnels stay easy.
export function verifyVapiSecret(req: Request): boolean {
  const expected = env.vapiServerSecret;
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      console.error("VAPI_SERVER_SECRET not set — rejecting request (fail closed)");
      return false;
    }
    console.warn("VAPI_SERVER_SECRET not set — skipping auth (dev only)");
    return true;
  }
  const fromHeader =
    req.headers.get("x-vapi-secret") ?? req.headers.get("x-vapi-signature");
  let fromQuery = new URL(req.url).searchParams.get("token");
  // Some Vapi versions build the completions URL by naive string append
  // (<model.url>/chat/completions), which lands the path suffix inside the
  // token value. Strip it before comparing.
  if (fromQuery?.endsWith("/chat/completions")) {
    fromQuery = fromQuery.slice(0, -"/chat/completions".length);
  }
  const got = fromHeader ?? fromQuery ?? "";
  return safeEqual(got, expected);
}
