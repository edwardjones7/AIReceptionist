// CLI wrapper over lib/provision.ts — provision (create or update) the Vapi
// assistant + phone number for a tenant from its row in Supabase.
//
// Run: npm run provision [-- <tenantId>]     (defaults to TENANT env, then "elenos")
//
// The tenant must be seeded first (npm run seed -- <id>) or created in the
// admin dashboard. The dashboard's Provision button calls the same code path.

import { config } from "dotenv";
config({ path: ".env.local" }); // primary
config(); // .env fallback (does not override already-set vars)

async function main() {
  // Import after dotenv so lib/env sees the vars.
  const { provisionTenant } = await import("../lib/provision");

  const id = process.argv[2] ?? process.env.TENANT ?? "elenos";
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
