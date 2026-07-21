import { requireAdmin } from "@/lib/admin-auth";
import { recentTransfers } from "@/lib/admin-queries";
import { pageParam } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { TransfersTable } from "@/components/records/tables";
import { Pager } from "@/components/records/pager";

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
      <h1 className="text-xl font-semibold">Transfers</h1>
      <p className="text-sm text-muted-foreground">
        Live-transfer attempts and after-hours callbacks captured in their place.
      </p>
      <Card className="mt-4 p-0">
        <TransfersTable
          rows={transfers.rows}
          page={page}
          callHrefBase={`/admin/tenants/${id}/calls`}
        />
      </Card>
      <Pager
        basePath={`/admin/tenants/${id}/transfers`}
        page={page}
        hasMore={transfers.hasMore}
      />
    </main>
  );
}
