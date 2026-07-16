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
  if (!ctx.settings.calendarId) {
    // Tenant has no calendar connected yet — degrade to lead capture.
    return {
      message:
        "I can't check the calendar right now. Let me take your details and have someone reach out to find a time that works.",
      data: { slots: [] },
    };
  }

  const slots = await findOpenSlots({
    calendarId: ctx.settings.calendarId,
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

  // Give the model BOTH the friendly spoken time (to read aloud) and the exact
  // ISO slot_start (to pass into book_discovery_call). The model must speak only
  // the friendly time but book with the matching ISO verbatim.
  const lines = slots.map(
    (s, i) =>
      `${i + 1}) ${spokenTime(s.start, ctx.tenant.timezone)} — slot_start=${s.start}`,
  );
  return {
    message: `Open times. Offer these to the caller by their friendly time only — do NOT read the slot_start values aloud. When the caller picks one, call book_discovery_call with that option's slot_start value exactly:\n${lines.join("\n")}`,
    data: { slots },
  };
}
