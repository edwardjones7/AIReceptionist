// Server shell: sidebar + inset content area. The logout form (a server
// action) is passed in as `footer` so this file stays server-rendered.

import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";

export function Shell({
  variant,
  tenantName,
  footer,
  children,
}: {
  variant: "admin" | "portal";
  tenantName?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar variant={variant} tenantName={tenantName} footer={footer} />
      <SidebarInset>
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 md:hidden">
          <SidebarTrigger />
          <span className="text-xs tracking-[0.2em] text-primary">SCARLETT</span>
        </div>
        <div className="mx-auto w-full max-w-6xl px-6 py-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
