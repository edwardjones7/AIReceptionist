"use server";

// Portal auth actions. sendMagicLink deliberately reports "sent" whether or
// not the email is known — no account enumeration.

import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase";
import { portalClient } from "@/lib/portal-auth";

function baseUrl(): string {
  return env.publicBaseUrl || "http://localhost:3000";
}

export async function sendMagicLink(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email || !email.includes("@")) redirect("/portal/login?error=bad-email");

  // Only emails an operator has granted access get a link.
  const { data: mapping, error } = await db()
    .from("portal_users")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (error) {
    console.error("portal_users lookup failed", error);
    redirect("/portal/login?sent=1");
  }
  if (!mapping) redirect("/portal/login?sent=1");

  const supabase = await portalClient();
  const { error: otpError } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${baseUrl()}/portal/auth/confirm`,
    },
  });
  if (otpError) {
    console.error("signInWithOtp failed", otpError);
    redirect("/portal/login?error=send-failed");
  }
  redirect("/portal/login?sent=1");
}

export async function portalLogout(): Promise<void> {
  const supabase = await portalClient();
  await supabase.auth.signOut();
  redirect("/portal/login");
}
