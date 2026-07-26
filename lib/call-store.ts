// Single place that turns a finished call into DB rows: the call record, its
// transcript, an outcome, and a lead if warranted. Two entry points feed it —
// the Vapi webhook (real-time, from the report body) and reconcileRecentCalls
// (a safety net that pulls straight from Vapi, since Vapi's webhook delivery is
// unreliable for forwarded/transferred calls). Both converge on storeCall so a
// call logs identically no matter which path caught it.

import { db, upsertCallByVapiId } from "./supabase";
import { resolveTenant } from "./context";
import { listVapiCalls, type VapiCall } from "./vapi";

export type Outcome = "booked" | "lead" | "transferred" | "answered" | "missed";

// Vapi's free post-call lead classification (assistant analysisPlan).
export interface StructuredLead {
  isLead?: boolean;
  qualified?: boolean;
  name?: string;
  contact?: string;
  intent?: string;
}

export interface StoreCallInput {
  tenantId: string;
  vapiCallId: string;
  callerNumber: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  costCents: number | null;
  recordingUrl: string | null;
  summary: string;
  transcript: string;
  structured?: StructuredLead;
}

// Classify from what the tools actually recorded against the call — free and
// more accurate than an LLM guess. Falls back to answered/missed.
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

// Create a leads row if the caller is a prospect (Vapi said so, or they booked)
// and one isn't already recorded for this call. Deduped by call_id.
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

// Persist a finished call. Returns the outcome (the webhook uses it for Discord).
export async function storeCall(
  input: StoreCallInput,
): Promise<{ callId: string | null; outcome: Outcome }> {
  const outcome = await classifyOutcome(input.vapiCallId, Boolean(input.transcript.trim()));

  const callId = await upsertCallByVapiId(input.tenantId, input.vapiCallId, {
    caller_number: input.callerNumber,
    started_at: input.startedAt,
    ended_at: input.endedAt,
    // Vapi reports fractional seconds (e.g. 72.001); duration_sec is an integer
    // column, so round or the whole write 400s and nothing stores.
    duration_sec: input.durationSec == null ? null : Math.round(input.durationSec),
    outcome,
    summary: input.summary,
    recording_url: input.recordingUrl,
    cost_cents: input.costCents == null ? null : Math.round(input.costCents),
  });

  if (callId && input.transcript) {
    await db().from("transcripts").delete().eq("call_id", callId);
    await db().from("transcripts").insert({
      call_id: callId,
      role: "system",
      text: input.transcript,
    });
  }

  if (callId) {
    await maybeCaptureLead({
      tenantId: input.tenantId,
      callId,
      structured: input.structured,
      outcome,
      summary: input.summary,
      callerNumber: input.callerNumber ?? "",
    });
  }

  return { callId, outcome };
}

function durationSeconds(startedAt?: string, endedAt?: string): number | null {
  if (!startedAt || !endedAt) return null;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : null;
}

// Map a Vapi call object → storeCall input, resolving the tenant by assistant.
export async function storeCallFromVapi(call: VapiCall): Promise<void> {
  if (!call.id || !call.assistantId) return;
  const resolved = await resolveTenant({ assistantId: call.assistantId });
  const transcript = call.transcript ?? call.artifact?.transcript ?? "";
  const summary =
    call.analysis?.summary?.trim() ||
    call.summary?.trim() ||
    (transcript ? transcript.slice(0, 500) : "No transcript captured.");
  await storeCall({
    tenantId: resolved.config.id,
    vapiCallId: call.id,
    callerNumber: call.customer?.number ?? null,
    startedAt: call.startedAt ?? null,
    endedAt: call.endedAt ?? null,
    durationSec: durationSeconds(call.startedAt, call.endedAt),
    costCents: typeof call.cost === "number" ? Math.round(call.cost * 100) : null,
    recordingUrl: call.recordingUrl ?? call.artifact?.recordingUrl ?? null,
    summary,
    transcript,
    structured: call.analysis?.structuredData as StructuredLead | undefined,
  });
}

// Safety net: pull recent ended calls from Vapi and store any that our DB is
// missing or hasn't fully logged (null summary). Runs best-effort on dashboard
// load so the logs are correct regardless of webhook delivery. Returns the
// number of calls (re)stored.
export async function reconcileRecentCalls(tenantId?: string): Promise<number> {
  let stored = 0;
  try {
    let q = db()
      .from("tenants")
      .select("id, vapi_assistant_id")
      .not("vapi_assistant_id", "is", null);
    if (tenantId) q = q.eq("id", tenantId);
    const { data: tenants } = await q;

    const cutoff = Date.now() - 24 * 3600_000; // last 24 hours
    for (const t of (tenants ?? []) as { id: string; vapi_assistant_id: string }[]) {
      let calls: VapiCall[] = [];
      try {
        calls = await listVapiCalls({ assistantId: t.vapi_assistant_id, limit: 20 });
      } catch (e) {
        console.error("listVapiCalls failed", e);
        continue;
      }
      for (const call of calls) {
        if (call.status !== "ended" || !call.id) continue;
        if (call.endedAt && new Date(call.endedAt).getTime() < cutoff) continue;

        const { data: row } = await db()
          .from("calls")
          .select("summary")
          .eq("vapi_call_id", call.id)
          .maybeSingle();
        const complete = (row as { summary?: string } | null)?.summary;
        if (complete) continue; // already logged

        await storeCallFromVapi(call);
        stored++;
      }
    }
  } catch (e) {
    console.error("reconcileRecentCalls failed", e);
  }
  return stored;
}
