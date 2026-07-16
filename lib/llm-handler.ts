// Shared handler for the custom-LLM endpoint. Used by both /api/llm and
// /api/llm/chat/completions (Vapi posts to <model.url>/chat/completions).

import { env } from "./env";
import { verifyVapiSecret } from "./auth";
import { resolveTenant } from "./context";
import { buildSystemPrompt, buildFounderPrompt } from "./personas/scarlett";
import { clientToolsFor, founderToolsFor } from "./tools";
import { isOwnerNumber } from "./founder";
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
  call?: {
    id?: string;
    assistantId?: string;
    phoneNumberId?: string;
    customer?: { number?: string };
  };
  // Some Vapi versions hoist the assistant to the top level.
  assistant?: { id?: string };
}

export async function handleLlm(req: Request): Promise<Response> {
  if (!verifyVapiSecret(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await req.json()) as LlmRequestBody;
  const resolved = await resolveTenant({
    assistantId: body.call?.assistantId ?? body.assistant?.id,
    phoneNumberId: body.call?.phoneNumberId,
  });
  const tenant = resolved.config;

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

  const founder = isOwnerNumber(callerNumber, resolved.settings.ownerNumbers);

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
  // (transfer_call is a normal registry tool now — handled via Vapi's live
  // call-control URL in lib/tools/transferCall.ts; nothing special to inject here.)

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
