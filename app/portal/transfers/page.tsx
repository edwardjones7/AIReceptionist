import { requirePortalTenant } from "@/lib/portal-auth";
import { recentTransfers } from "@/lib/admin-queries";
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
  const transfers = await recentTransfers(tenantId, page);

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
        />
      </Card>
      <Pager basePath="/portal/transfers" page={page} hasMore={transfers.hasMore} />
    </main>
  );
}
