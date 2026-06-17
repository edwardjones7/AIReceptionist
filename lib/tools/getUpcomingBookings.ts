import { getUpcomingBookings } from "../stats";
import { spokenTime } from "./checkAvailability";
import type { ToolContext, ToolResult } from "../types";

export async function getUpcomingBookingsTool(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.isFounder) return { message: "Not available.", isError: true };
  const limit = Math.min(Number(input.limit) || 5, 10);
  const bookings = await getUpcomingBookings(ctx.tenant.id, limit);

  if (bookings.length === 0)
    return { message: "Nothing booked on the calendar coming up.", data: { bookings: [] } };

  const lines = bookings.map(
    (b) => `${b.name || "Unnamed"} on ${spokenTime(b.slot_start, ctx.tenant.timezone)}`,
  );
  return {
    message: `${bookings.length} upcoming: ${lines.join("; ")}.`,
    data: { bookings },
  };
}
