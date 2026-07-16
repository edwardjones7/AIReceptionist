import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { listTenants } from "@/lib/admin-queries";
import { styles, Badge, fmtDate, fmtUsage } from "./ui";

export const dynamic = "force-dynamic";

export default async function TenantListPage() {
  await requireAdmin();
  const tenants = await listTenants();

  return (
    <main style={styles.page}>
      <h1 style={styles.h1}>Tenants</h1>
      <p style={styles.dim}>
        Every business Scarlett answers for. Counts are the last 7 days.
      </p>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Tenant</th>
            <th style={styles.th}>Status</th>
            <th style={styles.th}>Number</th>
            <th style={styles.th}>Calls</th>
            <th style={styles.th}>Leads</th>
            <th style={styles.th}>This month</th>
            <th style={styles.th}>Last call</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((t) => (
            <tr key={t.id}>
              <td style={styles.td}>
                <Link href={`/admin/tenants/${t.id}`} style={styles.link}>
                  {t.name}
                </Link>{" "}
                <span style={styles.faint}>({t.id})</span>
              </td>
              <td style={styles.td}>
                <Badge status={t.status} />
              </td>
              <td style={styles.td}>{t.phoneNumber ?? "—"}</td>
              <td style={styles.td}>{t.callsLast7}</td>
              <td style={styles.td}>{t.leadsLast7}</td>
              <td style={{ ...styles.td, whiteSpace: "nowrap" }}>
                {fmtUsage(t.callsMtd, t.secondsMtd, t.costCentsMtd)}
              </td>
              <td style={styles.td}>{fmtDate(t.lastCallAt)}</td>
            </tr>
          ))}
          {tenants.length === 0 ? (
            <tr>
              <td style={styles.td} colSpan={7}>
                No tenants yet. Seed one with <code>npm run seed -- elenos</code> or{" "}
                <Link href="/admin/tenants/new" style={styles.link}>
                  create one
                </Link>
                .
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </main>
  );
}
