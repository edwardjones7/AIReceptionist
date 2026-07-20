// Vapi API client — assistant + phone-number CRUD, and the assistant payload
// builder (single source of truth; the provision script and the dashboard both
// use it). Vapi's schema evolves; confirm fields against docs when they drift.

import twilio from "twilio";
import { env } from "./env";
import { toolsForTenant } from "./tools";
import { firstMessage } from "./personas/scarlett";
import type { TenantConfig } from "./types";

const VAPI_BASE = "https://api.vapi.ai";

async function vapiFetch<T>(
  path: string,
  init: { method: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${VAPI_BASE}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${env.vapiApiKey()}`,
      "Content-Type": "application/json",
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Vapi ${init.method} ${path} failed: ${res.status} ${text}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

// The custom-LLM URL the assistant calls. The token rides in the URL because
// Vapi doesn't reliably forward the secret header there. Single source of
// truth — buildAssistantPayload writes it, preflight verifies against it.
export function llmUrl(baseUrl: string, secret: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return secret
    ? `${base}/api/llm?token=${encodeURIComponent(secret)}`
    : `${base}/api/llm`;
}

export function webhookUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/vapi/webhook`;
}

// Per-tenant TTS voice. `version: 2` is a vapi-provider-only field.
function buildVoice(config: TenantConfig): Record<string, unknown> {
  const provider = config.voice.provider ?? "vapi";
  const voiceId = config.voice.voiceId ?? "Savannah";
  return {
    provider,
    voiceId,
    ...(provider === "vapi" ? { version: 2 } : {}),
  };
}

// Build the full Vapi assistant payload from a tenant config. Everything the
// assistant needs lives here: custom-LLM URL, tools, webhook, voice, STT.
export function buildAssistantPayload(
  config: TenantConfig,
  opts: { baseUrl: string; secret: string; llmModel: string },
): Record<string, unknown> {
  const base = opts.baseUrl.replace(/\/$/, "");
  const tools: unknown[] = toolsForTenant(config).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
    server: {
      url: `${base}/api/tools`,
      ...(opts.secret ? { secret: opts.secret } : {}),
    },
  }));

  return {
    name: `${config.agentName} — ${config.displayName}`,
    // Secondary tenant-resolution key + debugging aid (primary is the
    // assistant id ↔ tenants.vapi_assistant_id lookup).
    metadata: { tenantId: config.id },
    // Model-generated first line so the greeting adapts per caller (founder
    // gets a personal briefing; everyone else the standard line, pinned in the
    // prompt). firstMessage stays as a fallback.
    firstMessageMode: "assistant-speaks-first-with-model-generated-message",
    firstMessage: firstMessage(config),
    // Custom LLM points back at our proxy (which injects the persona prompt).
    // Vapi doesn't reliably forward the secret header to this URL, so the
    // credential rides in the URL itself — verifyVapiSecret accepts ?token=.
    model: {
      provider: "custom-llm",
      url: llmUrl(base, opts.secret),
      model: opts.llmModel,
      tools,
    },
    transcriber: {
      provider: "deepgram",
      model: "nova-3",
      language: "en",
    },
    voice: buildVoice(config),
    server: {
      url: webhookUrl(base),
      ...(opts.secret ? { secret: opts.secret } : {}),
    },
    serverMessages: ["end-of-call-report"],
    // Live call control → monitor.controlUrl on tool-call webhooks — required
    // for the transfer_call handler to bridge the call.
    monitorPlan: { controlEnabled: true, listenEnabled: true },
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 1800,
  };
}

export async function createAssistant(
  payload: Record<string, unknown>,
): Promise<{ id: string }> {
  return vapiFetch<{ id: string }>("/assistant", { method: "POST", body: payload });
}

export interface AssistantSnapshot {
  id: string;
  model?: { url?: string };
  server?: { url?: string };
}

export async function getAssistant(id: string): Promise<AssistantSnapshot> {
  return vapiFetch<AssistantSnapshot>(`/assistant/${id}`, { method: "GET" });
}

export async function updateAssistant(
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await vapiFetch(`/assistant/${id}`, { method: "PATCH", body: payload });
}

export async function deleteAssistant(id: string): Promise<void> {
  await vapiFetch(`/assistant/${id}`, { method: "DELETE" });
}

// Free Vapi-provided number (US only) — the zero-friction demo path.
// Vapi requires numberDesiredAreaCode (or a sipUri); callers must supply one
// (lib/provision.ts derives it from the tenant's numbers when blank).
export async function createVapiFreeNumber(opts: {
  assistantId: string;
  areaCode: string;
}): Promise<{ id: string; number: string }> {
  return vapiFetch<{ id: string; number: string }>("/phone-number", {
    method: "POST",
    body: {
      provider: "vapi",
      assistantId: opts.assistantId,
      numberDesiredAreaCode: opts.areaCode,
    },
  });
}

// Buy a number on the shared Twilio account (search by area code, then purchase).
export async function buyTwilioNumber(opts: {
  areaCode?: string;
}): Promise<{ e164: string }> {
  const client = twilio(env.twilioAccountSid(), env.twilioAuthToken());
  const available = await client.availablePhoneNumbers("US").local.list({
    ...(opts.areaCode ? { areaCode: Number(opts.areaCode) } : {}),
    limit: 1,
  });
  if (available.length === 0) {
    throw new Error(
      `No Twilio numbers available${opts.areaCode ? ` in area code ${opts.areaCode}` : ""}.`,
    );
  }
  const purchased = await client.incomingPhoneNumbers.create({
    phoneNumber: available[0].phoneNumber,
  });
  return { e164: purchased.phoneNumber };
}

// Register a Twilio number on Vapi and point it at the assistant.
export async function importTwilioNumber(opts: {
  e164: string;
  assistantId: string;
}): Promise<{ id: string; number: string }> {
  return vapiFetch<{ id: string; number: string }>("/phone-number", {
    method: "POST",
    body: {
      provider: "twilio",
      number: opts.e164,
      twilioAccountSid: env.twilioAccountSid(),
      twilioAuthToken: env.twilioAuthToken(),
      assistantId: opts.assistantId,
    },
  });
}

export async function releaseNumber(vapiPhoneNumberId: string): Promise<void> {
  await vapiFetch(`/phone-number/${vapiPhoneNumberId}`, { method: "DELETE" });
}
