# Scarlett — Elenos AI Voice Receptionist

A 24/7 AI phone receptionist. Answers questions, books discovery calls, captures
leads, and routes to a human — on a real phone number. Built single-tenant for
Elenos, architected to become a productized offering for other service businesses
(a second client = a new config file + a re-run of one script).

**Operators, not chatbots.**

---

## Architecture

```
Caller ──PSTN──► Twilio number ──► Vapi (STT · turn-taking · TTS)
                                     └─ custom LLM ──► /api/llm  (Claude Haiku 4.5, Scarlett prompt, prompt-cached)
                                          tool calls ──► /api/tools  (book / lead / transfer)
                                     end-of-call    ──► /api/vapi/webhook  (Sonnet summary → Discord)
                                                          └─► Supabase · Google Calendar · Twilio SMS
```

- **Vapi** owns the hard real-time audio problem (turn-taking, barge-in, latency).
- **This app** owns everything that makes Scarlett *Scarlett*: the prompt, the
  tools, the data. That keeps the whole thing portable off Vapi later.
- **Claude Haiku 4.5** runs live turns (fast, cheap); **Sonnet 4.6** runs the
  offline after-call summary.

| File | Role |
|---|---|
| `config/elenos.tenant.json` | The business — knowledge, hours, pricing rules, FAQ. The replicability seam. |
| `lib/personas/scarlett.ts` | Scarlett's behavior (constant across tenants) + injected tenant knowledge. |
| `lib/tools/*` | Provider-independent tools: `check_availability`, `book_discovery_call`, `capture_lead`, `book_job` (dormant), `transfer_to_human`. |
| `lib/anthropic.ts` | OpenAI ↔ Anthropic translation + streaming. |
| `app/api/llm` | Custom-LLM proxy Vapi calls each turn. |
| `app/api/tools` | Executes tool calls Vapi dispatches. |
| `app/api/vapi/webhook` | Call lifecycle → summary + notifications. |
| `supabase/schema.sql` | `tenants / calls / transcripts / leads / bookings / transfers` (+ RLS). |
| `scripts/provision-assistant.ts` | Create/update the Vapi assistant from a tenant config. |

---

## Setup

### 0. Install

```bash
npm install
cp .env.example .env.local   # then fill it in (see below)
```

### 1. Accounts & keys (Phase 0)

You need accounts and keys for: **Anthropic**, **Vapi**, **Supabase**, **Twilio**
(number + SMS), **Deepgram**, **ElevenLabs**, **Google Cloud** (Calendar API), and a
**Discord** webhook. Put them all in `.env.local` per `.env.example`.

### 2. Supabase

Create a project, then run `supabase/schema.sql` in the SQL editor. Copy the
project URL and the **service-role** key into `.env.local`.

### 3. Google Calendar

1. In Google Cloud: create a project, **enable the Google Calendar API**, create a
   **service account**, and download its JSON key.
2. Put `client_email` → `GOOGLE_CLIENT_EMAIL` and `private_key` → `GOOGLE_PRIVATE_KEY`
   (keep the `\n` escapes) in `.env.local`.
3. In Google Calendar, **share the founder's calendar** with the service-account
   email, permission **"Make changes to events."** Set `GOOGLE_CALENDAR_ID` to that
   calendar's address (e.g. `edjjones07@gmail.com`).

### 4. Twilio

Buy a local number. Put the SID/auth token and the number (E.164) in `.env.local`.
Set `FOUNDER_CELL` to the cell that should receive SMS alerts and call transfers.

### 5. Deploy

Deploy to Vercel (or any Node host). Set all `.env.local` vars as project env vars.
Set `PUBLIC_BASE_URL` to the deployed URL. Generate a long random
`VAPI_SERVER_SECRET`.

> Local testing: run `npm run dev` and expose it with a tunnel (e.g. `ngrok http 3000`),
> then set `PUBLIC_BASE_URL` to the tunnel URL.

### 6. Provision the Vapi assistant

```bash
npm run provision
```

This creates the assistant pointing its custom-LLM, tools, and webhook back at
your `PUBLIC_BASE_URL`. Then in the **Vapi dashboard**:

- Set the ElevenLabs **voiceId** on the assistant (the script leaves a placeholder).
  Pick a warm female voice for Scarlett.
- **Import your Twilio number** into Vapi and attach it to this assistant.
- Confirm the assistant's **server secret** matches `VAPI_SERVER_SECRET` so our
  endpoints authenticate Vapi's requests.

Copy the printed assistant id into `VAPI_ASSISTANT_ID` (re-running `provision`
then updates in place).

---

## Call transfer (read this)

`transfer_to_human` logs the request, alerts the founder, and — in business hours —
returns the founder's cell as a transfer destination. **To make Vapi actually
bridge the call**, finalize one of these in the Vapi dashboard, since live call
control is Vapi-side:

- Add Vapi's native **`transferCall`** tool with the founder's cell as a
  destination, gated by the same conditions; or
- Set a `forwardingPhoneNumber` on the assistant.

v1 is AI-only by design: after hours, `transfer_to_human` captures a callback and
SMS-alerts the founder instead of transferring. The hook is the seam where a live
human takes over later.

---

## Verify (end-to-end)

1. **Live call** — dial the number. Scarlett answers on-brand, answers "what does
   Elenos do / how is it different / what does it cost," declines to quote a firm
   price, and offers the discovery call.
2. **Booking** — ask to book. She offers real open slots, reads details back, books
   → the event appears on the founder's Google Calendar and a row lands in
   `bookings`. Discord + SMS fire.
3. **Lead capture** — give a not-ready / out-of-scope scenario → row in `leads`,
   Discord post (and SMS if marked qualified).
4. **Transfer** — say "I need a person." In hours → forwards to cell (once Vapi
   transfer is wired). After hours → callback captured + SMS.
5. **After-call** — hang up → `calls` row has a summary + outcome; Discord summary
   posts.
6. **Replicability** — add `config/acme.tenant.json`, run `TENANT=acme npm run provision`
   → a new assistant with no code changes.

`npm run typecheck` before deploying.

---

## Cost (low volume)

Marginal ≈ **$0.10–0.15/min** (Vapi + Deepgram + ElevenLabs + Twilio inbound +
Claude Haiku, prompt-cached). Fixed ≈ $1–2/mo. All-in ≈ **$12–17/mo at 100 min**,
**$32–47/mo at 300 min**, plus a few cents per call for the summary.

---

## Adding a second client (the productization play)

1. Copy `config/elenos.tenant.json` → `config/<client>.tenant.json` and fill in
   their knowledge, hours, pricing rules, FAQ, transfer number.
2. To enable on-site job booking (trades clients), set `booking.job.enabled = true`
   and add `jobTypes`. The `book_job` tool turns on automatically.
3. `INSERT` the tenant row in Supabase (or extend the seed).
4. `TENANT=<client> npm run provision`, attach their number, set their voice.

Same backend, same code. New file, new number.
