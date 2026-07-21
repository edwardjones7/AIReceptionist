// Call transcript + recording player. Server component.

import { cn } from "@/components/lib/utils";
import type { TranscriptRow } from "@/lib/admin-queries";

export function Transcript({
  rows,
  recordingUrl,
}: {
  rows: TranscriptRow[];
  recordingUrl?: string | null;
}) {
  return (
    <div className="space-y-3">
      {recordingUrl ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio controls src={recordingUrl} className="w-full" preload="none" />
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No transcript stored.</p>
      ) : (
        rows.map((t) => (
          <div key={t.id} className="text-sm leading-relaxed">
            <span
              className={cn(
                "mr-2 text-[11px] uppercase tracking-wider",
                t.role === "assistant" ? "text-primary" : "text-muted-foreground",
              )}
            >
              {t.role === "assistant" ? "scarlett" : t.role}
            </span>
            <span className="whitespace-pre-wrap text-foreground/80">{t.text}</span>
          </div>
        ))
      )}
    </div>
  );
}
