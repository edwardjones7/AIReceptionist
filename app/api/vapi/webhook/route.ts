// Vapi call-lifecycle webhook. On `end-of-call-report` it stores the call
// (summary, transcript, outcome, lead) and posts a Discord summary. The heavy
// lifting lives in lib/call-store so the reconcile path logs calls identically.
//
// The assistant reaches this at <PUBLIC_BASE_URL>/api/vapi/webhook?token=<secret>.
// Vapi doesn't reliably attach the secret to server messages (especially on
// forwarded calls), so auth also falls back to verifying the call id is real.

import { NextRequest, NextResponse } from "next/server";
import { verifyVapiSecret } from "@/lib/auth";
import { resolveTenant } from "@/lib/context";
import { getVapiCall } from "@/lib/vapi";
import { storeCall, type StructuredLead } from "@/lib/call-store";
import { postDiscord, sendSms } from "@/lib/notify";
import { isOwnerNumber } from "@/lib/founder";
import type { TenantConfig, TenantSettings } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Text a caller who did NOT book, with a link to book themselves.
 *
 * Best-effort and heavily gated: it needs a configured publicUrl, a caller ID,
 * a non-booked outcome, and a caller who isn't the owner. A booked caller
 * already got their confirmation text at booking time, so they're skipped here.
 */
async function textCallerFollowUp(o: {
  outcome: string;
  callerNumber: string;
  tenant: TenantConfig;
  settings: TenantSettings;
}): Promise<void> {
  try {
    const url = o.tenant.booking.discoveryCall.publicUrl;
    const to = o.callerNumber.trim();
    if (!url || !to) return;
    if (o.outcome === "booked") return;
    if (to === o.settings.notifyPhone) return;
    if (isOwnerNumber(to, o.settings.ownerNumbers)) return;

    await sendSms(
      to,
      `Thanks for trying ${o.tenant.agentName} — ${o.tenant.displayName}. ` +
        `If you'd like to grab a time, you can book here: ${url} ` +
        `(or just reply to this text).`,
    );
  } catch (e) {
    // Never let a follow-up text fail the webhook — Vapi would retry the whole
    // end-of-call report and we'd double-store the call.
    console.error("textCallerFollowUp failed", e);
  }
}

interface VapiWebhookBody {
  message?: {
    type?: string;
    call?: {
      id?: string;
      assistantId?: string;
      phoneNumberId?: string;
      customer?: { number?: string };
    };
    // Some Vapi versions hoist the assistant to the message level.
    assistant?: { id?: string };
    startedAt?: string;
    endedAt?: string;
    endedReason?: string;
    durationSeconds?: number;
    cost?: number;
    recordingUrl?: string;
    summary?: string;
    transcript?: string;
    analysis?: {
      summary?: string;
      successEvaluation?: string;
      structuredData?: StructuredLead;
    };
    artifact?: { transcript?: string; recordingUrl?: string };
  };
}

// Confirm a report is genuine by resolving its call id against our own Vapi
// account. A random caller can't guess a real call UUID, so this safely backs
// up the shared secret without depending on Vapi attaching it.
async function isRealVapiCall(id: string | undefined): Promise<boolean> {
  if (!id) return false;
  try {
    const call = await getVapiCall(id);
    return Boolean(call?.id);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as VapiWebhookBody;
  const msg = body.message ?? {};

  // Acknowledge non-report events; only end-of-call-report does work.
  if (msg.type !== "end-of-call-report") {
    return NextResponse.json({ ok: true });
  }

  const vapiCallId = msg.call?.id;

  const secretOk = verifyVapiSecret(req);
  const genuine = secretOk || (await isRealVapiCall(vapiCallId));
  console.log("vapi webhook", {
    callId: vapiCallId,
    endedReason: msg.endedReason,
    auth: secretOk ? "secret" : genuine ? "vapi-verified" : "rejected",
  });
  if (!genuine) return new Response("Unauthorized", { status: 401 });
  if (!vapiCallId) return NextResponse.json({ ok: true });

  const resolved = await resolveTenant({
    assistantId: msg.call?.assistantId ?? msg.assistant?.id,
    phoneNumberId: msg.call?.phoneNumberId,
  });

  const transcript = msg.artifact?.transcript ?? msg.transcript ?? "";
  const summary =
    msg.analysis?.summary?.trim() ||
    msg.summary?.trim() ||
    (transcript ? transcript.slice(0, 500) : "No transcript captured.");

  const { outcome } = await storeCall({
    tenantId: resolved.config.id,
    vapiCallId,
    callerNumber: msg.call?.customer?.number ?? null,
    startedAt: msg.startedAt ?? null,
    endedAt: msg.endedAt ?? null,
    durationSec: msg.durationSeconds ?? null,
    costCents: typeof msg.cost === "number" ? Math.round(msg.cost * 100) : null,
    recordingUrl: msg.recordingUrl ?? msg.artifact?.recordingUrl ?? null,
    summary,
    transcript,
    structured: msg.analysis?.structuredData,
  });

  // Didn't book? Send a self-serve link. This is the only place the outcome is
  // actually known — mid-call we can't tell a browser from a buyer. Opt-in per
  // tenant via booking.discoveryCall.publicUrl, so a trades client's customers
  // never get marketing texts.
  await textCallerFollowUp({
    outcome,
    callerNumber: msg.call?.customer?.number ?? "",
    tenant: resolved.config,
    settings: resolved.settings,
  });

  await postDiscord(resolved.settings.discordWebhookUrl, {
    title: `Call summary — ${outcome}`,
    description: summary,
    fields: [
      { name: "From", value: msg.call?.customer?.number ?? "—" },
      {
        name: "Duration",
        value: msg.durationSeconds ? `${msg.durationSeconds}s` : "—",
      },
      { name: "Ended", value: msg.endedReason ?? "—" },
    ],
  });

  return NextResponse.json({ ok: true });
}
