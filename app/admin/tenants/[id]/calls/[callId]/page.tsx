import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { getCall, getTranscripts, getCallLinks } from "@/lib/admin-queries";
import { styles, Section, fmtDate, fmtCents } from "../../../../ui";

export const dynamic = "force-dynamic";

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string; callId: string }>;
}) {
  await requireAdmin();
  const { id, callId } = await params;

  const call = await getCall(id, callId);
  if (!call) notFound();

  const [transcripts, links] = await Promise.all([
    getTranscripts(call.id),
    getCallLinks(call.id),
  ]);

  return (
    <main>
      <p style={{ ...styles.faint, margin: 0 }}>
        <Link href={`/admin/tenants/${id}/calls`} style={styles.link}>
          calls
        </Link>{" "}
        / {fmtDate(call.started_at ?? call.created_at)}
      </p>
      <h1 style={styles.h1}>Call — {call.outcome ?? "unknown outcome"}</h1>

      <Section title="Details">
        <table style={styles.table}>
          <tbody>
            <tr>
              <td style={styles.td}>From</td>
              <td style={styles.td}>{call.caller_number ?? "—"}</td>
            </tr>
            <tr>
              <td style={styles.td}>Started</td>
              <td style={styles.td}>{fmtDate(call.started_at)}</td>
            </tr>
            <tr>
              <td style={styles.td}>Ended</td>
              <td style={styles.td}>{fmtDate(call.ended_at)}</td>
            </tr>
            <tr>
              <td style={styles.td}>Duration</td>
              <td style={styles.td}>
                {call.duration_sec ? `${call.duration_sec}s` : "—"}
              </td>
            </tr>
            <tr>
              <td style={styles.td}>Vapi cost</td>
              <td style={styles.td}>
                {call.cost_cents != null ? fmtCents(call.cost_cents) : "—"}
              </td>
            </tr>
            <tr>
              <td style={styles.td}>Recording</td>
              <td style={styles.td}>
                {call.recording_url ? (
                  <a
                    href={call.recording_url}
                    style={styles.link}
                    target="_blank"
                    rel="noreferrer"
                  >
                    listen
                  </a>
                ) : (
                  "—"
                )}
              </td>
            </tr>
            <tr>
              <td style={styles.td}>Vapi call id</td>
              <td style={{ ...styles.td, ...styles.faint }}>
                {call.vapi_call_id ?? "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="Summary">
        <p style={{ color: "#aaa", margin: 0, lineHeight: 1.6 }}>
          {call.summary ?? "No summary."}
        </p>
      </Section>

      <Section title="Transcript">
        {transcripts.length === 0 ? (
          <p style={{ ...styles.dim, margin: 0 }}>No transcript stored.</p>
        ) : (
          transcripts.map((t) => (
            <pre
              key={t.id}
              style={{
                whiteSpace: "pre-wrap",
                fontFamily: "inherit",
                fontSize: 13,
                color: "#ccc",
                lineHeight: 1.6,
                margin: "0 0 12px",
              }}
            >
              {t.text}
            </pre>
          ))
        )}
      </Section>

      {links.leads.length > 0 || links.bookings.length > 0 || links.transfers.length > 0 ? (
        <Section title="From this call">
          {links.leads.map((l) => (
            <p key={l.id} style={{ fontSize: 13, margin: "0 0 8px" }}>
              Lead — {l.name ?? "unknown"} ({l.phone ?? l.email ?? "no contact"})
              {l.intent ? ` — ${l.intent}` : ""}{" "}
              <Link href={`/admin/tenants/${id}/leads`} style={styles.link}>
                view leads
              </Link>
            </p>
          ))}
          {links.bookings.map((b) => (
            <p key={b.id} style={{ fontSize: 13, margin: "0 0 8px" }}>
              Booking — {b.type ?? "booking"} for {b.name ?? "unknown"} at{" "}
              {fmtDate(b.slot_start)} ({b.status ?? "—"}){" "}
              <Link href={`/admin/tenants/${id}/bookings`} style={styles.link}>
                view bookings
              </Link>
            </p>
          ))}
          {links.transfers.map((t) => (
            <p key={t.id} style={{ fontSize: 13, margin: "0 0 8px" }}>
              Transfer — {t.status ?? "—"} to {t.to_number ?? "—"}
              {t.reason ? ` — ${t.reason}` : ""}
            </p>
          ))}
        </Section>
      ) : null}
    </main>
  );
}
