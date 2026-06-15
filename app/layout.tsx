export const metadata = {
  title: "Scarlett — Elenos Receptionist",
  description: "Operators, not chatbots.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#0a0a0a",
          color: "#ededed",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
        }}
      >
        {children}
      </body>
    </html>
  );
}
