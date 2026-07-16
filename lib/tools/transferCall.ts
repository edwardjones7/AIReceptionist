import { db } from "../supabase";
import { postDiscord } from "../notify";
import type { ToolContext, ToolResult } from "../types";

// Real transfer via Vapi's live call-control URL. Vapi includes
// message.call.monitor.controlUrl on the tool-call webhook; POSTing a transfer
// command to it bridges the live call to the destination. The destination
// number stays server-side (never exposed to the model/caller).
export async function transferCall(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const target = ctx.settings.transferNumber || ctx.settings.ownerNumbers[0] || "";
  const reason = String(input.reason ?? "").trim();

  // Can't transfer (no control URL or no number configured) → capture a callback.
  if (!ctx.controlUrl || !target) {
    try {
      await db().from("leads").insert({
        tenant_id: ctx.tenant.id,
        call_id: ctx.callId ?? null,
        phone: ctx.callerNumber ?? "",
        intent: "wants_human",
        details: reason || "Asked for a person; transfer unavailable.",
        qualified: true,
        status: "new",
      });
    } catch (e) {
      console.error("transfer callback lead insert failed", e);
    }
    await postDiscord(ctx.settings.discordWebhookUrl, {
      title: "Caller asked for a person (couldn't transfer)",
      description: reason || "Transfer unavailable — callback captured.",
    });
    return {
      message:
        "I can't connect you this second, but I'll have someone reach out right away. What's the best number to reach you?",
    };
  }

  try {
    const res = await fetch(ctx.controlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "transfer",
        destination: { type: "number", number: target },
      }),
    });
    if (!res.ok) throw new Error(`control ${res.status}: ${await res.text()}`);
  } catch (e) {
    console.error("transfer control POST failed", e);
    return {
      message:
        "Hmm, I'm having trouble connecting you — let me take your details and have someone call you right back. What's the best number?",
    };
  }

  // Best-effort log + alert (never block the transfer).
  db()
    .from("transfers")
    .insert({
      tenant_id: ctx.tenant.id,
      call_id: ctx.callId ?? null,
      reason,
      to_number: target,
      status: "transferred",
    })
    .then(
      () => {},
      () => {},
    );
  postDiscord(ctx.settings.discordWebhookUrl, {
    title: "Call transferred to a human",
    description: reason || "Caller asked for a person.",
  });

  return { message: "Connecting you now — one moment." };
}
