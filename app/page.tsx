// Minimal status surface. The real product is the phone number, not this page.
export default function Home() {
  return (
    <main style={{ padding: "4rem 2rem", maxWidth: 640 }}>
      <p style={{ color: "#a200ff", letterSpacing: "0.1em", fontSize: 12 }}>
        01 / OPERATOR
      </p>
      <h1 style={{ fontSize: 28, fontWeight: 600, marginTop: 8 }}>
        Scarlett is on the line.
      </h1>
      <p style={{ color: "#888", lineHeight: 1.6, maxWidth: 480 }}>
        Elenos AI receptionist. Answers, books discovery calls, captures leads —
        24/7. This is infrastructure, not a landing page.
      </p>
      <p style={{ color: "#555", fontSize: 12, marginTop: 32 }}>
        Endpoints: <code>/api/llm</code> · <code>/api/tools</code> ·{" "}
        <code>/api/vapi/webhook</code>
      </p>
    </main>
  );
}
