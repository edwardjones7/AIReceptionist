import { createEvent, isSlotFree } from "../google-calendar";
import { db } from "../supabase";
import { alertFounder } from "../notify";
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

  // Re-check the slot is still free (avoid double-booking).
  const free = await isSlotFree(start.toISOString(), end.toISOString(), ctx.tenant.timezone);
  if (!free) {
    return {
      message:
        "It looks like that time just filled up. Let me check what else is open.",
      data: { conflict: true },
    };
  }

  let eventId = "";
  try {
    const ev = await createEvent({
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
  await alertFounder({
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
