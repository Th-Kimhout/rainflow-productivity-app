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
  /*
   * Homescreen launch. `capable` emits `apple-mobile-web-app-capable`, which is what actually
   * makes iOS run this without Safari's chrome — the manifest's `display: standalone` is only
   * honoured from iOS 17, and this is the part that has worked for a decade.
   *
   * `black-translucent` puts the app's own background under the status bar rather than leaving a
   * light strip above a slate-900 canvas. It comes with an obligation, discharged on <body>: the
   * page now extends into the status bar, so the top has to pad itself with
   * `env(safe-area-inset-top)` or the first row of every header sits under the clock.
   */
  appleWebApp: {
    capable: true,
    title: "RainFlow",
    statusBarStyle: "black-translucent",
  },
  /*
   * `capable: true` above emits only the standardised `mobile-web-app-capable` in Next 16, and
   * the Apple-prefixed name is what iOS honoured for a decade before adopting it. Emitting both
   * costs one tag; getting it wrong costs standalone mode, and with it the `maximum-scale` cap —
   * which Safari only respects when installed. Checked against the built HTML, not assumed.
   */
  other: { "apple-mobile-web-app-capable": "yes" },
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
   * NO ZOOM. This is the fix for iOS magnifying the page whenever a control smaller than 16px
   * takes focus — and never zooming back out, so one tap on a filter box leaves the app
   * permanently enlarged and scrolling sideways.
   *
   * It is normally the wrong fix, because it takes pinch-zoom away from everyone to solve one
   * app's problem. Here it is the right one: RainFlow is single-user, installed to a homescreen,
   * and its own 12–14px type (§4.1) is the thing being protected.
   *
   * IT ONLY WORKS INSTALLED. Safari has ignored `maximum-scale` since iOS 10 and always permits
   * pinch-zoom in a tab; the standalone web view honours it. So a Safari tab still needs the
   * 16px-controls rule, which is why globals.css keeps that rule scoped to `display-mode:
   * browser` rather than dropping it.
   */
  maximumScale: 1,
  userScalable: false,
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
       *
       * The top inset is the other half of `statusBarStyle: "black-translucent"`: installed to a
       * homescreen the page runs edge to edge, under the clock and the notch, so it has to hold
       * that space back itself. Zero everywhere else, and inside the height rather than added to
       * it, because `border-box` is Tailwind's default.
       */
      }
      <body className="flex h-dvh flex-col overflow-hidden pt-[env(safe-area-inset-top)]">
        {children}
      </body>
    </html>
  );
}
