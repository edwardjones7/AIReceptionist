// Local test harness — exercise Scarlett's brain WITHOUT Vapi, Twilio, a phone
// number, Supabase, or Google Calendar. Only needs ANTHROPIC_API_KEY.
//
// It talks to the real /api/llm route (so the persona, prompt-cache, tool
// advertising, and OpenAI<->Anthropic streaming are all under test) and STUBS
// tool results locally so multi-turn flows (booking, lead capture) play out.
//
// Usage:
//   1) terminal A:  npm run dev
//   2) terminal B:  npm run test:call
//      (optionally: npm run test:call -- booking   to run one scenario)
//
// Env: ANTHROPIC_API_KEY (in .env.local), optional TEST_BASE_URL
// (default http://localhost:3000), optional VAPI_SERVER_SECRET (sent as header).

import { config } from "dotenv";
config({ path: ".env.local" }); // primary
config(); // .env fallback (does not override already-set vars)

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.VAPI_SERVER_SECRET ?? "";

interface Msg {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

// ── Stubbed tool results (stand in for /api/tools, which needs DB + calendar) ──
function stubToolResult(name: string, args: Record<string, unknown>): string {
  const tz = "America/New_York";
  const friendly = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));

  switch (name) {
    case "check_availability": {
      // Two fake slots a couple days out, on the half hour.
      const base = new Date(Date.now() + 2 * 86_400_000);
      base.setUTCHours(18, 0, 0, 0); // ~2pm ET
      const s1 = new Date(base);
      const s2 = new Date(base.getTime() + 86_400_000 + 90 * 60_000);
      const slots = [s1.toISOString(), s2.toISOString()];
      return (
        "Open times. Offer by friendly time only; book with the matching slot_start exactly:\n" +
        slots.map((s, i) => `${i + 1}) ${friendly(s)} — slot_start=${s}`).join("\n")
      );
    }
    case "book_discovery_call":
      return `Booked for ${friendly(String(args.slot_start))}. Calendar invite sent. (STUB)`;
    case "capture_lead":
      return "Lead saved and the founder was alerted. (STUB)";
    case "transfer_to_human":
      return "After hours — callback captured and the founder was texted. (STUB)";
    case "book_job":
      return "Job request captured. (STUB)";
    default:
      return "OK (STUB)";
  }
}

// Parse the OpenAI-format SSE stream from /api/llm into an assistant message.
async function callLlm(messages: Msg[]): Promise<Msg> {
  const res = await fetch(`${BASE}/api/llm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SECRET ? { "x-vapi-secret": SECRET } : {}),
    },
    body: JSON.stringify({
      model: "scarlett",
      messages,
      call: { id: "test-call-1", customer: { number: "+15555550123" } },
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`/api/llm ${res.status}: ${await res.text()}`);
  }

  let text = "";
  const toolCalls: NonNullable<Msg["tool_calls"]> = [];
  const decoder = new TextDecoder();
  let buffer = "";

  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      const chunk = JSON.parse(data);
      const delta = chunk.choices?.[0]?.delta ?? {};
      if (typeof delta.content === "string") text += delta.content;
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        toolCalls[idx] ??= {
          id: tc.id ?? `call_${idx}`,
          type: "function",
          function: { name: "", arguments: "" },
        };
        if (tc.id) toolCalls[idx].id = tc.id;
        if (tc.function?.name) toolCalls[idx].function.name = tc.function.name;
        if (tc.function?.arguments)
          toolCalls[idx].function.arguments += tc.function.arguments;
      }
    }
  }

  return {
    role: "assistant",
    content: text || null,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
}

// Run one user turn, resolving any tool calls (via stubs) until Scarlett speaks.
async function turn(messages: Msg[], userText: string): Promise<void> {
  console.log(`\n\x1b[36m  Caller:\x1b[0m ${userText}`);
  messages.push({ role: "user", content: userText });

  for (let hop = 0; hop < 5; hop++) {
    const assistant = await callLlm(messages);
    messages.push(assistant);

    if (assistant.content) {
      console.log(`\x1b[35mScarlett:\x1b[0m ${assistant.content}`);
    }
    if (!assistant.tool_calls?.length) return;

    for (const tc of assistant.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        /* ignore */
      }
      console.log(
        `\x1b[33m    ↳ tool: ${tc.function.name}(${JSON.stringify(args)})\x1b[0m`,
      );
      const result = stubToolResult(tc.function.name, args);
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }
  console.log("\x1b[31m  (hit tool-hop cap)\x1b[0m");
}

const SCENARIOS: Record<string, string[]> = {
  info: [
    "Hey, what kind of company is this?",
    "How are you different from a regular web agency?",
    "How much does a website run?",
  ],
  booking: [
    "Hi, I run an electrical company and my website is terrible. Can we talk?",
    "Sure, my name is Mike Sullivan.",
    "Tuesday works.",
    "It's 555-867-5309, and mike at sullivanelectric dot com.",
  ],
  lead: [
    "I'm just shopping around, not ready to book anything yet.",
    "Name's Dana, 555-111-2222. Just send me some info.",
  ],
  human: ["Can I just talk to a real person?"],
};

async function main() {
  const which = process.argv[2];
  const names = which ? [which] : Object.keys(SCENARIOS);
  for (const name of names) {
    const script = SCENARIOS[name];
    if (!script) {
      console.error(`Unknown scenario "${name}". Options: ${Object.keys(SCENARIOS).join(", ")}`);
      process.exit(1);
    }
    console.log(`\n\x1b[1m══ scenario: ${name} ══\x1b[0m`);
    const messages: Msg[] = [];
    for (const userText of script) await turn(messages, userText);
  }
  console.log("\n\x1b[32m✓ done\x1b[0m");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
