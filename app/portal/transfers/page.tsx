import { requirePortalTenant } from "@/lib/portal-auth";
import { recentTransfers, getTenantTimezone } from "@/lib/admin-queries";
import { pageParam } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { TransfersTable } from "@/components/records/tables";
import { Pager } from "@/components/records/pager";

export const dynamic = "force-dynamic";

export default async function PortalTransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { tenantId } = await requirePortalTenant();
  const page = pageParam((await searchParams).page);
  const [transfers, tz] = await Promise.all([
    recentTransfers(tenantId, page),
    getTenantTimezone(tenantId),
  ]);

  return (
    <main>
      <h1 className="text-xl font-semibold">Transfers</h1>
      <p className="text-sm text-muted-foreground">
        Calls handed to a human, and after-hours callback requests.
      </p>
      <Card className="mt-4 p-0">
        <TransfersTable
          rows={transfers.rows}
          page={page}
          callHrefBase="/portal/calls"
          tz={tz}
        />
      </Card>
      <Pager basePath="/portal/transfers" page={page} hasMore={transfers.hasMore} />
    </main>
  );
}
