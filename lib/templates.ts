// Onboarding templates — statically imported so the bundler always ships them
// (a request-time readdirSync over config/ breaks when the directory isn't in
// the serverless bundle). Adding a template = add the JSON file + one line here.

import { parseTenantConfig } from "./config-schema";
import type { TenantConfig } from "./types";
import elenos from "@/config/elenos.tenant.json";
import trades from "@/config/trades.tenant.json";

const TEMPLATES: Record<string, unknown> = { elenos, trades };

export function templateIds(): string[] {
  return Object.keys(TEMPLATES);
}

// Validates and returns a fresh copy (zod parse clones), so callers can
// mutate the result safely. Throws on unknown id or a template that has
// drifted from the schema.
export function templateConfig(id: string): TenantConfig {
  const raw = TEMPLATES[id];
  if (!raw) throw new Error(`Unknown template "${id}"`);
  return parseTenantConfig(raw);
}
