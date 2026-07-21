// Read queries for the admin dashboard. Server-only (service-role client).
// Kept out of the page files so RSCs stay thin.

import { db } from "./supabase";

export interface TenantStats {
  callsLast7: number;
  leadsLast7: number;
  lastCallAt: string | null;
  callsMtd: number;
  secondsMtd: number;
  costCentsMtd: number;
}

interface TenantStatsRow {
  tenant_id: string;
  calls_7d: number | null;
  leads_7d: number | null;
  last_call_at: string | null;
  calls_mtd: number | null;
  seconds_mtd: number | null;
  cost_cents_mtd: number | null;
}

const EMPTY_STATS: TenantStats = {
  callsLast7: 0,
  leadsLast7: 0,
  lastCallAt: null,
  callsMtd: 0,
  secondsMtd: 0,
  costCentsMtd: 0,
};

function toStats(row: TenantStatsRow | undefined): TenantStats {
  if (!row) return EMPTY_STATS;
  return {
    callsLast7: row.calls_7d ?? 0,
    leadsLast7: row.leads_7d ?? 0,
    lastCallAt: row.last_call_at,
    callsMtd: row.calls_mtd ?? 0,
    secondsMtd: row.seconds_mtd ?? 0,
    costCentsMtd: row.cost_cents_mtd ?? 0,
  };
}

export interface TenantListItem extends TenantStats {
  id: string;
  name: string;
  status: string;
  phoneNumber: string | null;
  vapiAssistantId: string | null;
}

export async function listTenants(): Promise<TenantListItem[]> {
  // Two queries total (tenants + the tenant_stats view), merged in JS —
  // replaces the old 3-queries-per-tenant fan-out.
  const [tenants, stats] = await Promise.all([
    db()
      .from("tenants")
      .select("id, name, status, phone_number, vapi_assistant_id")
      .order("created_at", { ascending: true }),
    db().from("tenant_stats").select("*"),
  ]);
  if (tenants.error) throw tenants.error;
  if (stats.error) throw stats.error;

  const byId = new Map(
    ((stats.data ?? []) as TenantStatsRow[]).map((s) => [s.tenant_id, s]),
  );
  return (tenants.data ?? []).map((t) => ({
    id: t.id,
    name: t.name ?? t.id,
    status: t.status ?? "active",
    phoneNumber: t.phone_number,
    vapiAssistantId: t.vapi_assistant_id,
    ...toStats(byId.get(t.id)),
  }));
}

export async function getTenantStats(id: string): Promise<TenantStats> {
  const { data, error } = await db()
    .from("tenant_stats")
    .select("*")
    .eq("tenant_id", id)
    .maybeSingle();
  if (error) throw error;
  return toStats((data as TenantStatsRow) ?? undefined);
}

export interface TenantRow {
  id: string;
  name: string | null;
  status: string | null;
  config: unknown;
  phone_number: string | null;
  vapi_assistant_id: string | null;
  vapi_phone_number_id: string | null;
  calendar_id: string | null;
  discord_webhook_url: string | null;
  notify_phone: string | null;
  owner_numbers: string[] | null;
  transfer_number: string | null;
  last_preflight: unknown;
  created_at: string;
  updated_at: string | null;
}

export async function getTenantRow(id: string): Promise<TenantRow | null> {
  const { data, error } = await db()
    .from("tenants")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as TenantRow) ?? null;
}

// ── Pagination: offset-based, 50/page. We fetch pageSize+1 rows to detect
// whether another page exists without a count query.
export const PAGE_SIZE = 50;

export interface Paged<T> {
  rows: T[];
  page: number;
  hasMore: boolean;
}

function paginate<T>(rows: T[], page: number): Paged<T> {
  return { rows: rows.slice(0, PAGE_SIZE), page, hasMore: rows.length > PAGE_SIZE };
}

function pageRange(page: number): [number, number] {
  const from = (page - 1) * PAGE_SIZE;
  return [from, from + PAGE_SIZE]; // inclusive → PAGE_SIZE + 1 rows
}

export interface CallRow {
  id: string;
  caller_number: string | null;
  started_at: string | null;
  duration_sec: number | null;
  outcome: string | null;
  summary: string | null;
  recording_url: string | null;
  created_at: string;
}

export async function recentCalls(tenantId: string, page = 1): Promise<Paged<CallRow>> {
  const [from, to] = pageRange(page);
  const { data, error } = await db()
    .from("calls")
    .select("id, caller_number, started_at, duration_sec, outcome, summary, recording_url, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw error;
  return paginate((data ?? []) as CallRow[], page);
}

export interface CallDetail extends CallRow {
  ended_at: string | null;
  cost_cents: number | null;
  vapi_call_id: string | null;
}

export async function getCall(
  tenantId: string,
  callId: string,
): Promise<CallDetail | null> {
  // Scoped by tenant AND call id so a crafted URL can't read across tenants.
  const { data, error } = await db()
    .from("calls")
    .select("id, caller_number, started_at, ended_at, duration_sec, outcome, summary, recording_url, cost_cents, vapi_call_id, created_at")
    .eq("tenant_id", tenantId)
    .eq("id", callId)
    .maybeSingle();
  if (error) throw error;
  return (data as CallDetail) ?? null;
}

export interface TranscriptRow {
  id: string;
  role: string;
  text: string;
  ts: string;
}

export async function getTranscripts(callId: string): Promise<TranscriptRow[]> {
  const { data, error } = await db()
    .from("transcripts")
    .select("id, role, text, ts")
    .eq("call_id", callId)
    .order("ts", { ascending: true });
  if (error) throw error;
  return (data ?? []) as TranscriptRow[];
}

export interface CallLinks {
  leads: LeadRow[];
  bookings: BookingRow[];
  transfers: TransferRow[];
}

export async function getCallLinks(callId: string): Promise<CallLinks> {
  const [leads, bookings, transfers] = await Promise.all([
    db()
      .from("leads")
      .select("id, name, phone, email, intent, details, qualified, status, created_at")
      .eq("call_id", callId),
    db()
      .from("bookings")
      .select("id, type, name, phone, email, slot_start, slot_end, status, created_at")
      .eq("call_id", callId),
    db()
      .from("transfers")
      .select("id, call_id, reason, summary, to_number, status, ts")
      .eq("call_id", callId),
  ]);
  if (leads.error) throw leads.error;
  if (bookings.error) throw bookings.error;
  if (transfers.error) throw transfers.error;
  return {
    leads: (leads.data ?? []) as LeadRow[],
    bookings: (bookings.data ?? []) as BookingRow[],
    transfers: (transfers.data ?? []) as TransferRow[],
  };
}

export interface TransferRow {
  id: string;
  call_id: string | null;
  reason: string | null;
  summary: string | null;
  to_number: string | null;
  status: string | null;
  ts: string;
}

export async function recentTransfers(
  tenantId: string,
  page = 1,
): Promise<Paged<TransferRow>> {
  const [from, to] = pageRange(page);
  const { data, error } = await db()
    .from("transfers")
    .select("id, call_id, reason, summary, to_number, status, ts")
    .eq("tenant_id", tenantId)
    .order("ts", { ascending: false })
    .range(from, to);
  if (error) throw error;
  return paginate((data ?? []) as TransferRow[], page);
}

export interface LeadRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  intent: string | null;
  details: string | null;
  qualified: boolean | null;
  status: string | null;
  created_at: string;
}

export async function recentLeads(tenantId: string, page = 1): Promise<Paged<LeadRow>> {
  const [from, to] = pageRange(page);
  const { data, error } = await db()
    .from("leads")
    .select("id, name, phone, email, intent, details, qualified, status, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw error;
  return paginate((data ?? []) as LeadRow[], page);
}

export interface PortalUserRow {
  id: string;
  email: string;
  created_at: string;
  last_login_at: string | null;
}

export async function listPortalUsers(tenantId: string): Promise<PortalUserRow[]> {
  const { data, error } = await db()
    .from("portal_users")
    .select("id, email, created_at, last_login_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PortalUserRow[];
}

export interface BookingRow {
  id: string;
  type: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  slot_start: string | null;
  slot_end: string | null;
  status: string | null;
  created_at: string;
}

export async function recentBookings(
  tenantId: string,
  page = 1,
): Promise<Paged<BookingRow>> {
  const [from, to] = pageRange(page);
  const { data, error } = await db()
    .from("bookings")
    .select("id, type, name, phone, email, slot_start, slot_end, status, created_at")
    .eq("tenant_id", tenantId)
    .order("slot_start", { ascending: false, nullsFirst: false })
    .range(from, to);
  if (error) throw error;
  return paginate((data ?? []) as BookingRow[], page);
}
