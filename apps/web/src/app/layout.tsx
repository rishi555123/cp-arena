import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CP Arena", template: "%s · CP Arena" },
  description: "One fair leaderboard across LeetCode, Codeforces and CodeChef.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1a1b23" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Dark by default; the toggle stores "light" in a cookie so the server renders the right class (no flash, no inline script).
  const light = (await cookies()).get("theme")?.value === "light";
  return (
    <html lang="en" className={light ? "light" : undefined} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
