"use client";

// Admin-only Vapi cost chart. Kept in its own file so cost data can never
// reach the portal bundle or flight payload.

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { Bucket } from "@/lib/analytics-queries";
import { bucketTickFormatter } from "./activity-charts";

const config = {
  vapi: { label: "Vapi", color: "var(--chart-5)" },
  llm: { label: "LLM", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function CostChart({
  series,
  bucket,
}: {
  series: { bucket: string; costCents: number; llmCostCents: number }[];
  bucket: Bucket;
}) {
  const tick = bucketTickFormatter(bucket);
  const data = series.map((p) => ({
    bucket: p.bucket,
    vapi: p.costCents / 100,
    llm: p.llmCostCents / 100,
  }));
  return (
    <Card className="gap-3 p-4">
      <p className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
        Cost — Vapi + LLM
      </p>
      <ChartContainer config={config} className="h-40 w-full">
        <BarChart data={data} margin={{ left: -14 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="bucket" tickFormatter={tick} tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
          <YAxis tickFormatter={(v: number) => `$${v}`} tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={tick}
                formatter={(value) => `$${Number(value).toFixed(2)}`}
              />
            }
          />
          <Bar dataKey="vapi" stackId="c" fill="var(--color-vapi)" radius={[0, 0, 3, 3]} />
          <Bar dataKey="llm" stackId="c" fill="var(--color-llm)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </Card>
  );
}
