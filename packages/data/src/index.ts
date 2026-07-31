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
  appWallClock,
  appWallClockAsHostLocal,
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
  CASCADE_CHILDREN,
  PRIMARY_KEYS,
  TABLE_ORDER,
  conflictTarget,
  dexieKey,
  rowKey,
  stripServerOwned,
} from "./wire";
export type {
  AnyRow,
  CascadeChild,
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
  BACKUP_VERSION,
  backupFilename,
  exportBackup,
  importBackup,
  parseBackup,
} from "./db/backup";
export type { Backup, ImportReport } from "./db/backup";

export {
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  deadLettered,
  pendingCount,
  pendingKeys,
} from "./db/outbox";

export {
  closeFocusSession,
  createHabit,
  createTask,
  createTaskFromCapture,
  createWriteContext,
  findOrCreateTag,
  moveTimeBlock,
  openFocusSession,
  patch,
  put,
  resizeTimeBlock,
  scheduleTask,
  setHabitArchived,
  setHabitLogged,
  setHabitRule,
  setSessionEnergy,
  setTaskCompleted,
  setTaskTag,
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

// ---------------------------------------------------------------------------- nlp
export { parseCapture } from "./nlp/parse-capture";
export type { CaptureToken, ParsedCapture } from "./nlp/parse-capture";

// ---------------------------------------------------------------------------- domain
export {
  QUADRANT_LABELS,
  displayPriority,
  quadrantOf,
  setQuadrant,
} from "./domain/eisenhower";
export type { EisenhowerFlags, Quadrant } from "./domain/eisenhower";

export {
  DAY_MINUTES,
  DEFAULT_BLOCK_MINUTES,
  SLOT_MINUTES,
  daySpanOf,
  durationMinutes,
  formatMinutes,
  layoutDay,
  nowLineMinutes,
  placeBlock,
  scheduledMinutes,
  snapToSlot,
  spansOverlap,
} from "./domain/schedule";
export type { DaySpan, PositionedBlock } from "./domain/schedule";

export {
  DEFAULT_CONFIG,
  PHASE_LABELS,
  abandon,
  beginPhase,
  completePhase,
  elapsedMs,
  formatDuration,
  idleState,
  isActive,
  isExpired,
  isRunning,
  nextPhaseOf,
  pause,
  phaseDurationMs,
  progress,
  remainingMs,
  reset,
  resume,
  setTask,
  tabTitle,
  upcomingPhase,
} from "./domain/pomodoro";
export type { PomodoroConfig, PomodoroState } from "./domain/pomodoro";

export {
  completedDaysOf,
  describeRule,
  dueDays,
  isDueOn,
  monthOf,
  nextDueOn,
  ruleColumns,
} from "./domain/recurrence";
export type { CompletedDays, RecurrenceRule } from "./domain/recurrence";

export { heatmap, summarise } from "./domain/streaks";
export type { HeatCell, StreakSummary } from "./domain/streaks";

export {
  energyByHour,
  focusByDay,
  focusByHour,
  formatHour,
  formatMinutes as formatFocusMinutes,
  habitConsistency,
  plannedVsActual,
  topFocusHours,
  velocity,
  weeklyDigest,
} from "./domain/analytics";
export type {
  DailyFocus,
  DigestInput,
  EnergyByHour,
  HabitConsistency,
  HourBucket,
  PlannedVsActual,
  TaskAccuracy,
  Velocity,
  WeeklyDigest,
} from "./domain/analytics";
