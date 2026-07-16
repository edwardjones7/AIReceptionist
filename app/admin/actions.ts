"use server";

// Admin server actions. Every action (except login) starts with requireAdmin()
// — the proxy only guards page navigation, not action invocations.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { isLocked, registerFailure, clearFailures } from "@/lib/login-throttle";
import {
  requireAdmin,
  setAdminSessionCookie,
  clearAdminSessionCookie,
} from "@/lib/admin-auth";
import { verifyAdminPassword } from "@/lib/admin-session";
import { safeParseTenantConfig } from "@/lib/config-schema";
import { invalidateTenantCache } from "@/lib/context";
import { templateConfig } from "@/lib/templates";
import { provisionTenant, deprovisionTenant } from "@/lib/provision";
import { runPreflight } from "@/lib/preflight";
import { db } from "@/lib/supabase";
import type { TenantConfig } from "@/lib/types";

export async function login(formData: FormData): Promise<void> {
  const hdrs = await headers();
  const ip =
    (hdrs.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
  if (isLocked(ip)) {
    redirect("/admin/login?error=locked");
  }
  const password = String(formData.get("password") ?? "");
  if (!(await verifyAdminPassword(password))) {
    registerFailure(ip);
    redirect("/admin/login?error=1");
  }
  clearFailures(ip);
  await setAdminSessionCookie();
  redirect("/admin");
}

export async function logout(): Promise<void> {
  await clearAdminSessionCookie();
  redirect("/admin/login");
}

export interface SaveResult {
  ok: boolean;
  errors?: string[];
}

export async function saveTenantConfig(
  id: string,
  rawJson: string,
): Promise<SaveResult> {
  await requireAdmin();

  let raw: unknown;
  try {
    raw = JSON.parse(rawJson);
  } catch (e) {
    return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}`] };
  }
  const parsed = safeParseTenantConfig(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  if (parsed.config.id !== id) {
    return { ok: false, errors: [`config.id "${parsed.config.id}" must match tenant "${id}"`] };
  }

  const { error } = await db()
    .from("tenants")
    .update({
      config: parsed.config,
      name: parsed.config.displayName,
      business_hours: parsed.config.businessHours,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, errors: [error.message] };

  invalidateTenantCache(id);
  revalidatePath(`/admin/tenants/${id}`, "layout");
  return { ok: true };
}

export async function saveTenantSettings(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/admin");

  const ownerNumbers = String(formData.get("owner_numbers") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const { error } = await db()
    .from("tenants")
    .update({
      calendar_id: String(formData.get("calendar_id") ?? "").trim() || null,
      discord_webhook_url: String(formData.get("discord_webhook_url") ?? "").trim() || null,
      notify_phone: String(formData.get("notify_phone") ?? "").trim() || null,
      transfer_number: String(formData.get("transfer_number") ?? "").trim() || null,
      owner_numbers: ownerNumbers,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    console.error("saveTenantSettings failed", error);
    redirect(`/admin/tenants/${id}?perror=${encodeURIComponent(error.message.slice(0, 300))}`);
  }

  invalidateTenantCache(id);
  revalidatePath(`/admin/tenants/${id}`, "layout");
  redirect(`/admin/tenants/${id}?saved=1`);
}

// Onboard a new tenant: template config + names swapped in, status=draft.
// Provisioning (Vapi assistant + number) is a separate, explicit click on the
// tenant page so the generated config can be reviewed first.
export async function createTenant(formData: FormData): Promise<void> {
  await requireAdmin();

  const id = String(formData.get("id") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const agentName = String(formData.get("agent_name") ?? "").trim() || "Scarlett";
  const timezone = String(formData.get("timezone") ?? "").trim() || "America/New_York";
  const template = String(formData.get("template") ?? "elenos").trim();

  if (!/^[a-z0-9-]+$/.test(id)) redirect("/admin/tenants/new?error=bad-id");
  if (!displayName) redirect("/admin/tenants/new?error=missing-name");

  const { data: existing } = await db()
    .from("tenants")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (existing) redirect("/admin/tenants/new?error=exists");

  let config: TenantConfig;
  try {
    config = templateConfig(template);
  } catch (e) {
    console.error("createTenant: bad template", e);
    redirect("/admin/tenants/new?error=bad-config");
  }
  config.id = id;
  config.displayName = displayName;
  config.agentName = agentName;
  config.timezone = timezone;
  config.voice.greeting = `${displayName} — this is ${agentName}. How can I help?`;
  const voiceId = String(formData.get("voice_id") ?? "").trim();
  if (voiceId) config.voice.voiceId = voiceId;

  const validated = safeParseTenantConfig(config);
  if (!validated.ok) {
    console.error("createTenant: config failed validation", validated.errors);
    redirect("/admin/tenants/new?error=bad-config");
  }
  config = validated.config;

  const ownerNumbers = String(formData.get("owner_numbers") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const { error } = await db().from("tenants").insert({
    id,
    name: displayName,
    status: "draft",
    config,
    business_hours: config.businessHours,
    calendar_id: String(formData.get("calendar_id") ?? "").trim() || null,
    discord_webhook_url: String(formData.get("discord_webhook_url") ?? "").trim() || null,
    notify_phone: String(formData.get("notify_phone") ?? "").trim() || null,
    transfer_number: String(formData.get("transfer_number") ?? "").trim() || null,
    owner_numbers: ownerNumbers,
  });
  if (error) {
    console.error("createTenant failed", error);
    redirect(`/admin/tenants/new?error=db`);
  }

  redirect(`/admin/tenants/${id}?created=1`);
}

export async function runPreflightAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/admin");

  try {
    await runPreflight(id);
  } catch (e) {
    console.error("runPreflight failed", e);
  }
  revalidatePath(`/admin/tenants/${id}`, "layout");
  redirect(`/admin/tenants/${id}`);
}

export async function provisionTenantAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const numberProvider =
    String(formData.get("number_provider") ?? "vapi") === "twilio" ? "twilio" : "vapi";
  const areaCode = String(formData.get("area_code") ?? "").trim() || undefined;
  const skipPreflight = formData.get("skip_preflight") === "on";
  if (!id) redirect("/admin");

  // Preflight gates provisioning (skippable for a deliberate override). The
  // CLI path (scripts/provision-assistant.ts) stays raw on purpose.
  if (!skipPreflight) {
    let failed = "";
    try {
      const report = await runPreflight(id);
      if (report.hasFailures) {
        failed = report.checks
          .filter((c) => c.status === "fail")
          .map((c) => c.label)
          .join(", ");
      }
    } catch (e) {
      console.error("preflight before provision failed", e);
    }
    if (failed) {
      revalidatePath(`/admin/tenants/${id}`, "layout");
      redirect(
        `/admin/tenants/${id}?perror=${encodeURIComponent(`Preflight failed: ${failed}. Fix below or check "provision anyway".`.slice(0, 300))}`,
      );
    }
  }

  let errorMsg = "";
  try {
    await provisionTenant(id, { numberProvider, areaCode });
  } catch (e) {
    console.error("provisionTenant failed", e);
    errorMsg = (e as Error).message;
  }
  revalidatePath(`/admin/tenants/${id}`, "layout");
  redirect(
    errorMsg
      ? `/admin/tenants/${id}?perror=${encodeURIComponent(errorMsg.slice(0, 300))}`
      : `/admin/tenants/${id}?provisioned=1`,
  );
}

// Delete a tenant row entirely. Guarded: must be deprovisioned first (so no
// Vapi assistant/number is orphaned) and the operator must type the tenant id.
// FK cascade (migration 0002) removes calls → transcripts, leads, bookings,
// and transfers with the row.
export async function deleteTenantAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const confirmId = String(formData.get("confirm_id") ?? "").trim();
  if (!id) redirect("/admin");
  if (confirmId !== id) {
    redirect(`/admin/tenants/${id}?perror=${encodeURIComponent("Type the tenant id to confirm deletion.")}`);
  }

  const { data: row } = await db()
    .from("tenants")
    .select("vapi_assistant_id, vapi_phone_number_id")
    .eq("id", id)
    .maybeSingle();
  if (row?.vapi_assistant_id || row?.vapi_phone_number_id) {
    redirect(`/admin/tenants/${id}?perror=${encodeURIComponent("Deprovision first — the tenant still has Vapi resources.")}`);
  }

  const { error } = await db().from("tenants").delete().eq("id", id);
  if (error) {
    console.error("deleteTenantAction failed", error);
    redirect(`/admin/tenants/${id}?perror=${encodeURIComponent(error.message.slice(0, 300))}`);
  }
  invalidateTenantCache(id);
  revalidatePath("/admin");
  redirect("/admin");
}

export async function deprovisionTenantAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/admin");

  let errorMsg = "";
  try {
    await deprovisionTenant(id);
  } catch (e) {
    console.error("deprovisionTenant failed", e);
    errorMsg = (e as Error).message;
  }
  revalidatePath(`/admin/tenants/${id}`, "layout");
  redirect(
    errorMsg
      ? `/admin/tenants/${id}?perror=${encodeURIComponent(errorMsg.slice(0, 300))}`
      : `/admin/tenants/${id}`,
  );
}

const LEAD_STATUSES = ["new", "contacted", "qualified", "converted", "closed"];
const BOOKING_STATUSES = ["confirmed", "completed", "cancelled", "no_show"];

// Return-to path from a form field — keep it inside /admin.
function safeBack(raw: FormDataEntryValue | null, fallback: string): string {
  const back = String(raw ?? "");
  return back.startsWith("/admin") ? back : fallback;
}

export async function setLeadStatus(formData: FormData): Promise<void> {
  await requireAdmin();
  const tenantId = String(formData.get("tenant_id") ?? "");
  const leadId = String(formData.get("lead_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const back = safeBack(formData.get("back"), `/admin/tenants/${tenantId}/leads`);
  if (!tenantId || !leadId || !LEAD_STATUSES.includes(status)) redirect(back);

  const { error } = await db()
    .from("leads")
    .update({ status, qualified: ["qualified", "converted"].includes(status) })
    .eq("tenant_id", tenantId)
    .eq("id", leadId);
  if (error) {
    console.error("setLeadStatus failed", error);
    redirect(`${back}${back.includes("?") ? "&" : "?"}perror=${encodeURIComponent(error.message.slice(0, 300))}`);
  }
  revalidatePath(`/admin/tenants/${tenantId}/leads`);
  redirect(back);
}

export async function setBookingStatus(formData: FormData): Promise<void> {
  await requireAdmin();
  const tenantId = String(formData.get("tenant_id") ?? "");
  const bookingId = String(formData.get("booking_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const back = safeBack(formData.get("back"), `/admin/tenants/${tenantId}/bookings`);
  if (!tenantId || !bookingId || !BOOKING_STATUSES.includes(status)) redirect(back);

  const { error } = await db()
    .from("bookings")
    .update({ status })
    .eq("tenant_id", tenantId)
    .eq("id", bookingId);
  if (error) {
    console.error("setBookingStatus failed", error);
    redirect(`${back}${back.includes("?") ? "&" : "?"}perror=${encodeURIComponent(error.message.slice(0, 300))}`);
  }
  revalidatePath(`/admin/tenants/${tenantId}/bookings`);
  redirect(back);
}

export async function setTenantStatus(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["active", "paused"].includes(status)) redirect("/admin");

  const { error } = await db()
    .from("tenants")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("setTenantStatus failed", error);
    redirect(`/admin/tenants/${id}?perror=${encodeURIComponent(error.message.slice(0, 300))}`);
  }

  invalidateTenantCache(id);
  revalidatePath(`/admin/tenants/${id}`, "layout");
  redirect(`/admin/tenants/${id}`);
}
