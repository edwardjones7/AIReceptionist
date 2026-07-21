// Titled card section — the primary layout primitive on detail pages.

import { Card } from "@/components/ui/card";

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="mt-4 gap-3 p-5">
      <p className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
        {title}
      </p>
      {children}
    </Card>
  );
}

// Labeled text input for server-action forms.
export function Field({
  label,
  name,
  defaultValue,
  placeholder,
  type,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="mt-3">
      <label
        htmlFor={name}
        className="mb-1 block text-[11px] uppercase tracking-[0.1em] text-muted-foreground"
      >
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type ?? "text"}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  );
}

// Key-value rows used on detail/overview cards.
export function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-border/50 last:border-0">
            <td className="w-56 py-2 text-muted-foreground">{k}</td>
            <td className="py-2">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
