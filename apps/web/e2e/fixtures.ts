import { test as base, type Page } from "@playwright/test";

/**
 * Fixtures that put the app in a signed-in, offline-from-the-server state.
 *
 * WHY STUB RATHER THAN SIGN IN FOR REAL. A spec that authenticates against the live project needs
 * credentials in the repo or the CI environment, and every run writes to the real database. Both
 * are bad trades for tests whose subject is the UI. Stubbing at the network layer exercises the
 * whole real stack below the network — Dexie, the outbox, the sync engine, every component — with
 * no secrets and nothing to clean up.
 *
 * The app is genuinely designed for this: reads never touch the network (ADR 0001 decision 3), so
 * a stubbed server is not a reduced version of the app. It is the app on a bad train connection,
 * which is a state it is supposed to handle perfectly.
 */

const SUPABASE_HOST = "https://e2e.supabase.co";
const SESSION = {
  access_token: "e2e-access-token",
  token_type: "bearer",
  // Far future, so the client never tries to refresh mid-spec.
  expires_at: 4_102_444_800,
  expires_in: 3_600,
  refresh_token: "e2e-refresh-token",
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: "e2e@example.com",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
  },
};

export interface ServerState {
  /** Rows the stubbed PostgREST returns from a pull, keyed by table. */
  rows: Record<string, unknown[]>;
  /** Everything the app has tried to upsert, in order. */
  upserts: Array<{ table: string; rows: unknown[] }>;
  /** When true, every request fails — the "Wi-Fi is off" switch. */
  offline: boolean;
}

/** Intercept every Supabase call. Nothing leaves the browser. */
export async function stubSupabase(page: Page, state: ServerState): Promise<void> {
  await page.route(
    (url) => url.host === new URL(SUPABASE_HOST).host,
    async (route) => {
      if (state.offline) {
        await route.abort("connectionfailed");
        return;
      }

      const url = new URL(route.request().url());

      if (url.pathname.startsWith("/auth/v1/")) {
        // `/token?grant_type=password` is what the login form hits; everything else that matters
        // (`/user`, refresh) is answered from the same fixture session.
        await route.fulfill({ json: url.pathname.endsWith("/user") ? SESSION.user : SESSION });
        return;
      }

      if (url.pathname.startsWith("/rest/v1/")) {
        const table = url.pathname.replace("/rest/v1/", "");

        if (route.request().method() === "GET") {
          await route.fulfill({ json: state.rows[table] ?? [] });
          return;
        }

        // POST with an on_conflict target — the drain's full-row upsert.
        const body = route.request().postDataJSON() as unknown;
        state.upserts.push({ table, rows: Array.isArray(body) ? body : [body] });
        await route.fulfill({ status: 201, json: [] });
        return;
      }

      // Realtime's websocket handshake, and anything else.
      await route.fulfill({ status: 200, json: {} });
      },
  );
}

/*
 * `auto: true` is load-bearing. Playwright fixtures are LAZY — one that no test destructures
 * simply never runs. Without it, only the spec that asks for `server` gets the stub, and every
 * other spec quietly hits the real network and fails on DNS. The failure looks like a broken app
 * rather than a broken fixture, which is exactly how it wasted twenty minutes.
 */
export const test = base.extend<{ server: ServerState }>({
  server: [
    async ({ page }, use) => {
      const state: ServerState = { rows: {}, upserts: [], offline: false };
      await stubSupabase(page, state);
      await use(state);
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";

/**
 * Sign in through the real login form, then wait for the shell.
 *
 * SIGNING IN FOR REAL rather than seeding a session into storage. `@supabase/ssr` keeps the
 * session in chunked, base64-prefixed cookies whose exact layout is an internal detail — a spec
 * that hand-writes them tests my reading of that library's source, and breaks silently on any
 * upgrade. Driving the form means the app writes the session in whatever shape it likes, and the
 * login path gets covered for free.
 *
 * Boot is then genuinely async: the session is read back, the device id comes from Dexie, and
 * children do not render until a write context exists. Waiting on the sidebar rather than on
 * `networkidle` waits for the thing the specs actually need.
 */
export async function signIn(page: Page, route = "/today"): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill("e2e@example.com");
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForApp(page);

  if (route !== "/today") await visit(page, route);
}

/**
 * Navigate, then wait for the shell again.
 *
 * The wait is not optional. Keyboard handlers register when the panes mount, and the panes do not
 * mount until the write context resolves — so a `goto` followed immediately by a keypress sends
 * it into a page with no listeners, and the spec fails claiming the shortcut is broken.
 */
export async function visit(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await waitForApp(page);
}

export async function waitForApp(page: Page): Promise<void> {
  await page
    .getByRole("navigation", { name: "Main" })
    .waitFor({ state: "visible", timeout: 20_000 });
}
