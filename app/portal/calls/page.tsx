import { requirePortalTenant } from "@/lib/portal-auth";
import { recentCalls } from "@/lib/admin-queries";
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
  const calls = await recentCalls(tenantId, page);

  return (
    <main>
      <h1 className="text-xl font-semibold">Calls</h1>
      <p className="text-sm text-muted-foreground">
        Every call answered, with a summary of what happened.
      </p>
      <Card className="mt-4 p-0">
        <CallsTable rows={calls.rows} hrefBase="/portal/calls" page={page} />
      </Card>
      <Pager basePath="/portal/calls" page={page} hasMore={calls.hasMore} />
    </main>
  );
}
