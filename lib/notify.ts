// Notifications: Discord webhook (summaries + leads) and Telnyx SMS (owner
// alerts + caller booking confirmations). Both are best-effort and never throw
// into the call path.
//
// Destinations are per-tenant (settings on the tenants row); only the Telnyx
// sending credentials/number stay global.

import { env } from "./env";
import type { TenantSettings, ToolContext } from "./types";

export async function postDiscord(
  webhookUrl: string,
  opts: {
    title: string;
    description: string;
    fields?: { name: string; value: string }[];
    color?: number;
  },
): Promise<void> {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: opts.title,
            description: opts.description,
            color: opts.color ?? 0xa200ff,
            fields: opts.fields ?? [],
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
  } catch (e) {
    console.error("postDiscord failed", e);
  }
}

/**
 * Send an SMS via Telnyx.
 *
 * Silently no-ops without a from-number so a missing env var can never break a
 * live call — but that also means a misconfiguration looks like success. A
 * non-2xx from Telnyx is logged with the body, since carrier-level rejections
 * (unregistered 10DLC campaign, blocked destination) only show up there.
 */
export async function sendSms(to: string, body: string): Promise<void> {
  if (!to || !env.telnyxPhoneNumber) return;
  try {
    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.telnyxApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.telnyxPhoneNumber,
        to,
        text: body,
        ...(env.telnyxMessagingProfileId
          ? { messaging_profile_id: env.telnyxMessagingProfileId }
          : {}),
      }),
    });
    if (!res.ok) {
      console.error("sendSms failed", res.status, await res.text().catch(() => ""));
    }
  } catch (e) {
    console.error("sendSms failed", e);
  }
}

/**
 * Text the CALLER on the number they rang in from (as opposed to alertOwner,
 * which texts the business).
 *
 * Every booking path should end with one of these: it gives the caller a
 * written record of what was agreed, and — critically — puts any address we
 * captured in front of them while they can still correct it. Replies come back
 * through /api/sms/inbound.
 *
 * No-ops when there's no caller ID, or when the caller IS the owner (founder
 * mode testing), so it can be called unconditionally.
 */
export async function textCaller(ctx: ToolContext, body: string): Promise<void> {
  const to = (ctx.callerNumber ?? "").trim();
  if (!to || to === ctx.settings.notifyPhone) return;
  await sendSms(to, body);
}

// Alert the tenant's owner on a hot lead / urgent matter via both channels.
export async function alertOwner(
  settings: TenantSettings,
  opts: {
    title: string;
    summary: string;
    fields?: { name: string; value: string }[];
    smsBody?: string;
  },
): Promise<void> {
  await Promise.all([
    postDiscord(settings.discordWebhookUrl, {
      title: opts.title,
      description: opts.summary,
      fields: opts.fields,
    }),
    opts.smsBody ? sendSms(settings.notifyPhone, opts.smsBody) : Promise.resolve(),
  ]);
}
