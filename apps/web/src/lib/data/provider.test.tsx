import type { Session } from "@supabase/supabase-js";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for the DataProvider boot sequence.
 *
 * These exist because of a real crash: `ctx` is resolved asynchronously (it reads the device id
 * from Dexie), so for one render after a session appeared it was still null — and every
 * component calls `useWriteContext` at the top level, so the app died with
 * "No write context — the sync engine has not booted" before painting anything.
 *
 * A passing `next build` cannot catch that; the types were all satisfied. Only mounting the
 * thing does.
 */

// The real client would open a Realtime WebSocket and hit the network on boot.
const subscribeSpy = vi.fn(() => () => {});
vi.mock("@/lib/supabase/client", () => ({
  getSupabase: () => ({
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
    from: () => ({
      select: () => ({
        gte: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
      }),
      upsert: async () => ({ error: null }),
    }),
  }),
}));

const { DataProvider, useWriteContext, useData } = await import("./provider");

const FAKE_SESSION = {
  access_token: "test",
  refresh_token: "test",
  expires_in: 3600,
  token_type: "bearer",
  user: { id: "67d57c57-0000-4000-8000-000000000000" },
} as unknown as Session;

/** Mimics every real consumer: reads the write context at the top level, unconditionally. */
function WriteConsumer() {
  const { ctx } = useWriteContext();
  return <p>client:{ctx.clientId.slice(0, 8)}</p>;
}

function StatusConsumer() {
  const { status } = useData();
  return <p>phase:{status.phase}</p>;
}

describe("DataProvider boot", () => {
  beforeEach(() => {
    subscribeSpy.mockClear();
  });

  it("does not render children until the write context exists", async () => {
    render(
      <DataProvider session={FAKE_SESSION}>
        <WriteConsumer />
      </DataProvider>,
    );

    // The gate, before the async device-id read resolves.
    expect(screen.getByText(/Opening local database/i)).toBeDefined();

    // Then children mount — crucially, without throwing.
    await waitFor(() => expect(screen.getByText(/^client:/)).toBeDefined());
  });

  it("gives a consumer a usable, non-null write context", async () => {
    render(
      <DataProvider session={FAKE_SESSION}>
        <WriteConsumer />
      </DataProvider>,
    );

    await waitFor(() => {
      const el = screen.getByText(/^client:/);
      // A real uuid prefix, not "undefined" — proves the id came from Dexie.
      expect(el.textContent).toMatch(/^client:[0-9a-f]{8}$/);
    });
  });

  it("keeps the same device id across remounts", async () => {
    const first = render(
      <DataProvider session={FAKE_SESSION}>
        <WriteConsumer />
      </DataProvider>,
    );
    await waitFor(() => expect(screen.getByText(/^client:/)).toBeDefined());
    const idA = screen.getByText(/^client:/).textContent;
    first.unmount();

    render(
      <DataProvider session={FAKE_SESSION}>
        <WriteConsumer />
      </DataProvider>,
    );
    await waitFor(() => expect(screen.getByText(/^client:/)).toBeDefined());

    /*
     * The device id is the last-write-wins tie-break in apply-remote.ts. If it changed per
     * mount, tie resolution would differ across reloads and two peers could stop converging.
     */
    expect(screen.getByText(/^client:/).textContent).toBe(idA);
  });

  it("exposes sync status to consumers", async () => {
    render(
      <DataProvider session={FAKE_SESSION}>
        <StatusConsumer />
      </DataProvider>,
    );
    await waitFor(() => expect(screen.getByText(/^phase:/)).toBeDefined());
  });

  it("throws a useful message when used outside the provider", () => {
    // Rendering the consumer bare must fail loudly, not silently no-op a write.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<WriteConsumer />)).toThrow(/useData must be used inside/);
    spy.mockRestore();
  });
});
