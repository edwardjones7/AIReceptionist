// Vapi API client — assistant + phone-number CRUD, and the assistant payload
// builder (single source of truth; the provision script and the dashboard both
// use it). Vapi's schema evolves; confirm fields against docs when they drift.

import twilio from "twilio";
import { env } from "./env";
import { provisionTools } from "./tools";
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

// Vapi does not reliably forward the server.secret HEADER to any of our
// endpoints (custom-LLM, tools, webhook), so the credential rides in the URL
// as ?token= — verifyVapiSecret accepts it from the query string. These three
// helpers are the single source of truth: buildAssistantPayload writes them,
// preflight verifies the live assistant against them.
function withToken(url: string, secret: string): string {
  return secret ? `${url}?token=${encodeURIComponent(secret)}` : url;
}

export function llmUrl(baseUrl: string, secret: string): string {
  return withToken(`${baseUrl.replace(/\/$/, "")}/api/llm`, secret);
}

export function toolsUrl(baseUrl: string, secret: string): string {
  return withToken(`${baseUrl.replace(/\/$/, "")}/api/tools`, secret);
}

export function webhookUrl(baseUrl: string, secret: string): string {
  return withToken(`${baseUrl.replace(/\/$/, "")}/api/vapi/webhook`, secret);
}

// Vapi runs an analysis pass after every call at no extra cost. We ask it to
// extract a lead classification into `analysis.structuredData` — this is "the
// AI deciding if the caller is a lead" for free, business-agnostic so it works
// for any tenant. The webhook turns a positive result into a leads row.
const LEAD_ANALYSIS_PLAN = {
  structuredDataPlan: {
    enabled: true,
    schema: {
      type: "object",
      properties: {
        isLead: {
          type: "boolean",
          description:
            "True if the caller is a potential customer/prospect for the business — asked about services, pricing, or expressed interest — even if they also booked a call. False for wrong numbers, spam, the business's own staff, or existing customers with support-only issues.",
        },
        qualified: {
          type: "boolean",
          description:
            "True if the caller showed strong intent: booked a call, described a concrete need with a budget or timeline, or asked to be contacted.",
        },
        name: { type: "string", description: "Caller's name if given, else empty string." },
        contact: {
          type: "string",
          description: "Best phone number or email the caller provided, else empty string.",
        },
        intent: {
          type: "string",
          description:
            "Short phrase of what the caller wants, e.g. 'website for auto detailing business'. Empty string if not a lead.",
        },
      },
      required: ["isLead", "qualified", "intent"],
    },
  },
};

// Deepgram nova-3 keyterm prompting, aimed squarely at email dictation.
//
// Boosts WORDS, so it helps with domains, separators and phonetic alphabet
// words — it does nothing for b/d/e/g/p/t/v/z confusion over an 8 kHz phone
// line, which is why the parser and the confirm_email loop carry more weight.
// Deliberately excludes bare "at" and single letters: boosting common function
// words causes over-triggering across the whole call.
const EMAIL_KEYTERMS = [
  // domains and their bare second-level labels
  "gmail.com", "gmail", "yahoo.com", "yahoo", "outlook.com", "outlook",
  "hotmail.com", "hotmail", "icloud.com", "icloud", "aol.com", "aol",
  "comcast.net", "verizon.net", "protonmail.com", "me.com", "live.com",
  "msn.com", "sbcglobal.net", "att.net", "ymail.com",
  // TLDs as spoken
  "dot com", "dot net", "dot org", "dot co", "dot io", "dot ai", "dot us",
  // separators and dictation hints (multi-word forms only)
  "at sign", "at symbol", "underscore", "hyphen", "dash", "period", "plus sign",
  "all one word", "no spaces", "all lowercase", "capital",
  // NATO — callers reach for it under pressure
  "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
  "india", "juliet", "kilo", "lima", "november", "oscar", "papa", "quebec",
  "romeo", "sierra", "tango", "uniform", "victor", "whiskey", "x-ray", "yankee",
  "zulu",
  // name suffixes — the exact word that got dropped on 2026-07-31
  "junior", "senior",
];

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
  const tools: unknown[] = provisionTools().map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
    server: {
      url: toolsUrl(base, opts.secret),
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
      // nova-3 + en only. Never send `keywords` alongside this.
      keyterm: EMAIL_KEYTERMS,
      // ms of silence before Deepgram finalizes an utterance. The default (~10)
      // chops a spelled-out address into separate transcripts.
      endpointing: 300,
      // Turn off provider-side "helpfulness" — normalization is ours, in
      // lib/email/spoken.ts, where it's deterministic and unit-tested.
      // smartFormat adds punctuation that corrupts letter runs ("M.A.T.T.");
      // numerals rewrites "to"→2 / "for"→4 / "ate"→8.
      smartFormat: false,
      numerals: false,
      // Pinned at Vapi's default ON PURPOSE. Raising it looks like a quality
      // knob but silently DROPS dictated letters, which score low by nature.
      confidenceThreshold: 0.4,
    },
    voice: buildVoice(config),
    server: {
      url: webhookUrl(base, opts.secret),
      ...(opts.secret ? { secret: opts.secret } : {}),
    },
    serverMessages: ["end-of-call-report"],
    // Free post-call lead classification (→ analysis.structuredData in the
    // end-of-call-report; the webhook writes a leads row from it).
    analysisPlan: LEAD_ANALYSIS_PLAN,
    // Live call control → monitor.controlUrl on tool-call webhooks — required
    // for the transfer_call handler to bridge the call.
    monitorPlan: { controlEnabled: true, listenEnabled: true },
    // Krisp-based removal of background speech (car, shop, TV). Biggest
    // single-line transcript-quality win for callers on mobile.
    backgroundSpeechDenoisingPlan: { smartDenoisingPlan: { enabled: true } },
    // When to start talking. People pause BETWEEN LETTERS when spelling; the
    // stock ~0.4s endpointing fires into those gaps and the assistant ends up
    // answering half an address. That is the most likely reason a "j r" suffix
    // went missing on the 2026-07-31 demo call.
    startSpeakingPlan: {
      waitSeconds: 0.6,
      smartEndpointingPlan: { provider: "livekit", waitFunction: "700 + 4000 * x" },
      transcriptionEndpointingPlan: {
        onPunctuationSeconds: 0.3,
        onNoPunctuationSeconds: 1.8, // spelling has no punctuation
        onNumberSeconds: 0.7,
      },
      // These override the smart plan when they match — most specific first.
      customEndpointingRules: [
        // We just asked them to spell something: be very patient.
        {
          type: "assistant",
          regex: "spell|letter by letter|one letter at a time|part before the at sign",
          regexOptions: [{ type: "ignore-case", enabled: true }],
          timeoutSeconds: 4.5,
        },
        // The caller is visibly mid-spelling — transcript ends in a run of
        // single letters. This is the rule that would have saved that call.
        {
          type: "customer",
          regex: "(\\b[a-z]\\b[ ,.]+){2,}\\b[a-z]\\b[ ,.]*$",
          regexOptions: [{ type: "ignore-case", enabled: true }],
          timeoutSeconds: 4.0,
        },
        // They've said "at" and haven't reached the domain yet.
        {
          type: "customer",
          regex: "\\b(at|at sign|at symbol|@)\\s*$",
          regexOptions: [{ type: "ignore-case", enabled: true }],
          timeoutSeconds: 3.0,
        },
        // We asked for an email at all.
        {
          type: "assistant",
          regex: "e-?mail|email address|best email|invite to",
          regexOptions: [{ type: "ignore-case", enabled: true }],
          timeoutSeconds: 3.0,
        },
      ],
    },
    // When to shut up. numWords/voiceSeconds match Vapi's defaults — barge-in
    // was already on when she talked over "Hold on. Pause." The real cause was
    // 30-second turns (a 300ms cut-off still leaves 29 seconds of wrong), which
    // the prompt's one-sentence rule fixes. Pinned here so they're explicit,
    // and backoff is raised: after "you got it wrong" the caller keeps going.
    stopSpeakingPlan: {
      numWords: 0,
      voiceSeconds: 0.2,
      backoffSeconds: 1.4,
      interruptionPhrases: [
        "hold on", "hang on", "wait", "stop", "pause", "no", "nope",
        "that's wrong", "you got it wrong", "not right", "incorrect",
      ],
      acknowledgementPhrases: [
        "okay", "ok", "yeah", "yep", "uh huh", "mm hmm", "got it", "right",
      ],
    },
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

export interface VapiCall {
  id: string;
  assistantId?: string;
  status?: string;
  endedReason?: string;
  startedAt?: string;
  endedAt?: string;
  cost?: number;
  recordingUrl?: string;
  transcript?: string;
  summary?: string;
  customer?: { number?: string };
  analysis?: {
    summary?: string;
    successEvaluation?: string;
    structuredData?: Record<string, unknown>;
  };
  artifact?: {
    transcript?: string;
    recordingUrl?: string;
    // Signed, temporary, browser-playable recording URLs (raw recordingUrl is
    // a private bucket that 400s). These expire ~1h after they're minted.
    presignedMonoUrl?: string;
    presignedStereoUrl?: string;
  };
}

export async function getVapiCall(id: string): Promise<VapiCall> {
  return vapiFetch<VapiCall>(`/call/${id}`, { method: "GET" });
}

// A fresh, browser-playable recording URL for a call. Minted per request
// because it expires — never store it. Returns null if there's no recording.
export async function getCallRecordingUrl(
  vapiCallId: string,
): Promise<string | null> {
  try {
    const call = await getVapiCall(vapiCallId);
    return (
      call.artifact?.presignedMonoUrl ?? call.artifact?.presignedStereoUrl ?? null
    );
  } catch {
    return null;
  }
}

// Recent calls for an assistant, newest first. Vapi returns full call objects
// (transcript + analysis included), so the reconcile path needs no per-call
// follow-up fetch.
export async function listVapiCalls(opts: {
  assistantId: string;
  limit?: number;
}): Promise<VapiCall[]> {
  const q = new URLSearchParams({
    assistantId: opts.assistantId,
    limit: String(opts.limit ?? 20),
  });
  return vapiFetch<VapiCall[]>(`/call?${q.toString()}`, { method: "GET" });
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
