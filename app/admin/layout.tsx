// Admin shell. The proxy redirects unauthenticated /admin/* navigation to the
// login page; this layout renders the sidebar only for an authenticated
// session so the login page stays bare (it shares this layout).

import { isAdmin } from "@/lib/admin-auth";
import { Shell } from "@/components/shell/shell";
import { Button } from "@/components/ui/button";
import { logout } from "./actions";

export const metadata = { title: "Scarlett — Admin" };

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = await isAdmin();
  if (!authed) return <>{children}</>;

  return (
    <Shell
      variant="admin"
      footer={
        <form action={logout}>
          <Button type="submit" variant="outline" size="sm" className="w-full">
            Log out
          </Button>
        </form>
      }
    >
      {children}
    </Shell>
  );
}
