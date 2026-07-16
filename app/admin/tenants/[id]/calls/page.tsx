import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { recentCalls } from "@/lib/admin-queries";
import { styles, fmtDate, Pager, pageParam } from "../../../ui";

export const dynamic = "force-dynamic";

export default async function TenantCallsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const page = pageParam((await searchParams).page);
  const calls = await recentCalls(id, page);

  return (
    <main>
      <h1 style={styles.h1}>Calls</h1>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>When</th>
            <th style={styles.th}>From</th>
            <th style={styles.th}>Duration</th>
            <th style={styles.th}>Outcome</th>
            <th style={styles.th}>Summary</th>
            <th style={styles.th}>Recording</th>
          </tr>
        </thead>
        <tbody>
          {calls.rows.map((c) => (
            <tr key={c.id}>
              <td style={{ ...styles.td, whiteSpace: "nowrap" }}>
                <Link href={`/admin/tenants/${id}/calls/${c.id}`} style={styles.link}>
                  {fmtDate(c.started_at ?? c.created_at)}
                </Link>
              </td>
              <td style={styles.td}>{c.caller_number ?? "—"}</td>
              <td style={styles.td}>{c.duration_sec ? `${c.duration_sec}s` : "—"}</td>
              <td style={styles.td}>{c.outcome ?? "—"}</td>
              <td style={{ ...styles.td, color: "#aaa", maxWidth: 420 }}>
                {c.summary ?? "—"}
              </td>
              <td style={styles.td}>
                {c.recording_url ? (
                  <a
                    href={c.recording_url}
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
          ))}
          {calls.rows.length === 0 ? (
            <tr>
              <td style={styles.td} colSpan={6}>
                No calls {page > 1 ? "on this page" : "yet"}.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <Pager
        basePath={`/admin/tenants/${id}/calls`}
        page={page}
        hasMore={calls.hasMore}
      />
    </main>
  );
}
