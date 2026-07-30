import type { SupabaseClient } from "@supabase/supabase-js";

import { type AnyRow, type TableName, conflictTarget } from "../wire";

/**
 * The network seam.
 *
 * The sync engine talks to this interface, never to supabase-js directly. That is what lets
 * the convergence tests drive the whole engine against an in-memory fake server with no
 * network, no auth and no WebSocket — which matters because this engine is where essentially
 * every hard bug in the project will live, and a test suite that boots in 200ms is the
 * difference between actually testing the interleavings and hoping.
 */

export type RemoteChangeHandler = (table: TableName, row: AnyRow) => void | Promise<void>;

export interface SyncTransport {
  /**
   * Rows changed at or after `sinceIso`, ordered by (updated_at, pk).
   *
   * Inclusive lower bound on purpose — see `pull.ts` for why the cursor is rewound and why
   * re-delivering rows is harmless.
   */
  fetchSince(table: TableName, sinceIso: string, limit: number): Promise<AnyRow[]>;

  /** Full-row upsert of one table's rows. Resolves on success, throws on failure. */
  upsert(table: TableName, rows: readonly Record<string, unknown>[]): Promise<void>;

  /** Subscribe to remote changes. Returns an unsubscribe function. */
  subscribe(onChange: RemoteChangeHandler): () => void;
}

/**
 * Supabase-backed transport.
 *
 * Note what is NOT here: Server Actions. The browser talks to PostgREST directly under RLS
 * (ADR 0001 decision 4), because Next 16 Server Actions dispatch sequentially — which would
 * serialise a queue drain — cap bodies at 1MB, and rotate action ids roughly every 14 days,
 * producing "Failed to find Server Action" in exactly the long-lived tab an offline-first app
 * depends on.
 */
export function createSupabaseTransport(
  client: SupabaseClient,
  tables: readonly TableName[],
): SyncTransport {
  return {
    async fetchSince(table, sinceIso, limit) {
      const { data, error } = await client
        .from(table)
        .select("*")
        .gte("updated_at", sinceIso)
        .order("updated_at", { ascending: true })
        .limit(limit);

      if (error) throw new Error(`fetchSince(${table}): ${error.message}`);
      return (data ?? []) as AnyRow[];
    },

    async upsert(table, rows) {
      if (rows.length === 0) return;

      const { error } = await client
        .from(table)
        .upsert(rows as never, { onConflict: conflictTarget(table) });

      if (error) throw new Error(`upsert(${table}): ${error.message}`);
    },

    subscribe(onChange) {
      const channel = client.channel("rainflow-sync");

      for (const table of tables) {
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          (payload) => {
            /*
             * Soft delete means DELETE events never fire — a delete arrives as an UPDATE with
             * deleted_at set. `payload.new` is therefore always the row we want, and no
             * `replica identity full` is needed on any table.
             */
            const row = payload.new as AnyRow | undefined;
            if (row && Object.keys(row).length > 0) void onChange(table, row);
          },
        );
      }

      channel.subscribe();
      return () => void client.removeChannel(channel);
    },
  };
}
