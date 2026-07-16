// Brute-force throttle for the admin login. In-memory per lambda instance —
// an attacker rotating instances still faces the constant-time HMAC compare in
// verifyAdminPassword; this is defense-in-depth for the common case, not a
// bank vault. No DB table on purpose (single-operator product).

const WINDOW_MS = 15 * 60_000; // 15 minutes
const MAX_PER_KEY = 5;
const MAX_GLOBAL = 10; // backstop across all keys (spoofed/rotating IPs)
const GLOBAL_KEY = "__global__";

const failures = new Map<string, number[]>(); // key → failure timestamps

function recent(key: string): number[] {
  const cutoff = Date.now() - WINDOW_MS;
  const kept = (failures.get(key) ?? []).filter((t) => t > cutoff);
  if (kept.length) failures.set(key, kept);
  else failures.delete(key);
  return kept;
}

export function isLocked(key: string): boolean {
  return (
    recent(key).length >= MAX_PER_KEY || recent(GLOBAL_KEY).length >= MAX_GLOBAL
  );
}

export function registerFailure(key: string): void {
  const now = Date.now();
  failures.set(key, [...recent(key), now]);
  failures.set(GLOBAL_KEY, [...recent(GLOBAL_KEY), now]);
}

export function clearFailures(key: string): void {
  failures.delete(key);
}
