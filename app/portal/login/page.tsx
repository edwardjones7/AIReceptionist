import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/section";
import { sendMagicLink } from "../actions";

const ERRORS: Record<string, string> = {
  "no-access": "That account does not have portal access. Contact your provider.",
  expired: "That sign-in link has expired or was already used. Request a new one.",
  "bad-email": "Enter a valid email address.",
  "send-failed": "Could not send the link. Try again in a minute.",
};

export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;
  return (
    <main className="mx-auto max-w-sm px-6 pt-24">
      <p className="text-xs tracking-[0.2em] text-primary">SCARLETT</p>
      <h1 className="mt-1 text-xl font-semibold">Client portal</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        See everything your receptionist is doing — calls, leads, bookings.
      </p>
      {error ? (
        <p className="mt-3 text-sm text-destructive">
          {ERRORS[error] ?? "Something went wrong."}
        </p>
      ) : null}
      {sent ? (
        <Card className="mt-6 p-5">
          <p className="text-sm">
            If that email has portal access, a sign-in link is on its way.
            Check your inbox.
          </p>
        </Card>
      ) : (
        <Card className="mt-6 p-5">
          <form action={sendMagicLink}>
            <Field
              label="Email"
              name="email"
              type="email"
              placeholder="you@company.com"
            />
            <Button type="submit" className="mt-4 w-full">
              Email me a sign-in link
            </Button>
          </form>
        </Card>
      )}
    </main>
  );
}
