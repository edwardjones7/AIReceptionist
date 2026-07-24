// Anthropic token-cost accounting. Server-only. Prices are USD per million
// tokens (see the claude-api skill): Haiku 4.5 for live turns, Sonnet 4.6 for
// the after-call summary. Cache read ≈ 0.1×, 5-minute cache write ≈ 1.25×.

import { db } from "./supabase";

interface Rate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// $ / 1M tokens.
const RATES: Record<string, Rate> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
};

// Unknown models fall back to Haiku pricing — cost is an estimate, not billing.
const FALLBACK = RATES["claude-haiku-4-5"];

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function llmCostCents(model: string, u: LlmUsage): number {
  const r = RATES[model] ?? FALLBACK;
  const dollars =
    (u.inputTokens * r.input +
      u.outputTokens * r.output +
      u.cacheReadTokens * r.cacheRead +
      u.cacheWriteTokens * r.cacheWrite) /
    1_000_000;
  return dollars * 100; // fractional cents
}

// Best-effort — a logging failure must never break a call (CLAUDE.md rule).
export async function recordLlmUsage(row: {
  tenantId: string;
  vapiCallId: string | null;
  model: string;
  kind: "live" | "summary";
  usage: LlmUsage;
}): Promise<void> {
  try {
    await db().from("llm_usage").insert({
      tenant_id: row.tenantId,
      vapi_call_id: row.vapiCallId,
      model: row.model,
      kind: row.kind,
      input_tokens: Math.round(row.usage.inputTokens),
      output_tokens: Math.round(row.usage.outputTokens),
      cache_read_tokens: Math.round(row.usage.cacheReadTokens),
      cache_write_tokens: Math.round(row.usage.cacheWriteTokens),
      cost_cents: llmCostCents(row.model, row.usage),
    });
  } catch (e) {
    console.error("recordLlmUsage failed", e);
  }
}
