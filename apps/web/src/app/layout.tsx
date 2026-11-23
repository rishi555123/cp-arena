import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CP Arena", template: "%s · CP Arena" },
  description: "One fair leaderboard across LeetCode, Codeforces and CodeChef.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1a1b23" };

// Applies the saved theme before paint (dark by default).
const themeScript = `try{if(localStorage.getItem('theme')==='light')document.documentElement.classList.add('light')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
