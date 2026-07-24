// Centralized, server-only environment access. Throws early with a clear
// message if a required var is missing — better than a vague runtime null.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  tenant: optional("TENANT", "elenos"),
  tenantCacheTtlMs: optional("TENANT_CACHE_TTL_MS", "60000"),
  publicBaseUrl: optional("PUBLIC_BASE_URL"),
  vapiServerSecret: optional("VAPI_SERVER_SECRET"),

  // Anthropic
  anthropicApiKey: () => required("ANTHROPIC_API_KEY"),
  llmModel: optional("LLM_MODEL", "claude-haiku-4-5"),
  summaryModel: optional("SUMMARY_MODEL", "claude-sonnet-4-6"),

  // Vapi
  vapiApiKey: () => required("VAPI_API_KEY"),
  vapiAssistantId: optional("VAPI_ASSISTANT_ID"),
  vapiPhoneNumberId: optional("VAPI_PHONE_NUMBER_ID"),

  // Supabase
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  // Publishable key — used only server-side for portal magic-link auth.
  supabaseAnonKey: () => required("SUPABASE_ANON_KEY"),
  // Postgres schema the Scarlett data tables live in. "public" for a
  // standalone project; set to "scarlett" when co-locating in the Elenos
  // database so its tables never mix with the CRM/portal tables. Lazy (a
  // getter) so tsx scripts that load .env.local after imports still see it.
  supabaseSchema: () => optional("SUPABASE_DB_SCHEMA", "public"),

  // Google Calendar
  googleClientEmail: () => required("GOOGLE_CLIENT_EMAIL"),
  googlePrivateKey: () => required("GOOGLE_PRIVATE_KEY"),
  googleCalendarId: optional("GOOGLE_CALENDAR_ID", "primary"),

  // Twilio
  twilioAccountSid: () => required("TWILIO_ACCOUNT_SID"),
  twilioAuthToken: () => required("TWILIO_AUTH_TOKEN"),
  twilioPhoneNumber: optional("TWILIO_PHONE_NUMBER"),

  // Notifications (dev fallback only — production values live per-tenant in
  // the tenants table; see lib/context.ts settingsFromEnv)
  founderCell: optional("FOUNDER_CELL"),
  founderNumbers: optional("FOUNDER_NUMBERS"),
  discordWebhookUrl: optional("DISCORD_WEBHOOK_URL"),

  // Admin dashboard (/admin)
  adminPassword: optional("ADMIN_PASSWORD"),
  adminSessionSecret: optional("ADMIN_SESSION_SECRET"),
};

// Resolve an "env:VAR_NAME" indirection used in tenant config (e.g. transfer
// target). Returns the literal string if it isn't an env indirection.
export function resolveEnvRef(value: string | null | undefined): string {
  if (!value) return "";
  if (value.startsWith("env:")) return process.env[value.slice(4)] ?? "";
  return value;
}
