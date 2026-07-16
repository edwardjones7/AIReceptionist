import { login } from "../actions";
import { styles, ACCENT } from "../ui";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main style={{ ...styles.page, maxWidth: 360, paddingTop: "6rem" }}>
      <p style={{ color: ACCENT, letterSpacing: "0.1em", fontSize: 12 }}>
        SCARLETT / ADMIN
      </p>
      <h1 style={styles.h1}>Operator console</h1>
      {error ? (
        <p style={{ color: "#ef4444", fontSize: 13 }}>
          {error === "locked"
            ? "Too many attempts — try again in 15 minutes."
            : "Wrong password."}
        </p>
      ) : null}
      <form action={login}>
        <label style={styles.label} htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoFocus
          style={styles.input}
        />
        <button type="submit" style={styles.button}>
          Log in
        </button>
      </form>
    </main>
  );
}
