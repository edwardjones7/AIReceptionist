// Shared handler for the custom-LLM endpoint. Used by both /api/llm and
// /api/llm/chat/completions (Vapi posts to <model.url>/chat/completions).

import { env } from "./env";
import { verifyVapiSecret } from "./auth";
import { loadTenant } from "./context";
import { buildSystemPrompt } from "./personas/scarlett";
import { toolsForTenant } from "./tools";
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

  const systemStable = buildSystemPrompt(tenant);
  const systemVolatile = [
    `Current date and time (${tenant.timezone}): ${nowSpoken}.`,
    callerNumber ? `Caller's number: ${callerNumber}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const messages = toAnthropicMessages(body.messages ?? []);
  const tools = toAnthropicTools(toolsForTenant(tenant));

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
