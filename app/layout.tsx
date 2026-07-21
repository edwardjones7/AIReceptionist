import "./globals.css";

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
      <body>{children}</body>
    </html>
  );
}
