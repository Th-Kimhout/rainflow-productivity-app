import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

/*
 * §4.1 specifies `Inter, -apple-system, BlinkMacSystemFont, Segoe UI`. The variable is named
 * --font-sans because that is what globals.css's @theme block reads; shadcn init wired
 * --font-geist-sans, which left --font-sans undefined.
 */
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
  fallback: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
});

/* Monospace is not specified in §4.1; needed for §3.5's syntax-highlighted code fences. */
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "RainFlow",
  description: "Personal productivity platform — tasks, timeboxing, focus, and habits.",
  applicationName: "RainFlow",
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    /*
     * `dark` is hardcoded rather than media-query driven: §4.1 states dark mode is
     * prioritised to reduce eye strain, and this is a single-user app with no theme toggle.
     */
    <html
      lang="en"
      className={`dark ${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
