import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/section";
import { login } from "../actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto max-w-sm px-6 pt-24">
      <p className="text-xs tracking-[0.2em] text-primary">SCARLETT / ADMIN</p>
      <h1 className="mt-1 text-xl font-semibold">Operator console</h1>
      {error ? (
        <p className="mt-2 text-sm text-destructive">
          {error === "locked"
            ? "Too many attempts — try again in 15 minutes."
            : "Wrong password."}
        </p>
      ) : null}
      <Card className="mt-6 p-5">
        <form action={login}>
          <Field label="Password" name="password" type="password" />
          <Button type="submit" className="mt-4 w-full">
            Log in
          </Button>
        </form>
      </Card>
    </main>
  );
}
