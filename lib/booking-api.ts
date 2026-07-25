// Client for an external booking backend (a tenant's own /book API). Matches
// the site's contract: GET /api/booking/slots/ → { slots: [ISO] } and
// POST /api/booking/ → { ok, booking } (409 if the slot was just taken). When
// a tenant sets booking.discoveryCall.api.baseUrl, Scarlett books through this
// instead of writing Google Calendar directly, so a voice booking is identical
// to a web booking (same confirmation email, Meet link, and invite).

function base(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

export async function fetchExternalSlots(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${base(baseUrl)}/api/booking/slots/`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`booking slots ${res.status}`);
  const data = (await res.json()) as { slots?: string[] };
  return data.slots ?? [];
}

export interface ExternalBookResult {
  ok: boolean;
  conflict?: boolean; // the slot was taken between offer and confirm (409)
  booking?: Record<string, unknown>;
  error?: string;
}

export async function createExternalBooking(
  baseUrl: string,
  p: {
    name: string;
    email: string;
    company?: string;
    message?: string;
    slot: string; // ISO, one of the values from fetchExternalSlots
    timezone: string;
  },
): Promise<ExternalBookResult> {
  try {
    const res = await fetch(`${base(baseUrl)}/api/booking/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        name: p.name,
        email: p.email,
        company: p.company ?? "",
        message: p.message ?? "",
        slot: p.slot,
        timezone: p.timezone,
        source_path: "/scarlett",
        // Anti-bot fields the web form sends: empty honeypot, plausible dwell.
        _gotcha: "",
        form_ms: 20000,
      }),
    });
    if (res.status === 409) return { ok: false, conflict: true };
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      booking?: Record<string, unknown>;
      error?: string;
    };
    if (res.ok && body.ok) return { ok: true, booking: body.booking };
    return { ok: false, error: body.error ?? `booking ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
