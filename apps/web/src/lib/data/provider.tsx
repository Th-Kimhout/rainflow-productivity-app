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
  session: Session | null;
  children: ReactNode;
}) {
  const db = getDb();
  const [ctx, setCtx] = useState<WriteContext | null>(null);
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [status, setStatus] = useState<SyncStatus>({
    phase: "idle",
    pending: 0,
    lastSyncedAt: null,
    lastError: null,
    online: true,
  });

  const userId = session?.user.id ?? null;

  useEffect(() => {
    // No session means no RLS-authorised requests are possible, so there is nothing to sync.
    // The local database stays readable — that is the point of local-first.
    if (!userId) {
      setCtx(null);
      return;
    }

    let disposed = false;
    let started: SyncEngine | null = null;

    void (async () => {
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
 * Throws rather than returning null so a mutation cannot silently no-op: a write that vanishes
 * because the session had not resolved yet is exactly the class of bug that is impossible to
 * reproduce later. Components that render before a session exists should not be offering
 * write affordances at all.
 */
export function useWriteContext(): { db: RainflowDB; ctx: WriteContext } {
  const { db, ctx } = useData();
  if (!ctx) {
    throw new Error(
      "No write context — the sync engine has not booted. Render write affordances inside " +
        "<AuthGate> so a session is guaranteed.",
    );
  }
  return { db, ctx };
}
