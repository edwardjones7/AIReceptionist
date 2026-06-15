// Server-only Supabase client using the service-role key (bypasses RLS).
// Never import this into a client component.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  client = createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

// Best-effort logging helpers. These never throw — a logging failure must not
// break a live call. They swallow and console.error instead.

export async function logTranscript(
  callId: string,
  role: string,
  text: string,
): Promise<void> {
  try {
    await db().from("transcripts").insert({ call_id: callId, role, text });
  } catch (e) {
    console.error("logTranscript failed", e);
  }
}

export async function upsertCallByVapiId(
  tenantId: string,
  vapiCallId: string,
  fields: Record<string, unknown>,
): Promise<string | null> {
  try {
    const { data, error } = await db()
      .from("calls")
      .upsert(
        { tenant_id: tenantId, vapi_call_id: vapiCallId, ...fields },
        { onConflict: "vapi_call_id" },
      )
      .select("id")
      .single();
    if (error) throw error;
    return data?.id ?? null;
  } catch (e) {
    console.error("upsertCallByVapiId failed", e);
    return null;
  }
}
