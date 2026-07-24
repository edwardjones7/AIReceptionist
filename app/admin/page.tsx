import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { listTenantsWithStats, rangeParam } from "@/lib/analytics-queries";
import { fmtCents, fmtDate } from "@/lib/format";
import { RangeTabs } from "@/components/stats/range-tabs";
import { StatusBadge } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function TenantListPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  await requireAdmin();
  const range = rangeParam((await searchParams).range);
  const tenants = await listTenantsWithStats(range);

  return (
    <main>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Tenants</h1>
          <p className="text-sm text-muted-foreground">
            Every business Scarlett answers for.
          </p>
        </div>
        <RangeTabs basePath="/admin" current={range} />
      </div>
      <Card className="mt-5 p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenant</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Number</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Minutes</TableHead>
              <TableHead className="text-right">Leads</TableHead>
              <TableHead className="text-right">Bookings</TableHead>
              <TableHead className="text-right">Vapi cost</TableHead>
              <TableHead className="text-right">LLM cost</TableHead>
              <TableHead>Last call</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <Link
                    href={`/admin/tenants/${t.id}`}
                    className="text-primary hover:underline"
                  >
                    {t.name}
                  </Link>{" "}
                  <span className="text-xs text-muted-foreground/60">({t.id})</span>
                </TableCell>
                <TableCell>
                  <StatusBadge status={t.status} />
                </TableCell>
                <TableCell>{t.phoneNumber ?? "—"}</TableCell>
                <TableCell className="text-right">{t.calls}</TableCell>
                <TableCell className="text-right">{Math.round(t.seconds / 60)}</TableCell>
                <TableCell className="text-right">{t.leads}</TableCell>
                <TableCell className="text-right">{t.bookings}</TableCell>
                <TableCell className="text-right">{fmtCents(t.costCents)}</TableCell>
                <TableCell className="text-right">{fmtCents(t.llmCostCents)}</TableCell>
                <TableCell className="whitespace-nowrap">{fmtDate(t.lastCallAt)}</TableCell>
              </TableRow>
            ))}
            {tenants.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-muted-foreground">
                  No tenants yet. Seed one with <code>npm run seed -- elenos</code> or{" "}
                  <Link href="/admin/tenants/new" className="text-primary hover:underline">
                    create one
                  </Link>
                  .
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>
    </main>
  );
}
