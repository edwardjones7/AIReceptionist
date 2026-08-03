import { findOpenSlots } from "../google-calendar";
import { fetchExternalSlots } from "../booking-api";
import type { ToolContext, ToolResult } from "../types";

// Format an ISO instant as a spoken time in the tenant timezone, e.g.
// "Tuesday, June 17th at 2:00 PM".
// Prepended to every list of offered slots. The relative-day rule is load-
// bearing: the model reliably mislabels an offered date ("Tuesday the 4th"
// becomes "tomorrow"), and a caller who hears a day that is actually booked
// solid loses all trust in the rest of the call.
const OFFER_RULES =
  "Open times. Offer these to the caller by their friendly day and time only — " +
  "do NOT read the slot_start values aloud. Say the day and date EXACTLY as " +
  'written here (e.g. "Tuesday the 4th at 10"). NEVER translate one into a ' +
  'relative day like "tomorrow", "today", or "later this week" — you will get ' +
  "it wrong. Any day NOT listed below has no openings at all; if the caller " +
  "asks for one, say it's fully booked and offer what's here. When the caller " +
  "picks one, call book_discovery_call with that option's slot_start exactly:";

// Today's date, restated immediately next to the slots. The system prompt
// already carries the current time, but a small model will still drift when it
// has to do date arithmetic across a tool boundary — repeating the anchor here,
// touching the data, is what keeps "Tuesday the 4th" from becoming "tomorrow".
function todayLine(timezone: string): string {
  const today = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
  return `For your reference, TODAY is ${today}. None of the times below are today or tomorrow unless the date literally matches.`;
}

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

  // External booking backend (the tenant's own /book API) — its slots already
  // reflect the real availability rules and calendar, so offer them directly.
  if (dc.api?.baseUrl) {
    try {
      const iso = (await fetchExternalSlots(dc.api.baseUrl)).slice(0, 3);
      if (iso.length === 0) {
        return {
          message:
            "I don't see any open times in the next few days. Let me take your details and have someone reach out to find a time that works.",
          data: { slots: [] },
        };
      }
      const lines = iso.map(
        (start, i) =>
          `${i + 1}) ${spokenTime(start, ctx.tenant.timezone)} — slot_start=${start}`,
      );
      return {
        message: `${todayLine(ctx.tenant.timezone)}\n\n${OFFER_RULES}\n${lines.join("\n")}`,
        data: { slots: iso.map((start) => ({ start })) },
      };
    } catch (e) {
      console.error("fetchExternalSlots failed", e);
      return {
        message:
          "I can't pull the calendar this second. Let me take your details and have someone lock in a time with you.",
        data: { slots: [] },
      };
    }
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
    message: `${todayLine(ctx.tenant.timezone)}\n\n${OFFER_RULES}\n${lines.join("\n")}`,
    data: { slots },
  };
}
