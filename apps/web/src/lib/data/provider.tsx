"use client";

import {
  RainflowDB,
  SYNCED_TABLES,
  SyncEngine,
  type SyncStatus,
  type WriteContext,
  createSupabaseTransport,
  createWriteContext,
  getClientId,
} from "@rainflow/data";
import type { Session } from "@supabase/supabase-js";
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { getSupabase } from "@/lib/supabase/client";

/**
 * Boots the local database and the sync engine, and exposes both to the tree.
 *
 * This file is the boundary: `@rainflow/data` knows nothing about React, and all the React
 * wiring lives here. That separation is what lets the sync engine be tested in a plain Node
 * process in ~300ms.
 */

interface DataContextValue {
  db: RainflowDB;
  ctx: WriteContext | null;
  status: SyncStatus;
  /** Force a sync cycle now — used by the status bar's retry affordance. */
  syncNow: () => void;
}

const DataContext = createContext<DataContextValue | null>(null);

/**
 * Module-scoped, not state. Dexie holds an IndexedDB connection and Dexie's live queries
 * subscribe to *this* instance, so a second one created by a re-render or by Strict Mode's
 * double-invoke would silently split the app across two connections.
 */
let dbSingleton: RainflowDB | null = null;

function getDb(): RainflowDB {
  dbSingleton ??= new RainflowDB();
  return dbSingleton;
}

export function DataProvider({
  session,
  children,
}: {
  /*
   * Required, not nullable. AuthGate only renders this once a session exists, and making that a
   * type-level fact removes the transitional state where `ctx` could be null while children
   * render — which is exactly the crash this used to produce.
   */
  session: Session;
  children: ReactNode;
}) {
  const db = getDb();
  const [ctx, setCtx] = useState<WriteContext | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [status, setStatus] = useState<SyncStatus>({
    phase: "idle",
    pending: 0,
    lastSyncedAt: null,
    lastError: null,
    online: true,
  });

  const userId = session.user.id;

  useEffect(() => {
    let disposed = false;
    let started: SyncEngine | null = null;

    void (async () => {
      try {
        /*
         * The device id lives in Dexie so it survives reloads and stays identical to what the
         * sync engine uses — it is the LWW tie-break, so a value that differed between the two
         * could stop peers converging. Reading it is one indexed IndexedDB lookup.
         */
        const clientId = await getClientId(db);
        if (disposed) return;
        setCtx(createWriteContext(clientId));

        const transport = createSupabaseTransport(getSupabase(), SYNCED_TABLES);
        const next = new SyncEngine({
          db,
          transport,
          onStatus: (s) => {
            if (!disposed) setStatus(s);
          },
        });

        started = next;
        setEngine(next);
        await next.start();
      } catch (err) {
        if (disposed) return;
        /*
         * Most likely cause is IndexedDB being unavailable — private browsing in some
         * browsers, or storage denied. Surfaced rather than swallowed, because the app is
         * unusable without a local database and a blank screen would be baffling.
         */
        setBootError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      disposed = true;
      void started?.stop();
      setEngine(null);
    };
    // `db` is a module singleton and never changes; re-running on session change is the point.
  }, [db, userId]);

  const value = useMemo<DataContextValue>(
    () => ({
      db,
      ctx,
      status,
      syncNow: () => void engine?.sync(),
    }),
    [db, ctx, status, engine],
  );

  if (bootError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md text-center">
          <p className="text-sm text-priority-high">Local database unavailable</p>
          <p className="mt-2 text-xs text-muted-foreground">{bootError}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            RainFlow stores everything locally first, so it cannot run without IndexedDB.
            Private-browsing windows and blocked site storage are the usual causes.
          </p>
        </div>
      </div>
    );
  }

  /*
   * Children do not render until the write context exists.
   *
   * This is what makes `useWriteContext`'s guarantee real. Resolving the device id is async, so
   * for one render after a session appears `ctx` is still null — and any component calling
   * `useWriteContext` at the top level (which is all of them) would throw immediately. Gating
   * here fixes every consumer at once instead of pushing null-checks into each of them.
   *
   * The cost is a single indexed IndexedDB read before first paint. The static shell has already
   * been served from the CDN by this point, so the §7.1 FCP budget is unaffected.
   */
  if (!ctx) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Opening local database…</p>
      </div>
    );
  }

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) throw new Error("useData must be used inside <DataProvider>");
  return value;
}

/**
 * The write context, guaranteed non-null.
 *
 * The guarantee is enforced by `DataProvider`, which does not render children until `ctx`
 * resolves — so any component inside the provider can call this at the top level without a
 * null check.
 *
 * Still throws rather than returning null, because a mutation that silently no-ops is the class
 * of bug that never reproduces. If this ever fires, the cause is a component rendered outside
 * `DataProvider` (which lives inside `AuthGate`), not a timing race.
 */
export function useWriteContext(): { db: RainflowDB; ctx: WriteContext } {
  const { db, ctx } = useData();
  if (!ctx) {
    throw new Error(
      "No write context. This component is rendering outside <DataProvider> — write " +
        "affordances belong inside the (app) route group, which wraps them in <AuthGate>.",
    );
  }
  return { db, ctx };
}
