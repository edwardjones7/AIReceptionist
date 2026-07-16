// Shared presentational bits for the admin dashboard. Server components only —
// keep the Elenos look: dark, monospace, purple accent, no hype.

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";

export const ACCENT = "#a200ff";

export const styles = {
  page: {
    padding: "2rem",
    maxWidth: 1100,
    margin: "0 auto",
  } as CSSProperties,
  h1: { fontSize: 22, fontWeight: 600, margin: "0 0 4px" } as CSSProperties,
  dim: { color: "#888" } as CSSProperties,
  faint: { color: "#555", fontSize: 12 } as CSSProperties,
  card: {
    border: "1px solid #262626",
    borderRadius: 8,
    padding: "1.25rem",
    background: "#111",
    marginTop: 16,
  } as CSSProperties,
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 13,
    marginTop: 8,
  } as CSSProperties,
  th: {
    textAlign: "left" as const,
    color: "#666",
    fontWeight: 500,
    fontSize: 11,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    padding: "8px 12px 8px 0",
    borderBottom: "1px solid #262626",
  } as CSSProperties,
  td: {
    padding: "10px 12px 10px 0",
    borderBottom: "1px solid #1a1a1a",
    verticalAlign: "top" as const,
  } as CSSProperties,
  input: {
    width: "100%",
    boxSizing: "border-box" as const,
    background: "#0a0a0a",
    color: "#ededed",
    border: "1px solid #333",
    borderRadius: 6,
    padding: "8px 10px",
    fontFamily: "inherit",
    fontSize: 13,
  } as CSSProperties,
  label: {
    display: "block",
    color: "#888",
    fontSize: 11,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    margin: "14px 0 4px",
  } as CSSProperties,
  button: {
    background: ACCENT,
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "9px 18px",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 16,
  } as CSSProperties,
  buttonGhost: {
    background: "transparent",
    color: "#aaa",
    border: "1px solid #333",
    borderRadius: 6,
    padding: "9px 18px",
    fontFamily: "inherit",
    fontSize: 13,
    cursor: "pointer",
  } as CSSProperties,
  link: { color: ACCENT, textDecoration: "none" } as CSSProperties,
};

export function Badge({ status }: { status: string }) {
  const color =
    status === "active" ? "#22c55e" : status === "draft" ? "#eab308" : "#ef4444";
  return (
    <span
      style={{
        color,
        border: `1px solid ${color}44`,
        borderRadius: 999,
        padding: "2px 10px",
        fontSize: 11,
        letterSpacing: "0.05em",
      }}
    >
      {status}
    </span>
  );
}

export function Field({
  label,
  name,
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label style={styles.label} htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        style={styles.input}
      />
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={styles.card}>
      <p style={{ ...styles.faint, letterSpacing: "0.1em", margin: "0 0 8px" }}>
        {title.toUpperCase()}
      </p>
      {children}
    </section>
  );
}

// "← Newer / Older →" links driven by a ?page= search param.
export function Pager({
  basePath,
  page,
  hasMore,
}: {
  basePath: string;
  page: number;
  hasMore: boolean;
}) {
  if (page <= 1 && !hasMore) return null;
  return (
    <p style={{ display: "flex", gap: 18, fontSize: 13, marginTop: 12 }}>
      {page > 1 ? (
        <Link href={`${basePath}?page=${page - 1}`} style={styles.link}>
          ← Newer
        </Link>
      ) : null}
      {hasMore ? (
        <Link href={`${basePath}?page=${page + 1}`} style={styles.link}>
          Older →
        </Link>
      ) : null}
    </p>
  );
}

export function pageParam(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 1 ? n : 1;
}

export function fmtDate(iso: string | null | undefined, tz?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// "12 calls · 43 min · $8.12" — month-to-date usage line (UTC month).
export function fmtUsage(calls: number, seconds: number, costCents: number): string {
  return `${calls} call${calls === 1 ? "" : "s"} · ${Math.round(seconds / 60)} min · ${fmtCents(costCents)}`;
}
