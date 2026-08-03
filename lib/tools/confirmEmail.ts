import { parseSpokenEmail } from "../email/spoken";
import { setVerifiedEmail } from "../email/verified-store";
import type { ToolContext, ToolResult } from "../types";

// Puts the deterministic parser in the loop DURING the call rather than only at
// booking time. The model passes through what it heard, verbatim, and gets back
// the exact sentence to say. That removes the model's freelancing — the
// inconsistent "M as in Mary" / "M as in Matthew" phonetics and the spoken word
// "space" that made a 7-minute demo call go sideways.
//
// The returned `message` has to carry its own instructions: app/api/tools/route
// forwards only this string to the model, so anything not in it is lost.

// Three tries before giving up, not two. The cap exists so a caller isn't stuck
// in a loop — but hitting it costs a booking, so it should be genuinely last
// resort. Most of what used to trip it was the parser rejecting "jim at gmail";
// that's fixed, and the extra attempt buys margin for the rest.
const MAX_ATTEMPTS = 4;

export async function confirmEmail(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const heard = String(input.heard ?? "").trim();
  const attempt = Number(input.attempt ?? 1) || 1;

  if (!heard) {
    return {
      message:
        'I did not receive anything to check. Ask once, plainly: "What\'s the best email for that invite?" — then call confirm_email again with exactly what you hear.',
      isError: true,
    };
  }

  const parsed = parseSpokenEmail(heard);

  // Cap the loop. Going around a third time reads as broken to the caller and
  // burns the goodwill that got them to book in the first place.
  if (!parsed.valid && attempt >= MAX_ATTEMPTS) {
    return {
      message:
        "STOP asking for the email — the line clearly isn't carrying it. Do NOT ask again. " +
        'Say EXACTLY: "Let\'s not fight the phone line on this — I\'ll text you, just reply with your email ' +
        'and I\'ll hold that time for you." Then call capture_lead with the name, the time they picked, ' +
        "and everything else you have. Tell them the time is held and they will get a text — do not imply they are fully booked.",
      data: { valid: false, attempt, raw: parsed.raw, capped: true },
      isError: true,
    };
  }

  if (!parsed.valid) {
    return {
      message:
        `NOT A VALID EMAIL (heard: "${parsed.raw}"). Do NOT call book_discovery_call or capture_lead with it. ` +
        'Ask for ONE piece only — say EXACTLY: "I didn\'t quite catch that one — what\'s the part before the at sign?" ' +
        `Then call confirm_email again with attempt ${attempt + 1}.`,
      data: { valid: false, attempt, raw: parsed.raw },
      isError: true,
    };
  }

  // Valid from here down. Remember it so book_discovery_call can prefer the
  // confirmed address over whatever the model retypes later in the call.
  setVerifiedEmail(ctx.vapiCallId, parsed.email);

  const say = (line: string) =>
    `Parsed: ${parsed.email} — VALID. Say EXACTLY this and nothing else, then STOP and wait for their answer: "${line}"`;

  // Ambiguity the caller has to settle — a spoken "junior" could be jr or the
  // whole word, and guessing is what sent an invite into the void last time.
  const ambiguity = parsed.alternatives?.[0];
  if (ambiguity?.reason === "junior" || ambiguity?.reason === "senior") {
    const short = ambiguity.reason === "junior" ? "j r" : "s r";
    const long = ambiguity.reason;
    return {
      message:
        say(
          `Let me read that back — ${parsed.spellback}. One check: is that ${short} on the end, or the whole word ${long}?`,
        ) +
        ` If they pick the other one, call confirm_email again with attempt ${attempt + 1} and their correction.`,
      data: { ...toData(parsed), attempt },
    };
  }

  if (parsed.correctedDomain) {
    const sld = parsed.correctedDomain.to.split(".")[0];
    return {
      message:
        `Parsed: ${parsed.email} — VALID, but I corrected the domain (${parsed.correctedDomain.from} → ${parsed.correctedDomain.to}), so confirm it as a CLOSED question. ` +
        `Say EXACTLY this and nothing else, then STOP and wait: "Let me read that back — ${parsed.spellback}. That's ${sld}, right?"`,
      data: { ...toData(parsed), attempt },
    };
  }

  return {
    message:
      say(`Let me read that back — ${parsed.spellback}. Did I get it?`) +
      " If they say yes, call book_discovery_call immediately in that same turn with this exact address." +
      ` If they correct anything, call confirm_email again with attempt ${attempt + 1}.`,
    data: { ...toData(parsed), attempt },
  };
}

function toData(parsed: ReturnType<typeof parseSpokenEmail>): Record<string, unknown> {
  return {
    email: parsed.email,
    valid: parsed.valid,
    spellback: parsed.spellback,
    confidence: parsed.confidence,
    correctedDomain: parsed.correctedDomain ?? null,
    alternatives: parsed.alternatives ?? null,
    raw: parsed.raw,
  };
}
