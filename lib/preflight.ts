// "Is this tenant actually ready?" — integration checks run from the admin
// dashboard before (and any time after) provisioning. Every check is wrapped
// so a probe failure becomes a red row, never a thrown error. The latest
// report persists to tenants.last_preflight (jsonb).

import { db } from "./supabase";
import { env, resolveEnvRef } from "./env";
import { safeParseTenantConfig } from "./config-schema";
import { checkCalendarAccess } from "./google-calendar";
import { getAssistant, llmUrl, webhookUrl } from "./vapi";
import type { TenantConfig } from "./types";

export interface PreflightCheck {
  key: string;
  label: string;
  status: "pass" | "fail" | "warn" | "skip";
  detail: string;
}

export interface PreflightReport {
  ranAt: string;
  checks: PreflightCheck[];
  hasFailures: boolean;
}

const E164 = /^\+[1-9]\d{6,14}$/;

export async function runPreflight(tenantId: string): Promise<PreflightReport> {
  const checks: PreflightCheck[] = [];
  const add = (c: PreflightCheck) => checks.push(c);

  const { data: row, error } = await db()
    .from("tenants")
    .select("config, calendar_id, discord_webhook_url, notify_phone, transfer_number, vapi_assistant_id")
    .eq("id", tenantId)
    .maybeSingle();

  if (error || !row) {
    return finalize(tenantId, [
      {
        key: "tenant",
        label: "Tenant row",
        status: "fail",
        detail: error?.message ?? `No tenant "${tenantId}" in the database.`,
      },
    ]);
  }

  // 1. Config passes the strict schema.
  const parsed = safeParseTenantConfig(row.config);
  if (parsed.ok) {
    add({ key: "config", label: "Config schema", status: "pass", detail: "valid TenantConfig" });
  } else {
    add({
      key: "config",
      label: "Config schema",
      status: "fail",
      detail: parsed.errors.slice(0, 3).join("; "),
    });
  }
  const config: TenantConfig | null = parsed.ok ? parsed.config : null;

  // 2. Deployment env that provisioning and auth depend on.
  add(
    env.publicBaseUrl
      ? { key: "base-url", label: "PUBLIC_BASE_URL", status: "pass", detail: env.publicBaseUrl }
      : { key: "base-url", label: "PUBLIC_BASE_URL", status: "fail", detail: "not set — Vapi can't reach this deployment" },
  );
  add(
    env.vapiServerSecret
      ? { key: "server-secret", label: "VAPI_SERVER_SECRET", status: "pass", detail: "set" }
      : { key: "server-secret", label: "VAPI_SERVER_SECRET", status: "fail", detail: "not set — API routes reject everything in production" },
  );

  // 3. Calendar — only when a booking flow is enabled.
  const bookingEnabled =
    config != null &&
    (config.booking.discoveryCall.enabled || config.booking.job.enabled);
  if (!bookingEnabled) {
    add({ key: "calendar", label: "Google Calendar", status: "skip", detail: "no booking flow enabled" });
  } else if (!row.calendar_id) {
    add({ key: "calendar", label: "Google Calendar", status: "fail", detail: "booking is enabled but no calendar id is set" });
  } else {
    try {
      const result = await checkCalendarAccess(String(row.calendar_id).trim());
      add({
        key: "calendar",
        label: "Google Calendar",
        status: result.ok ? "pass" : "fail",
        detail: result.detail,
      });
    } catch (e) {
      add({ key: "calendar", label: "Google Calendar", status: "fail", detail: (e as Error).message.slice(0, 200) });
    }
  }

  // 4. Discord webhook — GET validates without posting anything.
  if (!row.discord_webhook_url) {
    add({ key: "discord", label: "Discord webhook", status: "warn", detail: "not set — call summaries and lead alerts won't post" });
  } else {
    try {
      const res = await fetch(String(row.discord_webhook_url));
      add(
        res.ok
          ? { key: "discord", label: "Discord webhook", status: "pass", detail: "webhook responds" }
          : { key: "discord", label: "Discord webhook", status: "fail", detail: `webhook returned ${res.status}` },
      );
    } catch (e) {
      add({ key: "discord", label: "Discord webhook", status: "fail", detail: (e as Error).message.slice(0, 200) });
    }
  }

  // 5. Phone targets for the enabled tools.
  if (config?.transfer.enabled) {
    const target = resolveEnvRef(
      (row.transfer_number as string | null) || config.transfer.inHoursTarget,
    );
    if (!target) {
      add({ key: "transfer", label: "Transfer number", status: "fail", detail: "transfer is enabled but no destination number resolves" });
    } else if (!E164.test(target)) {
      add({ key: "transfer", label: "Transfer number", status: "fail", detail: `"${target}" is not E.164 (+15551234567)` });
    } else {
      add({ key: "transfer", label: "Transfer number", status: "pass", detail: target });
    }
  } else {
    add({ key: "transfer", label: "Transfer number", status: "skip", detail: "transfer disabled" });
  }
  if (!row.notify_phone) {
    add({ key: "notify", label: "Notify phone", status: "warn", detail: "not set — no SMS alerts for hot leads/transfers" });
  } else if (!env.twilioPhoneNumber) {
    add({ key: "notify", label: "Notify phone", status: "warn", detail: "set, but TWILIO_PHONE_NUMBER is missing — SMS can't send" });
  } else {
    add({ key: "notify", label: "Notify phone", status: "pass", detail: String(row.notify_phone) });
  }

  // 6. Vapi assistant exists AND its URLs match this deployment + secret
  // (post-provision only; needs live Vapi). Catches the silent-outage class
  // where code/secret changes ship but the assistant is never re-provisioned:
  // a stale model.url means every live call 401s. Vapi's GET redacts
  // server.secret, so the ?token= in model.url is the credential check.
  if (!row.vapi_assistant_id) {
    add({ key: "assistant", label: "Vapi assistant", status: "skip", detail: "not provisioned yet" });
  } else {
    try {
      const assistant = await getAssistant(String(row.vapi_assistant_id));
      const stale: string[] = [];
      if (env.publicBaseUrl) {
        if (assistant.model?.url !== llmUrl(env.publicBaseUrl, env.vapiServerSecret)) {
          stale.push("custom-LLM URL");
        }
        if (assistant.server?.url !== webhookUrl(env.publicBaseUrl)) {
          stale.push("webhook URL");
        }
      }
      if (stale.length) {
        add({
          key: "assistant",
          label: "Vapi assistant",
          status: "fail",
          detail: `stale ${stale.join(" + ")} — re-provision to push current config (live calls may be failing)`,
        });
      } else {
        add({ key: "assistant", label: "Vapi assistant", status: "pass", detail: `${row.vapi_assistant_id} — URLs current` });
      }
    } catch (e) {
      add({ key: "assistant", label: "Vapi assistant", status: "fail", detail: (e as Error).message.slice(0, 200) });
    }
  }

  return finalize(tenantId, checks);
}

async function finalize(
  tenantId: string,
  checks: PreflightCheck[],
): Promise<PreflightReport> {
  const report: PreflightReport = {
    ranAt: new Date().toISOString(),
    checks,
    hasFailures: checks.some((c) => c.status === "fail"),
  };
  // Best-effort persist — a storage failure must not hide the report.
  try {
    await db().from("tenants").update({ last_preflight: report }).eq("id", tenantId);
  } catch (e) {
    console.error("preflight persist failed", e);
  }
  return report;
}
