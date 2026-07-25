// Vapi call-lifecycle webhook. We care about `end-of-call-report`: persist the
// call with Vapi's own (free) summary + transcript, classify the outcome from
// what actually happened on the call, and post it to Discord. Other event
// types are acknowledged and ignored.
//
// The assistant reaches this at <PUBLIC_BASE_URL>/api/vapi/webhook?token=<secret>
// (Vapi doesn't reliably send the secret header — see lib/vapi.ts webhookUrl).

import { NextRequest, NextResponse } from "next/server";
import { verifyVapiSecret } from "@/lib/auth";
import { resolveTenant } from "@/lib/context";
import { db, upsertCallByVapiId } from "@/lib/supabase";
import { postDiscord } from "@/lib/notify";

export const runtime = "nodejs";
export const maxDuration = 60;

type Outcome = "booked" | "lead" | "transferred" | "answered" | "missed";

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

// Vapi's free post-call lead classification (assistant analysisPlan in
// lib/vapi.ts). All fields optional — treat a missing block as "no signal".
interface StructuredLead {
  isLead?: boolean;
  qualified?: boolean;
  name?: string;
  contact?: string;
  intent?: string;
}

// Classify the call from what the tools actually recorded against it — free
// and more accurate than asking an LLM to guess. Falls back to "answered"
// (had a conversation) or "missed" (no transcript).
async function classifyOutcome(
  vapiCallId: string,
  hasTranscript: boolean,
): Promise<Outcome> {
  try {
    const { data: call } = await db()
      .from("calls")
      .select("id")
      .eq("vapi_call_id", vapiCallId)
      .maybeSingle();
    const callId = (call as { id?: string } | null)?.id;
    if (callId) {
      const [booking, transfer, lead] = await Promise.all([
        db().from("bookings").select("id").eq("call_id", callId).limit(1),
        db().from("transfers").select("id").eq("call_id", callId).limit(1),
        db().from("leads").select("id").eq("call_id", callId).limit(1),
      ]);
      if (booking.data?.length) return "booked";
      if (transfer.data?.length) return "transferred";
      if (lead.data?.length) return "lead";
    }
  } catch (e) {
    console.error("classifyOutcome failed", e);
  }
  return hasTranscript ? "answered" : "missed";
}

// Turn Vapi's lead classification into a leads row, so a prospect who booked
// (or was interested but didn't) still lands in the leads table. Deduped by
// call: if the live capture_lead tool already saved one, we don't double it.
// Free — no LLM call; Vapi did the classification as part of its analysis.
async function maybeCaptureLead(opts: {
  tenantId: string;
  callId: string;
  structured: StructuredLead | undefined;
  outcome: Outcome;
  summary: string;
  callerNumber: string;
}): Promise<void> {
  try {
    const sd = opts.structured;
    // Trust Vapi's classification; if it's absent, fall back to "a booking
    // means a lead" so booked prospects are always captured.
    const isLead = sd?.isLead ?? opts.outcome === "booked";
    if (!isLead) return;

    const existing = await db()
      .from("leads")
      .select("id")
      .eq("call_id", opts.callId)
      .limit(1);
    if (existing.data?.length) return;

    const contact = (sd?.contact ?? "").trim();
    const isEmail = contact.includes("@");
    await db().from("leads").insert({
      tenant_id: opts.tenantId,
      call_id: opts.callId,
      name: (sd?.name ?? "").trim(),
      phone: isEmail ? opts.callerNumber : contact || opts.callerNumber,
      email: isEmail ? contact : "",
      intent: (sd?.intent ?? "").trim(),
      details: opts.summary,
      qualified: sd?.qualified ?? opts.outcome === "booked",
      status: "new",
    });
  } catch (e) {
    console.error("maybeCaptureLead failed", e);
  }
}

export async function POST(req: NextRequest) {
  if (!verifyVapiSecret(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await req.json()) as VapiWebhookBody;
  const msg = body.message ?? {};

  // Acknowledge everything; only end-of-call-report does work.
  if (msg.type !== "end-of-call-report") {
    return NextResponse.json({ ok: true });
  }

  const vapiCallId = msg.call?.id;
  if (!vapiCallId) return NextResponse.json({ ok: true });

  const resolved = await resolveTenant({
    assistantId: msg.call?.assistantId ?? msg.assistant?.id,
    phoneNumberId: msg.call?.phoneNumberId,
  });
  const tenant = resolved.config;

  const transcript = msg.artifact?.transcript ?? msg.transcript ?? "";
  // Vapi generates the summary as part of the call analysis at no extra cost —
  // use it instead of a paid model call. Fall back to a transcript snippet.
  const summary =
    msg.analysis?.summary?.trim() ||
    msg.summary?.trim() ||
    (transcript ? transcript.slice(0, 500) : "No transcript captured.");
  const outcome = await classifyOutcome(vapiCallId, Boolean(transcript.trim()));

  const recordingUrl = msg.recordingUrl ?? msg.artifact?.recordingUrl ?? null;
  const costCents =
    typeof msg.cost === "number" ? Math.round(msg.cost * 100) : null;

  const callId = await upsertCallByVapiId(tenant.id, vapiCallId, {
    caller_number: msg.call?.customer?.number ?? null,
    started_at: msg.startedAt ?? null,
    ended_at: msg.endedAt ?? null,
    duration_sec: msg.durationSeconds ?? null,
    outcome,
    summary,
    recording_url: recordingUrl,
    cost_cents: costCents,
  });

  // Store the transcript once per call (idempotent: clear any prior rows first
  // so a webhook retry doesn't duplicate it).
  if (callId && transcript) {
    await db().from("transcripts").delete().eq("call_id", callId);
    await db().from("transcripts").insert({
      call_id: callId,
      role: "system",
      text: transcript,
    });
  }

  // Capture the caller as a lead if Vapi flagged them (or they booked).
  if (callId) {
    await maybeCaptureLead({
      tenantId: tenant.id,
      callId,
      structured: msg.analysis?.structuredData,
      outcome,
      summary,
      callerNumber: msg.call?.customer?.number ?? "",
    });
  }

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
