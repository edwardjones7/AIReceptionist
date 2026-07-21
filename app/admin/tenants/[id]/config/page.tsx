import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { getTenantRow } from "@/lib/admin-queries";
import { Section } from "@/components/section";
import ConfigEditor from "./editor";

export const dynamic = "force-dynamic";

export default async function TenantConfigPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const row = await getTenantRow(id);
  if (!row) notFound();

  const initialJson = row.config ? JSON.stringify(row.config, null, 2) : "";

  return (
    <main>
      <h1 className="text-xl font-semibold">Config — {row.name ?? id}</h1>
      <p className="text-sm text-muted-foreground">
        The full tenant config: knowledge, FAQ, voice, booking, transfer rules.
        Validated on save; live calls pick it up within ~60 seconds. Greeting or
        tool-enablement changes also need a re-provision (the assistant carries
        them on Vapi&apos;s side).
      </p>
      <Section title="tenant config (json)">
        <ConfigEditor tenantId={id} initialJson={initialJson} />
      </Section>
    </main>
  );
}
