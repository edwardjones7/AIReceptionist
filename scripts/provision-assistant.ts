// Provision (create or update) the Vapi assistant for a tenant from its config.
// Run: npm run provision   (reads .env.local)
//
// This is the "spin up a client" script — the replicability seam. A second
// client is a new config/<id>.tenant.json + a re-run of this script with
// TENANT=<id>. Vapi's assistant schema evolves; treat this payload as a strong
// starting point and confirm fields against the Vapi dashboard/docs.

import "dotenv/config";
import { loadTenant } from "../lib/context";
import { toolsForTenant } from "../lib/tools";
import { firstMessage } from "../lib/personas/scarlett";

const VAPI_BASE = "https://api.vapi.ai";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function main() {
  const tenant = loadTenant();
  const apiKey = need("VAPI_API_KEY");
  const base = need("PUBLIC_BASE_URL").replace(/\/$/, "");
  const secret = process.env.VAPI_SERVER_SECRET ?? "";
  const llmModel = process.env.LLM_MODEL ?? "claude-haiku-4-5";

  const tools = toolsForTenant(tenant).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
    server: {
      url: `${base}/api/tools`,
      ...(secret ? { secret } : {}),
    },
  }));

  const assistant = {
    name: `${tenant.agentName} — ${tenant.displayName}`,
    firstMessage: firstMessage(tenant),
    // Custom LLM points back at our proxy (which injects Scarlett's prompt).
    model: {
      provider: "custom-llm",
      url: `${base}/api/llm`,
      model: llmModel,
      tools,
    },
    // Deepgram Nova-3 for STT.
    transcriber: {
      provider: "deepgram",
      model: "nova-3",
      language: "en",
    },
    // ElevenLabs for Scarlett's voice. Replace voiceId with a chosen voice.
    voice: {
      provider: "11labs",
      voiceId: "REPLACE_WITH_ELEVENLABS_VOICE_ID",
      model: "eleven_turbo_v2_5",
    },
    // Lifecycle webhook → our summary/notify route.
    server: {
      url: `${base}/api/vapi/webhook`,
      ...(secret ? { secret } : {}),
    },
    serverMessages: ["end-of-call-report"],
    // Keep responses snappy; tune endpointing later.
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 1800,
  };

  const existingId = process.env.VAPI_ASSISTANT_ID;
  const url = existingId
    ? `${VAPI_BASE}/assistant/${existingId}`
    : `${VAPI_BASE}/assistant`;
  const method = existingId ? "PATCH" : "POST";

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(assistant),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`Vapi ${method} failed: ${res.status}`);
    console.error(text);
    process.exit(1);
  }

  const data = JSON.parse(text) as { id: string };
  console.log(`✅ Assistant ${existingId ? "updated" : "created"}: ${data.id}`);
  if (!existingId) {
    console.log(`\nAdd to .env.local:\n  VAPI_ASSISTANT_ID=${data.id}`);
    console.log(
      `\nNext: attach a phone number to this assistant in the Vapi dashboard,\n` +
        `set the ElevenLabs voiceId, and place a test call.`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
