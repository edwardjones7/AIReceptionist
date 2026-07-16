# Scarlett — an AI voice receptionist

Scarlett is a 24/7 AI receptionist that lives on a real phone number. She answers
the way a sharp front-desk person would: she knows the business cold, books calls
onto a live calendar, captures leads when a caller isn't ready, and hands off to a
human when it matters. When she hangs up she writes the call up and files it.

She is **one assistant with two minds**. To an outside caller she's the receptionist.
To the founder calling in, she's an in-house chief-of-staff who can read back the
day's numbers, the recent leads, and the calendar — from voice alone. Same brain,
same data, different persona and a different set of tools, chosen the instant the
phone rings based on *who is calling*.

This repo is the reference implementation, deployed for **[Elenos](https://elenos.ai)**
(a software studio). But the interesting part isn't Elenos — it's how Scarlett works.
The whole "personality + knowledge of the business" is data in one JSON file, so the
same engine becomes a different company's receptionist by swapping that file. This
README is about the engine.

**Operators, not chatbots.**

---

## How a call actually works

The hard real-time problem — turning speech into text, taking turns, not talking over
people, sounding human — is handled by **Vapi**, a managed voice platform. Scarlett
(this app) owns everything that makes her *her*: the prompt, the tools, the data, the
memory. That split is deliberate. Vapi is rented; the brain is owned and portable.

```
Caller ──PSTN──► Twilio number ──► Vapi  (speech-to-text · turn-taking · text-to-speech)
                                     │
                  every turn ────────┼──► /api/llm           the brain: persona + Claude, streamed
                  tool calls ────────┼──► /api/tools         the hands: book / capture / report / transfer
                  call ends  ────────┴──► /api/vapi/webhook  the memory: summarize → notify → file
```

Walk one caller through it:

1. **The phone rings.** Vapi answers the audio, transcribes the caller, and for every
   single conversational turn sends the running transcript to **`/api/llm`** — as if
   Scarlett were just another OpenAI-compatible model.

2. **The brain decides who's calling.** `/api/llm` looks at the caller's number. Is it
   the founder, or anyone else? That one fact selects the **persona** and the **toolset**
   for the rest of the call (see [Two personas](#two-personas-one-brain)).

3. **The brain answers.** It builds Scarlett's system prompt, translates the
   conversation into Claude's format, and streams **Claude Haiku 4.5**'s reply back to
   Vapi token by token, so Vapi can start speaking before the sentence is finished.
   Latency is the whole game on a phone call — every part of this path streams.

4. **If she needs to *do* something** — check the calendar, book a slot, save a lead,
   pull today's stats — Claude emits a tool call. Vapi relays it to **`/api/tools`**,
   which runs the matching handler against Google Calendar / Supabase / Twilio and
   returns a short spoken result ("That's booked — Tuesday at 2"). Claude folds the
   result into the conversation and keeps talking.

5. **The caller hangs up.** Vapi fires an end-of-call report at **`/api/vapi/webhook`**.
   A *second*, slower model — **Claude Sonnet 4.6** — reads the full transcript and
   writes a tight factual summary and an outcome label. That gets filed in the database,
   posted to Discord, and (for hot leads or bookings) texted to the founder.

The division of labor between the two models is the point: **Haiku is on the clock**
(fast, cheap, prompt-cached, in the live loop); **Sonnet is off the clock** (smarter,
runs once after hangup where a few seconds doesn't matter).

---

## Two personas, one brain

The same call infrastructure serves two completely different conversations. The fork
happens in `lib/llm-handler.ts` the moment a call connects, keyed on the caller's number
(`lib/founder.ts` normalizes to the last 10 digits and checks it against the founder's
known numbers).

### Client mode — the receptionist

For everyone who isn't the founder. Built by `buildSystemPrompt()` in
`lib/personas/scarlett.ts`.

- **She never volunteers that she's AI.** Asked directly, she gives a light non-answer
  and moves on — "I'm Scarlett, I look after the front desk here. What can I do for you?"
- **Grounded, not generative.** She answers *only* from the tenant's knowledge base
  (what the company does, how it's different, the FAQ). No improvising facts about the
  business, no quoting prices that aren't there.
- **A careful pronoun rule.** She says "*we*" for anything the company or founder does
  (the build, the recommendation, the discovery call) and "*I*" only for her own
  front-desk actions (booking, taking a message, connecting you). She never implies
  she'll personally do the work.
- **A priority order**, in this sequence: answer accurately → book a discovery call if
  the caller's a fit → capture a lead if they're not ready → transfer to a human (rare,
  and gated, see below).
- **Voice is load-bearing.** The persona inherits a brand archetype from config (for
  Elenos: "The Architect" — precise, unhurried, quietly confident) plus a list of
  forbidden tics (no hype, no emoji, no exclamation marks).

### Founder mode — the chief-of-staff

When the founder calls in. Built by `buildFounderPrompt()`.

- **She drops the receptionist act entirely.** No "front desk" framing — she's the
  in-house assistant talking to her boss like a teammate she actually likes.
- **She leads with the numbers.** Before she even speaks, the handler pre-fetches a live
  snapshot — today's and the last 7 days' calls, bookings, leads, qualified leads, book
  rate — and injects it into her context. So her opener is real: *"Hey Ed — quiet so
  far, two calls and one booked. What's up?"* No tool round-trip needed for the greeting.
- **She can pull anything on request** via a set of read-only reporting tools (stats,
  recent calls with their AI summaries, recent leads, upcoming bookings, the founder's
  actual Google Calendar for today/tomorrow).
- **She's scoped differently.** A client call is constrained to booking/leads/transfer.
  A founder call can go anywhere he takes it.

Crucially, **the toolsets don't overlap**. In client mode she's offered booking,
lead-capture, and transfer — never the reporting tools. In founder mode she's offered
reporting — never client booking or transfer. The persona and its tools are chosen
together, so she can't accidentally read the founder his own stats or try to "book" a
caller into the reporting layer.

---

## The hands: the tool layer

Tools are how Scarlett affects the world. They live in `lib/tools/`, defined **once** as
a declarative registry (JSON schema + handler + audience + per-tenant enablement) and
fed to three places that must always agree: `/api/llm` (advertises them to Claude),
`/api/tools` (executes them), and the provisioning script (registers them on Vapi).
Edit one file, all three stay in sync.

Two iron rules: **a tool never throws into the live call** (handlers catch everything and
return a spoken message — a failed booking becomes "let me take your details instead,"
never dead air), and **notifications are best-effort** (a Discord outage can't drop a
call).

### Client tools

| Tool | What she does | Notable behavior |
|---|---|---|
| `check_availability` | Finds open discovery-call slots | Queries Google Calendar free/busy, generates candidate slots inside business hours, returns 3 — reads the friendly times aloud, keeps the ISO timestamps for booking |
| `book_discovery_call` | Books the call | Re-checks the slot is *still* free, creates the calendar event, writes a `bookings` row, texts the founder. If the calendar write fails, it **falls back to capturing a lead** so the caller is never lost |
| `capture_lead` | Saves a caller who isn't ready | Hot (qualified) leads → Discord **and** SMS to the founder; soft leads → Discord only |
| `transferCall` | Hands the live call to a human | Vapi-native (only the audio platform can bridge a PSTN call). Only offered **in business hours**; after hours she captures a callback instead |
| `book_job` | Books an on-site service job | **Dormant** — a template for trades clients (plumbers, electricians). Off for Elenos; flip one config flag to enable per tenant |

### Founder tools (read-only)

`get_stats` (today/week/month), `get_recent_calls` (with the Sonnet summaries),
`get_recent_leads`, `get_upcoming_bookings`, and `get_schedule` (the founder's real
Google Calendar). All read straight from Supabase / Google with no side effects — she
can report, but in founder mode she can't change anything.

### Business hours gate everything time-sensitive

`isWithinBusinessHours()` (`lib/context.ts`) converts "now" into the tenant's timezone
with no external dependencies and checks it against configured open/close windows. It's
what decides whether a transfer bridges a live human or politely takes a callback.

---

## The brain in detail: prompt, translation, streaming

A few things make the live loop fast and cheap. They all live in `lib/anthropic.ts` and
`lib/llm-handler.ts`.

**Vapi speaks OpenAI; Claude speaks Anthropic.** `toAnthropicMessages()` translates the
conversation each turn: it drops Vapi's system messages (Scarlett injects her own),
rewrites assistant tool-calls into Anthropic `tool_use` blocks, merges consecutive tool
results into a single user turn (an Anthropic requirement), and prepends a synthetic
`(Call connected.)` when the transcript opens with Scarlett rather than the caller.
`streamClaudeAsOpenAI()` does the reverse on the way out, re-emitting Claude's stream as
OpenAI server-sent-event chunks — including streaming tool-call arguments — so Vapi
never waits on a full response.

**The system prompt is split for caching.** Claude's prompt caching only helps if the
prefix is byte-stable, so the prompt is built in two blocks:

- a **stable** block — Scarlett's persona rules, the tenant's knowledge and FAQ, the
  tool definitions — marked with a cache breakpoint;
- a **volatile** block — the current time, the caller's number, the founder's live stats
  snapshot — appended *after* the breakpoint.

Put a timestamp in the stable block and you'd bust the cache every turn. Keeping the
volatile bits separate means the expensive prefix is cached across turns and across
calls — which is most of why a live minute stays cheap.

**Graceful failure.** If Claude errors mid-turn, the stream doesn't crash — it emits a
spoken "I'm having trouble, can you say that again?" so the call survives.

---

## The memory: what survives a call

Everything is persisted to Supabase, multi-tenant from row one (every record carries a
`tenant_id`; row-level security denies everyone except the service-role backend). The
schema is in `supabase/schema.sql`.

| Table | Holds |
|---|---|
| `tenants` | One row per business — number, assistant id, hours |
| `calls` | One per call — caller, timing, duration, **outcome**, the Sonnet **summary**, recording URL, cost |
| `transcripts` | The full turn-by-turn conversation, for replay and audit |
| `leads` | Captured callers — intent, details, and a `qualified` flag that decides hot vs. soft alerting |
| `bookings` | Discovery calls (and jobs), linked to the Google Calendar event id |
| `transfers` | Every handoff or after-hours callback, with the reason |

This table is also what founder mode reads back over the phone. The loop closes: a client
call writes a `calls`/`leads`/`bookings` row → the webhook summarizes it → the founder
calls later and Scarlett reads him the result. The database *is* her memory.

**Notifications** (`lib/notify.ts`) ride on top: `postDiscord()` for call summaries and
soft leads, `sendSms()` via Twilio for anything urgent, and `alertFounder()` which fires
both. All best-effort, all wrapped so they can't break a call.

---

## The replicability seam

Scarlett isn't hardcoded to Elenos. *Who she is* lives in
`config/<tenant>.tenant.json` — agent name, timezone, business hours, transfer rules,
booking settings, the entire knowledge base, the FAQ, and the voice archetype with its
forbidden phrases. `lib/personas/scarlett.ts` holds her *behavior* (constant across every
tenant); the config holds her *knowledge* (different per tenant). The persona reads the
config; no business facts are baked into code.

So standing up a second business is data, not engineering. The primary path is the
dashboard — no code, no deploys:

1. **`/admin` → New tenant.** Pick a template (`elenos` for consultative businesses,
   `trades` for job-booking businesses — `booking.job.enabled` activates the `book_job`
   tool), fill in the name, timezone, voice id, and integration targets.
2. **Review the config** on the Config tab; edit knowledge, FAQ, hours, transfer rules.
3. **Run preflight** on the Overview tab — it verifies the config schema, calendar
   sharing, the Discord webhook, and phone targets before anything goes live.
4. **Provision.** One click creates the Vapi assistant *and* the phone number — a free
   Vapi number for demos, or an automated Twilio purchase + import for production
   (optional area code). Voice comes from `config.voice.voiceId` (default Savannah);
   changing it requires a re-provision.

The CLI path still works: new `config/<client>.tenant.json` (register it in
`lib/templates.ts` if it should appear in the dashboard template picker), then
`npm run seed -- <client>` and `npm run provision -- <client>`.

Same code, same backend. New row, new number, new receptionist.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Voice platform | **Vapi** | Managed STT, turn-taking, TTS, telephony — the real-time audio problem |
| Live model | **Claude Haiku 4.5** | Every turn — fast, cheap, prompt-cached |
| Summary model | **Claude Sonnet 4.6** | Once, after hangup — smarter, off the latency path |
| App / host | **Next.js** on **Vercel** | API routes own the brain; trivially portable |
| Data | **Supabase** (Postgres + RLS) | Multi-tenant store and Scarlett's memory |
| Calendar | **Google Calendar** (service account) | Direct booking, no middleman |
| Telephony | **Twilio** | Inbound number + SMS alerts |
| Alerts | **Discord** + **Twilio SMS** | Summaries and leads to Discord; hot/urgent by text |

LLM access is the Anthropic SDK only, both ways through `lib/anthropic.ts`.

---

## Running it

```bash
npm install
cp .env.example .env.local   # fill in keys (see below)
npm run dev                  # local; pair with a tunnel and set PUBLIC_BASE_URL
npm run typecheck            # tsc --noEmit — run before committing
npm run build                # next build
npm run provision            # create/update the Vapi assistant from the tenant config
```

**Required keys:** `ANTHROPIC_API_KEY`, `VAPI_API_KEY`, `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY` (keep the `\n`
escapes), `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`.
**Common optional:** `TENANT` (default `elenos`), `PUBLIC_BASE_URL`, `VAPI_SERVER_SECRET`,
`FOUNDER_CELL`, `DISCORD_WEBHOOK_URL`, `GOOGLE_CALENDAR_ID`, `LLM_MODEL`, `SUMMARY_MODEL`.
All env access goes through `lib/env.ts` — don't read `process.env` directly.

**First-time setup, in order:**

1. **Supabase** — create a project, run `supabase/schema.sql` in the SQL editor, copy the
   URL and **service-role** key.
2. **Google Calendar** — create a project, enable the Calendar API, create a service
   account, download its JSON key. Share the founder's calendar with the service-account
   email ("Make changes to events"), and set `GOOGLE_CALENDAR_ID` to that calendar.
3. **Twilio** — set the SID/token and `TWILIO_PHONE_NUMBER` (SMS sender), plus
   `FOUNDER_CELL` for alerts and transfers. Number *purchase* is automated at provision
   time — you don't buy numbers by hand.
4. **Deploy** to Vercel (or any Node host); set every env var; set `PUBLIC_BASE_URL` to
   the deployed URL; generate a long random `VAPI_SERVER_SECRET`. (Local: tunnel
   `npm run dev` with ngrok and point `PUBLIC_BASE_URL` at the tunnel.) In production the
   API routes **fail closed** without `VAPI_SERVER_SECRET` — it is not optional there.
5. **Provision** — from `/admin` (preflight + one click) or `npm run provision -- <id>`.
   This creates the assistant (voice from `config.voice.voiceId`), acquires and attaches
   the phone number (Vapi free or Twilio buy+import), and wires the secret: header on
   tool/webhook calls, `?token=` on the custom-LLM URL (Vapi doesn't reliably forward
   the header there). Re-running updates in place.

> **Upgrading from soft LLM auth:** `/api/llm` now rejects unauthenticated requests.
> After deploying, re-provision every active tenant so their assistants pick up the
> token-bearing custom-LLM URL — until then live calls will get 401s.

---

## Verifying end to end

1. **Call the number.** She answers on-brand, fields "what do you do / how are you
   different / what does it cost," declines to quote a firm price, and offers the call.
2. **Book.** She offers real open slots, reads the details back, and books — the event
   lands on the calendar, a `bookings` row appears, Discord and SMS fire.
3. **Leave a not-ready scenario.** A `leads` row appears; Discord posts (plus SMS if
   qualified).
4. **Ask for a person.** In hours → it forwards; after hours → callback captured + SMS.
5. **Hang up.** The `calls` row gets a summary and outcome; the Discord summary posts.
6. **Call as the founder.** She greets you with today's numbers and can read back recent
   calls, leads, and the calendar on request.
7. **Replicate.** `/admin` → New tenant → trades template → preflight → provision — a
   new assistant and number, no code changes, no deploys.

Run `npm run typecheck` before deploying.

---

## Notes and honest edges

- **Vapi's wire contract** (custom-LLM auth, tool-call field names, native transfer)
  varies by version. The routes parse the common shapes defensively; expect minor
  finalizing against a live assistant.
- **Live transfer is Vapi-side.** `transferCall` is advertised and logged here, but the
  actual call-bridging happens in Vapi via its native transfer or a
  `forwardingPhoneNumber`. v1 is AI-first by design.
- **Cost** at low volume is roughly **$0.10–0.15/min** marginal (Vapi + speech + Twilio
  inbound + prompt-cached Haiku) plus a few cents per call for the Sonnet summary — call
  it **$12–17/mo at 100 minutes**.
- `lib/*` is **server-only** (it holds secrets and the service-role DB client) — never
  import it into a client component.
