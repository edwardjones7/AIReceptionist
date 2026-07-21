// Portal shell. Login/auth pages render bare (no session); everything else
// gets the sidebar with the tenant's name. Authorization happens per-page via
// requirePortalTenant().

import { getPortalUser, requirePortalTenant } from "@/lib/portal-auth";
import { Shell } from "@/components/shell/shell";
import { Button } from "@/components/ui/button";
import { portalLogout } from "./actions";

export const metadata = { title: "Scarlett — Portal" };

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getPortalUser();
  if (!user) return <>{children}</>;

  const { tenantName, email } = await requirePortalTenant();

  return (
    <Shell
      variant="portal"
      tenantName={tenantName}
      footer={
        <div className="space-y-2">
          <p className="truncate text-xs text-muted-foreground/60">{email}</p>
          <form action={portalLogout}>
            <Button type="submit" variant="outline" size="sm" className="w-full">
              Log out
            </Button>
          </form>
        </div>
      }
    >
      {children}
    </Shell>
  );
}
