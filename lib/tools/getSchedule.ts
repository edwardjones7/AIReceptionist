import { listEvents } from "../google-calendar";
import type { ToolContext, ToolResult } from "../types";

// Read Ed's actual Google Calendar agenda for today or tomorrow.
export async function getScheduleTool(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.isFounder) return { message: "Not available.", isError: true };
  const day = String(input.day) === "tomorrow" ? "tomorrow" : "today";
  const tz = ctx.tenant.timezone;

  // Compute local-midnight window for the requested day, in UTC.
  const now = new Date();
  const offsetMs =
    new Date(now.toLocaleString("en-US", { timeZone: tz })).getTime() -
    new Date(now.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value) + (day === "tomorrow" ? 1 : 0);
  const startUtc = new Date(Date.UTC(y, m - 1, d) - offsetMs);
  const endUtc = new Date(startUtc.getTime() + 86_400_000);

  if (!ctx.settings.calendarId) {
    return { message: "No calendar is connected for this business yet.", isError: true };
  }
  const events = await listEvents(
    ctx.settings.calendarId,
    startUtc.toISOString(),
    endUtc.toISOString(),
  );
  if (events.length === 0) return { message: `Nothing on your calendar ${day}.`, data: { events: [] } };

  const fmt = (iso: string) =>
    iso.includes("T")
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }).format(new Date(iso))
      : "all day";

  const lines = events.map((e) => `${e.summary} at ${fmt(e.start)}`);
  return { message: `Your ${day}: ${lines.join("; ")}.`, data: { events } };
}
