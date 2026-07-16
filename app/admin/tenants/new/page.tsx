import { requireAdmin } from "@/lib/admin-auth";
import { templateIds } from "@/lib/templates";
import { createTenant } from "../../actions";
import { styles, Field, Section } from "../../ui";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  "bad-id": "Tenant id must be a lowercase slug (a-z, 0-9, hyphens).",
  "missing-name": "Business name is required.",
  exists: "A tenant with that id already exists.",
  "bad-config": "Generated config failed validation — check the template.",
  db: "Database insert failed — check the server logs.",
};

export default async function NewTenantPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const { error } = await searchParams;

  return (
    <main style={styles.page}>
      <h1 style={styles.h1}>New tenant</h1>
      <p style={styles.dim}>
        Creates the tenant as a draft from a template config. Review the
        generated config, then provision from the tenant page — that&apos;s when
        the Vapi assistant and phone number are created.
      </p>
      {error ? (
        <p style={{ color: "#ef4444", fontSize: 13 }}>
          {ERRORS[error] ?? "Something went wrong."}
        </p>
      ) : null}

      <form action={createTenant}>
        <Section title="Business">
          <Field label="Tenant id (slug)" name="id" placeholder="sullivan-electric" />
          <Field label="Business name" name="display_name" placeholder="Sullivan Electric" />
          <Field label="Agent name" name="agent_name" defaultValue="Scarlett" />
          <Field label="Timezone" name="timezone" defaultValue="America/New_York" />
          <label style={styles.label} htmlFor="template">
            Template
          </label>
          <select id="template" name="template" style={styles.input} defaultValue="elenos">
            {templateIds().map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <Field
            label="Voice id (Vapi voice; blank = Savannah)"
            name="voice_id"
            placeholder="Savannah"
          />
        </Section>

        <Section title="Integrations (can be filled in later)">
          <Field
            label="Google Calendar id"
            name="calendar_id"
            placeholder="client-calendar@gmail.com — share it with the service account first"
          />
          <Field
            label="Discord webhook URL"
            name="discord_webhook_url"
            placeholder="https://discord.com/api/webhooks/…"
          />
          <Field label="Notify phone (SMS alerts)" name="notify_phone" placeholder="+1…" />
          <Field label="Transfer number" name="transfer_number" placeholder="+1…" />
          <Field
            label="Owner numbers (founder mode, comma-separated)"
            name="owner_numbers"
            placeholder="+1…, +1…"
          />
        </Section>

        <button type="submit" style={styles.button}>
          Create draft tenant
        </button>
      </form>
    </main>
  );
}
