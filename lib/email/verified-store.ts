// Remembers the email the caller actually confirmed, keyed by Vapi call id, so
// book_discovery_call uses the verified address rather than whatever the model
// retypes from memory a few turns later.
//
// Best-effort by design: on Vercel two /api/tools requests in the same call can
// land on different lambda instances, so a miss is normal and every reader must
// fall back to the model-supplied value. The durable version is a
// calls.verified_email column — see the plan.

interface Entry {
  email: string;
  at: number;
}

const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 500;

const store = new Map<string, Entry>();

function sweep(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of store) if (v.at < cutoff) store.delete(k);
  // Map preserves insertion order, so the head is the oldest.
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export function setVerifiedEmail(callId: string | undefined, email: string): void {
  if (!callId || !email) return;
  store.delete(callId); // re-insert so the entry moves to the tail
  store.set(callId, { email, at: Date.now() });
  sweep();
}

export function getVerifiedEmail(callId: string | undefined): string | null {
  if (!callId) return null;
  const hit = store.get(callId);
  if (!hit) return null;
  if (hit.at < Date.now() - TTL_MS) {
    store.delete(callId);
    return null;
  }
  return hit.email;
}
