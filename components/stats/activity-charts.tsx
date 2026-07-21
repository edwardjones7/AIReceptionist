"use client";

// Trend charts for both surfaces. The props type deliberately has no cost
// field — cost is admin-only and lives in cost-chart.tsx.

import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { Bucket } from "@/lib/analytics-queries";

export interface ActivityPoint {
  bucket: string;
  calls: number;
  minutes: number;
  leads: number;
  bookings: number;
}

export function bucketTickFormatter(bucket: Bucket) {
  // Loose param type: recharts passes string ticks but types tooltip labels
  // as ReactNode.
  return (iso: unknown) => {
    const d = new Date(String(iso));
    if (bucket === "month") {
      return d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
    }
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  };
}

const callsConfig = {
  calls: { label: "Calls", color: "var(--chart-1)" },
} satisfies ChartConfig;

const minutesConfig = {
  minutes: { label: "Minutes", color: "var(--chart-1)" },
} satisfies ChartConfig;

const outcomesConfig = {
  leads: { label: "Leads", color: "var(--chart-2)" },
  bookings: { label: "Bookings", color: "var(--chart-3)" },
} satisfies ChartConfig;

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="gap-3 p-4">
      <p className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
        {title}
      </p>
      {children}
    </Card>
  );
}

const AXIS = {
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
  fontSize: 11,
} as const;

export function ActivityCharts({
  series,
  bucket,
}: {
  series: ActivityPoint[];
  bucket: Bucket;
}) {
  const tick = bucketTickFormatter(bucket);
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <ChartCard title="Calls">
        <ChartContainer config={callsConfig} className="h-56 w-full">
          <BarChart data={series} margin={{ left: -20 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tickFormatter={tick} {...AXIS} />
            <YAxis allowDecimals={false} {...AXIS} />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={tick} />} />
            <Bar dataKey="calls" fill="var(--color-calls)" radius={3} />
          </BarChart>
        </ChartContainer>
      </ChartCard>
      <ChartCard title="Minutes">
        <ChartContainer config={minutesConfig} className="h-56 w-full">
          <AreaChart data={series} margin={{ left: -20 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tickFormatter={tick} {...AXIS} />
            <YAxis allowDecimals={false} {...AXIS} />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={tick} />} />
            <Area
              dataKey="minutes"
              stroke="var(--color-minutes)"
              fill="var(--color-minutes)"
              fillOpacity={0.15}
              type="monotone"
            />
          </AreaChart>
        </ChartContainer>
      </ChartCard>
      <ChartCard title="Leads and bookings">
        <ChartContainer config={outcomesConfig} className="h-56 w-full lg:col-span-1">
          <BarChart data={series} margin={{ left: -20 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tickFormatter={tick} {...AXIS} />
            <YAxis allowDecimals={false} {...AXIS} />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={tick} />} />
            <Bar dataKey="leads" stackId="a" fill="var(--color-leads)" radius={[0, 0, 3, 3]} />
            <Bar dataKey="bookings" stackId="a" fill="var(--color-bookings)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </ChartCard>
    </div>
  );
}
