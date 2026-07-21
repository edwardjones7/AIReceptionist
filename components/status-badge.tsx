// Status pill with the existing green/yellow/red semantics.

import { cn } from "@/components/lib/utils";

const COLORS: Record<string, string> = {
  // tenant
  active: "text-green-500 border-green-500/30",
  draft: "text-yellow-500 border-yellow-500/30",
  paused: "text-red-500 border-red-500/30",
  // leads
  new: "text-yellow-500 border-yellow-500/30",
  contacted: "text-blue-400 border-blue-400/30",
  qualified: "text-green-500 border-green-500/30",
  converted: "text-green-500 border-green-500/30",
  closed: "text-muted-foreground border-border",
  // bookings
  confirmed: "text-green-500 border-green-500/30",
  completed: "text-muted-foreground border-border",
  cancelled: "text-red-500 border-red-500/30",
  no_show: "text-red-500 border-red-500/30",
  // transfers
  transferred: "text-green-500 border-green-500/30",
  callback_captured: "text-yellow-500 border-yellow-500/30",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full border px-2.5 py-0.5 text-[11px] tracking-wider",
        COLORS[status] ?? "text-red-500 border-red-500/30",
      )}
    >
      {status}
    </span>
  );
}
