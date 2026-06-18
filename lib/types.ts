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
  };
}

// ── Tool input/result types (provider-independent core) ──

export interface ToolContext {
  tenant: TenantConfig;
  callId?: string; // our internal calls.id, if known
  vapiCallId?: string;
  callerNumber?: string;
  isFounder?: boolean; // true when the caller is recognized as the founder/internal
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
