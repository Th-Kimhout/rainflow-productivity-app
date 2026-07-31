import Dexie, { type EntityTable } from "dexie";

import type {
  FocusSessionRow,
  HabitLogRow,
  HabitRow,
  TableName,
  TagRow,
  TaskRow,
  TaskTagRow,
  TimeBlockRow,
} from "../wire";

/**
 * The local database. This is the RENDER SOURCE — every view reads from here, never from the
 * network, which is what makes reads instant and available offline (ADR 0001 decision 3).
 *
 * The stores mirror the Postgres tables one-for-one, holding the same snake_case wire rows.
 * Deliberately no client-side remapping to camelCase: a row read here can be upserted to
 * PostgREST unchanged, and one shape means one place for bugs to hide.
 *
 * TOMBSTONES ARE KEPT. A soft-deleted row stays in Dexie with `deleted_at` set rather than
 * being removed. If deletes were applied as local removals, a late-arriving stale update for
 * that row would have nothing to compare against and would resurrect it. Every query
 * therefore has to exclude them — see `live()` helpers in queries.ts.
 */

/** An outbox entry: one pending full-row upsert, waiting to be drained to PostgREST. */
export interface OutboxOp {
  /** Auto-incremented. Drain order, and the reason this is `++seq` rather than a uuid. */
  seq?: number;
  table: TableName;
  /** `rowKey(table, row)` — the dedupe target. Unique, so a re-edit coalesces in place. */
  key: string;
  /** The complete row to upsert. Full-row, not a patch: see ADR 0001 R10. */
  row: Record<string, unknown>;
  /**
   * Copied out of `row.client_updated_at`. Compared after a successful send to detect that
   * the user edited the row again while the request was in flight — in which case the op
   * must NOT be deleted, or that newer edit is silently dropped.
   */
  client_updated_at: string;
  attempts: number;
  last_error: string | null;
  /** Epoch ms. Exponential backoff gate; `0` means eligible immediately. */
  next_attempt_at: number;
}

/** Small key/value store for sync cursors and the device identity. */
export interface MetaRow {
  key: string;
  value: unknown;
}

export class RainflowDB extends Dexie {
  task!: EntityTable<TaskRow, "id">;
  tag!: EntityTable<TagRow, "id">;
  task_tag!: EntityTable<TaskTagRow, never>;
  time_block!: EntityTable<TimeBlockRow, "id">;
  habit!: EntityTable<HabitRow, "id">;
  habit_log!: EntityTable<HabitLogRow, "id">;
  focus_session!: EntityTable<FocusSessionRow, "id">;

  outbox!: EntityTable<OutboxOp, "seq">;
  meta!: EntityTable<MetaRow, "key">;

  constructor(name = "rainflow") {
    super(name);

    /*
     * Indexes are chosen for the queries the UI actually runs, which is a different set from
     * the Postgres indexes — §6's @@index([status, dueDate]) lives HERE, not in SQL, because
     * this is the only place a filtered read happens.
     *
     * `deleted_at` is not indexed: IndexedDB cannot index null, and maintaining a derived
     * 0/1 flag on every write is a bug farm. Tombstones are filtered in JS instead. At N=1
     * scale (thousands of rows, not millions) that stays comfortably inside §7.1's 50ms
     * command-palette budget.
     */
    this.version(1).stores({
      task: "id, status, parent_id, due_at, sort_order, client_updated_at, [status+sort_order]",
      tag: "id, name, client_updated_at",
      task_tag: "[task_id+tag_id], task_id, tag_id, client_updated_at",
      time_block: "id, task_id, starts_at, [task_id+starts_at]",
      habit: "id, archived_at, client_updated_at",
      habit_log: "id, habit_id, log_date, [habit_id+log_date]",
      focus_session: "id, task_id, started_at, phase",

      // `&key` is the coalescing mechanism: a second edit to the same row replaces the
      // pending op rather than queueing a duplicate upsert.
      outbox: "++seq, &key, table, next_attempt_at",
      meta: "key",
    });

    /*
     * ---------------------------------------------------------------------------------------
     * ADDING A VERSION — read this before touching the block above.
     *
     * Dexie applies versions in order, so an EXISTING version's `.stores()` must never be
     * edited. Changing version(1) does not migrate anyone already on it; it makes their
     * database silently disagree with the schema, and the failure surfaces later as a query
     * returning nothing rather than as an error.
     *
     *   this.version(2).stores({ task: "id, status, ..., new_index" });
     *
     * Only the tables that CHANGE need listing; the rest carry forward. A table set to `null`
     * is dropped. An `.upgrade()` callback is only needed to transform existing rows — a new
     * index is built by Dexie without one.
     *
     * WHAT MAKES THIS SAFE HERE: every row also exists on the server, and `resetCursors()`
     * plus a pull re-hydrates the lot. So the worst case for a botched local migration is a
     * re-download, NOT data loss — with one exception. A non-empty outbox holds writes that
     * exist nowhere else, so a migration that touches `outbox` must preserve it, and the
     * settings screen's JSON export is the backstop worth taking first.
     * ---------------------------------------------------------------------------------------
     */
  }
}

/**
 * Dexie table name for a wire table. They are identical by design, but going through this
 * function means a future rename is a type error rather than a silent string mismatch.
 */
export function storeFor(db: RainflowDB, table: TableName) {
  return db.table(table);
}
