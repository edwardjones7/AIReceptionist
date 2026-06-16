// Custom-LLM endpoint for Vapi. Vapi POSTs an OpenAI chat-completions request
// (stream:true); we inject Scarlett's system prompt, advertise our tools, run
// the turn on Claude (Haiku 4.5), and stream the result back as OpenAI SSE.
//
// Vapi appends /chat/completions to the configured model.url, so the real call
// lands in ./chat/completions/route.ts — both delegate to the shared handler.

import { NextRequest } from "next/server";
import { handleLlm } from "@/lib/llm-handler";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  return handleLlm(req);
}
