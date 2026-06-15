// Notifications: Discord webhook (summaries + leads) and Twilio SMS (hot/urgent).
// Both are best-effort and never throw into the call path.

import twilio from "twilio";
import { env } from "./env";

export async function postDiscord(opts: {
  title: string;
  description: string;
  fields?: { name: string; value: string }[];
  // Elenos accent color #a200ff
  color?: number;
}): Promise<void> {
  const url = env.discordWebhookUrl;
  if (!url) return;
  try {
    await fetch(url, {
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

// Alert the founder on a hot lead / urgent matter via both channels.
export async function alertFounder(opts: {
  title: string;
  summary: string;
  fields?: { name: string; value: string }[];
  smsBody?: string;
}): Promise<void> {
  await Promise.all([
    postDiscord({
      title: opts.title,
      description: opts.summary,
      fields: opts.fields,
    }),
    opts.smsBody ? sendSms(env.founderCell, opts.smsBody) : Promise.resolve(),
  ]);
}
