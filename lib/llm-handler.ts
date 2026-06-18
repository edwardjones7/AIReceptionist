// Shared handler for the custom-LLM endpoint. Used by both /api/llm and
// /api/llm/chat/completions (Vapi posts to <model.url>/chat/completions).

import { env } from "./env";
import { verifyVapiSecret } from "./auth";
import { loadTenant } from "./context";
import { buildSystemPrompt, buildFounderPrompt } from "./personas/scarlett";
import { clientToolsFor, founderToolsFor } from "./tools";
import { isFounderNumber } from "./founder";
import { getStats } from "./stats";
import {
  toAnthropicMessages,
  toAnthropicTools,
  streamClaudeAsOpenAI,
  type OpenAIMessage,
} from "./anthropic";

interface LlmRequestBody {
  model?: string;
  messages?: OpenAIMessage[];
  call?: { id?: string; customer?: { number?: string } };
}

export async function handleLlm(req: Request): Promise<Response> {
  if (!verifyVapiSecret(req, { soft: true })) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await req.json()) as LlmRequestBody;
  const tenant = loadTenant();

  const callerNumber = body.call?.customer?.number ?? "";
  const nowSpoken = new Intl.DateTimeFormat("en-US", {
    timeZone: tenant.timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());

  const founder = isFounderNumber(callerNumber);

  const systemStable = founder
    ? buildFounderPrompt(tenant)
    : buildSystemPrompt(tenant);

  const volatileParts = [`Current date and time (${tenant.timezone}): ${nowSpoken}.`];
  if (!founder && callerNumber) volatileParts.push(`Caller's number: ${callerNumber}.`);

  // Founder mode: inject a quick snapshot so she can lead with numbers in the
  // greeting without a tool round-trip. Best-effort — never block the call.
  if (founder) {
    try {
      const [today, week] = await Promise.all([
        getStats(tenant.id, "today", tenant.timezone),
        getStats(tenant.id, "week", tenant.timezone),
      ]);
      volatileParts.push(
        `SNAPSHOT — Today: ${today.calls} calls, ${today.booked} booked, ${today.leads} leads (${today.qualifiedLeads} qualified). ` +
          `Last 7 days: ${week.calls} calls, ${week.booked} booked, ${week.leads} leads, book rate ${week.bookRatePct}%.`,
      );
    } catch (e) {
      console.error("founder snapshot failed", e);
    }
  }

  const systemVolatile = volatileParts.join(" ");
  const messages = toAnthropicMessages(body.messages ?? []);
  const tools = toAnthropicTools(
    founder ? founderToolsFor(tenant) : clientToolsFor(tenant),
  );

  // Real call transfer: advertise Vapi's native transferCall to the model on
  // client calls only. When the model emits it, Vapi bridges to the destination
  // configured on the assistant (the founder's cell) — our endpoint just passes
  // the tool-call through. Founder mode (Ed) never transfers.
  if (!founder && tenant.transfer.enabled) {
    tools.push({
      name: "transferCall",
      description:
        "Transfer the live call to a member of the team. Use ONLY when the caller has clearly asked for a real person at least twice or is insistent, OR the matter is genuinely urgent/important and you cannot help. Do not offer it proactively — prefer helping, taking their info, or booking the call.",
      input_schema: { type: "object", properties: {} },
    } as (typeof tools)[number]);
  }

  const stream = streamClaudeAsOpenAI({
    model: env.llmModel,
    systemStable,
    systemVolatile,
    messages,
    tools,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
