import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";

// Tenant sub-nav lives in the sidebar (components/shell/app-sidebar.tsx);
// this layout only adds the breadcrumb.
export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  return (
    <div>
      <p className="mb-4 text-xs text-muted-foreground/60">
        <Link href="/admin" className="text-primary hover:underline">
          tenants
        </Link>{" "}
        / {id}
      </p>
      {children}
    </div>
  );
}
