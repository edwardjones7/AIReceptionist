// Custom-LLM endpoint for Vapi. Vapi POSTs an OpenAI chat-completions request
// (stream:true); we inject Scarlett's system prompt, advertise our tools, run
// the turn on Claude (Haiku 4.5), and stream the result back as OpenAI SSE.
//
// Configure the Vapi assistant's model as a custom LLM pointing at:
//   <PUBLIC_BASE_URL>/api/llm
// with the VAPI_SERVER_SECRET as the custom header (see README).

import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { verifyVapiSecret } from "@/lib/auth";
import { loadTenant } from "@/lib/context";
import { buildSystemPrompt } from "@/lib/personas/scarlett";
import { toolsForTenant } from "@/lib/tools";
import {
  toAnthropicMessages,
  toAnthropicTools,
  streamClaudeAsOpenAI,
  type OpenAIMessage,
} from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

interface LlmRequestBody {
  model?: string;
  messages?: OpenAIMessage[];
  call?: { id?: string; customer?: { number?: string } };
}

export async function POST(req: NextRequest) {
  if (!verifyVapiSecret(req)) {
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
