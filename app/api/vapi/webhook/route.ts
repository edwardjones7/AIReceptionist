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
    analysis?: { summary?: string; successEvaluation?: string };
    artifact?: { transcript?: string; recordingUrl?: string };
  };
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
