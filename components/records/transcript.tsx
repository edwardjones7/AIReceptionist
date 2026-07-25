// Call transcript + recording player. Server component.
//
// Vapi hands us the transcript as one flat string of "AI: …\nUser: …" lines,
// stored as a single row. We parse it into speaker turns here so it renders as
// a readable back-and-forth rather than one undifferentiated block.

import { cn } from "@/components/lib/utils";
import type { TranscriptRow } from "@/lib/admin-queries";

type Turn = { role: "assistant" | "user" | "other"; text: string };

const LABEL = /^\s*(AI|Assistant|Bot|Scarlett|Agent|User|Customer|Caller|Human|Speaker)\s*:\s*(.*)$/i;

function parseTurns(raw: string): Turn[] {
  const turns: Turn[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(LABEL);
    if (m) {
      const who = m[1].toLowerCase();
      const role: Turn["role"] = /ai|assistant|bot|scarlett|agent/.test(who)
        ? "assistant"
        : /user|customer|caller|human/.test(who)
          ? "user"
          : "other";
      turns.push({ role, text: m[2].trim() });
    } else if (turns.length) {
      // Continuation of the previous turn (wrapped line).
      turns[turns.length - 1].text += ` ${line.trim()}`;
    } else {
      turns.push({ role: "other", text: line.trim() });
    }
  }
  return turns.filter((t) => t.text);
}

export function Transcript({
  rows,
  recordingUrl,
}: {
  rows: TranscriptRow[];
  recordingUrl?: string | null;
}) {
  const turns = parseTurns(rows.map((r) => r.text).join("\n"));

  return (
    <div className="space-y-3">
      {recordingUrl ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio controls src={recordingUrl} className="w-full" preload="metadata" />
      ) : null}
      {turns.length === 0 ? (
        <p className="text-sm text-muted-foreground">No transcript stored.</p>
      ) : (
        turns.map((t, i) => (
          <div key={i} className="text-sm leading-relaxed">
            {t.role !== "other" ? (
              <span
                className={cn(
                  "mr-2 text-[11px] uppercase tracking-wider",
                  t.role === "assistant" ? "text-primary" : "text-muted-foreground",
                )}
              >
                {t.role === "assistant" ? "scarlett" : "caller"}
              </span>
            ) : null}
            <span className="whitespace-pre-wrap text-foreground/80">{t.text}</span>
          </div>
        ))
      )}
    </div>
  );
}
