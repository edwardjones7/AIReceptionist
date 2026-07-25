import { createEvent, isSlotFree } from "../google-calendar";
import { createExternalBooking } from "../booking-api";
import { db } from "../supabase";
import { alertOwner } from "../notify";
import type { ToolContext, ToolResult } from "../types";
import { spokenTime } from "./checkAvailability";

export async function bookDiscoveryCall(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const name = String(input.name ?? "").trim();
  const phone = String(input.phone ?? "").trim();
  const email = String(input.email ?? "").trim();
  const slotStart = String(input.slot_start ?? "").trim();

  if (!name || !slotStart) {
    return {
      message:
        "I need at least a name and a time to book. Can you give me your name and the time you'd like?",
      isError: true,
    };
  }

  const dc = ctx.tenant.booking.discoveryCall;
  const start = new Date(slotStart);
  if (isNaN(start.getTime())) {
    return { message: "That time didn't come through clearly — can you say it again?", isError: true };
  }
  const end = new Date(start.getTime() + dc.durationMinutes * 60_000);

  // External booking backend: hand the booking to the tenant's /book API so the
  // caller gets the same confirmation email + Meet link + invite as a web
  // booking. Needs an email for the invite.
  if (dc.api?.baseUrl) {
    if (!email) {
      return {
        message:
          "I'll need an email to send the calendar invite — what's the best one for you?",
        isError: true,
      };
    }
    const result = await createExternalBooking(dc.api.baseUrl, {
      name,
      email,
      message: phone ? `Booked by phone. Caller: ${phone}` : "Booked by phone.",
      slot: slotStart,
      timezone: ctx.tenant.timezone,
    });
    if (result.conflict) {
      return {
        message: "It looks like that time just filled up. Let me check what else is open.",
        data: { conflict: true },
      };
    }
    if (!result.ok) {
      // Don't lose the booking — capture it as a qualified lead to confirm.
      await db().from("leads").insert({
        tenant_id: ctx.tenant.id,
        call_id: ctx.callId ?? null,
        name,
        phone,
        email,
        intent: "discovery_call_request",
        details: `Wanted ${dc.name} at ${slotStart} but the booking system didn't confirm.`,
        qualified: true,
      });
      return {
        message:
          "I've got your details — I'll have your time confirmed and the invite sent over shortly.",
        data: { booked: false, fallbackLead: true },
      };
    }

    await db().from("bookings").insert({
      tenant_id: ctx.tenant.id,
      call_id: ctx.callId ?? null,
      type: "discovery_call",
      name,
      phone,
      email,
      slot_start: String(result.booking?.starts_at ?? start.toISOString()),
      slot_end: String(result.booking?.ends_at ?? end.toISOString()),
      gcal_event_id: String(result.booking?.manage_token ?? result.booking?.id ?? ""),
      status: "confirmed",
    });

    const bookedWhen = spokenTime(start.toISOString(), ctx.tenant.timezone);
    await alertOwner(ctx.settings, {
      title: "New discovery call booked",
      summary: `${name} booked a ${dc.name} for ${bookedWhen}.`,
      fields: [
        { name: "Phone", value: phone || "—" },
        { name: "Email", value: email || "—" },
      ],
      smsBody: `📅 Discovery call booked: ${name} — ${bookedWhen}. ${phone}`,
    });

    return {
      message: `You're booked for ${bookedWhen}. You'll get a calendar invite by email. Anything else I can help with?`,
      data: { booked: true, when: bookedWhen },
    };
  }

  // Re-check the slot is still free (avoid double-booking).
  const calendarId = ctx.settings.calendarId;
  const free =
    !calendarId ||
    (await isSlotFree(calendarId, start.toISOString(), end.toISOString(), ctx.tenant.timezone));
  if (!free) {
    return {
      message:
        "It looks like that time just filled up. Let me check what else is open.",
      data: { conflict: true },
    };
  }

  let eventId = "";
  try {
    if (!calendarId) throw new Error("no calendarId configured for tenant");
    const ev = await createEvent({
      calendarId,
      summary: `${dc.name} — ${name} (${ctx.tenant.displayName})`,
      description: `Booked by ${ctx.tenant.agentName} (front desk).\nName: ${name}\nPhone: ${phone}\nEmail: ${email}`,
      start: start.toISOString(),
      end: end.toISOString(),
      timezone: ctx.tenant.timezone,
      attendeeEmail: email || undefined,
    });
    eventId = ev.eventId;
  } catch (e) {
    console.error("createEvent failed", e);
    // Fall back to capturing the booking request as a lead so it isn't lost.
    await db().from("leads").insert({
      tenant_id: ctx.tenant.id,
      call_id: ctx.callId ?? null,
      name,
      phone,
      email,
      intent: "discovery_call_request",
      details: `Wanted ${dc.name} at ${slotStart} but calendar booking failed.`,
      qualified: true,
    });
    return {
      message:
        "I've got your details — I'll have your time confirmed and a calendar invite sent over shortly.",
      data: { booked: false, fallbackLead: true },
    };
  }

  await db().from("bookings").insert({
    tenant_id: ctx.tenant.id,
    call_id: ctx.callId ?? null,
    type: "discovery_call",
    name,
    phone,
    email,
    slot_start: start.toISOString(),
    slot_end: end.toISOString(),
    gcal_event_id: eventId,
    status: "confirmed",
  });

  const when = spokenTime(start.toISOString(), ctx.tenant.timezone);
  await alertOwner(ctx.settings, {
    title: "New discovery call booked",
    summary: `${name} booked a ${dc.name} for ${when}.`,
    fields: [
      { name: "Phone", value: phone || "—" },
      { name: "Email", value: email || "—" },
    ],
    smsBody: `📅 Discovery call booked: ${name} — ${when}. ${phone}`,
  });

  return {
    message: `You're booked for ${when}. You'll get a calendar invite${email ? " by email" : ""}. Anything else I can help with?`,
    data: { booked: true, eventId, when },
  };
}
