import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePortalTenant } from "@/lib/portal-auth";
import { getCall, getTranscripts, getCallLinks } from "@/lib/admin-queries";
import { fmtDate, fmtDuration } from "@/lib/format";
import { KV, Section } from "@/components/section";
import { Transcript } from "@/components/records/transcript";

export const dynamic = "force-dynamic";

export default async function PortalCallDetailPage({
  params,
}: {
  params: Promise<{ callId: string }>;
}) {
  const { tenantId } = await requirePortalTenant();
  const { callId } = await params;

  // getCall filters by tenant AND call id — a crafted URL for another
  // tenant's call 404s here.
  const call = await getCall(tenantId, callId);
  if (!call) notFound();

  const [transcripts, links] = await Promise.all([
    getTranscripts(call.id),
    getCallLinks(call.id),
  ]);

  return (
    <main>
      <p className="text-xs text-muted-foreground/60">
        <Link href="/portal/calls" className="text-primary hover:underline">
          calls
        </Link>{" "}
        / {fmtDate(call.started_at ?? call.created_at)}
      </p>
      <h1 className="mt-1 text-xl font-semibold">
        Call — {call.outcome ?? "unknown outcome"}
      </h1>

      <Section title="Details">
        <KV
          rows={[
            ["From", call.caller_number ?? "—"],
            ["Started", fmtDate(call.started_at)],
            ["Ended", fmtDate(call.ended_at)],
            ["Duration", fmtDuration(call.duration_sec)],
          ]}
        />
      </Section>

      <Section title="Summary">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {call.summary ?? "No summary."}
        </p>
      </Section>

      <Section title="Transcript">
        <Transcript rows={transcripts} recordingUrl={call.recording_url} />
      </Section>

      {links.leads.length > 0 || links.bookings.length > 0 || links.transfers.length > 0 ? (
        <Section title="From this call">
          <div className="space-y-2 text-sm">
            {links.leads.map((l) => (
              <p key={l.id}>
                Lead — {l.name ?? "unknown"} ({l.phone ?? l.email ?? "no contact"})
                {l.intent ? ` — ${l.intent}` : ""}
              </p>
            ))}
            {links.bookings.map((b) => (
              <p key={b.id}>
                Booking — {b.type ?? "booking"} for {b.name ?? "unknown"} at{" "}
                {fmtDate(b.slot_start)} ({b.status ?? "—"})
              </p>
            ))}
            {links.transfers.map((t) => (
              <p key={t.id}>
                Transfer — {t.status ?? "—"} to {t.to_number ?? "—"}
                {t.reason ? ` — ${t.reason}` : ""}
              </p>
            ))}
          </div>
        </Section>
      ) : null}
    </main>
  );
}
