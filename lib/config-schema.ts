// Zod schema for TenantConfig — the write-time gate for tenant configs coming
// from the dashboard, seed script, or onboarding. `satisfies z.ZodType<...>`
// keeps it in lockstep with the interface in lib/types.ts: drift is a compile
// error. Runtime call paths use safeParse and never fail a live call on a
// schema nit.

import { z } from "zod";
import type { TenantConfig } from "./types";

const hoursWindow = z.object({
  open: z.string().regex(/^\d{2}:\d{2}$/, "expected HH:mm"),
  close: z.string().regex(/^\d{2}:\d{2}$/, "expected HH:mm"),
});

export const TenantConfigSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, "lowercase slug (a-z, 0-9, -)"),
  displayName: z.string().min(1),
  agentName: z.string().min(1),
  agentGender: z.string(),
  founderPreferredName: z.string().optional(),
  timezone: z.string().min(1),
  businessHours: z.object({
    note: z.string().optional(),
    mondayToFriday: hoursWindow.nullable(),
    saturday: hoursWindow.nullable(),
    sunday: hoursWindow.nullable(),
  }),
  transfer: z.object({
    enabled: z.boolean(),
    mode: z.enum(["cold", "warm"]),
    inHoursTarget: z.string(),
    rule: z.string(),
    afterHoursBehavior: z.enum(["capture_callback", "voicemail"]),
  }),
  booking: z.object({
    discoveryCall: z.object({
      enabled: z.boolean(),
      name: z.string(),
      durationMinutes: z.number().int().positive(),
      description: z.string(),
      offerWindowDays: z.number().int().positive(),
      earliestHoursOut: z.number().nonnegative(),
    }),
    job: z.object({
      enabled: z.boolean(),
      note: z.string().optional(),
      jobTypes: z.array(z.string()).optional(),
    }),
  }),
  knowledge: z.object({
    oneLiner: z.string(),
    whatWeDo: z.string(),
    howDifferent: z.string(),
    whoWeServe: z.string(),
    founder: z.string(),
    services: z.array(z.string()),
    pricing: z.object({
      rule: z.string(),
      publicRange: z.string().optional(),
      spokenLine: z.string(),
    }),
    promiseDiscipline: z.string(),
    cta: z.string(),
    website: z.string(),
  }),
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
  voice: z.object({
    archetype: z.string(),
    greeting: z.string().min(1),
    forbidden: z.array(z.string()),
    provider: z.string().optional(),
    voiceId: z.string().optional(),
  }),
}) satisfies z.ZodType<TenantConfig>;

// Strict parse — throws with readable messages. Use at write time.
export function parseTenantConfig(raw: unknown): TenantConfig {
  const result = TenantConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid tenant config:\n${formatConfigErrors(result.error)}`);
  }
  return result.data;
}

// Lenient parse — returns issues instead of throwing. Use in the dashboard
// editor (show errors) and at runtime (log and continue).
export function safeParseTenantConfig(
  raw: unknown,
): { ok: true; config: TenantConfig } | { ok: false; errors: string[] } {
  const result = TenantConfigSchema.safeParse(raw);
  if (result.success) return { ok: true, config: result.data };
  return { ok: false, errors: formatConfigErrors(result.error).split("\n") };
}

function formatConfigErrors(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}
