// Provisioning orchestration — the "spin up a client" seam, callable from the
// dashboard (server action) or the CLI. Idempotent state machine driven by the
// tenants row: each step persists its result immediately, so a mid-flight
// failure resumes where it left off and never double-buys a number.

import { env } from "./env";
import { db } from "./supabase";
import { invalidateTenantCache } from "./context";
import { parseTenantConfig } from "./config-schema";
import {
  buildAssistantPayload,
  createAssistant,
  updateAssistant,
  deleteAssistant,
  createVapiFreeNumber,
  buyTwilioNumber,
  importTwilioNumber,
  releaseNumber,
} from "./vapi";

export interface ProvisionResult {
  tenantId: string;
  assistantId: string;
  assistantCreated: boolean; // false → existing assistant was PATCHed
  phoneNumber: string | null;
  numberCreated: boolean;
}

async function getRow(tenantId: string) {
  const { data, error } = await db()
    .from("tenants")
    .select("id, config, vapi_assistant_id, vapi_phone_number_id, phone_number, transfer_number, notify_phone")
    .eq("id", tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No tenants row for "${tenantId}" — seed or create it first.`);
  return data as {
    id: string;
    config: unknown;
    vapi_assistant_id: string | null;
    vapi_phone_number_id: string | null;
    phone_number: string | null;
    transfer_number: string | null;
    notify_phone: string | null;
  };
}

// Vapi's free-number endpoint requires a desired area code. When the operator
// leaves it blank, borrow the area code from the tenant's transfer/notify
// number (US E.164) so the receptionist's number looks local to the business.
function deriveAreaCode(...numbers: (string | null)[]): string | undefined {
  for (const n of numbers) {
    const m = /^\+1(\d{3})\d{7}$/.exec((n ?? "").trim());
    if (m) return m[1];
  }
  return undefined;
}

async function persist(tenantId: string, fields: Record<string, unknown>) {
  const { error } = await db()
    .from("tenants")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", tenantId);
  if (error) throw error;
  invalidateTenantCache(tenantId);
}

export async function provisionTenant(
  tenantId: string,
  opts: { numberProvider?: "vapi" | "twilio"; areaCode?: string } = {},
): Promise<ProvisionResult> {
  const baseUrl = env.publicBaseUrl;
  if (!baseUrl) throw new Error("PUBLIC_BASE_URL must be set to provision.");

  const row = await getRow(tenantId);
  if (!row.config) throw new Error(`Tenant "${tenantId}" has no config to provision from.`);
  const config = parseTenantConfig(row.config); // strict — bad config must not reach Vapi

  const payload = buildAssistantPayload(config, {
    baseUrl,
    secret: env.vapiServerSecret,
    llmModel: env.llmModel,
  });

  // Step 1: assistant (PATCH if we already have one).
  let assistantId = row.vapi_assistant_id;
  let assistantCreated = false;
  if (assistantId) {
    await updateAssistant(assistantId, payload);
  } else {
    const created = await createAssistant(payload);
    assistantId = created.id;
    assistantCreated = true;
    await persist(tenantId, { vapi_assistant_id: assistantId });
  }

  // Step 2: phone number (skip if one is already attached).
  let phoneNumber = row.phone_number;
  let numberCreated = false;
  if (!row.vapi_phone_number_id) {
    const provider = opts.numberProvider ?? "vapi";
    let vapiNumber: { id: string; number: string };
    if (provider === "twilio") {
      const bought = await buyTwilioNumber({ areaCode: opts.areaCode });
      vapiNumber = await importTwilioNumber({ e164: bought.e164, assistantId });
    } else {
      const areaCode =
        opts.areaCode ?? deriveAreaCode(row.transfer_number, row.notify_phone);
      if (!areaCode) {
        throw new Error(
          "Vapi free numbers need an area code — fill in the Area code field (or set a transfer/notify number to derive it from).",
        );
      }
      vapiNumber = await createVapiFreeNumber({ assistantId, areaCode });
    }
    phoneNumber = vapiNumber.number;
    numberCreated = true;
    await persist(tenantId, {
      vapi_phone_number_id: vapiNumber.id,
      phone_number: vapiNumber.number,
    });
  }

  // Step 3: live.
  await persist(tenantId, { status: "active" });

  return { tenantId, assistantId, assistantCreated, phoneNumber, numberCreated };
}

// Release the number + delete the assistant; keep the row and all call/lead
// data. status → paused. Re-provisioning later creates fresh Vapi resources.
export async function deprovisionTenant(tenantId: string): Promise<void> {
  const row = await getRow(tenantId);
  if (row.vapi_phone_number_id) {
    await releaseNumber(row.vapi_phone_number_id);
    await persist(tenantId, { vapi_phone_number_id: null, phone_number: null });
  }
  if (row.vapi_assistant_id) {
    await deleteAssistant(row.vapi_assistant_id);
    await persist(tenantId, { vapi_assistant_id: null });
  }
  await persist(tenantId, { status: "paused" });
}
