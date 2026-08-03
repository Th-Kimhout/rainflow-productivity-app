import type { MetadataRoute } from "next";

/**
 * The web app manifest, so "Add to Home Screen" installs an app rather than bookmarking a page.
 *
 * This is a prerequisite for something else rather than a nicety: **iOS Safari has ignored
 * `maximum-scale` since iOS 10**, for accessibility, and only honours it when the page is running
 * standalone. So the viewport cap in `layout.tsx` that stops the zoom-into-inputs behaviour does
 * nothing at all until the app is launched from the homescreen — which needs this file and the
 * `appleWebApp` block beside it.
 *
 * Emitted as a static file at build time, so it costs the §7.1 budget nothing.
 *
 * ONE THING IT DOES NOT BUY: offline launch. There is no service worker (ADR 0001 decision 3, and
 * Serwist needs a `webpack` key which Turbopack rejects outright), so a cold start with no network
 * still fails — the HTML has to come over the wire. Installing changes how the app is framed, not
 * what it can do without a connection.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RainFlow",
    short_name: "RainFlow",
    description: "Personal productivity platform — tasks, timeboxing, focus, and habits.",
    // Straight into the daily view, not `/`, which only redirects.
    start_url: "/today",
    scope: "/",
    display: "standalone",
    // Both slate 900: the splash background and the system chrome match the app's own canvas, so
    // launching does not flash white.
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      /*
       * Android crops an adaptive icon to a shape of the launcher's choosing, so the maskable
       * variant keeps the mark inside the 80% safe circle. Without one, Android generates its own
       * by putting the "any" icon on a white plate — which would put a dark square in a circle.
       */
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
