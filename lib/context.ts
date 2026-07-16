// Tenant resolution — the multi-tenant seam. One deployment serves many
// tenants: each request maps to a tenant via the Vapi assistant/phone-number id
// in the payload, looked up against the tenants table in Supabase.
//
// Resolution order (first hit wins):
//   1. assistantId    → tenants.vapi_assistant_id
//   2. phoneNumberId  → tenants.vapi_phone_number_id
//   3. TENANT env     → tenants.id (single-tenant back-compat)
//   4. config/<TENANT>.tenant.json + env-var settings (dev / pre-seed fallback)
//
// A DB hiccup must never drop a live call — lookups are best-effort and fall
// through to the file fallback.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { env, resolveEnvRef } from "./env";
import { db } from "./supabase";
import { safeParseTenantConfig } from "./config-schema";
import type { Tenant, TenantConfig, TenantSettings } from "./types";

// ── cache ──────────────────────────────────────────────────────────────────
// Per-lambda-instance TTL cache. Keyed by every identifier that can resolve a
// tenant so a warm instance does one DB read per tenant per TTL window.

const TTL_MS = Number(env.tenantCacheTtlMs) || 60_000;
const cache = new Map<string, { tenant: Tenant; expires: number }>();

function cacheGet(key: string): Tenant | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return hit.tenant;
}

function cachePut(tenant: Tenant): void {
  const entry = { tenant, expires: Date.now() + TTL_MS };
  cache.set(`id:${tenant.config.id}`, entry);
  if (tenant.vapiAssistantId) cache.set(`asst:${tenant.vapiAssistantId}`, entry);
  if (tenant.vapiPhoneNumberId) cache.set(`phone:${tenant.vapiPhoneNumberId}`, entry);
}

// Drop every cache entry for a tenant (call after a dashboard save).
export function invalidateTenantCache(tenantId: string): void {
  for (const [key, entry] of cache) {
    if (entry.tenant.config.id === tenantId) cache.delete(key);
  }
}

// ── DB row → Tenant ────────────────────────────────────────────────────────

interface TenantRow {
  id: string;
  name: string | null;
  config: unknown;
  status: string | null;
  vapi_assistant_id: string | null;
  vapi_phone_number_id: string | null;
  phone_number: string | null;
  calendar_id: string | null;
  discord_webhook_url: string | null;
  notify_phone: string | null;
  owner_numbers: string[] | null;
  transfer_number: string | null;
}

const TENANT_COLUMNS =
  "id, name, config, status, vapi_assistant_id, vapi_phone_number_id, phone_number, calendar_id, discord_webhook_url, notify_phone, owner_numbers, transfer_number";

function rowToTenant(row: TenantRow): Tenant | null {
  if (!row.config) return null; // row exists but was never seeded with a config
  // Lenient at runtime: log schema drift, keep the call alive.
  const parsed = safeParseTenantConfig(row.config);
  if (!parsed.ok) {
    console.warn(`[tenant] config for "${row.id}" has schema issues (continuing):`, parsed.errors.slice(0, 5));
  }
  const config = (parsed.ok ? parsed.config : row.config) as TenantConfig;
  const settings: TenantSettings = {
    calendarId: (row.calendar_id ?? "").trim(),
    discordWebhookUrl: row.discord_webhook_url ?? "",
    notifyPhone: row.notify_phone ?? "",
    transferNumber: row.transfer_number ?? "",
    ownerNumbers: row.owner_numbers ?? [],
  };
  return {
    config,
    settings,
    vapiAssistantId: row.vapi_assistant_id,
    vapiPhoneNumberId: row.vapi_phone_number_id,
    phoneNumber: row.phone_number,
    status: (row.status as Tenant["status"]) ?? "active",
  };
}

async function fetchTenantBy(column: string, value: string): Promise<Tenant | null> {
  try {
    const { data, error } = await db()
      .from("tenants")
      .select(TENANT_COLUMNS)
      .eq(column, value)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return rowToTenant(data as TenantRow);
  } catch (e) {
    console.error(`[tenant] DB lookup failed (${column}=${value})`, e);
    return null;
  }
}

// ── file fallback (dev / pre-seed / DB outage) ─────────────────────────────

// Read a tenant config straight from config/<id>.tenant.json. Used for seeds,
// onboarding templates, and as the last-resort runtime fallback.
export function loadTenantFromFile(tenantId: string): TenantConfig {
  const path = join(process.cwd(), "config", `${tenantId}.tenant.json`);
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as TenantConfig;
}

// Settings synthesized from the legacy global env vars, so a fresh checkout
// with only .env.local keeps working exactly as before.
function settingsFromEnv(config: TenantConfig): TenantSettings {
  const extraOwners = env.founderNumbers
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    calendarId: env.googleCalendarId.trim(),
    discordWebhookUrl: env.discordWebhookUrl,
    notifyPhone: env.founderCell,
    transferNumber: resolveEnvRef(config.transfer.inHoursTarget),
    ownerNumbers: [env.founderCell, ...extraOwners].filter(Boolean),
  };
}

function tenantFromFile(tenantId: string): Tenant {
  const config = loadTenantFromFile(tenantId);
  return {
    config,
    settings: settingsFromEnv(config),
    vapiAssistantId: env.vapiAssistantId || null,
    vapiPhoneNumberId: env.vapiPhoneNumberId || null,
    phoneNumber: env.twilioPhoneNumber || null,
    status: "active",
  };
}

// ── public API ─────────────────────────────────────────────────────────────

// Resolve the tenant for an inbound Vapi request. Never throws on DB trouble;
// the env-tenant file fallback is the floor.
export async function resolveTenant(
  hint: { assistantId?: string; phoneNumberId?: string } = {},
): Promise<Tenant> {
  const cached =
    (hint.assistantId && cacheGet(`asst:${hint.assistantId}`)) ||
    (hint.phoneNumberId && cacheGet(`phone:${hint.phoneNumberId}`)) ||
    null;
  if (cached) return cached;

  let tenant: Tenant | null = null;
  let source = "";
  if (hint.assistantId) {
    tenant = await fetchTenantBy("vapi_assistant_id", hint.assistantId);
    if (tenant) source = `asst:${hint.assistantId}`;
  }
  if (!tenant && hint.phoneNumberId) {
    tenant = await fetchTenantBy("vapi_phone_number_id", hint.phoneNumberId);
    if (tenant) source = `phone:${hint.phoneNumberId}`;
  }
  if (!tenant) {
    tenant = cacheGet(`id:${env.tenant}`) ?? (await fetchTenantBy("id", env.tenant));
    if (tenant) source = `env-tenant db row (${env.tenant})`;
  }
  if (!tenant) {
    tenant = tenantFromFile(env.tenant);
    source = `file fallback (config/${env.tenant}.tenant.json)`;
    console.warn(`[tenant] no DB row matched — using ${source}`);
  }

  console.log(`[tenant] resolved "${tenant.config.id}" via ${source}`);
  cachePut(tenant);
  return tenant;
}

// Load a tenant by id — dashboard, scripts, provisioning. Throws if the tenant
// exists nowhere (no DB row, no config file).
export async function loadTenantById(tenantId: string): Promise<Tenant> {
  const cached = cacheGet(`id:${tenantId}`);
  if (cached) return cached;
  const tenant = (await fetchTenantBy("id", tenantId)) ?? tenantFromFile(tenantId);
  cachePut(tenant);
  return tenant;
}

// True if `now` falls within the tenant's business hours, in the tenant tz.
export function isWithinBusinessHours(
  tenant: TenantConfig,
  now: Date = new Date(),
): boolean {
  // Get day-of-week + HH:mm in the tenant timezone without extra deps.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tenant.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const hhmm = `${hour}:${minute}`;

  const h = tenant.businessHours;
  let window: { open: string; close: string } | null = null;
  if (weekday === "Sat") window = h.saturday;
  else if (weekday === "Sun") window = h.sunday;
  else window = h.mondayToFriday;

  if (!window) return false;
  return hhmm >= window.open && hhmm < window.close;
}
