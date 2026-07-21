import { requirePortalTenant } from "@/lib/portal-auth";
import { recentLeads } from "@/lib/admin-queries";
import { pageParam } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { LeadsTable } from "@/components/records/tables";
import { Pager } from "@/components/records/pager";

export const dynamic = "force-dynamic";

export default async function PortalLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { tenantId } = await requirePortalTenant();
  const page = pageParam((await searchParams).page);
  const leads = await recentLeads(tenantId, page);

  return (
    <main>
      <h1 className="text-xl font-semibold">Leads</h1>
      <p className="text-sm text-muted-foreground">
        Callers who wanted something — captured with contact details.
      </p>
      <Card className="mt-4 p-0">
        <LeadsTable rows={leads.rows} page={page} />
      </Card>
      <Pager basePath="/portal/leads" page={page} hasMore={leads.hasMore} />
    </main>
  );
}
