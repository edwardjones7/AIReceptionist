// Magic-link landing: verifies the token_hash from the email, stamps
// last_login_at, and drops the user on the portal dashboard.

import { NextRequest, NextResponse } from "next/server";
import { portalClient } from "@/lib/portal-auth";
import { db } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const tokenHash = req.nextUrl.searchParams.get("token_hash");
  const fail = new URL("/portal/login?error=expired", req.url);
  if (!tokenHash) return NextResponse.redirect(fail);

  const supabase = await portalClient();
  const { data, error } = await supabase.auth.verifyOtp({
    type: "email",
    token_hash: tokenHash,
  });
  if (error || !data.user?.email) return NextResponse.redirect(fail);

  // Best-effort — a failed stamp must not block login.
  try {
    await db()
      .from("portal_users")
      .update({ last_login_at: new Date().toISOString() })
      .ilike("email", data.user.email);
  } catch (e) {
    console.error("last_login_at stamp failed", e);
  }

  return NextResponse.redirect(new URL("/portal", req.url));
}
