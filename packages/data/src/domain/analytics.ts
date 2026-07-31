import { type DayKey, addDays, dayKeyOf, diffDays, eachDay, hourOf, startOfWeek } from "../time/tz";
import type {
  EnergyLevel,
  FocusSessionRow,
  HabitLogRow,
  HabitRow,
  TaskRow,
  TimeBlockRow,
} from "../wire";
import { completedDaysOf } from "./recurrence";
import { summarise } from "./streaks";

/**
 * §3.6 focus analytics. Pure functions over rows already in Dexie — no queries, no aggregation
 * in SQL, no scheduled function.
 *
 * WHY EVERYTHING IS COMPUTED ON VIEW. §3.6 calls the weekly digest "automated", which reads like
 * a cron job writing a summary row. At N=1 that would be a scheduled Edge Function, a table to
 * store results in, and a whole new class of bug — a digest that disagrees with the data it came
 * from, with no way to tell which is right. A year of this user's history is a few thousand rows;
 * summing them takes microseconds and cannot go stale.
 *
 * TWO RULES RUN THROUGH ALL OF IT:
 *
 *   * Only FOCUS sessions count as focus time. Break sessions are recorded too (the `phase`
 *     column exists for exactly this), and counting them would inflate every number here.
 *   * `actual_secs` is the sum of RUNNING segments, never `ended_at - started_at`. Paused time
 *     sits between those two — see the pomodoro store.
 */

/** Rows excluded everywhere: a tombstone is not history, it is a retraction. */
function live<T extends { deleted_at: string | null }>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.deleted_at === null);
}

/** A closed, non-deleted FOCUS session. The unit of every figure below. */
function focusSessions(
  sessions: readonly FocusSessionRow[],
  from: DayKey,
  to: DayKey,
): FocusSessionRow[] {
  return live(sessions).filter((s) => {
    if (s.phase !== "FOCUS") return false;
    const day = dayKeyOf(new Date(s.started_at));
    return day >= from && day <= to;
  });
}

// ------------------------------------------------------------------ focus time

export interface DailyFocus {
  day: DayKey;
  /** Minutes of genuine focus. */
  minutes: number;
  sessions: number;
}

/**
 * Focus minutes per day across a range, including days with none.
 *
 * Zero-days are kept deliberately: a chart that silently omits them compresses a week with two
 * good days into something that looks like consistent work.
 */
export function focusByDay(
  sessions: readonly FocusSessionRow[],
  from: DayKey,
  to: DayKey,
): DailyFocus[] {
  const buckets = new Map<DayKey, DailyFocus>();
  for (const day of eachDay(from, to)) buckets.set(day, { day, minutes: 0, sessions: 0 });

  for (const s of focusSessions(sessions, from, to)) {
    const day = dayKeyOf(new Date(s.started_at));
    const bucket = buckets.get(day);
    if (!bucket) continue;
    bucket.minutes += s.actual_secs / 60;
    bucket.sessions += 1;
  }

  return [...buckets.values()].map((b) => ({ ...b, minutes: Math.round(b.minutes) }));
}

export interface HourBucket {
  /** 0–23, in `APP_TIMEZONE`. */
  hour: number;
  minutes: number;
  sessions: number;
}

/**
 * §3.6's "top focus hours".
 *
 * Bucketed by the hour a session STARTED, in the app timezone. `hourOf` resolves through it —
 * reading UTC hours would report a Phnom Penh user's 9am as 2am and make the whole chart a lie.
 *
 * A session is counted whole against its starting hour rather than split across the hours it
 * spans. Splitting is more precise and less useful: the question is "when do I start working
 * well", and a 25-minute pomodoro cannot straddle more than two buckets anyway.
 */
export function focusByHour(
  sessions: readonly FocusSessionRow[],
  from: DayKey,
  to: DayKey,
): HourBucket[] {
  const buckets: HourBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    minutes: 0,
    sessions: 0,
  }));

  for (const s of focusSessions(sessions, from, to)) {
    const bucket = buckets[hourOf(new Date(s.started_at))];
    if (!bucket) continue;
    bucket.minutes += s.actual_secs / 60;
    bucket.sessions += 1;
  }

  return buckets.map((b) => ({ ...b, minutes: Math.round(b.minutes) }));
}

/** The hours with the most focus time, best first. Ties broken by hour so it is deterministic. */
export function topFocusHours(buckets: readonly HourBucket[], limit = 3): HourBucket[] {
  return [...buckets]
    .filter((b) => b.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes || a.hour - b.hour)
    .slice(0, limit);
}

// ------------------------------------------------------------------ energy

export interface EnergyByHour {
  hour: number;
  /** Mean of HIGH=3, MEDIUM=2, LOW=1, or `null` when nothing was rated in that hour. */
  score: number | null;
  samples: number;
}

const ENERGY_SCORE: Record<EnergyLevel, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

/**
 * §3.6's "energy mapped against time of day".
 *
 * `null` rather than `0` for an unrated hour, and the distinction matters: zero would plot as
 * rock-bottom energy at 3am for someone who has simply never worked at 3am, and the chart would
 * suggest avoiding hours that were never tried.
 */
export function energyByHour(
  sessions: readonly FocusSessionRow[],
  from: DayKey,
  to: DayKey,
): EnergyByHour[] {
  const totals = Array.from({ length: 24 }, () => ({ sum: 0, n: 0 }));

  for (const s of focusSessions(sessions, from, to)) {
    if (!s.energy) continue;
    const bucket = totals[hourOf(new Date(s.started_at))];
    if (!bucket) continue;
    bucket.sum += ENERGY_SCORE[s.energy];
    bucket.n += 1;
  }

  return totals.map((t, hour) => ({
    hour,
    score: t.n === 0 ? null : t.sum / t.n,
    samples: t.n,
  }));
}

// ------------------------------------------------------------------ planned vs actual

export interface PlannedVsActual {
  /** Minutes committed on the calendar (§3.2 time blocks). */
  plannedMinutes: number;
  /** Minutes actually spent in focus sessions. */
  actualMinutes: number;
  /** `actual / planned`, or `null` when nothing was planned. */
  ratio: number | null;
  /** Tasks that were both estimated and worked on, for the per-task table. */
  tasks: TaskAccuracy[];
}

export interface TaskAccuracy {
  taskId: string;
  title: string;
  estimatedMins: number | null;
  actualMins: number;
}

/**
 * §3.6 planned-versus-actual.
 *
 * "Planned" is time BLOCKED OUT on the calendar, not the sum of task estimates. The two answer
 * different questions: estimates say how long the work should take, blocks say how much of the
 * day was committed to it. §3.6 asks about execution against timeboxing, so blocks are the
 * comparison — and unlike estimates, every block has a definite place in the range.
 *
 * Per-task accuracy uses `estimated_mins`, which is the other half of the picture, so both are
 * returned rather than picking one.
 */
export function plannedVsActual(
  blocks: readonly TimeBlockRow[],
  sessions: readonly FocusSessionRow[],
  tasks: readonly TaskRow[],
  from: DayKey,
  to: DayKey,
): PlannedVsActual {
  let plannedMinutes = 0;
  for (const b of live(blocks)) {
    const day = dayKeyOf(new Date(b.starts_at));
    if (day < from || day > to) continue;
    plannedMinutes += (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60_000;
  }

  const inRange = focusSessions(sessions, from, to);

  let actualMinutes = 0;
  const perTask = new Map<string, number>();
  for (const s of inRange) {
    const mins = s.actual_secs / 60;
    actualMinutes += mins;
    // A bare pomodoro has no task; it counts toward the total but not toward any task's accuracy.
    if (s.task_id) perTask.set(s.task_id, (perTask.get(s.task_id) ?? 0) + mins);
  }

  const byId = new Map(live(tasks).map((t) => [t.id, t]));
  const accuracy: TaskAccuracy[] = [...perTask.entries()]
    .map(([taskId, mins]) => {
      const task = byId.get(taskId);
      return {
        taskId,
        title: task?.title ?? "Deleted task",
        estimatedMins: task?.estimated_mins ?? null,
        actualMins: Math.round(mins),
      };
    })
    .sort((a, b) => b.actualMins - a.actualMins);

  return {
    plannedMinutes: Math.round(plannedMinutes),
    actualMinutes: Math.round(actualMinutes),
    ratio: plannedMinutes === 0 ? null : actualMinutes / plannedMinutes,
    tasks: accuracy,
  };
}

// ------------------------------------------------------------------ task velocity

export interface Velocity {
  completed: number;
  created: number;
  /** Completions per day across the range. */
  perDay: number;
  byDay: Array<{ day: DayKey; completed: number }>;
}

/**
 * Task velocity.
 *
 * Completions are bucketed by `completed_at`, which is a real transition timestamp rather than a
 * derived one — §6 carried three overlapping completion fields and ADR 0001 collapsed them
 * precisely so a number like this has one unambiguous source.
 *
 * Creation has no timestamp of its own on `task`, so "created" is approximated from `sort_order`,
 * which `createTask` seeds with `Date.now()`. Approximate and clearly labelled beats absent.
 */
export function velocity(
  tasks: readonly TaskRow[],
  from: DayKey,
  to: DayKey,
): Velocity {
  const byDay = new Map<DayKey, number>();
  for (const day of eachDay(from, to)) byDay.set(day, 0);

  let completed = 0;
  let created = 0;

  for (const t of live(tasks)) {
    if (t.completed_at) {
      const day = dayKeyOf(new Date(t.completed_at));
      if (day >= from && day <= to) {
        completed++;
        byDay.set(day, (byDay.get(day) ?? 0) + 1);
      }
    }

    if (Number.isFinite(t.sort_order) && t.sort_order > 0) {
      const day = dayKeyOf(new Date(t.sort_order));
      if (day >= from && day <= to) created++;
    }
  }

  const days = diffDays(from, to) + 1;

  return {
    completed,
    created,
    perDay: days === 0 ? 0 : completed / days,
    byDay: [...byDay.entries()].map(([day, n]) => ({ day, completed: n })),
  };
}

// ------------------------------------------------------------------ habit consistency

export interface HabitConsistency {
  /** Mean completion rate across all live habits, 0–1. `0` when there are no habits. */
  rate: number;
  habits: Array<{ id: string; title: string; rate: number; current: number }>;
}

/**
 * §3.6's "habit consistency percentage".
 *
 * The mean of each habit's own rate, NOT total completions over total due days. The latter lets
 * one daily habit outvote five weekly ones simply by having more occurrences, so a perfect week
 * on everything except the daily one would read as a bad week.
 *
 * Archived habits are excluded — §3.4 archiving means "stop tracking", and continuing to score
 * something you deliberately stopped is exactly the wrong signal.
 */
export function habitConsistency(
  habits: readonly HabitRow[],
  logs: readonly HabitLogRow[],
  today: DayKey,
  windowDays = 30,
): HabitConsistency {
  const active = live(habits).filter((h) => h.archived_at === null);
  if (active.length === 0) return { rate: 0, habits: [] };

  const rows = active.map((habit) => {
    const completed = completedDaysOf(logs, habit.id);
    const s = summarise(habit, completed, today, windowDays);
    return { id: habit.id, title: habit.title, rate: s.rate, current: s.current };
  });

  return {
    rate: rows.reduce((sum, r) => sum + r.rate, 0) / rows.length,
    habits: rows.sort((a, b) => b.rate - a.rate),
  };
}

// ------------------------------------------------------------------ weekly digest

export interface WeeklyDigest {
  weekStart: DayKey;
  weekEnd: DayKey;
  focusMinutes: number;
  focusSessions: number;
  velocity: Velocity;
  consistency: HabitConsistency;
  topHours: HourBucket[];
  plannedVsActual: PlannedVsActual;
  /** The same figures for the week before, so the digest can say "up" or "down". */
  previous: { focusMinutes: number; completed: number; consistency: number } | null;
}

export interface DigestInput {
  tasks: readonly TaskRow[];
  blocks: readonly TimeBlockRow[];
  sessions: readonly FocusSessionRow[];
  habits: readonly HabitRow[];
  logs: readonly HabitLogRow[];
}

/**
 * §3.6's weekly review digest, computed on view.
 *
 * Weeks run Monday–Sunday (`startOfWeek`). The previous week is included because every figure
 * here is meaningless in isolation: "4 hours of focus" says nothing without knowing whether last
 * week was two or ten.
 */
export function weeklyDigest(
  input: DigestInput,
  anyDayInWeek: DayKey,
  includePrevious = true,
): WeeklyDigest {
  const weekStart = startOfWeek(anyDayInWeek);
  const weekEnd = addDays(weekStart, 6);

  const sessions = focusSessions(input.sessions, weekStart, weekEnd);
  const focusMinutes = Math.round(sessions.reduce((sum, s) => sum + s.actual_secs / 60, 0));

  const hours = focusByHour(input.sessions, weekStart, weekEnd);

  let previous: WeeklyDigest["previous"] = null;
  if (includePrevious) {
    const prevStart = addDays(weekStart, -7);
    const prevEnd = addDays(weekStart, -1);
    const prevSessions = focusSessions(input.sessions, prevStart, prevEnd);

    previous = {
      focusMinutes: Math.round(prevSessions.reduce((sum, s) => sum + s.actual_secs / 60, 0)),
      completed: velocity(input.tasks, prevStart, prevEnd).completed,
      // Scored as at the end of that week, not as at today, or the comparison would be against
      // a rate that has since moved.
      consistency: habitConsistency(input.habits, input.logs, prevEnd, 7).rate,
    };
  }

  return {
    weekStart,
    weekEnd,
    focusMinutes,
    focusSessions: sessions.length,
    velocity: velocity(input.tasks, weekStart, weekEnd),
    consistency: habitConsistency(input.habits, input.logs, weekEnd, 7),
    topHours: topFocusHours(hours),
    plannedVsActual: plannedVsActual(
      input.blocks,
      input.sessions,
      input.tasks,
      weekStart,
      weekEnd,
    ),
    previous,
  };
}

/** `95` → `"1h 35m"`. Minutes are the unit everywhere above; this is the only formatter. */
export function formatMinutes(total: number): string {
  const mins = Math.max(0, Math.round(total));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** `14` → `"2pm"`. Compact enough for an axis label. */
export function formatHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}
