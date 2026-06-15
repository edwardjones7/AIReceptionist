// Tool-execution endpoint for Vapi server tools. When Scarlett (Claude) calls a
// tool, Vapi dispatches it here, we run the handler, and return the result for
// Vapi to feed back into the conversation.
//
// Configure each tool on the Vapi assistant with server.url = <PUBLIC_BASE_URL>/api/tools
// (the provision script does this). Vapi's tool-call webhook shape varies by
// version; we parse the common variants defensively.

import { NextRequest, NextResponse } from "next/server";
import { verifyVapiSecret } from "@/lib/auth";
import { loadTenant } from "@/lib/context";
import { runTool } from "@/lib/tools";
import { upsertCallByVapiId } from "@/lib/supabase";
import type { ToolContext } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

interface VapiToolCall {
  id?: string;
  toolCallId?: string;
  function?: { name?: string; arguments?: string | Record<string, unknown> };
  name?: string;
  arguments?: string | Record<string, unknown>;
}

function parseArgs(
  raw: string | Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  if (!verifyVapiSecret(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await req.json()) as {
    message?: {
      type?: string;
      toolCalls?: VapiToolCall[];
      toolCallList?: VapiToolCall[];
      call?: { id?: string; customer?: { number?: string } };
    };
  };

  const msg = body.message ?? {};
  const calls = msg.toolCallList ?? msg.toolCalls ?? [];
  const tenant = loadTenant();

  const vapiCallId = msg.call?.id;
  const callerNumber = msg.call?.customer?.number;
  let internalCallId: string | null = null;
  if (vapiCallId) {
    internalCallId = await upsertCallByVapiId(tenant.id, vapiCallId, {
      caller_number: callerNumber ?? null,
    });
  }

  const ctx: ToolContext = {
    tenant,
    callId: internalCallId ?? undefined,
    vapiCallId,
    callerNumber,
  };

  const results = await Promise.all(
    calls.map(async (c) => {
      const id = c.toolCallId ?? c.id ?? "";
      const name = c.function?.name ?? c.name ?? "";
      const args = parseArgs(c.function?.arguments ?? c.arguments);
      const result = await runTool(name, args, ctx);
      return {
        toolCallId: id,
        // Vapi reads `result` as the string handed back to the model.
        result: result.message,
        // Extra metadata (ignored by Vapi, useful for our own logs/debugging).
        metadata: result.data ?? {},
      };
    }),
  );

  return NextResponse.json({ results });
}
