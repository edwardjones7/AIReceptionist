import { requireAdmin } from "@/lib/admin-auth";
import { recentCalls, getTenantTimezone } from "@/lib/admin-queries";
import { reconcileRecentCalls } from "@/lib/call-store";
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
  // Self-heal: pull any recent calls Vapi didn't deliver a webhook report for
  // (forwarded/transferred calls especially). Best-effort — never blocks render.
  if (page === 1) await reconcileRecentCalls(id).catch(() => {});
  const [calls, tz] = await Promise.all([
    recentCalls(id, page),
    getTenantTimezone(id),
  ]);

  return (
    <main>
      <h1 className="text-xl font-semibold">Calls</h1>
      <Card className="mt-4 p-0">
        <CallsTable
          rows={calls.rows}
          hrefBase={`/admin/tenants/${id}/calls`}
          page={page}
          tz={tz}
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
