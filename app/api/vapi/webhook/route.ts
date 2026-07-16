// Vapi call-lifecycle webhook. We mainly care about `end-of-call-report`:
// persist the call, run one offline Claude (Sonnet) summary, and post it to
// Discord. Other event types are acknowledged and ignored for v1.
//
// Configure on the Vapi assistant: serverUrl = <PUBLIC_BASE_URL>/api/vapi/webhook

import { NextRequest, NextResponse } from "next/server";
import { verifyVapiSecret } from "@/lib/auth";
import { env } from "@/lib/env";
import { resolveTenant } from "@/lib/context";
import { anthropic } from "@/lib/anthropic";
import { db, upsertCallByVapiId } from "@/lib/supabase";
import { postDiscord } from "@/lib/notify";
import type { TenantConfig } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

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
    artifact?: { transcript?: string; recordingUrl?: string };
  };
}

interface CallSummary {
  summary: string;
  outcome: "booked" | "lead" | "transferred" | "answered" | "missed";
}

async function summarize(
  transcript: string,
  tenant: TenantConfig,
): Promise<CallSummary> {
  const fallback: CallSummary = { summary: transcript.slice(0, 500), outcome: "answered" };
  if (!transcript.trim()) return { summary: "No transcript captured.", outcome: "missed" };
  try {
    const res = await anthropic().messages.create({
      model: env.summaryModel,
      max_tokens: 512,
      system: `You summarize a phone call handled by ${tenant.agentName}, an AI receptionist for ${tenant.displayName}. Business context: ${tenant.knowledge.oneLiner} Be concise and factual. Output strict JSON.`,
      messages: [
        {
          role: "user",
          content: `Summarize this call in 2-3 sentences and classify the outcome.\n\nTranscript:\n${transcript}`,
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              summary: { type: "string" },
              outcome: {
                type: "string",
                enum: ["booked", "lead", "transferred", "answered", "missed"],
              },
            },
            required: ["summary", "outcome"],
            additionalProperties: false,
          },
        },
      },
    });
    const text = res.content.find((b) => b.type === "text");
    if (text && text.type === "text") {
      return JSON.parse(text.text) as CallSummary;
    }
    return fallback;
  } catch (e) {
    console.error("summarize failed", e);
    return fallback;
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
  const { summary, outcome } = await summarize(transcript, tenant);

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

  if (callId && transcript) {
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
