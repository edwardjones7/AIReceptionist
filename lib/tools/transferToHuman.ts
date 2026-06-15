import { db } from "../supabase";
import { isWithinBusinessHours } from "../context";
import { resolveEnvRef } from "../env";
import { alertFounder } from "../notify";
import type { ToolContext, ToolResult } from "../types";

// Conservative for v1 (AI-only): in business hours, return a transfer
// destination so Vapi cold-forwards to the founder's cell. After hours,
// capture a callback and SMS the founder instead — do NOT transfer.
export async function transferToHuman(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const reason = String(input.reason ?? "").trim();
  const summary = String(input.summary ?? "").trim();
  const t = ctx.tenant;

  if (!t.transfer.enabled) {
    return captureCallback(ctx, reason, summary, "transfer_disabled");
  }

  const inHours = isWithinBusinessHours(t);
  const target = resolveEnvRef(t.transfer.inHoursTarget);

  if (inHours && target) {
    await db().from("transfers").insert({
      tenant_id: t.id,
      call_id: ctx.callId ?? null,
      reason,
      summary,
      to_number: target,
      status: "transferred",
    });
    await alertFounder({
      title: "Call being transferred to you",
      summary: `${reason}\n${summary}`,
      smsBody: `📞 ${ctx.tenant.agentName} is transferring a caller: ${reason}`,
    });
    return {
      message: "Let me connect you — one moment.",
      transfer: { destinationNumber: target, mode: t.transfer.mode },
      data: { transferred: true },
    };
  }

  // After hours (or no target) → callback.
  return captureCallback(ctx, reason, summary, "callback_captured");
}

async function captureCallback(
  ctx: ToolContext,
  reason: string,
  summary: string,
  status: string,
): Promise<ToolResult> {
  await db().from("transfers").insert({
    tenant_id: ctx.tenant.id,
    call_id: ctx.callId ?? null,
    reason,
    summary,
    to_number: null,
    status,
  });
  await db().from("leads").insert({
    tenant_id: ctx.tenant.id,
    call_id: ctx.callId ?? null,
    phone: ctx.callerNumber ?? "",
    intent: "wants_human",
    details: `${reason} — ${summary}`,
    qualified: true,
    status: "new",
  });
  await alertFounder({
    title: "Caller asked for a person (after hours)",
    summary: `${reason}\n${summary}`,
    smsBody: `📵 After-hours: caller wants a callback. ${reason}. ${ctx.callerNumber ?? ""}`,
  });
  return {
    message:
      "I can't put a person on right now, but I've flagged this and someone will call you back as soon as they can. Can I confirm the best number to reach you?",
    data: { callback: true },
  };
}
