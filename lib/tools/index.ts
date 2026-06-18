// Provider-independent tool layer. Defined once here as strict JSON schemas +
// handlers. The /api/llm proxy advertises these to Claude; the /api/tools route
// dispatches Vapi tool-call webhooks to the handlers. The same definitions feed
// the Vapi provisioning script. This is the durable, replicable core — it does
// not change when the voice platform changes.

import type { TenantConfig, ToolContext, ToolResult } from "../types";
import { checkAvailability } from "./checkAvailability";
import { bookDiscoveryCall } from "./bookDiscoveryCall";
import { captureLead } from "./captureLead";
import { bookJob } from "./bookJob";
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
    name: "book_discovery_call",
    description:
      "Book the discovery call onto the calendar. Only call this AFTER reading the phone, email, and chosen time back to the caller and getting confirmation. slot_start must be one of the ISO times returned by check_availability.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Caller's full name" },
        phone: { type: "string", description: "Caller's phone number" },
        email: { type: "string", description: "Caller's email address" },
        slot_start: {
          type: "string",
          description:
            "ISO 8601 start time of the chosen slot, exactly as returned by check_availability",
        },
      },
      required: ["name", "slot_start"],
      additionalProperties: false,
    },
    handler: bookDiscoveryCall,
    audience: "client",
    enabledFor: (t) => t.booking.discoveryCall.enabled,
  },
  {
    name: "capture_lead",
    description:
      "Save the caller's details when they aren't ready to book, ask something you can't fully help with, or it's a time-sensitive matter after hours. Read contact details back before calling. Set qualified=true if they described a real need and a budget signal.",
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
  // NOTE: real call transfer is handled by Vapi's native `transferCall` tool
  // (configured in scripts/provision-assistant.ts and advertised to the model in
  // lib/llm-handler.ts) — NOT a server tool here, because only Vapi can bridge a
  // live PSTN call. Our endpoint just passes the transferCall tool-call through.

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
