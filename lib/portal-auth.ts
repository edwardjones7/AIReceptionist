// Client-portal auth. Server-only. Supabase Auth (magic links) provides the
// session; authorization is ours: every request re-resolves the signed-in
// email to a tenant via portal_users (service role), so removing a portal
// user in /admin locks them out immediately.

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { env } from "./env";
import { db } from "./supabase";

export async function portalClient() {
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // Server Components can't write cookies; the proxy refreshes
        // sessions. Swallow the error per @supabase/ssr guidance.
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {}
      },
    },
  });
}

// getUser() re-validates the JWT against the auth server — never trust
// getSession() server-side.
export const getPortalUser = cache(async (): Promise<{ email: string } | null> => {
  // Portal auth not configured yet — every visitor is logged-out, silently.
  if (!process.env.SUPABASE_ANON_KEY) return null;
  // No session must render as logged-out, not crash the login page.
  try {
    const supabase = await portalClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) return null;
    return { email: user.email.toLowerCase() };
  } catch (e) {
    console.error("getPortalUser failed", e);
    return null;
  }
});

export interface PortalTenant {
  tenantId: string;
  tenantName: string;
  email: string;
}

export const requirePortalTenant = cache(async (): Promise<PortalTenant> => {
  const user = await getPortalUser();
  if (!user) redirect("/portal/login");

  const { data: mapping, error } = await db()
    .from("portal_users")
    .select("tenant_id")
    .ilike("email", user.email)
    .maybeSingle();
  if (error) throw error;
  if (!mapping) {
    const supabase = await portalClient();
    await supabase.auth.signOut();
    redirect("/portal/login?error=no-access");
  }

  const { data: tenant } = await db()
    .from("tenants")
    .select("name")
    .eq("id", mapping.tenant_id)
    .maybeSingle();

  return {
    tenantId: mapping.tenant_id,
    tenantName: tenant?.name ?? mapping.tenant_id,
    email: user.email,
  };
});
