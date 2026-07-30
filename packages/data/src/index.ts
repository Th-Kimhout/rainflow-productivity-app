/**
 * `@rainflow/data` — the data layer: wire types, the Dexie schema, the write repository, the
 * outbox, the sync engine, and the pure domain helpers.
 *
 * INVARIANT: nothing in this package may import `next/*` or `react`. The sync engine has to be
 * runnable in a plain Node test process, and this package's dependency list (`dexie`,
 * `@supabase/supabase-js`) is what enforces that structurally rather than by convention.
 * React bindings live in `apps/web/src/lib/data/hooks.ts`.
 */

// ---------------------------------------------------------------------------- time
export {
  APP_TIMEZONE,
  addDays,
  atMinutesIntoDay,
  dayKeyOf,
  dayRange,
  daysInMonth,
  diffDays,
  eachDay,
  endOfDay,
  hourOf,
  isDayKey,
  isWeekday,
  minutesIntoDay,
  monthlyNthOccurrence,
  nextDay,
  parseDayKey,
  previousDay,
  startOfDay,
  startOfWeek,
  todayKey,
  weekdayOf,
} from "./time/tz";
export type { DayKey } from "./time/tz";

// ---------------------------------------------------------------------------- ids
export { newId } from "./ids";

// ---------------------------------------------------------------------------- wire
export {
  PRIMARY_KEYS,
  TABLE_ORDER,
  conflictTarget,
  rowKey,
  stripServerOwned,
} from "./wire";
export type {
  AnyRow,
  EnergyLevel,
  FocusPhase,
  FocusSessionRow,
  HabitKind,
  HabitLogRow,
  HabitRow,
  SyncColumns,
  TableName,
  TagRow,
  TaskRow,
  TaskStatus,
  TaskTagRow,
  TimeBlockRow,
  WireTables,
} from "./wire";

// ---------------------------------------------------------------------------- local db
export { RainflowDB } from "./db/schema";
export type { MetaRow, OutboxOp } from "./db/schema";

export {
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  deadLettered,
  pendingCount,
  pendingKeys,
} from "./db/outbox";

export {
  createTask,
  createWriteContext,
  patch,
  put,
  setTaskCompleted,
  softDelete,
} from "./db/repo";
export type { WriteContext } from "./db/repo";

// ---------------------------------------------------------------------------- sync
export { applyRemoteRows } from "./sync/apply-remote";
export type { ApplyResult } from "./sync/apply-remote";

export { getCursor, pullAll, pullTable, resetCursors, setCursor } from "./sync/pull";
export type { PullReport } from "./sync/pull";

export { drain, drainUntilQuiet } from "./sync/push";
export type { DrainReport } from "./sync/push";

export { createSupabaseTransport } from "./sync/transport";
export type { RemoteChangeHandler, SyncTransport } from "./sync/transport";

export {
  SYNCED_TABLES,
  SyncEngine,
  getClientId,
  requestPersistentStorage,
} from "./sync/engine";
export type { EngineOptions, SyncPhase, SyncStatus } from "./sync/engine";

// ---------------------------------------------------------------------------- domain
export { displayPriority, quadrantOf, setQuadrant } from "./domain/eisenhower";
export type { Quadrant } from "./domain/eisenhower";
