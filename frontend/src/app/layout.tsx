import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hetzner SB Explorer",
  description: "Filter and compare Hetzner Serverboerse servers from local SQLite snapshots.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
