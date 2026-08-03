// Provider-independent tool layer. Defined once here as strict JSON schemas +
// handlers. The /api/llm proxy advertises these to Claude; the /api/tools route
// dispatches Vapi tool-call webhooks to the handlers. The same definitions feed
// the Vapi provisioning script. This is the durable, replicable core — it does
// not change when the voice platform changes.

import type { TenantConfig, ToolContext, ToolResult } from "../types";
import { checkAvailability } from "./checkAvailability";
import { confirmEmail } from "./confirmEmail";
import { bookDiscoveryCall } from "./bookDiscoveryCall";
import { captureLead } from "./captureLead";
import { bookJob } from "./bookJob";
import { transferCall } from "./transferCall";
import { getStatsTool } from "./getStats";
import { getRecentLeadsTool } from "./getRecentLeads";
import { getRecentCallsTool } from "./getRecentCalls";
import { getUpcomingBookingsTool } from "./getUpcomingBookings";
import { getScheduleTool } from "./getSchedule";

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema (OpenAI "function.parameters" shape)
  handler: (
    input: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<ToolResult>;
  // "client" tools are offered to outside callers; "founder" tools (read-only
  // reporting) are offered only when the caller is recognized as the founder.
  audience: "client" | "founder";
  // If false for the active tenant, the tool is not advertised to the model.
  enabledFor: (t: TenantConfig) => boolean;
}

export const TOOLS: ToolDef[] = [
  {
    name: "check_availability",
    description:
      "Find open times for the discovery call. Call this after you have the caller's name and they want to book. Returns a few spoken time options to offer.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    handler: checkAvailability,
    audience: "client",
    enabledFor: (t) => t.booking.discoveryCall.enabled,
  },
  {
    name: "confirm_email",
    description:
      "Normalize an email the caller just said and get back the EXACT words to read to them. Call this the moment you hear an email, and again after every correction — always before book_discovery_call or capture_lead. Read the returned line back VERBATIM. Never invent your own spelling or 'as in' words.",
    parameters: {
      type: "object",
      properties: {
        heard: {
          type: "string",
          description:
            "Exactly what you heard, verbatim — including 'at', 'dot', any letters they spelled out, and any 'as in' words. Do NOT clean it up, fix it, or guess.",
        },
        attempt: {
          type: "integer",
          description: "1 on the first try, 2 after one correction, 3 after two.",
        },
      },
      required: ["heard"],
      additionalProperties: false,
    },
    handler: confirmEmail,
    audience: "client",
    enabledFor: () => true,
  },
  {
    name: "book_discovery_call",
    description:
      "Book the discovery call onto the calendar. Only call this AFTER confirm_email has come back valid AND the caller has agreed to the read-back. slot_start must be one of the ISO times returned by check_availability.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Caller's full name" },
        phone: { type: "string", description: "Caller's phone number" },
        email: {
          type: "string",
          description:
            "The EXACT address confirm_email returned — lowercase, no spaces. Do not retype it from memory.",
          pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$",
        },
        slot_start: {
          type: "string",
          description:
            "ISO 8601 start time of the chosen slot, exactly as returned by check_availability",
        },
      },
      required: ["name", "email", "slot_start"],
      additionalProperties: false,
    },
    handler: bookDiscoveryCall,
    audience: "client",
    enabledFor: (t) => t.booking.discoveryCall.enabled,
  },
  {
    name: "capture_lead",
    description:
      "Save the caller's details when they aren't ready to book, ask something you can't fully help with, or it's a time-sensitive matter after hours. If they give an email, run it through confirm_email first and pass the exact address it returned — do not retype it from memory. Read the phone back before calling. Set qualified=true if they described a real need and a budget signal.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        intent: {
          type: "string",
          description: "Short phrase of what they want",
        },
        details: { type: "string", description: "One or two sentences of context" },
        qualified: {
          type: "boolean",
          description: "True if this is a hot/qualified lead",
        },
      },
      required: ["intent"],
      additionalProperties: false,
    },
    handler: captureLead,
    audience: "client",
    enabledFor: () => true,
  },
  {
    name: "book_job",
    description:
      "Book an on-site service job. Collect job type, address, and urgency.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        job_type: { type: "string" },
        address: { type: "string" },
        urgency: {
          type: "string",
          enum: ["emergency", "urgent", "routine"],
        },
        details: { type: "string" },
      },
      required: ["job_type"],
      additionalProperties: false,
    },
    handler: bookJob,
    audience: "client",
    enabledFor: (t) => t.booking.job.enabled, // dormant for Elenos
  },
  {
    name: "transfer_call",
    description:
      "Connect the caller to a live person on the team. Use ONLY when the caller has clearly asked for a real person at least twice or is insistent, OR the matter is genuinely urgent/important and you can't help. Do not offer it proactively — prefer helping, taking their info, or booking the call.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "One short line on why they need a person",
        },
      },
      required: [],
      additionalProperties: false,
    },
    handler: transferCall,
    audience: "client",
    enabledFor: (t) => t.transfer.enabled,
  },

  // ── Founder-mode tools (read-only reporting; offered only to the founder) ──
  {
    name: "get_stats",
    description:
      "Get call/business metrics for a period. Use when the founder asks how things are going, today's or the week's numbers, book rate, etc.",
    parameters: {
      type: "object",
      properties: {
        period: { type: "string", enum: ["today", "week", "month"] },
      },
      required: [],
      additionalProperties: false,
    },
    handler: getStatsTool,
    audience: "founder",
    enabledFor: () => true,
  },
  {
    name: "get_recent_leads",
    description:
      "List the most recent leads with name, intent, and status. Use when the founder asks about recent leads or who's been calling.",
    parameters: {
      type: "object",
      properties: { limit: { type: "integer" } },
      required: [],
      additionalProperties: false,
    },
    handler: getRecentLeadsTool,
    audience: "founder",
    enabledFor: () => true,
  },
  {
    name: "get_recent_calls",
    description:
      "Get summaries of recent calls — what each call was actually about, the outcome, and when. Use when the founder asks what a call/caller was about, what people wanted, or to recap recent calls (not just counts).",
    parameters: {
      type: "object",
      properties: { limit: { type: "integer" } },
      required: [],
      additionalProperties: false,
    },
    handler: getRecentCallsTool,
    audience: "founder",
    enabledFor: () => true,
  },
  {
    name: "get_upcoming_bookings",
    description:
      "List upcoming booked discovery calls (who and when). Use when the founder asks what's on the books or who's booked.",
    parameters: {
      type: "object",
      properties: { limit: { type: "integer" } },
      required: [],
      additionalProperties: false,
    },
    handler: getUpcomingBookingsTool,
    audience: "founder",
    enabledFor: () => true,
  },
  {
    name: "get_schedule",
    description:
      "Read the founder's actual Google Calendar agenda for today or tomorrow. Use when he asks what's on his calendar / schedule.",
    parameters: {
      type: "object",
      properties: { day: { type: "string", enum: ["today", "tomorrow"] } },
      required: [],
      additionalProperties: false,
    },
    handler: getScheduleTool,
    audience: "founder",
    enabledFor: () => true,
  },
];

// Client-facing tools for outside callers.
export function clientToolsFor(t: TenantConfig): ToolDef[] {
  return TOOLS.filter((tool) => tool.audience === "client" && tool.enabledFor(t));
}

// Founder reporting tools (read-only). Offered only when the caller is the founder.
export function founderToolsFor(t: TenantConfig): ToolDef[] {
  return TOOLS.filter((tool) => tool.audience === "founder" && tool.enabledFor(t));
}

// All tools enabled for the tenant — used by the provision script so Vapi can
// dispatch any of them (gating of who's *offered* what happens in /api/llm).
export function toolsForTenant(t: TenantConfig): ToolDef[] {
  return TOOLS.filter((tool) => tool.enabledFor(t));
}

// Every tool, registered on the Vapi assistant regardless of per-tenant
// enablement. Vapi needs a tool registered to know where to dispatch it, so we
// register them all; what Scarlett is actually *offered* on a given call is
// gated live in /api/llm (clientToolsFor/founderToolsFor read the current
// config). This makes ability toggles take effect on the next call — no
// re-provision.
export function provisionTools(): ToolDef[] {
  return TOOLS;
}

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}

// Execute a tool by name with parsed input. Never throws — converts errors into
// a spoken ToolResult so the call keeps going.
export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = findTool(name);
  if (!tool) {
    return { message: `Unknown tool: ${name}`, isError: true };
  }
  try {
    return await tool.handler(input, ctx);
  } catch (e) {
    console.error(`tool ${name} threw`, e);
    return {
      message:
        "Sorry — something went wrong on my end with that. Let me take your details and have someone follow up.",
      isError: true,
    };
  }
}
