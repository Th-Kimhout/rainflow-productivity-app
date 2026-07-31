import { type DayKey, addDays, diffDays, todayKey } from "../time/tz";
import { type CompletedDays, type RecurrenceRule, dueDays } from "./recurrence";

/**
 * §3.4 streak maintenance.
 *
 * Two rules do all the work, and both are easy to get wrong in ways that quietly punish the user:
 *
 * RULE 1 — ONLY A DUE DAY CAN BREAK A STREAK.
 *   A weekdays-only habit must not lose its streak over the weekend, and a monthly one must not
 *   lose it on the 2nd. Counting calendar days instead of scheduled days makes every habit that
 *   is not daily impossible to keep, which is the fastest way to make someone stop using a habit
 *   tracker.
 *
 * RULE 2 — TODAY IS NOT YET A MISS.
 *   The day is not over. A streak that resets to zero at midnight and only recovers when you tick
 *   the box means the number is wrong for most of every day, and it reads as a punishment for not
 *   having done the thing yet. Today counts if completed and is skipped if not.
 */

export interface StreakSummary {
  /** Consecutive completed due days, counting back from today. */
  current: number;
  /** The best run ever, within the window examined. */
  longest: number;
  /** Completed due days ÷ total due days in the window. `0` when nothing was due. */
  rate: number;
  /** Due days that came and went uncompleted, excluding today. */
  missed: number;
  /** Total completions in the window, including any on days that were not due. */
  completions: number;
  /** True when today is scheduled and not yet ticked. */
  dueToday: boolean;
  /** True when today is scheduled and ticked. */
  doneToday: boolean;
}

/** How far back to look. Two years is well past any streak worth showing. */
const DEFAULT_WINDOW_DAYS = 730;

/**
 * Summarise a habit's history.
 *
 * THE HISTORY BEGINS AT THE FIRST COMPLETION, and this is load-bearing. `habit` has no creation
 * date — §6 never gave it one — so a window that simply ran back `windowDays` would count every
 * day before the habit existed as a miss. A habit created this morning would open with 729 misses
 * and a 0.9% completion rate, which is both false and the single most discouraging thing a habit
 * tracker could say to someone on day one.
 *
 * A habit never completed therefore has no history at all: nothing missed, no rate, streak zero.
 * `windowDays` remains as an upper bound so the walk stays cheap on a habit years old.
 */
export function summarise(
  habit: RecurrenceRule,
  completed: CompletedDays,
  today: DayKey = todayKey(),
  windowDays: number = DEFAULT_WINDOW_DAYS,
): StreakSummary {
  const floor = addDays(today, -windowDays);
  const first = earliestOf(today, completed);
  // Zero-padded ISO dates compare chronologically as strings.
  const from = first > floor ? first : floor;

  const due = dueDays(habit, from, today, completed);

  const doneToday = completed.has(today);
  const dueToday = due.length > 0 && due[due.length - 1] === today;

  let longest = 0;
  let run = 0;
  let missed = 0;

  for (const day of due) {
    if (completed.has(day)) {
      run++;
      if (run > longest) longest = run;
      continue;
    }

    // RULE 2. Today is not over, so an unticked box today is not a miss and does not end the run.
    if (day === today) continue;

    run = 0;
    missed++;
  }

  /*
   * `run` is the streak in progress at the end of the walk, which is exactly the current streak:
   * the loop already skipped an incomplete today rather than resetting on it. Deriving it here
   * rather than walking backwards separately means the two numbers cannot disagree.
   */
  const current = run;

  const completedDue = due.filter((d) => completed.has(d)).length;
  const scored = due.filter((d) => d !== today || doneToday).length;

  return {
    current,
    longest,
    // Today is excluded from the denominator until it is answered, or the rate would drop every
    // morning purely because the day has not happened yet.
    rate: scored === 0 ? 0 : completedDue / scored,
    missed,
    completions: countInRange(completed, from, today),
    dueToday: dueToday && !doneToday,
    doneToday,
  };
}

/** The earliest of `floor` and the first completion. */
function earliestOf(floor: DayKey, completed: CompletedDays): DayKey {
  let earliest = floor;
  for (const d of completed) {
    // Zero-padded ISO dates compare chronologically as strings.
    if (d < earliest) earliest = d;
  }
  return earliest;
}

function countInRange(completed: CompletedDays, from: DayKey, to: DayKey): number {
  let n = 0;
  for (const d of completed) {
    if (d >= from && d <= to) n++;
  }
  return n;
}

/** One cell of the §3.4 heatmap. */
export interface HeatCell {
  day: DayKey;
  completed: boolean;
  /** Scheduled on this day. A missed cell is `due && !completed`. */
  due: boolean;
  /** True for days after today — rendered blank rather than as misses. */
  future: boolean;
}

/**
 * Build the heatmap grid (§3.4, "inspired by GitHub contribution graphs").
 *
 * Distinguishing DUE from COMPLETED is the point. A grid that only shows completions makes a
 * weekdays habit look like it is failing every weekend, and gives no way to tell a day off from
 * a day missed — which is the single most useful thing the picture can say.
 */
export function heatmap(
  habit: RecurrenceRule,
  completed: CompletedDays,
  from: DayKey,
  to: DayKey,
  today: DayKey = todayKey(),
): HeatCell[] {
  // Seeded from the earliest completion so INTERVAL's schedule is correct at the window's left
  // edge, then trimmed back to the requested range.
  const walkFrom = earliestOf(from, completed);
  const due = new Set(dueDays(habit, walkFrom, to, completed));

  const span = diffDays(from, to);
  if (span < 0) return [];

  const cells: HeatCell[] = [];
  for (let i = 0; i <= span; i++) {
    const day = addDays(from, i);
    cells.push({
      day,
      completed: completed.has(day),
      due: due.has(day),
      future: day > today,
    });
  }

  return cells;
}
