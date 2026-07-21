"use client";

// Left sidebar for both surfaces. Admin: tenant list nav + a per-tenant group
// when inside /admin/tenants/[id]. Portal: fixed nav for the signed-in tenant.

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarCheck,
  FileJson,
  LayoutDashboard,
  Phone,
  PhoneForwarded,
  Plus,
  UserRound,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}

const TENANT_TABS = [
  ["", "Overview", LayoutDashboard, true],
  ["/calls", "Calls", Phone, false],
  ["/leads", "Leads", UserRound, false],
  ["/bookings", "Bookings", CalendarCheck, false],
  ["/transfers", "Transfers", PhoneForwarded, false],
  ["/config", "Config", FileJson, false],
] as const;

const PORTAL_NAV: NavItem[] = [
  { href: "/portal", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/portal/calls", label: "Calls", icon: Phone },
  { href: "/portal/leads", label: "Leads", icon: UserRound },
  { href: "/portal/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/portal/transfers", label: "Transfers", icon: PhoneForwarded },
];

function NavMenu({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <SidebarMenu>
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton asChild isActive={active}>
              <Link href={item.href}>
                <item.icon className="size-4" />
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

export function AppSidebar({
  variant,
  tenantName,
  footer,
}: {
  variant: "admin" | "portal";
  tenantName?: string;
  footer?: React.ReactNode;
}) {
  const pathname = usePathname();

  // Inside /admin/tenants/<id>/… surface the tenant's own nav group.
  const tenantMatch =
    variant === "admin" ? pathname.match(/^\/admin\/tenants\/([^/]+)/) : null;
  const tenantId =
    tenantMatch && tenantMatch[1] !== "new" ? tenantMatch[1] : null;

  const adminNav: NavItem[] = [
    { href: "/admin", label: "Tenants", icon: BarChart3, exact: true },
    { href: "/admin/tenants/new", label: "New tenant", icon: Plus, exact: true },
  ];

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="px-4 py-4">
        <p className="text-xs tracking-[0.2em] text-primary">
          {variant === "admin" ? "SCARLETT / ADMIN" : "SCARLETT"}
        </p>
        {variant === "portal" && tenantName ? (
          <p className="truncate text-sm text-sidebar-foreground">{tenantName}</p>
        ) : null}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <NavMenu
              items={variant === "admin" ? adminNav : PORTAL_NAV}
              pathname={pathname}
            />
          </SidebarGroupContent>
        </SidebarGroup>
        {tenantId ? (
          <SidebarGroup>
            <SidebarGroupLabel className="tracking-[0.15em]">
              {tenantId.toUpperCase()}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <NavMenu
                items={TENANT_TABS.map(([suffix, label, icon, exact]) => ({
                  href: `/admin/tenants/${tenantId}${suffix}`,
                  label,
                  icon,
                  exact,
                }))}
                pathname={pathname}
              />
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter className="px-4 py-4">{footer}</SidebarFooter>
    </Sidebar>
  );
}
