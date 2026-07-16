import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { recentTransfers } from "@/lib/admin-queries";
import { styles, fmtDate, Pager, pageParam } from "../../../ui";

export const dynamic = "force-dynamic";

export default async function TenantTransfersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const page = pageParam((await searchParams).page);
  const transfers = await recentTransfers(id, page);

  return (
    <main>
      <h1 style={styles.h1}>Transfers</h1>
      <p style={styles.dim}>
        Live-transfer attempts and after-hours callbacks captured in their place.
      </p>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>When</th>
            <th style={styles.th}>Status</th>
            <th style={styles.th}>To</th>
            <th style={styles.th}>Reason</th>
            <th style={styles.th}>Call</th>
          </tr>
        </thead>
        <tbody>
          {transfers.rows.map((t) => (
            <tr key={t.id}>
              <td style={{ ...styles.td, whiteSpace: "nowrap" }}>{fmtDate(t.ts)}</td>
              <td style={styles.td}>{t.status ?? "—"}</td>
              <td style={styles.td}>{t.to_number ?? "—"}</td>
              <td style={{ ...styles.td, color: "#aaa", maxWidth: 420 }}>
                {t.reason ?? t.summary ?? "—"}
              </td>
              <td style={styles.td}>
                {t.call_id ? (
                  <Link
                    href={`/admin/tenants/${id}/calls/${t.call_id}`}
                    style={styles.link}
                  >
                    view
                  </Link>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
          {transfers.rows.length === 0 ? (
            <tr>
              <td style={styles.td} colSpan={5}>
                No transfers {page > 1 ? "on this page" : "yet"}.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <Pager
        basePath={`/admin/tenants/${id}/transfers`}
        page={page}
        hasMore={transfers.hasMore}
      />
    </main>
  );
}
