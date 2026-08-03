// Re-run the email parser over addresses already stored in bookings and leads
// to find historical damage — invalid addresses, and near-miss domains that
// would now be auto-corrected. Read-only: it never writes.
//
// Run: npm run audit:emails [-- <limit>]     (default 200 rows each)

import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  // Import after dotenv so lib/env sees the vars.
  const { db } = await import("../lib/supabase");
  const { isValidEmail, correctDomain } = await import("../lib/email/spoken");

  const limit = Number(process.argv[2]) || 200;

  for (const table of ["bookings", "leads"] as const) {
    const { data, error } = await db()
      .from(table)
      .select("id, name, email, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`${table}: ${error.message}`);
      continue;
    }

    const rows = (data ?? []) as { id: string; name: string | null; email: string | null; created_at: string }[];
    const withEmail = rows.filter((r) => (r.email ?? "").trim());
    const problems: string[] = [];

    for (const r of withEmail) {
      const email = (r.email ?? "").trim();
      const when = r.created_at?.slice(0, 10) ?? "?";
      const who = r.name || "(no name)";

      if (!isValidEmail(email)) {
        problems.push(`  ✗ INVALID   ${when}  ${who} — "${email}"`);
        continue;
      }
      const domain = email.slice(email.lastIndexOf("@") + 1);
      const fixed = correctDomain(domain);
      if (fixed.corrected) {
        problems.push(
          `  ⚠ SUSPECT   ${when}  ${who} — ${email}  (domain looks like ${fixed.corrected.to})`,
        );
      }
    }

    console.log(
      `\n${table}: ${rows.length} rows, ${withEmail.length} with an email, ${problems.length} flagged`,
    );
    for (const p of problems) console.log(p);
    if (!problems.length && withEmail.length) console.log("  ✓ all clean");
  }

  console.log(
    "\nNote: an address that is well-formed and has a real domain can still be the" +
      "\nwrong person — that class of error is what the booking confirmation SMS catches.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
