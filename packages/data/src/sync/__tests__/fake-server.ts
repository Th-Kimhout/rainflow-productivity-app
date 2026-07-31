import {
  type AnyRow,
  PRIMARY_KEYS,
  type TableName,
  TABLE_ORDER,
  rowKey,
} from "../../wire";
import type { RemoteChangeHandler, SyncTransport } from "../transport";

/**
 * An in-memory stand-in for Postgres + PostgREST + Realtime.
 *
 * It reproduces the behaviours the sync engine actually depends on, including the awkward
 * ones that make naive implementations wrong:
 *
 *   * `updated_at` is stamped by the SERVER clock, mirroring the trigger — a client's own
 *     timestamp is ignored, exactly as in production.
 *   * A single upsert call stamps every row in it with ONE identical timestamp, which is what
 *     breaks strict `>` cursor pagination.
 *   * Reads use an inclusive `>=` bound and are ordered by (updated_at, pk), matching the
 *     index in 20260730000400_indexes.sql.
 *   * It can be told to fail, to go "offline", and to deliver Realtime echoes — including
 *     echoing a client's own writes back at it, which is what Rule 1 in apply-remote.ts
 *     exists to survive.
 */
export class FakeServer {
  private tables = new Map<TableName, Map<string, AnyRow>>();
  private handlers = new Set<RemoteChangeHandler>();

  /** Server clock, in ms. Advanced explicitly so tests are deterministic. */
  clock = 1_000_000_000_000;

  /** When true, every request rejects — used to simulate being offline. */
  offline = false;

  /** Force the next N requests to fail. */
  failNext = 0;

  /** Set true to push Realtime events on write (including the writer's own echo). */
  realtimeEnabled = false;

  requestCount = 0;

  /**
   * Monotonic write counter per row. Presence assertions cannot tell a correctly-ordered drain
   * from one that only happened to work — a real Postgres would have rejected the child-first
   * ordering outright, and this is what lets a test see the difference.
   */
  private writeSeq = 0;
  private writeOrder = new Map<string, number>();

  constructor() {
    for (const t of TABLE_ORDER) this.tables.set(t, new Map());
  }

  tick(ms = 1): void {
    this.clock += ms;
  }

  private guard(): void {
    this.requestCount++;
    if (this.offline) throw new Error("network offline");
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("injected failure");
    }
  }

  rows(table: TableName): AnyRow[] {
    return [...this.tables.get(table)!.values()];
  }

  get(table: TableName, key: string): AnyRow | undefined {
    return this.tables.get(table)!.get(key);
  }

  /** Seed data as if another device had written it, bypassing the request guard. */
  seed(table: TableName, rows: readonly Partial<AnyRow>[]): void {
    this.applyUpsert(table, rows as Record<string, unknown>[], /* notify */ false);
  }

  private applyUpsert(
    table: TableName,
    rows: readonly Record<string, unknown>[],
    notify: boolean,
  ): AnyRow[] {
    const store = this.tables.get(table)!;
    // ONE timestamp for the whole batch — this is the detail that breaks strict-`>` cursors.
    const stampedAt = new Date(this.clock).toISOString();
    const written: AnyRow[] = [];

    for (const incoming of rows) {
      const key = rowKey(table, incoming as never);
      const row = { ...incoming, updated_at: stampedAt } as AnyRow;
      store.set(key, row);
      this.writeOrder.set(`${table}|${key}`, ++this.writeSeq);
      written.push(row);
    }

    if (notify && this.realtimeEnabled) {
      for (const row of written) {
        for (const h of this.handlers) this.track(h(table, row));
      }
    }

    return written;
  }

  /**
   * Realtime handlers are fire-and-forget in production, which makes them untestable without
   * either arbitrary sleeps or a way to await them. Outstanding handler promises are tracked
   * so tests can `await server.flushRealtime()` and assert against a settled state instead of
   * racing a timer.
   */
  private inflight = new Set<Promise<void>>();

  private track(result: void | Promise<void>): void {
    if (!result) return;
    const p = Promise.resolve(result).finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  async flushRealtime(): Promise<void> {
    while (this.inflight.size > 0) {
      await Promise.all([...this.inflight]);
    }
  }

  transport(): SyncTransport {
    return {
      fetchSince: async (table, sinceIso, limit) => {
        this.guard();
        const since = Date.parse(sinceIso);

        return this.rows(table)
          .filter((r) => Date.parse(r.updated_at) >= since)
          .sort((a, b) => {
            const d = Date.parse(a.updated_at) - Date.parse(b.updated_at);
            if (d !== 0) return d;
            return rowKey(table, a as never).localeCompare(rowKey(table, b as never));
          })
          .slice(0, limit);
      },

      upsert: async (table, rows) => {
        this.guard();
        this.applyUpsert(table, rows, /* notify */ true);
      },

      subscribe: (onChange) => {
        this.handlers.add(onChange);
        return () => this.handlers.delete(onChange);
      },
    };
  }

  /** Deliver an out-of-band Realtime event, as if a different device had written. */
  async pushRealtime(table: TableName, row: AnyRow): Promise<void> {
    await Promise.all([...this.handlers].map((h) => h(table, row)));
  }

  /** When a row was last written, relative to every other row. Throws if it never was. */
  order(table: TableName, key: string): number {
    const seq = this.writeOrder.get(`${table}|${key}`);
    if (seq === undefined) throw new Error(`${table} ${key} was never written`);
    return seq;
  }

  /** Every table's rows keyed by pk — for asserting convergence between two peers. */
  snapshot(): Record<string, Record<string, AnyRow>> {
    const out: Record<string, Record<string, AnyRow>> = {};
    for (const t of TABLE_ORDER) {
      out[t] = Object.fromEntries(this.tables.get(t)!);
    }
    return out;
  }
}

/** Assert the primary-key metadata stays in step with TABLE_ORDER. */
export function allTablesHavePrimaryKeys(): boolean {
  return TABLE_ORDER.every((t) => (PRIMARY_KEYS[t]?.length ?? 0) > 0);
}
