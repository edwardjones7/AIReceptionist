// Formatting + search-param helpers shared by admin and portal pages.
// Server-only like the rest of lib/ — client components receive formatted
// strings as props instead of importing these.

export function pageParam(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 1 ? n : 1;
}

export function fmtDate(iso: string | null | undefined, tz?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function fmtMinutes(seconds: number): string {
  return `${Math.round(seconds / 60)} min`;
}

// "12 calls · 43 min · $8.12"
export function fmtUsage(calls: number, seconds: number, costCents: number): string {
  return `${calls} call${calls === 1 ? "" : "s"} · ${Math.round(seconds / 60)} min · ${fmtCents(costCents)}`;
}

export function fmtDuration(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
