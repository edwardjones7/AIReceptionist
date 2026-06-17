import { getRecentLeads } from "../stats";
import type { ToolContext, ToolResult } from "../types";

function ago(iso: string): string {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export async function getRecentLeadsTool(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.isFounder) return { message: "Not available.", isError: true };
  const limit = Math.min(Number(input.limit) || 5, 10);
  const leads = await getRecentLeads(ctx.tenant.id, limit);

  if (leads.length === 0) return { message: "No leads captured yet.", data: { leads: [] } };

  const lines = leads.map((l) => {
    const who = l.name || "Unknown caller";
    const what = l.intent || "no stated intent";
    const q = l.qualified ? "qualified" : "soft";
    return `${who} — ${what} (${q}, ${ago(l.created_at)})`;
  });
  return {
    message: `Last ${leads.length} leads: ${lines.join("; ")}.`,
    data: { leads },
  };
}
