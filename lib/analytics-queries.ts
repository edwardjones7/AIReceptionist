// Range-scoped stats + time series for the dashboards. Server-only
// (service-role client). Data comes from the analytics RPCs in
// supabase/migrations/0003_analytics.sql; buckets and boundaries are UTC.

import { db } from "./supabase";

export type StatRange = "7d" | "14d" | "1m" | "3m" | "1y" | "all";
export type Bucket = "day" | "week" | "month";

export const RANGES: { value: StatRange; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "14d", label: "14D" },
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "1y", label: "1Y" },
  { value: "all", label: "ALL" },
];

const RANGE_DAYS: Record<Exclude<StatRange, "all">, number> = {
  "7d": 7,
  "14d": 14,
  "1m": 30,
  "3m": 91,
  "1y": 365,
};

export function rangeParam(raw: string | undefined): StatRange {
  return RANGES.some((r) => r.value === raw) ? (raw as StatRange) : "1m";
}

// null = all-time (the series RPC then starts at the tenant's first call).
export function rangeStart(range: StatRange): Date | null {
  if (range === "all") return null;
  return new Date(Date.now() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000);
}

// Bucket granularity: daily up to 3 months, weekly for a year, monthly all-time.
export function rangeBucket(range: StatRange): Bucket {
  if (range === "1y") return "week";
  if (range === "all") return "month";
  return "day";
}

export interface SeriesPoint {
  bucket: string;
  calls: number;
  minutes: number;
  leads: number;
  bookings: number;
  costCents: number;
}

interface SeriesRow {
  bucket: string;
  calls: number;
  seconds: number;
  leads: number;
  bookings: number;
  cost_cents: number;
}

export async function getTenantSeries(
  tenantId: string,
  range: StatRange,
): Promise<SeriesPoint[]> {
  const { data, error } = await db().rpc("tenant_activity_series", {
    p_tenant_id: tenantId,
    p_start: rangeStart(range)?.toISOString() ?? null,
    p_bucket: rangeBucket(range),
  });
  if (error) throw error;
  return ((data ?? []) as SeriesRow[]).map((r) => ({
    bucket: r.bucket,
    calls: Number(r.calls),
    minutes: Math.round(Number(r.seconds) / 60),
    leads: Number(r.leads),
    bookings: Number(r.bookings),
    costCents: Number(r.cost_cents),
  }));
}

export interface RangeStats {
  calls: number;
  seconds: number;
  costCents: number;
  leads: number;
  bookings: number;
  transfers: number;
  lastCallAt: string | null;
}

interface RangeStatsRow {
  calls: number;
  seconds: number;
  cost_cents: number;
  leads: number;
  bookings: number;
  transfers: number;
  last_call_at: string | null;
}

export async function getTenantRangeStats(
  tenantId: string,
  range: StatRange,
): Promise<RangeStats> {
  const { data, error } = await db().rpc("tenant_range_stats", {
    p_tenant_id: tenantId,
    p_start: rangeStart(range)?.toISOString() ?? null,
  });
  if (error) throw error;
  const row = ((data ?? []) as RangeStatsRow[])[0];
  return {
    calls: Number(row?.calls ?? 0),
    seconds: Number(row?.seconds ?? 0),
    costCents: Number(row?.cost_cents ?? 0),
    leads: Number(row?.leads ?? 0),
    bookings: Number(row?.bookings ?? 0),
    transfers: Number(row?.transfers ?? 0),
    lastCallAt: row?.last_call_at ?? null,
  };
}

export interface TenantWithStats {
  id: string;
  name: string;
  status: string;
  phoneNumber: string | null;
  calls: number;
  seconds: number;
  costCents: number;
  leads: number;
  bookings: number;
  lastCallAt: string | null;
}

interface TenantsStatsRow {
  tenant_id: string;
  calls: number;
  seconds: number;
  cost_cents: number;
  leads: number;
  bookings: number;
  last_call_at: string | null;
}

// The admin tenant list: every tenant + its totals for the range, two queries.
export async function listTenantsWithStats(
  range: StatRange,
): Promise<TenantWithStats[]> {
  const [tenants, stats] = await Promise.all([
    db()
      .from("tenants")
      .select("id, name, status, phone_number")
      .order("created_at", { ascending: true }),
    db().rpc("tenants_range_stats", {
      p_start: rangeStart(range)?.toISOString() ?? null,
    }),
  ]);
  if (tenants.error) throw tenants.error;
  if (stats.error) throw stats.error;

  const byId = new Map(
    ((stats.data ?? []) as TenantsStatsRow[]).map((s) => [s.tenant_id, s]),
  );
  return (tenants.data ?? []).map((t) => {
    const s = byId.get(t.id);
    return {
      id: t.id,
      name: t.name ?? t.id,
      status: t.status ?? "active",
      phoneNumber: t.phone_number,
      calls: Number(s?.calls ?? 0),
      seconds: Number(s?.seconds ?? 0),
      costCents: Number(s?.cost_cents ?? 0),
      leads: Number(s?.leads ?? 0),
      bookings: Number(s?.bookings ?? 0),
      lastCallAt: s?.last_call_at ?? null,
    };
  });
}
