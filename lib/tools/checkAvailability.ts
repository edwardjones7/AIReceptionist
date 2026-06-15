import { findOpenSlots } from "../google-calendar";
import type { ToolContext, ToolResult } from "../types";

// Format an ISO instant as a spoken time in the tenant timezone, e.g.
// "Tuesday, June 17th at 2:00 PM".
export function spokenTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

export async function checkAvailability(
  _input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const dc = ctx.tenant.booking.discoveryCall;
  if (!dc.enabled) {
    return { message: "Booking isn't available right now.", isError: true };
  }
  const hours = ctx.tenant.businessHours.mondayToFriday;
  if (!hours) {
    return { message: "No business hours are configured.", isError: true };
  }

  const slots = await findOpenSlots({
    durationMinutes: dc.durationMinutes,
    windowDays: dc.offerWindowDays,
    earliestHoursOut: dc.earliestHoursOut,
    timezone: ctx.tenant.timezone,
    businessOpen: hours.open,
    businessClose: hours.close,
    count: 3,
  });

  if (slots.length === 0) {
    return {
      message:
        "I don't see any open times in the next few days. Let me take your details and have someone reach out to find a time that works.",
      data: { slots: [] },
    };
  }

  const spoken = slots.map((s) => spokenTime(s.start, ctx.tenant.timezone));
  return {
    message: `Here are a few open times: ${spoken.join("; ")}. Which works best?`,
    data: { slots },
  };
}
