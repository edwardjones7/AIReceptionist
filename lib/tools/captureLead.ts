import { db } from "../supabase";
import { alertOwner, postDiscord } from "../notify";
import { parseSpokenEmail } from "../email/spoken";
import { getVerifiedEmail } from "../email/verified-store";
import type { ToolContext, ToolResult } from "../types";

export async function captureLead(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const name = String(input.name ?? "").trim();
  const phone = String(input.phone ?? "").trim() || ctx.callerNumber || "";
  // Prefer the address the caller actually confirmed via confirm_email; fall
  // back to parsing whatever the model passed. A lead is worth keeping even
  // with a shaky address, so an unparseable one is stored raw rather than lost.
  const parsedEmail = parseSpokenEmail(String(input.email ?? ""));
  const email = getVerifiedEmail(ctx.vapiCallId) ?? parsedEmail.email;
  const intent = String(input.intent ?? "").trim();
  const details = String(input.details ?? "").trim();
  const qualified = Boolean(input.qualified);

  if (!name && !phone) {
    return {
      message: "Can I get your name and the best number to reach you?",
      isError: true,
    };
  }

  await db().from("leads").insert({
    tenant_id: ctx.tenant.id,
    call_id: ctx.callId ?? null,
    name,
    phone,
    email,
    intent,
    details,
    qualified,
    status: "new",
  });

  const fields = [
    { name: "Phone", value: phone || "—" },
    { name: "Email", value: email || "—" },
    { name: "Intent", value: intent || "—" },
  ];

  if (qualified) {
    // Hot lead — fire SMS too.
    await alertOwner(ctx.settings, {
      title: "New qualified lead",
      summary: `${name || "Caller"}: ${details || intent || "wants a callback"}`,
      fields,
      smsBody: `🔥 Lead: ${name || "caller"} — ${intent || details || "callback"}. ${phone}`,
    });
  } else {
    // Soft lead — Discord only.
    await postDiscord(ctx.settings.discordWebhookUrl, {
      title: "New lead",
      description: `${name || "Caller"}: ${details || intent || "left details"}`,
      fields,
    });
  }

  return {
    message:
      "Got it — I've taken your details and someone will reach out. Anything else I can help with?",
    data: { captured: true, qualified },
  };
}
