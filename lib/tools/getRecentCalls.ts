import { getRecentCalls } from "../stats";
import type { ToolContext, ToolResult } from "../types";

function ago(iso: string): string {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// What recent calls were actually about — reads the AI-written call summaries.
export async function getRecentCallsTool(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.isFounder) return { message: "Not available.", isError: true };
  const limit = Math.min(Number(input.limit) || 5, 10);
  const calls = await getRecentCalls(ctx.tenant.id, limit);

  if (calls.length === 0)
    return {
      message: "No call summaries yet — once real calls come through I'll have the rundown.",
      data: { calls: [] },
    };

  const lines = calls.map((c) => {
    const who = c.caller_number || "a caller";
    const outcome = c.outcome ? `${c.outcome}` : "answered";
    const dur = c.duration_sec ? `, ${c.duration_sec}s` : "";
    return `${who} (${outcome}${dur}, ${ago(c.created_at)}): ${c.summary}`;
  });
  return {
    message: `Last ${calls.length} calls. ${lines.join(" || ")}`,
    data: { calls },
  };
}
