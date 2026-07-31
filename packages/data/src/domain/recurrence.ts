import {
  type DayKey,
  addDays,
  diffDays,
  isWeekday,
  monthlyNthOccurrence,
  parseDayKey,
  weekdayOf,
} from "../time/tz";
import type { HabitKind, HabitRow } from "../wire";

/**
 * The §3.4 recurrence engine. Pure: a day in, a yes or no out.
 *
 * §6 modelled recurrence as `frequency String` plus `targetDays`, which cannot express two of
 * the four rules §3.4 asks for — hence the structured columns (ADR 0001 decision 7). This module
 * is the other half of that decision: the columns say WHAT the rule is, and these functions say
 * what it MEANS.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY `INTERVAL` IS ANCHORED ON THE LAST COMPLETION
 *
 * "Every 3 days" is meaningless without a starting point, and `habit` has no start date — §6
 * never gave it one. Two ways to fix that:
 *
 *   1. Add a `starts_on` column and lay a fixed calendar grid from it.
 *   2. Anchor on the most recent completion.
 *
 * Option 2 is chosen, and not only because it avoids a migration. A fixed grid means missing one
 * occurrence leaves you permanently out of step with your own habit: water the plants a day late
 * and every future due date is still on the original grid, so you are late forever. Anchoring on
 * the last completion is what people actually mean — "every three days" is three days since I
 * last did it. It also makes an overdue habit STAY due rather than silently skipping to the next
 * grid slot, which is the behaviour that keeps a streak honest.
 *
 * The cost is that `INTERVAL` is not a pure function of the day alone; it needs the completion
 * history. Every function here therefore takes the set of completed days, and the ones that do
 * not need it ignore it.
 * ---------------------------------------------------------------------------------------------
 */

/** The subset of `habit` that defines a schedule. Accepts a whole `HabitRow`. */
export interface RecurrenceRule {
  kind: HabitKind;
  interval_days: number | null;
  /** 0 = Sunday … 6 = Saturday, matching `weekdayOf`. */
  weekdays: number[] | null;
  month_day: number | null;
}

export type CompletedDays = ReadonlySet<DayKey>;

/** The completed-day set for a habit, from its logs. Tombstones excluded. */
export function completedDaysOf(
  logs: readonly { habit_id: string; log_date: string; deleted_at: string | null }[],
  habitId: string,
): Set<DayKey> {
  const out = new Set<DayKey>();
  for (const log of logs) {
    if (log.deleted_at !== null || log.habit_id !== habitId) continue;
    out.add(log.log_date);
  }
  return out;
}

/** The latest completed day strictly before `day`, or `null`. */
function lastCompletionBefore(completed: CompletedDays, day: DayKey): DayKey | null {
  let best: DayKey | null = null;
  for (const d of completed) {
    // DayKeys are zero-padded ISO dates, so string order IS chronological order.
    if (d < day && (best === null || d > best)) best = d;
  }
  return best;
}

/**
 * Is `habit` scheduled on `day`?
 *
 * Note what this does NOT mean: whether it was done. A due day that was missed is still due —
 * that is exactly what makes it break a streak.
 */
export function isDueOn(
  habit: RecurrenceRule,
  day: DayKey,
  completed: CompletedDays = new Set(),
): boolean {
  switch (habit.kind) {
    case "DAILY":
      return true;

    case "WEEKDAYS": {
      // A null array would be a constraint violation upstream; treat it as Monday–Friday rather
      // than as "never", so a corrupt row degrades to something usable.
      if (!habit.weekdays) return isWeekday(day);
      return habit.weekdays.includes(weekdayOf(day));
    }

    case "INTERVAL": {
      const every = habit.interval_days;
      if (!every || every < 1) return false;

      // Never done: it is due now. A habit you created and have not started is not "not yet
      // scheduled", it is waiting on you.
      const last = lastCompletionBefore(completed, day);
      if (last === null) return true;

      // `>=` rather than `===`: an overdue habit stays due every day until it is done, instead
      // of blinking out and reappearing on some future multiple of the interval.
      return diffDays(last, day) >= every;
    }

    case "MONTHLY_NTH": {
      const target = habit.month_day;
      if (!target) return false;
      // Clamps 29/30/31 to the last day of a short month, so a "the 31st" habit lands on
      // Feb 28 rather than being skipped four months a year (ADR 0001, R5).
      return monthlyNthOccurrence(day, target) === day;
    }
  }
}

/**
 * Every day in `[from, to]` on which `habit` is scheduled.
 *
 * Walks forward and threads the last completion through, which is what makes `INTERVAL` correct
 * across a range: each due day depends on what came before it. Calling `isDueOn` in a loop would
 * give the same answer here, but at the cost of re-scanning the completion set for every day.
 */
export function dueDays(
  habit: RecurrenceRule,
  from: DayKey,
  to: DayKey,
  completed: CompletedDays = new Set(),
): DayKey[] {
  const span = diffDays(from, to);
  if (span < 0) return [];

  const out: DayKey[] = [];

  if (habit.kind === "INTERVAL") {
    const every = habit.interval_days;
    if (!every || every < 1) return [];

    // Seed from history before the window, or the first days of the range would look overdue
    // when they are not.
    let last = lastCompletionBefore(completed, from);

    for (let i = 0; i <= span; i++) {
      const day = addDays(from, i);
      if (last === null || diffDays(last, day) >= every) out.push(day);
      if (completed.has(day)) last = day;
    }

    return out;
  }

  for (let i = 0; i <= span; i++) {
    const day = addDays(from, i);
    if (isDueOn(habit, day, completed)) out.push(day);
  }

  return out;
}

/**
 * The next scheduled day on or after `from`.
 *
 * Bounded rather than unbounded: a malformed rule that is never due would otherwise loop for
 * ever. 400 days covers every rule the schema can express — the longest gap possible is a
 * monthly habit, at 31 days — and returning `null` past that is a bug signal, not a silent hang.
 */
export function nextDueOn(
  habit: RecurrenceRule,
  from: DayKey,
  completed: CompletedDays = new Set(),
): DayKey | null {
  const HORIZON = 400;

  if (habit.kind === "INTERVAL") {
    const every = habit.interval_days;
    if (!every || every < 1) return null;
    const last = lastCompletionBefore(completed, from);
    if (last === null) return from;
    const due = addDays(last, every);
    return due < from ? from : due;
  }

  for (let i = 0; i < HORIZON; i++) {
    const day = addDays(from, i);
    if (isDueOn(habit, day, completed)) return day;
  }

  return null;
}

/** Human-readable rule, for the habit list. */
export function describeRule(habit: RecurrenceRule): string {
  switch (habit.kind) {
    case "DAILY":
      return "Every day";

    case "WEEKDAYS": {
      const days = habit.weekdays;
      if (!days || days.length === 0) return "Weekdays";
      if (days.length === 7) return "Every day";

      const sorted = [...days].sort((a, b) => a - b);
      // Recognise the two common shapes by name rather than listing five abbreviations.
      if (sorted.join() === "1,2,3,4,5") return "Weekdays";
      if (sorted.join() === "0,6") return "Weekends";

      return sorted.map((d) => WEEKDAY_NAMES[d] ?? "?").join(", ");
    }

    case "INTERVAL": {
      const n = habit.interval_days ?? 0;
      return n === 1 ? "Every day" : `Every ${n} days`;
    }

    case "MONTHLY_NTH": {
      const d = habit.month_day ?? 1;
      return `Monthly on the ${d}${ordinalSuffix(d)}`;
    }
  }
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function ordinalSuffix(n: number): string {
  // 11th, 12th and 13th are the exceptions that a bare `n % 10` gets wrong.
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/** Build the rule columns for a habit, with the shape the CHECK constraint demands. */
export function ruleColumns(
  kind: HabitKind,
  params: { intervalDays?: number; weekdays?: number[]; monthDay?: number } = {},
): Pick<HabitRow, "kind" | "interval_days" | "weekdays" | "month_day"> {
  /*
   * Every field not belonging to this kind is explicitly null. `habit_params_match_kind` rejects
   * a row that carries leftovers from a previous kind, so switching a habit from INTERVAL to
   * DAILY has to clear `interval_days` — sending a partial patch would fail server-side with a
   * constraint error long after the write appeared to succeed locally.
   */
  switch (kind) {
    case "DAILY":
      return { kind, interval_days: null, weekdays: null, month_day: null };

    case "WEEKDAYS":
      return {
        kind,
        interval_days: null,
        weekdays: normaliseWeekdays(params.weekdays ?? [1, 2, 3, 4, 5]),
        month_day: null,
      };

    case "INTERVAL":
      return {
        kind,
        interval_days: Math.max(1, Math.round(params.intervalDays ?? 2)),
        weekdays: null,
        month_day: null,
      };

    case "MONTHLY_NTH":
      return {
        kind,
        interval_days: null,
        weekdays: null,
        month_day: Math.min(31, Math.max(1, Math.round(params.monthDay ?? 1))),
      };
  }
}

/** Sorted, de-duplicated, 0–6 only — matching `habit_weekdays_in_range`. */
function normaliseWeekdays(days: readonly number[]): number[] {
  const set = new Set<number>();
  for (const d of days) {
    const n = Math.round(d);
    if (n >= 0 && n <= 6) set.add(n);
  }
  // An empty array would violate `array_length(weekdays, 1) between 1 and 7`.
  if (set.size === 0) return [1, 2, 3, 4, 5];
  return [...set].sort((a, b) => a - b);
}

/** The month a `DayKey` falls in, as `YYYY-MM`. Used to group the heatmap. */
export function monthOf(day: DayKey): string {
  const { year, month } = parseDayKey(day);
  return `${year}-${String(month).padStart(2, "0")}`;
}
