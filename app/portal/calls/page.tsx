import { requirePortalTenant } from "@/lib/portal-auth";
import { recentCalls, getTenantTimezone } from "@/lib/admin-queries";
import { reconcileRecentCalls } from "@/lib/call-store";
import { pageParam } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { CallsTable } from "@/components/records/tables";
import { Pager } from "@/components/records/pager";

export const dynamic = "force-dynamic";

export default async function PortalCallsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { tenantId } = await requirePortalTenant();
  const page = pageParam((await searchParams).page);
  // Self-heal: pull any calls Vapi didn't deliver a webhook for, so a client
  // watching only their portal still sees every call (best-effort).
  if (page === 1) await reconcileRecentCalls(tenantId).catch(() => {});
  const [calls, tz] = await Promise.all([
    recentCalls(tenantId, page),
    getTenantTimezone(tenantId),
  ]);

  return (
    <main>
      <h1 className="text-xl font-semibold">Calls</h1>
      <p className="text-sm text-muted-foreground">
        Every call answered, with a summary of what happened.
      </p>
      <Card className="mt-4 p-0">
        <CallsTable rows={calls.rows} hrefBase="/portal/calls" page={page} tz={tz} />
      </Card>
      <Pager basePath="/portal/calls" page={page} hasMore={calls.hasMore} />
    </main>
  );
}
