import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { getTenantRow, getTenantStats } from "@/lib/admin-queries";
import {
  saveTenantSettings,
  setTenantStatus,
  provisionTenantAction,
  deprovisionTenantAction,
  deleteTenantAction,
  runPreflightAction,
} from "../../actions";
import { styles, Badge, Field, Section, fmtDate, fmtCents } from "../../ui";
import { ConfirmSubmit } from "../../confirm-submit";
import type { PreflightReport } from "@/lib/preflight";

const CHECK_COLORS: Record<string, string> = {
  pass: "#22c55e",
  fail: "#ef4444",
  warn: "#eab308",
  skip: "#555",
};

function PreflightSection({
  id,
  report,
}: {
  id: string;
  report: PreflightReport | null;
}) {
  return (
    <Section title="Preflight">
      {report ? (
        <>
          <table style={styles.table}>
            <tbody>
              {report.checks.map((c) => (
                <tr key={c.key}>
                  <td style={{ ...styles.td, width: 220 }}>
                    <span style={{ color: CHECK_COLORS[c.status] ?? "#888" }}>
                      ●
                    </span>{" "}
                    {c.label}
                  </td>
                  <td style={{ ...styles.td, color: "#888", width: 60 }}>
                    {c.status}
                  </td>
                  <td style={{ ...styles.td, color: "#aaa" }}>{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ ...styles.faint, margin: "8px 0 0" }}>
            Last run {fmtDate(report.ranAt)}.
          </p>
        </>
      ) : (
        <p style={{ ...styles.dim, margin: 0, fontSize: 13 }}>
          Not run yet. Checks config, calendar sharing, Discord, phone targets,
          and the Vapi assistant.
        </p>
      )}
      <form action={runPreflightAction}>
        <input type="hidden" name="id" value={id} />
        <button type="submit" style={{ ...styles.buttonGhost, marginTop: 16 }}>
          Run preflight
        </button>
      </form>
    </Section>
  );
}

export const dynamic = "force-dynamic";

export default async function TenantOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    saved?: string;
    created?: string;
    provisioned?: string;
    perror?: string;
  }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { saved, created, provisioned, perror } = await searchParams;
  const row = await getTenantRow(id);
  if (!row) notFound();
  const stats = await getTenantStats(id);

  return (
    <main>
      <h1 style={styles.h1}>
        {row.name ?? row.id} <Badge status={row.status ?? "active"} />
      </h1>
      {saved ? <p style={{ color: "#22c55e", fontSize: 13 }}>Saved.</p> : null}
      {created ? (
        <p style={{ color: "#22c55e", fontSize: 13 }}>
          Draft created. Review the config tab, then provision below when ready.
        </p>
      ) : null}
      {provisioned ? (
        <p style={{ color: "#22c55e", fontSize: 13 }}>
          Provisioned. Call {row.phone_number ?? "the number"} to test.
        </p>
      ) : null}
      {perror ? (
        <p style={{ color: "#ef4444", fontSize: 13 }}>{perror}</p>
      ) : null}

      <Section title="Usage — this month">
        <table style={styles.table}>
          <tbody>
            <tr>
              <td style={{ ...styles.td, color: "#888", width: 220 }}>Calls</td>
              <td style={styles.td}>{stats.callsMtd}</td>
            </tr>
            <tr>
              <td style={{ ...styles.td, color: "#888" }}>Minutes</td>
              <td style={styles.td}>{Math.round(stats.secondsMtd / 60)}</td>
            </tr>
            <tr>
              <td style={{ ...styles.td, color: "#888" }}>Vapi cost</td>
              <td style={styles.td}>{fmtCents(stats.costCentsMtd)}</td>
            </tr>
            <tr>
              <td style={{ ...styles.td, color: "#888" }}>Last call</td>
              <td style={styles.td}>{fmtDate(stats.lastCallAt)}</td>
            </tr>
          </tbody>
        </table>
        <p style={{ ...styles.faint, margin: "8px 0 0" }}>
          Month boundary is UTC. Cost is Vapi&apos;s per-call charge, not what you
          bill the client.
        </p>
      </Section>

      <PreflightSection
        id={row.id}
        report={(row.last_preflight as PreflightReport | null) ?? null}
      />

      <Section title="Provisioning">
        <table style={styles.table}>
          <tbody>
            <tr>
              <td style={{ ...styles.td, color: "#888", width: 220 }}>Phone number</td>
              <td style={styles.td}>{row.phone_number ?? "— not provisioned"}</td>
            </tr>
            <tr>
              <td style={{ ...styles.td, color: "#888" }}>Vapi assistant id</td>
              <td style={styles.td}>{row.vapi_assistant_id ?? "—"}</td>
            </tr>
            <tr>
              <td style={{ ...styles.td, color: "#888" }}>Vapi phone-number id</td>
              <td style={styles.td}>{row.vapi_phone_number_id ?? "—"}</td>
            </tr>
            <tr>
              <td style={{ ...styles.td, color: "#888" }}>Updated</td>
              <td style={styles.td}>{fmtDate(row.updated_at)}</td>
            </tr>
          </tbody>
        </table>
        {!row.vapi_assistant_id ? (
          <form action={provisionTenantAction}>
            <input type="hidden" name="id" value={row.id} />
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <label style={styles.label} htmlFor="number_provider">
                  Number
                </label>
                <select id="number_provider" name="number_provider" style={styles.input}>
                  <option value="vapi">Vapi free number (demo, US)</option>
                  <option value="twilio">Buy Twilio number (production)</option>
                </select>
              </div>
              <div style={{ width: 140 }}>
                <label style={styles.label} htmlFor="area_code">
                  Area code
                </label>
                <input
                  id="area_code"
                  name="area_code"
                  placeholder="e.g. 856 — blank uses the transfer number's"
                  style={styles.input}
                />
              </div>
            </div>
            <label
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                marginTop: 12,
                fontSize: 13,
                color: "#888",
              }}
            >
              <input type="checkbox" name="skip_preflight" />
              Provision anyway (skip preflight)
            </label>
            <button type="submit" style={styles.button}>
              Provision — create assistant + number
            </button>
          </form>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <form action={provisionTenantAction}>
              <input type="hidden" name="id" value={row.id} />
              <button type="submit" style={{ ...styles.buttonGhost, marginTop: 16 }}>
                Re-provision (push config to Vapi)
              </button>
              <label
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  marginTop: 6,
                  fontSize: 12,
                  color: "#666",
                }}
              >
                <input type="checkbox" name="skip_preflight" />
                skip preflight
              </label>
            </form>
            <form action={setTenantStatus}>
              <input type="hidden" name="id" value={row.id} />
              <input
                type="hidden"
                name="status"
                value={row.status === "paused" ? "active" : "paused"}
              />
              <button type="submit" style={{ ...styles.buttonGhost, marginTop: 16 }}>
                {row.status === "paused" ? "Reactivate" : "Pause"}
              </button>
            </form>
            <form action={deprovisionTenantAction}>
              <input type="hidden" name="id" value={row.id} />
              <ConfirmSubmit
                message={`Deprovision ${row.id}? This releases the phone number and deletes the Vapi assistant. Callers will get dead air until re-provisioned.`}
                style={{ ...styles.buttonGhost, marginTop: 16, color: "#ef4444", borderColor: "#ef444455" }}
              >
                Deprovision (release number + assistant)
              </ConfirmSubmit>
            </form>
          </div>
        )}
      </Section>

      <Section title="Integrations (per-tenant)">
        <form action={saveTenantSettings}>
          <input type="hidden" name="id" value={row.id} />
          <Field
            label="Google Calendar id"
            name="calendar_id"
            defaultValue={row.calendar_id ?? ""}
            placeholder="client-calendar@gmail.com — must be shared with the service account"
          />
          <Field
            label="Discord webhook URL"
            name="discord_webhook_url"
            defaultValue={row.discord_webhook_url ?? ""}
            placeholder="https://discord.com/api/webhooks/…"
          />
          <Field
            label="Notify phone (SMS alerts)"
            name="notify_phone"
            defaultValue={row.notify_phone ?? ""}
            placeholder="+1…"
          />
          <Field
            label="Transfer number (live transfer target)"
            name="transfer_number"
            defaultValue={row.transfer_number ?? ""}
            placeholder="+1…"
          />
          <Field
            label="Owner numbers (founder mode, comma-separated)"
            name="owner_numbers"
            defaultValue={(row.owner_numbers ?? []).join(", ")}
            placeholder="+1…, +1…"
          />
          <button type="submit" style={styles.button}>
            Save settings
          </button>
        </form>
      </Section>

      {!row.vapi_assistant_id && !row.vapi_phone_number_id ? (
        <Section title="Danger">
          <p style={{ ...styles.dim, margin: "0 0 4px", fontSize: 13 }}>
            Deletes the tenant and all of its calls, transcripts, leads,
            bookings, and transfers. There is no undo.
          </p>
          <form action={deleteTenantAction}>
            <input type="hidden" name="id" value={row.id} />
            <Field
              label={`Type the tenant id (${row.id}) to confirm`}
              name="confirm_id"
              placeholder={row.id}
            />
            <ConfirmSubmit
              message={`Permanently delete ${row.id} and all of its data?`}
              style={{
                ...styles.buttonGhost,
                marginTop: 16,
                color: "#ef4444",
                borderColor: "#ef444455",
              }}
            >
              Delete tenant permanently
            </ConfirmSubmit>
          </form>
        </Section>
      ) : null}
    </main>
  );
}
