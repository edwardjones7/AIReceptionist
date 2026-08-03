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

import { parseSpokenEmail } from "../lib/email/spoken";

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
    // NOT a stub — runs the real parser so the confirm→read-back→book loop
    // under test is the one that ships. Mirrors lib/tools/confirmEmail.ts.
    case "confirm_email": {
      const attempt = Number(args.attempt ?? 1) || 1;
      const p = parseSpokenEmail(String(args.heard ?? ""));
      if (!p.valid && attempt >= 3) {
        return "STOP — two corrections is the cap. Say EXACTLY: \"Let's not fight the phone line on this — I'll text you the details and you can send me the right address.\" Then call capture_lead.";
      }
      if (!p.valid) {
        return `NOT A VALID EMAIL (heard: "${p.raw}"). Do NOT call book_discovery_call. Ask for the part before the at sign only, then call confirm_email again with attempt ${attempt + 1}.`;
      }
      const alt = p.alternatives?.[0];
      if (alt?.reason === "junior") {
        return `Parsed: ${p.email} — VALID. Say EXACTLY this and nothing else, then STOP: "Let me read that back — ${p.spellback}. One check: is that j r on the end, or the whole word junior?"`;
      }
      return `Parsed: ${p.email} — VALID. Say EXACTLY this and nothing else, then STOP and wait: "Let me read that back — ${p.spellback}. Did I get it?" If they say yes, call book_discovery_call immediately with this exact address.`;
    }
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
    // founder-mode reporting stubs
    case "get_stats":
      return `${args.period ?? "today"}: 6 calls, 2 booked, 3 leads (2 qualified). Book rate 33%. (STUB)`;
    case "get_recent_leads":
      return "Last 3 leads: Mike Sullivan — new website + AI (qualified, 2h ago); Dana — just shopping (soft, 5h ago); after-hours callback. (STUB)";
    case "get_upcoming_bookings":
      return "2 upcoming: Wave Electrical Thursday at 1:00 PM; ALR Electric Friday at 10:00 AM. (STUB)";
    case "get_schedule":
      return `Your ${args.day ?? "today"}: ALR Electric Discovery Call at 1:00 PM; Internal Systems at 3:00 PM. (STUB)`;
    default:
      return "OK (STUB)";
  }
}

// Caller number for the active scenario (founder scenario overrides this).
let callerNumber = "+15555550123";

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
      call: { id: "test-call-1", customer: { number: callerNumber } },
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
async function turn(
  messages: Msg[],
  userText: string,
  tr?: Transcript,
  turnIndex = 0,
): Promise<void> {
  console.log(`\n\x1b[36m  Caller:\x1b[0m ${userText}`);
  messages.push({ role: "user", content: userText });

  for (let hop = 0; hop < 5; hop++) {
    const assistant = await callLlm(messages);
    messages.push(assistant);

    if (assistant.content) {
      console.log(`\x1b[35mScarlett:\x1b[0m ${assistant.content}`);
      tr?.said.push(assistant.content);
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
      tr?.toolCalls.push({ name: tc.function.name, args, turn: turnIndex });
      const result = stubToolResult(tc.function.name, args);
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }
  console.log("\x1b[31m  (hit tool-hop cap)\x1b[0m");
}

interface Scenario {
  caller?: string; // overrides the caller number (e.g. founder mode)
  lines: string[];
  // Optional post-run assertions over everything that was said and called.
  check?: (t: Transcript) => string[]; // returns failures
}

interface Transcript {
  said: string[];
  toolCalls: { name: string; args: Record<string, unknown>; turn: number }[];
}

const SCENARIOS: Record<string, Scenario> = {
  info: {
    lines: [
      "Hey, what kind of company is this?",
      "How are you different from a regular web agency?",
      "How much does a website run?",
    ],
  },
  booking: {
    lines: [
      "Hi, I run an electrical company and my website is terrible. Can we talk?",
      "Sure, my name is Mike Sullivan.",
      "Tuesday works.",
      "It's 555-867-5309, and mike at sullivanelectric dot com.",
    ],
  },
  lead: {
    lines: [
      "I'm just shopping around, not ready to book anything yet.",
      "Name's Dana, 555-111-2222. Just send me some info.",
    ],
  },
  human: { lines: ["Can I just talk to a real person?"] },
  // Regression test for the 2026-07-31 demo call, where a garbled email loop
  // ended with mattmanzi@gmail.com booked instead of mattmanzijr@gmail.com.
  // Caller lines are the real transcript, mis-transcriptions and all.
  email: {
    lines: [
      "Hi, I run a plumbing and heating company. We miss a ton of calls after hours.",
      "Matt. Matt Manzi.",
      "Tuesday at noon works.",
      "Matt manzie junior at g mail dot com.",
      "No, you got it wrong.",
      "M a t t m a n z i j r at g m a i l dot com",
      "Yeah, that's right.",
    ],
    check: (t) => {
      const fails: string[] = [];
      const bookings = t.toolCalls.filter((c) => c.name === "book_discovery_call");
      const lastConfirm = t.toolCalls.map((c) => c.name).lastIndexOf("confirm_email");

      if (!bookings.length) {
        fails.push("never called book_discovery_call");
      } else {
        const email = String(bookings[bookings.length - 1].args.email ?? "");
        if (email !== "mattmanzijr@gmail.com") {
          fails.push(`booked the wrong address: "${email}" (expected mattmanzijr@gmail.com)`);
        }
        // The booking must come after the final confirmation, not race it.
        const firstBookIdx = t.toolCalls.findIndex((c) => c.name === "book_discovery_call");
        if (firstBookIdx < lastConfirm) {
          fails.push("called book_discovery_call before the final confirm_email");
        }
        if (bookings[0].turn < 6) {
          fails.push(`booked on turn ${bookings[0].turn} — before the caller confirmed`);
        }
      }
      if (!t.toolCalls.some((c) => c.name === "confirm_email")) {
        fails.push("never called confirm_email");
      }
      const invented = t.said.find((s) => /\bas in\b/i.test(s));
      if (invented) fails.push(`invented phonetics: "${invented.slice(0, 80)}"`);
      const space = t.said.find((s) => /\bspace\b/i.test(s));
      if (space) fails.push(`said the word "space": "${space.slice(0, 80)}"`);
      return fails;
    },
  },
  // Founder mode — calls from FOUNDER_CELL; expects an EA-style briefing.
  founder: {
    caller: process.env.FOUNDER_CELL,
    lines: [
      "How'd we do today?",
      "Any new leads?",
      "What's on my calendar today?",
      "Who's booked coming up?",
    ],
  },
};

// A missing or placeholder .env.local surfaces as an opaque 500 from /api/llm
// (the tenant lookup fails first), so check the obvious causes up front.
function preflight(): void {
  const problems: string[] = [];
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  const supabase = process.env.SUPABASE_URL ?? "";

  if (!key) problems.push("ANTHROPIC_API_KEY is not set");
  else if (key.includes("[SENSITIVE]")) problems.push("ANTHROPIC_API_KEY is a redacted placeholder");
  if (supabase && !/^https?:\/\//.test(supabase)) {
    problems.push(`SUPABASE_URL is not a URL ("${supabase.slice(0, 24)}")`);
  }

  if (problems.length) {
    console.error("\n\x1b[31mEnvironment isn't usable:\x1b[0m");
    for (const p of problems) console.error(`  · ${p}`);
    console.error(
      "\nPull real values first:\n" +
        "  npx vercel env pull .env.local --environment=production --yes\n",
    );
    process.exit(1);
  }
}

async function main() {
  preflight();
  const which = process.argv[2];
  const names = which ? [which] : Object.keys(SCENARIOS);
  let failed = false;
  for (const name of names) {
    const scenario = SCENARIOS[name];
    if (!scenario) {
      console.error(`Unknown scenario "${name}". Options: ${Object.keys(SCENARIOS).join(", ")}`);
      process.exit(1);
    }
    callerNumber = scenario.caller || "+15555550123";
    if (name === "founder" && !scenario.caller) {
      console.error("founder scenario needs FOUNDER_CELL set in .env.local");
      process.exit(1);
    }
    console.log(`\n\x1b[1m══ scenario: ${name} (from ${callerNumber}) ══\x1b[0m`);
    const messages: Msg[] = [];
    const tr: Transcript = { said: [], toolCalls: [] };
    for (const [i, userText] of scenario.lines.entries()) {
      await turn(messages, userText, tr, i);
    }

    if (scenario.check) {
      const fails = scenario.check(tr);
      if (fails.length) {
        console.log(`\n\x1b[31m✗ ${name} FAILED\x1b[0m`);
        for (const f of fails) console.log(`\x1b[31m  · ${f}\x1b[0m`);
        failed = true;
      } else {
        console.log(`\n\x1b[32m✓ ${name} assertions passed\x1b[0m`);
      }
    }
  }
  if (failed) {
    console.log("\n\x1b[31m✗ one or more scenarios failed\x1b[0m");
    process.exit(1);
  }
  console.log("\n\x1b[32m✓ done\x1b[0m");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
