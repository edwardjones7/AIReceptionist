// Root proxy (Next 16's middleware). Two gates:
//   /admin  — signed admin session cookie (single operator).
//   /portal — Supabase Auth session (per-tenant client logins); this also
//             refreshes expired tokens, so the mutated response must be
//             returned. Tenant authorization happens in requirePortalTenant()
//             on every page — this only covers navigation.
// Env is read from process.env directly (same pattern as lib/admin-session.ts)
// so lib/env.ts stays out of the proxy.

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { ADMIN_COOKIE, verifySessionValue } from "./lib/admin-session";

async function adminGate(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/admin/login") return NextResponse.next();

  const ok = await verifySessionValue(req.cookies.get(ADMIN_COOKIE)?.value);
  if (!ok) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

async function portalGate(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/portal/login" || pathname.startsWith("/portal/auth")) {
    return NextResponse.next();
  }

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    const to = req.nextUrl.clone();
    to.pathname = "/portal/login";
    to.search = "";
    return NextResponse.redirect(to);
  }

  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (cookiesToSet) => {
        // Both sides of the dance: the request (so this pass sees the fresh
        // token) and the response (so the browser keeps it).
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        cookiesToSet.forEach(({ name, value, options }) =>
          res.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const to = req.nextUrl.clone();
    to.pathname = "/portal/login";
    to.search = "";
    return NextResponse.redirect(to);
  }
  return res;
}

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/portal")) return portalGate(req);
  return adminGate(req);
}

export const config = {
  matcher: ["/admin/:path*", "/portal/:path*"],
};
