import { requireAdmin } from "@/lib/admin-auth";
import { recentCalls } from "@/lib/admin-queries";
import { pageParam } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { CallsTable } from "@/components/records/tables";
import { Pager } from "@/components/records/pager";

export const dynamic = "force-dynamic";

export default async function TenantCallsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const page = pageParam((await searchParams).page);
  const calls = await recentCalls(id, page);

  return (
    <main>
      <h1 className="text-xl font-semibold">Calls</h1>
      <Card className="mt-4 p-0">
        <CallsTable
          rows={calls.rows}
          hrefBase={`/admin/tenants/${id}/calls`}
          page={page}
        />
      </Card>
      <Pager
        basePath={`/admin/tenants/${id}/calls`}
        page={page}
        hasMore={calls.hasMore}
      />
    </main>
  );
}
