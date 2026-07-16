import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { styles } from "../../ui";

const TABS = [
  ["", "Overview"],
  ["/config", "Config"],
  ["/calls", "Calls"],
  ["/leads", "Leads"],
  ["/bookings", "Bookings"],
  ["/transfers", "Transfers"],
] as const;

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  return (
    <div style={styles.page}>
      <p style={{ ...styles.faint, margin: 0 }}>
        <Link href="/admin" style={styles.link}>
          tenants
        </Link>{" "}
        / {id}
      </p>
      <nav style={{ display: "flex", gap: 18, margin: "12px 0 4px", fontSize: 13 }}>
        {TABS.map(([suffix, label]) => (
          <Link key={suffix} href={`/admin/tenants/${id}${suffix}`} style={styles.link}>
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
