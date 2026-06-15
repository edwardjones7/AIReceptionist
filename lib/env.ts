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

  // Google Calendar
  googleClientEmail: () => required("GOOGLE_CLIENT_EMAIL"),
  googlePrivateKey: () => required("GOOGLE_PRIVATE_KEY"),
  googleCalendarId: optional("GOOGLE_CALENDAR_ID", "primary"),

  // Twilio
  twilioAccountSid: () => required("TWILIO_ACCOUNT_SID"),
  twilioAuthToken: () => required("TWILIO_AUTH_TOKEN"),
  twilioPhoneNumber: optional("TWILIO_PHONE_NUMBER"),

  // Notifications
  founderCell: optional("FOUNDER_CELL"),
  discordWebhookUrl: optional("DISCORD_WEBHOOK_URL"),
};

// Resolve an "env:VAR_NAME" indirection used in tenant config (e.g. transfer
// target). Returns the literal string if it isn't an env indirection.
export function resolveEnvRef(value: string | null | undefined): string {
  if (!value) return "";
  if (value.startsWith("env:")) return process.env[value.slice(4)] ?? "";
  return value;
}
