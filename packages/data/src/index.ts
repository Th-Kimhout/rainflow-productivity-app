/**
 * `@rainflow/data` — the data layer: generated Supabase types, the Dexie schema, the write
 * repository, the outbox, the sync engine, and the pure domain helpers.
 *
 * INVARIANT: nothing in this package may import `next/*` or `react`. The sync engine has to
 * be runnable in a plain Node test process, and this package's dependency list (`dexie`,
 * `@supabase/supabase-js`) is what enforces that structurally rather than by convention.
 * React bindings live in `apps/web/src/lib/data/hooks.ts`.
 */

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

export { newId } from "./ids";
