import { requireAdmin } from "@/lib/admin-auth";
import { recentLeads } from "@/lib/admin-queries";
import { pageParam } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LeadsTable } from "@/components/records/tables";
import { Pager } from "@/components/records/pager";
import { setLeadStatus } from "../../../actions";

export const dynamic = "force-dynamic";

const LEAD_STATUSES = ["new", "contacted", "qualified", "converted", "closed"];

export default async function TenantLeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; perror?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const leads = await recentLeads(id, page);
  const back = `/admin/tenants/${id}/leads${page > 1 ? `?page=${page}` : ""}`;

  return (
    <main>
      <h1 className="text-xl font-semibold">Leads</h1>
      {sp.perror ? <p className="mt-2 text-sm text-destructive">{sp.perror}</p> : null}
      <Card className="mt-4 p-0">
        <LeadsTable
          rows={leads.rows}
          page={page}
          actionSlot={(l) => (
            <form action={setLeadStatus} className="flex items-center gap-1.5">
              <input type="hidden" name="tenant_id" value={id} />
              <input type="hidden" name="lead_id" value={l.id} />
              <input type="hidden" name="back" value={back} />
              <select
                name="status"
                defaultValue={l.status ?? "new"}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs"
              >
                {LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="outline" size="sm" className="h-7 px-2 text-xs">
                Set
              </Button>
            </form>
          )}
        />
      </Card>
      <Pager
        basePath={`/admin/tenants/${id}/leads`}
        page={page}
        hasMore={leads.hasMore}
      />
    </main>
  );
}
