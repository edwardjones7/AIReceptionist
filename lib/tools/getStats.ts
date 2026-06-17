import { getStats, type Period } from "../stats";
import type { ToolContext, ToolResult } from "../types";

export async function getStatsTool(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.isFounder) return { message: "Not available.", isError: true };
  const period = (["today", "week", "month"].includes(String(input.period))
    ? String(input.period)
    : "today") as Period;

  const s = await getStats(ctx.tenant.id, period, ctx.tenant.timezone);
  const label = period === "today" ? "today" : period === "week" ? "the last 7 days" : "the last 30 days";

  const summary =
    `${label}: ${s.calls} calls, ${s.booked} booked, ${s.leads} leads (${s.qualifiedLeads} qualified)` +
    `${s.transferred ? `, ${s.transferred} transferred` : ""}${s.missed ? `, ${s.missed} missed` : ""}. ` +
    `Book rate ${s.bookRatePct}%.`;

  return { message: summary, data: { stats: s } };
}
