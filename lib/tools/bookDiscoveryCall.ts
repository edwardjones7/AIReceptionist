import { createEvent, isSlotFree } from "../google-calendar";
import { createExternalBooking } from "../booking-api";
import { db } from "../supabase";
import { alertOwner, textCaller } from "../notify";
import { parseSpokenEmail, isValidEmail } from "../email/spoken";
import { getVerifiedEmail } from "../email/verified-store";
import type { ToolContext, ToolResult } from "../types";
import { spokenTime } from "./checkAvailability";

/** "Wednesday, Jul 29, 2026 · 10:30 AM EDT" — matches the site's booking notification. */
function whenLabel(iso: string, timezone: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(d);
  return `${date} · ${time}`;
}

/** Pull a Meet link out of the external /book response, whatever key it uses. */
function meetLink(booking: Record<string, unknown> | undefined): string {
  if (!booking) return "";
  for (const key of ["meet_url", "meetUrl", "meet_link", "meetLink", "hangout_link", "hangoutLink", "meet"]) {
    const v = booking[key];
    if (typeof v === "string" && v.startsWith("http")) return v;
  }
  return "";
}

/**
 * Record a booking attempt whose email wouldn't parse, so the lead survives the
 * caller hanging up in frustration. Deduped per call — Scarlett may try twice.
 */
async function saveFailedEmailLead(
  ctx: ToolContext,
  o: { name: string; phone: string; parsedRaw: string; slotStart: string; dcName: string },
): Promise<void> {
  try {
    if (ctx.callId) {
      const { data } = await db()
        .from("leads")
        .select("id")
        .eq("call_id", ctx.callId)
        .eq("intent", "discovery_call_request")
        .limit(1);
      if (data?.length) return;
    }
    await db().from("leads").insert({
      tenant_id: ctx.tenant.id,
      call_id: ctx.callId ?? null,
      name: o.name,
      phone: o.phone,
      email: "",
      intent: "discovery_call_request",
      details: `Wanted ${o.dcName} at ${o.slotStart} but the email did not parse: "${o.parsedRaw}". Needs a human to confirm the address.`,
      qualified: true,
      status: "new",
    });
  } catch (e) {
    // Never let bookkeeping break the call.
    console.error("saveFailedEmailLead failed", e);
  }
}

/**
 * Text the caller their booking and the address the invite went to.
 *
 * This is the safety net for the failure this whole module exists to prevent:
 * an address that parses cleanly but is still wrong (a missing "jr", gmial.com)
 * books silently and the invite lands nowhere. Putting it in front of them on
 * the phone they're already holding makes that recoverable instead of lost.
 */
async function textCallerConfirmation(
  ctx: ToolContext,
  o: { when: string; email: string },
): Promise<void> {
  const dest = o.email
    ? ` The invite is going to ${o.email} — if that's not right, just reply here with the correct address.`
    : "";
  await textCaller(ctx, `You're booked for ${o.when}.${dest} — ${ctx.tenant.displayName}`);
}

export async function bookDiscoveryCall(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const name = String(input.name ?? "").trim();
  // Callers rarely dictate their number — fall back to the caller ID.
  const phone = String(input.phone ?? "").trim() || (ctx.callerNumber ?? "").trim();
  // Prefer the address the caller actually confirmed through confirm_email over
  // whatever the model retyped; otherwise run the raw value through the same
  // deterministic parser so spoken artifacts ("cheriselyn n1@gmail.com",
  // "ed at gmail dot com") resolve the one consistent way.
  const parsedEmail = parseSpokenEmail(String(input.email ?? ""));
  const email = getVerifiedEmail(ctx.vapiCallId) ?? parsedEmail.email;
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

  // Email gating, for BOTH booking paths. The external /book API needs an
  // address to send the invite to; the calendar path doesn't, but a malformed
  // address must never be written either way.
  if (dc.api?.baseUrl && !email) {
    return {
      message:
        "I'll need an email to send the calendar invite — what's the best one for you?",
      isError: true,
    };
  }
  if (email && !isValidEmail(email)) {
    // Don't book to a bad address — but don't dead-end either. Persisting the
    // attempt means a caller who gives up mid-loop still leaves a name, a
    // caller ID, the slot they wanted and the raw string, instead of vanishing.
    await saveFailedEmailLead(ctx, { name, phone, parsedRaw: parsedEmail.raw, slotStart, dcName: dc.name });
    return {
      message:
        "I didn't catch that email correctly, so nothing has been booked yet. Call confirm_email with exactly what the caller says next — do not call book_discovery_call again until it comes back valid.",
      isError: true,
    };
  }

  // External booking backend: hand the booking to the tenant's /book API so the
  // caller gets the same confirmation email + Meet link + invite as a web
  // booking. Needs an email for the invite.
  if (dc.api?.baseUrl) {
    // This message lands in the site's own "📅 New booking" notification as
    // the Notes field, so credit the assistant and keep the caller's number.
    const bookedVia = `Booked by phone through ${ctx.tenant.agentName} (AI receptionist demo).`;
    const result = await createExternalBooking(dc.api.baseUrl, {
      name,
      email,
      message: phone ? `${bookedVia} Caller: ${phone}` : bookedVia,
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
    const startsAt = String(result.booking?.starts_at ?? start.toISOString());
    const meet = meetLink(result.booking);
    await alertOwner(ctx.settings, {
      title: "📅 New booking",
      summary: `${name} booked a ${dc.name} through ${ctx.tenant.agentName}.`,
      fields: [
        { name: "Name", value: name },
        { name: "Phone", value: phone || "—" },
        { name: "Email", value: email || "—" },
        { name: "When", value: whenLabel(startsAt, ctx.tenant.timezone) },
        { name: "Meet", value: meet || "—" },
        { name: "Notes", value: bookedVia },
      ],
      smsBody: `📅 Discovery call booked: ${name} — ${bookedWhen}. ${phone}`,
    });

    await textCallerConfirmation(ctx, { when: bookedWhen, email });

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
    title: "📅 New booking",
    summary: `${name} booked a ${dc.name} through ${ctx.tenant.agentName}.`,
    fields: [
      { name: "Name", value: name },
      { name: "Phone", value: phone || "—" },
      { name: "Email", value: email || "—" },
      { name: "When", value: whenLabel(start.toISOString(), ctx.tenant.timezone) },
      { name: "Notes", value: `Booked by phone through ${ctx.tenant.agentName} (AI receptionist).` },
    ],
    smsBody: `📅 Discovery call booked: ${name} — ${when}. ${phone}`,
  });

  await textCallerConfirmation(ctx, { when, email });

  // NOTE: no invite is sent on this path — createEvent deliberately omits
  // attendees (a service account without domain-wide delegation gets a 403),
  // so promising an email here would be a lie. The SMS above is the delivery.
  return {
    message: `You're booked for ${when} — I'll text you the details. Anything else I can help with?`,
    data: { booked: true, eventId, when },
  };
}
