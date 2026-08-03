// Inbound SMS from Telnyx.
//
// This exists so the booking-confirmation text is a real conversation and not a
// broadcast: when a caller replies "actually it's mattmanzijr@gmail.com", that
// correction has to reach a human. Without this route the reply lands on the
// Telnyx number and nobody ever sees it.
//
// Point the Telnyx messaging profile's webhook at:
//   <PUBLIC_BASE_URL>/api/sms/inbound

import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { env } from "@/lib/env";
import { postDiscord, sendSms } from "@/lib/notify";
import { resolveTenant } from "@/lib/context";

export const runtime = "nodejs";

// Telnyx signs `${timestamp}|${rawBody}` with Ed25519 and hands out the public
// key as raw base64. Node needs SPKI DER, which for Ed25519 is a fixed 12-byte
// prefix followed by the 32 key bytes.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const MAX_SKEW_SECONDS = 300;

function verifyTelnyxSignature(raw: string, signature: string, timestamp: string): boolean {
  const pub = env.telnyxPublicKey;
  if (!pub) {
    // Fail closed: an unverified public endpoint that can trigger outbound SMS
    // is not something to leave open because a config value is missing.
    console.error("TELNYX_PUBLIC_KEY unset — rejecting inbound SMS webhook");
    return false;
  }
  if (!signature || !timestamp) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_SKEW_SECONDS) return false;

  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pub, "base64")]),
      format: "der",
      type: "spki",
    });
    return crypto.verify(
      null,
      Buffer.from(`${timestamp}|${raw}`, "utf8"),
      key,
      Buffer.from(signature, "base64"),
    );
  } catch (e) {
    console.error("telnyx signature verification failed", e);
    return false;
  }
}

interface TelnyxWebhook {
  data?: {
    event_type?: string;
    payload?: {
      direction?: string;
      text?: string;
      from?: { phone_number?: string };
      to?: { phone_number?: string }[];
    };
  };
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  const ok = verifyTelnyxSignature(
    raw,
    req.headers.get("telnyx-signature-ed25519") ?? "",
    req.headers.get("telnyx-timestamp") ?? "",
  );
  if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  let body: TelnyxWebhook;
  try {
    body = JSON.parse(raw) as TelnyxWebhook;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const payload = body.data?.payload;
  // Only inbound messages matter — delivery receipts fire on this hook too.
  if (body.data?.event_type !== "message.received" || payload?.direction !== "inbound") {
    return NextResponse.json({ ok: true });
  }

  const from = payload.from?.phone_number ?? "unknown";
  const text = (payload.text ?? "").trim();

  // Fall back to env-derived settings when the tenant can't be resolved — this
  // path must never drop a customer's correction on the floor.
  let settings;
  try {
    settings = (await resolveTenant({})).settings;
  } catch (e) {
    console.error("inbound sms: tenant resolve failed", e);
  }

  await postDiscord(settings?.discordWebhookUrl ?? env.discordWebhookUrl, {
    title: "💬 SMS reply",
    description: text || "(empty message)",
    fields: [{ name: "From", value: from }],
  });

  const notify = settings?.notifyPhone || env.founderCell;
  if (notify) await sendSms(notify, `💬 SMS from ${from}: ${text}`);

  return NextResponse.json({ ok: true });
}
