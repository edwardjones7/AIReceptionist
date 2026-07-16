import { db } from "../supabase";
import { alertOwner } from "../notify";
import type { ToolContext, ToolResult } from "../types";

// DORMANT for Elenos. This is the trades-client template flow — booking an
// on-site service visit (HVAC tune-up, electrical repair, etc.). Enable per
// tenant by setting booking.job.enabled = true and populating jobTypes in the
// tenant config. When enabled, this captures the job request as a lead/booking
// and alerts the owner; wire it to the tenant's own calendar/dispatch as needed.
export async function bookJob(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenant.booking.job.enabled) {
    // Should never be reached for Elenos — the tool isn't offered. Degrade to
    // a lead so nothing is lost if it somehow fires.
    return {
      message:
        "Let me take your details and have someone follow up about that.",
      isError: false,
    };
  }

  const name = String(input.name ?? "").trim();
  const phone = String(input.phone ?? "").trim() || ctx.callerNumber || "";
  const jobType = String(input.job_type ?? "").trim();
  const address = String(input.address ?? "").trim();
  const urgency = String(input.urgency ?? "").trim();
  const details = String(input.details ?? "").trim();

  await db().from("bookings").insert({
    tenant_id: ctx.tenant.id,
    call_id: ctx.callId ?? null,
    type: "job",
    name,
    phone,
    status: "requested",
  });
  await db().from("leads").insert({
    tenant_id: ctx.tenant.id,
    call_id: ctx.callId ?? null,
    name,
    phone,
    intent: `job:${jobType}`,
    details: `${jobType} at ${address} — urgency ${urgency}. ${details}`,
    qualified: true,
    status: "new",
  });

  await alertOwner(ctx.settings, {
    title: "New job request",
    summary: `${name}: ${jobType} (${urgency})`,
    fields: [
      { name: "Address", value: address || "—" },
      { name: "Phone", value: phone || "—" },
      { name: "Details", value: details || "—" },
    ],
    smsBody: `🛠️ Job: ${name} — ${jobType} (${urgency}). ${address}. ${phone}`,
  });

  return {
    message: `Got it — a ${jobType} request${urgency ? `, marked ${urgency}` : ""}. Someone will reach out to confirm a time. Anything else?`,
    data: { captured: true },
  };
}
