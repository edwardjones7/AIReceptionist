// Business reporting for founder mode. Aggregates from Supabase. Low volume, so
// we fetch the window's rows and tally in JS (no RPC needed).

import { db } from "./supabase";

export type Period = "today" | "week" | "month";

// Start-of-window as a UTC instant. "today" = since local midnight in `tz`;
// "week"/"month" = rolling 7/30 days.
function windowStart(period: Period, tz: string): Date {
  const now = new Date();
  if (period === "week") return new Date(now.getTime() - 7 * 86_400_000);
  if (period === "month") return new Date(now.getTime() - 30 * 86_400_000);
  // today → local midnight in tz, converted to the correct UTC instant
  const offsetMs =
    new Date(now.toLocaleString("en-US", { timeZone: tz })).getTime() -
    new Date(now.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  return new Date(Date.UTC(y, m - 1, d) - offsetMs);
}

export interface Stats {
  period: Period;
  calls: number;
  booked: number;
  leads: number;
  qualifiedLeads: number;
  transferred: number;
  missed: number;
  bookRatePct: number;
}

export async function getStats(
  tenantId: string,
  period: Period,
  tz: string,
): Promise<Stats> {
  const startIso = windowStart(period, tz).toISOString();

  const [callsRes, leadsRes, bookingsRes] = await Promise.all([
    db().from("calls").select("outcome").eq("tenant_id", tenantId).gte("created_at", startIso),
    db().from("leads").select("qualified").eq("tenant_id", tenantId).gte("created_at", startIso),
    db().from("bookings").select("id").eq("tenant_id", tenantId).eq("type", "discovery_call").gte("created_at", startIso),
  ]);

  const calls = callsRes.data ?? [];
  const leads = leadsRes.data ?? [];
  const booked = bookingsRes.data?.length ?? 0;

  const outcome = (o: string) => calls.filter((c) => (c as { outcome?: string }).outcome === o).length;
  const callCount = calls.length;

  return {
    period,
    calls: callCount,
    booked,
    leads: leads.length,
    qualifiedLeads: leads.filter((l) => (l as { qualified?: boolean }).qualified).length,
    transferred: outcome("transferred"),
    missed: outcome("missed"),
    bookRatePct: callCount > 0 ? Math.round((booked / callCount) * 100) : 0,
  };
}

export interface RecentLead {
  name: string | null;
  intent: string | null;
  qualified: boolean | null;
  status: string | null;
  created_at: string;
}

export async function getRecentLeads(
  tenantId: string,
  limit = 5,
): Promise<RecentLead[]> {
  const { data } = await db()
    .from("leads")
    .select("name,intent,qualified,status,created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as RecentLead[];
}

export interface RecentCall {
  caller_number: string | null;
  outcome: string | null;
  summary: string | null;
  duration_sec: number | null;
  created_at: string;
}

// Recent completed calls with their AI-written summaries. Only returns calls that
// actually have a summary (i.e. a real call that produced an end-of-call report,
// not a bare row created by tool dispatch).
export async function getRecentCalls(
  tenantId: string,
  limit = 5,
): Promise<RecentCall[]> {
  const { data } = await db()
    .from("calls")
    .select("caller_number,outcome,summary,duration_sec,created_at")
    .eq("tenant_id", tenantId)
    .not("summary", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as RecentCall[];
}

export interface UpcomingBooking {
  name: string | null;
  slot_start: string;
  type: string;
}

export async function getUpcomingBookings(
  tenantId: string,
  limit = 5,
): Promise<UpcomingBooking[]> {
  const { data } = await db()
    .from("bookings")
    .select("name,slot_start,type")
    .eq("tenant_id", tenantId)
    .gte("slot_start", new Date().toISOString())
    .order("slot_start", { ascending: true })
    .limit(limit);
  return (data ?? []) as UpcomingBooking[];
}
