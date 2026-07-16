// Notifications: Discord webhook (summaries + leads) and Twilio SMS (hot/urgent).
// Both are best-effort and never throw into the call path.
//
// Destinations are per-tenant (settings on the tenants row); only the Twilio
// sending credentials/number stay global.

import twilio from "twilio";
import { env } from "./env";
import type { TenantSettings } from "./types";

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

export async function sendSms(to: string, body: string): Promise<void> {
  if (!to || !env.twilioPhoneNumber) return;
  try {
    const client = twilio(env.twilioAccountSid(), env.twilioAuthToken());
    await client.messages.create({
      to,
      from: env.twilioPhoneNumber,
      body,
    });
  } catch (e) {
    console.error("sendSms failed", e);
  }
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
