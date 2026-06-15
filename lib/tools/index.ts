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
import { transferToHuman } from "./transferToHuman";

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema (OpenAI "function.parameters" shape)
  handler: (
    input: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<ToolResult>;
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
    enabledFor: (t) => t.booking.job.enabled, // dormant for Elenos
  },
  {
    name: "transfer_to_human",
    description:
      "Connect the caller to a person. Only call this when the caller explicitly asks for a human, or you genuinely cannot help and it's time-sensitive. After hours this captures a callback instead of transferring.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "One line on why a person is needed",
        },
        summary: {
          type: "string",
          description: "Short summary of the conversation so far",
        },
      },
      required: ["reason"],
      additionalProperties: false,
    },
    handler: transferToHuman,
    enabledFor: (t) => t.transfer.enabled,
  },
];

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
