// Record tables shared by admin and portal. Server components — admin passes
// an actionSlot to embed its status-select forms; the portal renders the same
// tables readOnly with status badges.

import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { fmtDate, fmtDuration } from "@/lib/format";
import type {
  BookingRow,
  CallRow,
  LeadRow,
  TransferRow,
} from "@/lib/admin-queries";

function EmptyRow({ colSpan, page, thing }: { colSpan: number; page: number; thing: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-muted-foreground">
        No {thing} {page > 1 ? "on this page" : "yet"}.
      </TableCell>
    </TableRow>
  );
}

export function CallsTable({
  rows,
  hrefBase,
  page,
}: {
  rows: CallRow[];
  hrefBase: string;
  page: number;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>From</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead>Summary</TableHead>
          <TableHead>Recording</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((c) => (
          <TableRow key={c.id}>
            <TableCell className="whitespace-nowrap">
              <Link href={`${hrefBase}/${c.id}`} className="text-primary hover:underline">
                {fmtDate(c.started_at ?? c.created_at)}
              </Link>
            </TableCell>
            <TableCell>{c.caller_number ?? "—"}</TableCell>
            <TableCell>{fmtDuration(c.duration_sec)}</TableCell>
            <TableCell>{c.outcome ?? "—"}</TableCell>
            <TableCell className="max-w-md whitespace-normal text-muted-foreground">
              {c.summary ?? "—"}
            </TableCell>
            <TableCell>
              {c.recording_url ? (
                <a
                  href={c.recording_url}
                  className="text-primary hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  listen
                </a>
              ) : (
                "—"
              )}
            </TableCell>
          </TableRow>
        ))}
        {rows.length === 0 ? <EmptyRow colSpan={6} page={page} thing="calls" /> : null}
      </TableBody>
    </Table>
  );
}

export function LeadsTable({
  rows,
  page,
  actionSlot,
}: {
  rows: LeadRow[];
  page: number;
  actionSlot?: (row: LeadRow) => React.ReactNode;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Contact</TableHead>
          <TableHead>Intent</TableHead>
          <TableHead>Details</TableHead>
          <TableHead>Qualified</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((l) => (
          <TableRow key={l.id}>
            <TableCell className="whitespace-nowrap">{fmtDate(l.created_at)}</TableCell>
            <TableCell>{l.name || "—"}</TableCell>
            <TableCell>{[l.phone, l.email].filter(Boolean).join(" · ") || "—"}</TableCell>
            <TableCell>{l.intent ?? "—"}</TableCell>
            <TableCell className="max-w-sm whitespace-normal text-muted-foreground">
              {l.details ?? "—"}
            </TableCell>
            <TableCell>{l.qualified ? "yes" : "no"}</TableCell>
            <TableCell className="whitespace-nowrap">
              {actionSlot ? actionSlot(l) : <StatusBadge status={l.status ?? "new"} />}
            </TableCell>
          </TableRow>
        ))}
        {rows.length === 0 ? <EmptyRow colSpan={7} page={page} thing="leads" /> : null}
      </TableBody>
    </Table>
  );
}

export function BookingsTable({
  rows,
  page,
  actionSlot,
}: {
  rows: BookingRow[];
  page: number;
  actionSlot?: (row: BookingRow) => React.ReactNode;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Slot</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Contact</TableHead>
          <TableHead>Booked</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((b) => (
          <TableRow key={b.id}>
            <TableCell className="whitespace-nowrap">{fmtDate(b.slot_start)}</TableCell>
            <TableCell>{b.type ?? "—"}</TableCell>
            <TableCell>{b.name || "—"}</TableCell>
            <TableCell>{[b.phone, b.email].filter(Boolean).join(" · ") || "—"}</TableCell>
            <TableCell className="whitespace-nowrap">{fmtDate(b.created_at)}</TableCell>
            <TableCell className="whitespace-nowrap">
              {actionSlot ? actionSlot(b) : <StatusBadge status={b.status ?? "confirmed"} />}
            </TableCell>
          </TableRow>
        ))}
        {rows.length === 0 ? <EmptyRow colSpan={6} page={page} thing="bookings" /> : null}
      </TableBody>
    </Table>
  );
}

export function TransfersTable({
  rows,
  page,
  callHrefBase,
}: {
  rows: TransferRow[];
  page: number;
  callHrefBase?: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>To</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Call</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((t) => (
          <TableRow key={t.id}>
            <TableCell className="whitespace-nowrap">{fmtDate(t.ts)}</TableCell>
            <TableCell>
              {t.status ? <StatusBadge status={t.status} /> : "—"}
            </TableCell>
            <TableCell>{t.to_number ?? "—"}</TableCell>
            <TableCell className="max-w-md whitespace-normal text-muted-foreground">
              {t.reason ?? t.summary ?? "—"}
            </TableCell>
            <TableCell>
              {t.call_id && callHrefBase ? (
                <Link
                  href={`${callHrefBase}/${t.call_id}`}
                  className="text-primary hover:underline"
                >
                  view
                </Link>
              ) : (
                "—"
              )}
            </TableCell>
          </TableRow>
        ))}
        {rows.length === 0 ? <EmptyRow colSpan={5} page={page} thing="transfers" /> : null}
      </TableBody>
    </Table>
  );
}
