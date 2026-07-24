// Stat card row. Cost renders only when costCents is provided — portal pages
// never pass it, so it never reaches the client there.

import { Card } from "@/components/ui/card";
import { fmtCents } from "@/lib/format";

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="gap-1 p-4">
      <p className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
        {label}
      </p>
      <p className="text-2xl font-semibold">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </Card>
  );
}

export function StatCards({
  calls,
  seconds,
  leads,
  bookings,
  transfers,
  costCents,
  llmCostCents,
}: {
  calls: number;
  seconds: number;
  leads: number;
  bookings: number;
  transfers: number;
  // Cost props are admin-only — the portal omits them entirely.
  costCents?: number;
  llmCostCents?: number;
}) {
  const showCost = costCents !== undefined;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <StatCard label="Calls" value={String(calls)} />
      <StatCard label="Minutes" value={String(Math.round(seconds / 60))} />
      <StatCard label="Leads" value={String(leads)} />
      <StatCard label="Bookings" value={String(bookings)} />
      <StatCard label="Transfers" value={String(transfers)} />
      {showCost ? (
        <>
          <StatCard label="Vapi cost" value={fmtCents(costCents!)} />
          <StatCard label="LLM cost" value={fmtCents(llmCostCents ?? 0)} />
          <StatCard
            label="Total cost"
            value={fmtCents(costCents! + (llmCostCents ?? 0))}
            sub="Vapi + Anthropic"
          />
        </>
      ) : null}
    </div>
  );
}
