// Shared types: the tenant config shape and the DB row shapes.

export interface BusinessHours {
  note?: string;
  mondayToFriday: { open: string; close: string } | null;
  saturday: { open: string; close: string } | null;
  sunday: { open: string; close: string } | null;
}

export interface TenantConfig {
  id: string;
  displayName: string;
  agentName: string;
  agentGender: string;
  founderPreferredName?: string; // what the assistant calls the founder in founder mode
  timezone: string;
  businessHours: BusinessHours;
  transfer: {
    enabled: boolean;
    mode: "cold" | "warm";
    inHoursTarget: string; // may be "env:FOUNDER_CELL"
    rule: string;
    afterHoursBehavior: "capture_callback" | "voicemail";
  };
  booking: {
    discoveryCall: {
      enabled: boolean;
      name: string;
      durationMinutes: number;
      description: string;
      offerWindowDays: number;
      earliestHoursOut: number;
    };
    job: {
      enabled: boolean;
      note?: string;
      jobTypes?: string[];
    };
  };
  knowledge: {
    oneLiner: string;
    whatWeDo: string;
    howDifferent: string;
    whoWeServe: string;
    founder: string;
    services: string[];
    pricing: { rule: string; publicRange?: string; spokenLine: string };
    promiseDiscipline: string;
    cta: string;
    website: string;
  };
  faq: { q: string; a: string }[];
  voice: {
    archetype: string;
    greeting: string;
    forbidden: string[];
    provider?: string; // Vapi TTS provider; defaults to "vapi"
    voiceId?: string; // provider voice id; defaults to "Savannah"
  };
}

// ── Per-tenant integration values (DB columns, not config JSON) ──
// The credentials themselves (Google service account, Twilio, Anthropic) stay
// global; these are the per-client *targets* they act on.

export interface TenantSettings {
  calendarId: string; // Google Calendar id shared with the service account; "" → booking degrades gracefully
  discordWebhookUrl: string; // per-client Discord channel; "" → no Discord posts
  notifyPhone: string; // SMS alert target for hot leads/transfers
  transferNumber: string; // live-transfer destination
  ownerNumbers: string[]; // caller IDs that unlock founder mode
}

// A fully-resolved tenant: config (prompt/behavior) + settings (integrations)
// + provisioning state. This is what resolveTenant/loadTenantById return.
export interface Tenant {
  config: TenantConfig;
  settings: TenantSettings;
  vapiAssistantId: string | null;
  vapiPhoneNumberId: string | null;
  phoneNumber: string | null;
  status: "draft" | "active" | "paused";
}

// ── Tool input/result types (provider-independent core) ──

export interface ToolContext {
  tenant: TenantConfig;
  settings: TenantSettings;
  callId?: string; // our internal calls.id, if known
  vapiCallId?: string;
  callerNumber?: string;
  isFounder?: boolean; // true when the caller is recognized as the founder/internal
  controlUrl?: string; // Vapi live-call control URL (for performing a transfer)
}

export interface ToolResult {
  // Human-readable string spoken back / fed to the model.
  message: string;
  // Optional structured data for logging / Vapi.
  data?: Record<string, unknown>;
  // For transfer: tells Vapi to perform a call transfer.
  transfer?: { destinationNumber: string; mode: "cold" | "warm" };
  isError?: boolean;
}
