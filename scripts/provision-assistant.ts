// CLI wrapper over lib/provision.ts — provision (create or update) the Vapi
// assistant + phone number for a tenant from its row in Supabase.
//
// Run: npm run provision [-- <tenantId>]     (defaults to TENANT env, then "elenos")
//      npm run provision -- <tenantId> --dry-run   print the payload, call nothing
//
// Use --dry-run before shipping assistant-level changes: provisioning PATCHes
// in place, so an unrecognized field is a Vapi 400 against a live phone number.
//
// The tenant must be seeded first (npm run seed -- <id>) or created in the
// admin dashboard. The dashboard's Provision button calls the same code path.

import { config } from "dotenv";
config({ path: ".env.local" }); // primary
config(); // .env fallback (does not override already-set vars)

async function main() {
  // Import after dotenv so lib/env sees the vars.
  const { provisionTenant } = await import("../lib/provision");

  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const dryRun = process.argv.includes("--dry-run");
  const id = args[0] ?? process.env.TENANT ?? "elenos";

  if (dryRun) {
    const { loadTenantById } = await import("../lib/context");
    const { buildAssistantPayload } = await import("../lib/vapi");
    const { env } = await import("../lib/env");

    // Falls back to config/<id>.tenant.json when there's no DB row.
    const tenant = await loadTenantById(id);
    const payload = buildAssistantPayload(tenant.config, {
      baseUrl: env.publicBaseUrl,
      secret: env.vapiServerSecret,
      llmModel: tenant.config.llmModel || env.llmModel,
    });
    console.log(JSON.stringify(payload, null, 2));
    console.error(`\n(dry run — nothing sent to Vapi for "${id}")`);
    return;
  }

  const numberProvider =
    process.env.NUMBER_PROVIDER === "twilio" ? ("twilio" as const) : ("vapi" as const);

  const result = await provisionTenant(id, { numberProvider });

  console.log(
    `✅ Assistant ${result.assistantCreated ? "created" : "updated"}: ${result.assistantId}`,
  );
  if (result.numberCreated) {
    console.log(`✅ Number provisioned: ${result.phoneNumber}`);
  } else if (result.phoneNumber) {
    console.log(`ℹ️  Number already attached: ${result.phoneNumber}`);
  } else {
    console.log(`ℹ️  No number attached yet — provision again or attach in the Vapi dashboard.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
