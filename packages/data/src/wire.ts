/**
 * Wire types — the exact row shapes that cross the network to PostgREST.
 *
 * These are hand-written to match `supabase/migrations/*.sql` because the Supabase CLI is
 * not installed yet, so `supabase gen types typescript` has not been run. Once it has, the
 * generated output lands in `types.gen.ts` and `types.assert.ts` proves these agree with it
 * at compile time — so drift becomes a type error rather than a runtime surprise.
 *
 * Naming is snake_case throughout: these are database rows, not domain objects, and keeping
 * the wire shape literal means a full-row upsert is just `supabase.from(t).upsert(row)`.
 */

export type TaskStatus =
  | "INBOX"
  | "BACKLOG"
  | "TODAY"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "ARCHIVED";

export type HabitKind = "DAILY" | "WEEKDAYS" | "INTERVAL" | "MONTHLY_NTH";
export type EnergyLevel = "HIGH" | "MEDIUM" | "LOW";
export type FocusPhase = "FOCUS" | "SHORT_BREAK" | "LONG_BREAK";

/**
 * Columns every synced table carries.
 *
 * `updated_at` is SERVER-owned — the trigger in 20260730000200_sync.sql forces it to now()
 * on every write, and it exists solely as the incremental-pull cursor. The client must never
 * send it and must never compare against it for conflict resolution.
 *
 * `client_updated_at` is CLIENT-owned and is what last-write-wins compares. Splitting the two
 * is what keeps the cursor immune to a device with a badly wrong clock.
 */
export interface SyncColumns {
  updated_at: string;
  client_updated_at: string;
  deleted_at: string | null;
  client_id: string | null;
}

export interface TaskRow extends SyncColumns {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  /** §3.2 Eisenhower. These two are the source of truth; quadrant/priority are derived. */
  is_urgent: boolean;
  is_important: boolean;
  estimated_mins: number | null;
  due_at: string | null;
  due_is_all_day: boolean;
  completed_at: string | null;
  parent_id: string | null;
  sort_order: number;
}

export interface TagRow extends SyncColumns {
  id: string;
  name: string;
  color: string;
}

export interface TaskTagRow extends SyncColumns {
  task_id: string;
  tag_id: string;
}

export interface TimeBlockRow extends SyncColumns {
  id: string;
  task_id: string;
  starts_at: string;
  ends_at: string;
}

export interface HabitRow extends SyncColumns {
  id: string;
  title: string;
  description: string | null;
  kind: HabitKind;
  interval_days: number | null;
  /** 0 = Sunday .. 6 = Saturday, matching `weekdayOf()`. */
  weekdays: number[] | null;
  month_day: number | null;
  target_per_period: number;
  color: string;
  archived_at: string | null;
}

export interface HabitLogRow extends SyncColumns {
  id: string;
  habit_id: string;
  /** A DayKey — calendar date in APP_TIMEZONE, not a UTC slice of a timestamp. */
  log_date: string;
  completed_at: string;
}

export interface FocusSessionRow extends SyncColumns {
  id: string;
  task_id: string | null;
  started_at: string;
  ended_at: string | null;
  planned_mins: number;
  actual_secs: number;
  was_completed: boolean;
  phase: FocusPhase;
  energy: EnergyLevel | null;
  notes: string | null;
}

/** Every synced table, keyed by its Postgres name. */
export interface WireTables {
  task: TaskRow;
  tag: TagRow;
  task_tag: TaskTagRow;
  time_block: TimeBlockRow;
  habit: HabitRow;
  habit_log: HabitLogRow;
  focus_session: FocusSessionRow;
}

export type TableName = keyof WireTables;

export type AnyRow = WireTables[TableName];

/**
 * Drain and hydrate order. Parents before children.
 *
 * The FKs are `deferrable initially deferred`, so a single transaction does not strictly
 * need this — but PostgREST sends one request per table, not one transaction, so ordering
 * still matters on the wire. Keeping it explicit also makes hydration deterministic, which
 * the convergence tests depend on.
 */
export const TABLE_ORDER: readonly TableName[] = [
  "tag",
  "task",
  "task_tag",
  "time_block",
  "habit",
  "habit_log",
  "focus_session",
] as const;

/**
 * Primary key columns per table. `task_tag` is the only composite one — §6 modelled it as a
 * bare join table and it keeps that shape.
 */
export const PRIMARY_KEYS: { readonly [K in TableName]: readonly (keyof WireTables[K])[] } = {
  task: ["id"],
  tag: ["id"],
  task_tag: ["task_id", "tag_id"],
  time_block: ["id"],
  habit: ["id"],
  habit_log: ["id"],
  focus_session: ["id"],
} as const;

/**
 * Stable string key for a row, used as the outbox's dedupe key and Dexie's lookup key.
 * Composite keys join with a character that cannot appear in a uuid.
 */
export function rowKey<K extends TableName>(table: K, row: Partial<WireTables[K]>): string {
  const cols = PRIMARY_KEYS[table];
  const parts = cols.map((c) => {
    const v = (row as Record<string, unknown>)[c as string];
    if (v === undefined || v === null) {
      throw new Error(`rowKey(${table}): missing primary key column "${String(c)}"`);
    }
    return String(v);
  });
  return parts.join("|");
}

/** `on_conflict` target for a PostgREST upsert. */
export function conflictTarget(table: TableName): string {
  return PRIMARY_KEYS[table].join(",");
}

/**
 * Columns the client is not allowed to send. `updated_at` is server-owned; sending it would
 * be harmless (the trigger overwrites it) but stripping it keeps the contract obvious.
 */
const SERVER_OWNED = new Set(["updated_at"]);

export function stripServerOwned<T extends object>(row: T): Omit<T, "updated_at"> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!SERVER_OWNED.has(k)) out[k] = v;
  }
  return out as Omit<T, "updated_at">;
}
