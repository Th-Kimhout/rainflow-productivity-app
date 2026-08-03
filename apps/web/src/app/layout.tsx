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
  /*
   * Next already emits `width=device-width, initial-scale=1`; `viewportFit` is the part it does
   * not assume. Without it the page is letterboxed inside the safe area on a notched phone, and
   * the bottom nav floats above a dead strip instead of meeting the edge of the screen. The
   * inverse obligation comes with it: anything pinned to an edge has to pad itself with
   * `env(safe-area-inset-*)`, or it lands under the home indicator.
   */
  viewportFit: "cover",
  /*
   * Deliberately NOT capping `maximumScale`. It is the usual one-line cure for iOS zooming into
   * a focused input, and it works by disabling pinch-zoom for everyone, permanently. The cure is
   * in globals.css instead: form controls go to 16px on phone widths, which is the size iOS is
   * actually asking for.
   */
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
      {/*
       * `100dvh` rather than `h-full`, and the app frame is exactly the viewport.
       *
       * `height: 100%` resolves against the *large* viewport on mobile Safari — the one that
       * assumes the URL bar is hidden — so the status bar and the bottom nav sat below the fold
       * until you scrolled, and the page scrolled as a whole because it genuinely was too tall.
       * `dvh` tracks the visible height as the browser chrome slides away.
       *
       * `overflow-hidden` then makes "the page never scrolls, panes do" structural rather than
       * incidental. Anything that needs to scroll says so.
       */
      }
      <body className="flex h-dvh flex-col overflow-hidden">{children}</body>
    </html>
  );
}
