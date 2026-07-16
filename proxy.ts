// Root proxy (Next 16's middleware): gate /admin pages behind the signed
// admin session cookie. Server actions are re-checked inside each action via
// requireAdmin() — this only covers page navigation.

import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, verifySessionValue } from "./lib/admin-session";

export default async function proxy(req: NextRequest) {
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

export const config = {
  matcher: ["/admin/:path*"],
};
