// Google Calendar via a service account (JWT). Two endpoints we need:
//  - freebusy: find open slots
//  - events.insert: book a discovery call
//
// Setup (see README): create a service account, enable the Calendar API, and
// SHARE the founder's calendar with the service-account email (Make changes to
// events). Then GOOGLE_CALENDAR_ID is the founder's calendar address.
//
// We call the REST API directly with a google-auth-library access token — no
// extra googleapis dependency needed.

import { JWT } from "google-auth-library";
import { env } from "./env";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

// Calendar id, trimmed of any stray whitespace/newline that would otherwise
// corrupt the request URL and yield a 404.
function calendarId(): string {
  return env.googleCalendarId.trim();
}

function jwtClient(): JWT {
  // Support both literal-\n keys and already-newlined keys; trim stray edges.
  const key = env.googlePrivateKey().replace(/\\n/g, "\n").trim();
  return new JWT({
    email: env.googleClientEmail().trim(),
    key,
    scopes: SCOPES,
  });
}

async function accessToken(): Promise<string> {
  const { token } = await jwtClient().getAccessToken();
  if (!token) throw new Error("Failed to get Google access token");
  return token;
}

export interface Slot {
  start: string; // ISO
  end: string; // ISO
}

// Return up to `count` open slots of `durationMinutes`, within business hours,
// over the next `windowDays`, starting at least `earliestHoursOut` from now.
export async function findOpenSlots(opts: {
  durationMinutes: number;
  windowDays: number;
  earliestHoursOut: number;
  timezone: string;
  businessOpen: string; // "09:00"
  businessClose: string; // "18:00"
  count?: number;
}): Promise<Slot[]> {
  const token = await accessToken();
  const now = new Date();
  const timeMin = new Date(now.getTime() + opts.earliestHoursOut * 3600_000);
  const timeMax = new Date(now.getTime() + opts.windowDays * 86_400_000);

  // Pull busy blocks from the calendar.
  const fbRes = await fetch(
    "https://www.googleapis.com/calendar/v3/freeBusy",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone: opts.timezone,
        items: [{ id: calendarId() }],
      }),
    },
  );
  if (!fbRes.ok) {
    throw new Error(`freeBusy failed: ${fbRes.status} ${await fbRes.text()}`);
  }
  const fb = (await fbRes.json()) as {
    calendars: Record<string, { busy: { start: string; end: string }[] }>;
  };
  const busy = fb.calendars[calendarId()]?.busy ?? [];

  // Generate candidate slots on the hour and half-hour within business hours,
  // skip weekends, skip anything overlapping a busy block, in tenant tz.
  const slots: Slot[] = [];
  const durMs = opts.durationMinutes * 60_000;
  const [openH, openM] = opts.businessOpen.split(":").map(Number);
  const [closeH, closeM] = opts.businessClose.split(":").map(Number);

  // Align the starting point to the next :00/:30 boundary, otherwise every
  // candidate inherits timeMin's arbitrary minute offset and the :00/:30 filter
  // below rejects all of them.
  const step = 30 * 60_000;
  const startAligned = Math.ceil(timeMin.getTime() / step) * step;
  for (
    let d = new Date(startAligned);
    d < timeMax && slots.length < (opts.count ?? 3);
    d = new Date(d.getTime() + step)
  ) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: opts.timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const wd = parts.find((p) => p.type === "weekday")?.value;
    const hh = Number(parts.find((p) => p.type === "hour")?.value);
    const mm = Number(parts.find((p) => p.type === "minute")?.value);
    if (wd === "Sat" || wd === "Sun") continue;
    if (mm !== 0 && mm !== 30) continue;

    const afterOpen = hh > openH || (hh === openH && mm >= openM);
    const endMinutes = hh * 60 + mm + opts.durationMinutes;
    const beforeClose = endMinutes <= closeH * 60 + closeM;
    if (!afterOpen || !beforeClose) continue;

    const start = d;
    const end = new Date(d.getTime() + durMs);
    const overlaps = busy.some(
      (b) =>
        start < new Date(b.end) && end > new Date(b.start),
    );
    if (overlaps) continue;

    slots.push({ start: start.toISOString(), end: end.toISOString() });
  }

  return slots;
}

export interface CreateEventResult {
  eventId: string;
  htmlLink?: string;
}

export async function createEvent(opts: {
  summary: string;
  description: string;
  start: string; // ISO
  end: string; // ISO
  timezone: string;
  attendeeEmail?: string;
}): Promise<CreateEventResult> {
  const token = await accessToken();
  // NOTE: we intentionally do NOT set `attendees`. A plain service account
  // (no domain-wide delegation) gets 403 "cannot invite attendees" if it tries.
  // The caller's email/phone is captured in the event description instead.
  const body: Record<string, unknown> = {
    summary: opts.summary,
    description: opts.description,
    start: { dateTime: opts.start, timeZone: opts.timezone },
    end: { dateTime: opts.end, timeZone: opts.timezone },
  };

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId(),
    )}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`events.insert failed: ${res.status} ${await res.text()}`);
  }
  const ev = (await res.json()) as { id: string; htmlLink?: string };
  return { eventId: ev.id, htmlLink: ev.htmlLink };
}

export async function deleteEvent(eventId: string): Promise<void> {
  const token = await accessToken();
  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId(),
    )}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
}

// Re-check that a specific slot is still free right before booking (avoids
// double-booking between the offer and the confirm).
export async function isSlotFree(
  start: string,
  end: string,
  timezone: string,
): Promise<boolean> {
  const token = await accessToken();
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: start,
      timeMax: end,
      timeZone: timezone,
      items: [{ id: calendarId() }],
    }),
  });
  if (!res.ok) return true; // fail open — better to attempt the booking
  const fb = (await res.json()) as {
    calendars: Record<string, { busy: { start: string; end: string }[] }>;
  };
  const busy = fb.calendars[calendarId()]?.busy ?? [];
  return busy.length === 0;
}
