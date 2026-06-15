// Loads the per-tenant config. This is the replicability seam — a second
// client is a new config/<id>.tenant.json plus a provisioned Vapi assistant,
// no code changes.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "./env";
import type { TenantConfig } from "./types";

let cached: TenantConfig | null = null;

export function loadTenant(tenantId: string = env.tenant): TenantConfig {
  if (cached && cached.id === tenantId) return cached;
  const path = join(process.cwd(), "config", `${tenantId}.tenant.json`);
  const raw = readFileSync(path, "utf8");
  const config = JSON.parse(raw) as TenantConfig;
  cached = config;
  return config;
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
