// Time-range switcher. Pure links (?range=…) — zero client JS; the page
// re-renders server-side with the new range.

import Link from "next/link";
import { cn } from "@/components/lib/utils";
import { RANGES, type StatRange } from "@/lib/analytics-queries";

export function RangeTabs({
  basePath,
  current,
}: {
  basePath: string;
  current: StatRange;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
      {RANGES.map((r) => (
        <Link
          key={r.value}
          href={r.value === "1m" ? basePath : `${basePath}?range=${r.value}`}
          className={cn(
            "rounded-md px-3 py-1 text-xs tracking-wider transition-colors",
            r.value === current
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {r.label}
        </Link>
      ))}
    </div>
  );
}
