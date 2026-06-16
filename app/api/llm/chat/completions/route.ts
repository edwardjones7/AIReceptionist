// Vapi posts the live custom-LLM turn to <model.url>/chat/completions.
// Same handler as /api/llm.

import { NextRequest } from "next/server";
import { handleLlm } from "@/lib/llm-handler";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  return handleLlm(req);
}
