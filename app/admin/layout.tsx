// Admin shell. The proxy redirects unauthenticated /admin/* navigation to the
// login page; this layout renders the nav only for an authenticated session so
// the login page stays bare (it shares this layout).

import Link from "next/link";
import { isAdmin } from "@/lib/admin-auth";
import { logout } from "./actions";
import { styles, ACCENT } from "./ui";

export const metadata = { title: "Scarlett — Admin" };

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = await isAdmin();
  if (!authed) return <>{children}</>;

  return (
    <div>
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          gap: 24,
          padding: "14px 2rem",
          borderBottom: "1px solid #1f1f1f",
          fontSize: 13,
        }}
      >
        <span style={{ color: ACCENT, letterSpacing: "0.1em", fontSize: 12 }}>
          SCARLETT / ADMIN
        </span>
        <Link href="/admin" style={styles.link}>
          Tenants
        </Link>
        <Link href="/admin/tenants/new" style={styles.link}>
          + New tenant
        </Link>
        <form action={logout} style={{ marginLeft: "auto" }}>
          <button type="submit" style={{ ...styles.buttonGhost, padding: "5px 12px" }}>
            Log out
          </button>
        </form>
      </nav>
      {children}
    </div>
  );
}
