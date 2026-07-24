import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { getTenantRow, listPortalUsers } from "@/lib/admin-queries";
import { env } from "@/lib/env";
import {
  getTenantRangeStats,
  getTenantSeries,
  rangeBucket,
  rangeParam,
} from "@/lib/analytics-queries";
import { fmtDate } from "@/lib/format";
import {
  addPortalUser,
  removePortalUser,
  saveTenantSettings,
  setTenantStatus,
  provisionTenantAction,
  deprovisionTenantAction,
  deleteTenantAction,
  runPreflightAction,
} from "../../actions";
import { Field, KV, Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { RangeTabs } from "@/components/stats/range-tabs";
import { StatCards } from "@/components/stats/stat-cards";
import { ActivityCharts } from "@/components/stats/activity-charts";
import { CostChart } from "@/components/stats/cost-chart";
import { Button } from "@/components/ui/button";
import { ConfirmSubmit } from "../../confirm-submit";
import type { PreflightReport } from "@/lib/preflight";

const CHECK_COLORS: Record<string, string> = {
  pass: "text-green-500",
  fail: "text-red-500",
  warn: "text-yellow-500",
  skip: "text-muted-foreground/60",
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
          <table className="w-full text-sm">
            <tbody>
              {report.checks.map((c) => (
                <tr key={c.key} className="border-b border-border/50 last:border-0">
                  <td className="w-56 py-2">
                    <span className={CHECK_COLORS[c.status] ?? "text-muted-foreground"}>
                      ●
                    </span>{" "}
                    {c.label}
                  </td>
                  <td className="w-16 py-2 text-muted-foreground">{c.status}</td>
                  <td className="py-2 text-muted-foreground">{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground/60">
            Last run {fmtDate(report.ranAt)}.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Not run yet. Checks config, calendar sharing, Discord, phone targets,
          and the Vapi assistant.
        </p>
      )}
      <form action={runPreflightAction}>
        <input type="hidden" name="id" value={id} />
        <Button type="submit" variant="outline" size="sm">
          Run preflight
        </Button>
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
    range?: string;
  }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const range = rangeParam(sp.range);
  const row = await getTenantRow(id);
  if (!row) notFound();
  const [stats, series, portalUsers] = await Promise.all([
    getTenantRangeStats(id, range),
    getTenantSeries(id, range),
    listPortalUsers(id),
  ]);

  return (
    <main>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-xl font-semibold">
          {row.name ?? row.id} <StatusBadge status={row.status ?? "active"} />
        </h1>
        <RangeTabs basePath={`/admin/tenants/${id}`} current={range} />
      </div>
      {sp.saved ? <p className="mt-2 text-sm text-green-500">Saved.</p> : null}
      {sp.created ? (
        <p className="mt-2 text-sm text-green-500">
          Draft created. Review the config tab, then provision below when ready.
        </p>
      ) : null}
      {sp.provisioned ? (
        <p className="mt-2 text-sm text-green-500">
          Provisioned. Call {row.phone_number ?? "the number"} to test.
        </p>
      ) : null}
      {sp.perror ? <p className="mt-2 text-sm text-destructive">{sp.perror}</p> : null}

      <div className="mt-5 space-y-3">
        <StatCards
          calls={stats.calls}
          seconds={stats.seconds}
          leads={stats.leads}
          bookings={stats.bookings}
          transfers={stats.transfers}
          costCents={stats.costCents}
          llmCostCents={stats.llmCostCents}
        />
        <ActivityCharts
          series={series.map(({ costCents: _c, llmCostCents: _l, ...p }) => p)}
          bucket={rangeBucket(range)}
        />
        <CostChart
          series={series.map((p) => ({
            bucket: p.bucket,
            costCents: p.costCents,
            llmCostCents: p.llmCostCents,
          }))}
          bucket={rangeBucket(range)}
        />
        <p className="text-xs text-muted-foreground/60">
          Buckets and range boundaries are UTC. Vapi cost is telephony; LLM cost
          is the estimated Anthropic token spend (Haiku turns + Sonnet summary) —
          both are your cost, not what you bill the client. Last call{" "}
          {fmtDate(stats.lastCallAt)}.
        </p>
      </div>

      <PreflightSection
        id={row.id}
        report={(row.last_preflight as PreflightReport | null) ?? null}
      />

      <Section title="Provisioning">
        <KV
          rows={[
            ["Phone number", row.phone_number ?? "— not provisioned"],
            ["Vapi assistant id", row.vapi_assistant_id ?? "—"],
            ["Vapi phone-number id", row.vapi_phone_number_id ?? "—"],
            ["Updated", fmtDate(row.updated_at)],
          ]}
        />
        {!row.vapi_assistant_id ? (
          <form action={provisionTenantAction}>
            <input type="hidden" name="id" value={row.id} />
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label
                  className="mb-1 block text-[11px] uppercase tracking-[0.1em] text-muted-foreground"
                  htmlFor="number_provider"
                >
                  Number
                </label>
                <select
                  id="number_provider"
                  name="number_provider"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="vapi">Vapi free number (demo, US)</option>
                  <option value="twilio">Buy Twilio number (production)</option>
                </select>
              </div>
              <div className="w-40">
                <label
                  className="mb-1 block text-[11px] uppercase tracking-[0.1em] text-muted-foreground"
                  htmlFor="area_code"
                >
                  Area code
                </label>
                <input
                  id="area_code"
                  name="area_code"
                  placeholder="e.g. 856"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50"
                />
              </div>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" name="skip_preflight" />
              Provision anyway (skip preflight)
            </label>
            <Button type="submit" className="mt-4">
              Provision — create assistant + number
            </Button>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <form action={provisionTenantAction}>
              <input type="hidden" name="id" value={row.id} />
              <Button type="submit" variant="outline" size="sm">
                Re-provision (push config to Vapi)
              </Button>
              <label className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground/60">
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
              <Button type="submit" variant="outline" size="sm">
                {row.status === "paused" ? "Reactivate" : "Pause"}
              </Button>
            </form>
            <form action={deprovisionTenantAction}>
              <input type="hidden" name="id" value={row.id} />
              <ConfirmSubmit
                message={`Deprovision ${row.id}? This releases the phone number and deletes the Vapi assistant. Callers will get dead air until re-provisioned.`}
                className="inline-flex h-8 items-center rounded-md border border-destructive/40 px-3 text-sm text-destructive hover:bg-destructive/10"
              >
                Deprovision (release number + assistant)
              </ConfirmSubmit>
            </form>
          </div>
        )}
      </Section>

      <Section title="Portal access">
        {portalUsers.length > 0 ? (
          <table className="w-full text-sm">
            <tbody>
              {portalUsers.map((u) => (
                <tr key={u.id} className="border-b border-border/50 last:border-0">
                  <td className="py-2">{u.email}</td>
                  <td className="py-2 text-muted-foreground">
                    added {fmtDate(u.created_at)}
                  </td>
                  <td className="py-2 text-muted-foreground">
                    {u.last_login_at
                      ? `last login ${fmtDate(u.last_login_at)}`
                      : "never logged in"}
                  </td>
                  <td className="py-2 text-right">
                    <form action={removePortalUser}>
                      <input type="hidden" name="tenant_id" value={row.id} />
                      <input type="hidden" name="portal_user_id" value={u.id} />
                      <ConfirmSubmit
                        message={`Remove portal access for ${u.email}? They are locked out on their next request.`}
                        className="text-sm text-destructive hover:underline"
                      >
                        remove
                      </ConfirmSubmit>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted-foreground">
            No client logins yet. Add an email to give this client a dashboard.
          </p>
        )}
        <form action={addPortalUser} className="flex items-end gap-3">
          <input type="hidden" name="tenant_id" value={row.id} />
          <div className="flex-1">
            <Field label="Client email" name="email" placeholder="owner@client.com" />
          </div>
          <Button type="submit" variant="outline">
            Grant access
          </Button>
        </form>
        <p className="text-xs text-muted-foreground/60">
          They sign in with a magic link at{" "}
          <code>{`${env.publicBaseUrl || "http://localhost:3000"}/portal`}</code>. The
          portal shows stats, calls, transcripts, leads, and bookings for this
          tenant only — never cost.
        </p>
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
          <Button type="submit" className="mt-4">
            Save settings
          </Button>
        </form>
      </Section>

      {!row.vapi_assistant_id && !row.vapi_phone_number_id ? (
        <Section title="Danger">
          <p className="text-sm text-muted-foreground">
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
              className="mt-4 inline-flex h-8 items-center rounded-md border border-destructive/40 px-3 text-sm text-destructive hover:bg-destructive/10"
            >
              Delete tenant permanently
            </ConfirmSubmit>
          </form>
        </Section>
      ) : null}
    </main>
  );
}
