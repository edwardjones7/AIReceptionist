import { requirePortalTenant } from "@/lib/portal-auth";
import {
  getTenantRangeStats,
  getTenantSeries,
  rangeBucket,
  rangeParam,
} from "@/lib/analytics-queries";
import { fmtDate } from "@/lib/format";
import { RangeTabs } from "@/components/stats/range-tabs";
import { StatCards } from "@/components/stats/stat-cards";
import { ActivityCharts } from "@/components/stats/activity-charts";

export const dynamic = "force-dynamic";

export default async function PortalDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { tenantId, tenantName } = await requirePortalTenant();
  const range = rangeParam((await searchParams).range);
  const [stats, series] = await Promise.all([
    getTenantRangeStats(tenantId, range),
    getTenantSeries(tenantId, range),
  ]);

  return (
    <main>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{tenantName}</h1>
          <p className="text-sm text-muted-foreground">
            What your receptionist has been doing.
          </p>
        </div>
        <RangeTabs basePath="/portal" current={range} />
      </div>

      <div className="mt-5 space-y-3">
        <StatCards
          calls={stats.calls}
          seconds={stats.seconds}
          leads={stats.leads}
          bookings={stats.bookings}
          transfers={stats.transfers}
        />
        <ActivityCharts
          // Strip both cost fields before the RSC → client boundary; anything
          // passed here is serialized into the page payload.
          series={series.map(({ costCents: _c, llmCostCents: _l, ...p }) => p)}
          bucket={rangeBucket(range)}
        />
        <p className="text-xs text-muted-foreground/60">
          Times are UTC. Last call {fmtDate(stats.lastCallAt)}.
        </p>
      </div>
    </main>
  );
}
