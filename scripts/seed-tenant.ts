// Seed (or refresh) a tenant row in Supabase from its config/<id>.tenant.json
// plus the current env vars for integration values. Idempotent upsert — safe
// to re-run. This is how the legacy file-based tenant graduates to the DB.
//
// Run: npm run seed -- elenos     (defaults to TENANT env, then "elenos")

import { config } from "dotenv";
config({ path: ".env.local" }); // primary
config(); // .env fallback (does not override already-set vars)

import { loadTenantFromFile } from "../lib/context";
import { parseTenantConfig } from "../lib/config-schema";
import { resolveEnvRef } from "../lib/env";
import { db } from "../lib/supabase";

async function main() {
  const id = process.argv[2] ?? process.env.TENANT ?? "elenos";

  const raw = loadTenantFromFile(id);
  const tenantConfig = parseTenantConfig(raw); // strict at write time
  if (tenantConfig.id !== id) {
    throw new Error(`config file id "${tenantConfig.id}" does not match "${id}"`);
  }

  const ownerNumbers = [
    process.env.FOUNDER_CELL ?? "",
    ...(process.env.FOUNDER_NUMBERS ?? "").split(","),
  ]
    .map((s) => s.trim())
    .filter(Boolean);

  const row = {
    id,
    name: tenantConfig.displayName,
    config: tenantConfig,
    status: "active",
    business_hours: tenantConfig.businessHours,
    calendar_id: (process.env.GOOGLE_CALENDAR_ID ?? "").trim() || null,
    discord_webhook_url: process.env.DISCORD_WEBHOOK_URL || null,
    notify_phone: process.env.FOUNDER_CELL || null,
    owner_numbers: ownerNumbers,
    transfer_number: resolveEnvRef(tenantConfig.transfer.inHoursTarget) || null,
    vapi_assistant_id: process.env.VAPI_ASSISTANT_ID || null,
    vapi_phone_number_id: process.env.VAPI_PHONE_NUMBER_ID || null,
    phone_number: process.env.TWILIO_PHONE_NUMBER || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await db().from("tenants").upsert(row, { onConflict: "id" });
  if (error) throw error;

  console.log(`✅ Tenant "${id}" seeded.`);
  console.log(`   calendar_id:         ${row.calendar_id ?? "—"}`);
  console.log(`   discord_webhook_url: ${row.discord_webhook_url ? "set" : "—"}`);
  console.log(`   notify_phone:        ${row.notify_phone ?? "—"}`);
  console.log(`   owner_numbers:       ${row.owner_numbers.join(", ") || "—"}`);
  console.log(`   transfer_number:     ${row.transfer_number ?? "—"}`);
  console.log(`   vapi_assistant_id:   ${row.vapi_assistant_id ?? "—"}`);
  console.log(`   vapi_phone_number_id:${row.vapi_phone_number_id ?? "—"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
