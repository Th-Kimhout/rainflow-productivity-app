import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end specs.
 *
 * HERMETIC BY CONSTRUCTION. The dev server is started with a fake Supabase URL and key, and every
 * request to that host is intercepted in `e2e/fixtures.ts`. So these specs need no credentials, no
 * network, and cannot touch the real database — which means they run identically on a laptop and
 * in CI, and a broken spec can never corrupt real data.
 *
 * Real environment variables take precedence over `.env.local` in Next, so setting them here is
 * enough to override whatever is on the developer's machine.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: "http://127.0.0.1:3100",
    // Only kept for a failure. A trace per passing test is gigabytes for no benefit.
    trace: "retain-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    /*
     * A real phone profile: 412×839, `hasTouch`, `isMobile`. The touch flag is the point — the
     * whole class of bug this project exists to catch is code that only responds to a mouse, and
     * a narrow desktop window would pass every one of those.
     *
     * Pixel rather than an iPhone descriptor purely so it runs on Chromium: the iPhone profiles
     * default to WebKit, which is a second browser to install for a difference this suite does
     * not test. The layout is CSS and the gestures are pointer events; neither is engine-specific
     * here.
     */
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],

  webServer: {
    /*
     * BUILD AND START, not `dev`. Two reasons, and the second is the one that forced it:
     *
     *   * These specs then run against the bundle that actually ships, including the static
     *     prerendering every route depends on.
     *   * Next 16 refuses to start a second dev server for a directory that already has one, so
     *     `dev` here fails outright on any machine where the app is already open — which is
     *     every machine anyone would run these on.
     *
     * `NEXT_PUBLIC_*` is inlined at BUILD time, so the fake values have to be set for the build
     * step, not just the server. Real environment variables take precedence over `.env.local`,
     * so this overrides whatever is on the developer's machine.
     */
    command: "pnpm build && pnpm start --port 3100",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://e2e.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "e2e-publishable-key",
    },
  },
});
