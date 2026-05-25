import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Game Bank",
  description: "A local multiplayer banking app for tabletop games."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
