/**
 * Day-boundary math, pinned to a fixed timezone.
 *
 * The PRD never named a timezone, yet habit streaks, the Today view, "Nth day of month"
 * and daily velocity all depend on when a day starts. Everything here is computed in
 * `APP_TIMEZONE` and is deliberately independent of the host's `TZ` — the test suite runs
 * under `TZ=Pacific/Kiritimati` (UTC+14) to prove it.
 *
 * A `DayKey` is a calendar date as `YYYY-MM-DD`. It is the canonical key for anything
 * that happens "on a day" (see `habit_log.log_date`). Never derive one with
 * `Date#toISOString().slice(0, 10)` — that silently gives you the UTC day.
 */

export const APP_TIMEZONE = "Asia/Phnom_Penh";

/** A calendar date in `APP_TIMEZONE`, formatted `YYYY-MM-DD`. */
export type DayKey = string;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(instant: Date): ZonedParts {
  const out: Record<string, number> = {};
  for (const part of partsFormatter.formatToParts(instant)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out as unknown as ZonedParts;
}

/**
 * Offset of `APP_TIMEZONE` from UTC at `instant`, in milliseconds.
 * Positive east of Greenwich. Computed rather than hardcoded to +07:00 so this module
 * stays correct if `APP_TIMEZONE` is ever changed to a zone that observes DST.
 */
function offsetMsAt(instant: Date): number {
  const p = zonedParts(instant);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Drop sub-second precision on both sides so the difference is a clean offset.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** The calendar date, in `APP_TIMEZONE`, on which `instant` falls. */
export function dayKeyOf(instant: Date): DayKey {
  const p = zonedParts(instant);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Today's calendar date in `APP_TIMEZONE`. */
export function todayKey(now: Date = new Date()): DayKey {
  return dayKeyOf(now);
}

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Split a `DayKey` into its numeric parts. Throws on anything malformed. */
export function parseDayKey(key: DayKey): { year: number; month: number; day: number } {
  const m = DAY_KEY_RE.exec(key);
  if (!m) throw new RangeError(`Not a DayKey: ${JSON.stringify(key)}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) throw new RangeError(`Bad month in DayKey: ${key}`);
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Bad day in DayKey: ${key}`);
  }
  return { year, month, day };
}

export function isDayKey(value: unknown): value is DayKey {
  if (typeof value !== "string" || !DAY_KEY_RE.test(value)) return false;
  try {
    parseDayKey(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * The instant at which `key` begins in `APP_TIMEZONE`.
 *
 * Resolved in two passes: guess using the offset at the naive UTC reading, then re-derive
 * the offset at that candidate and correct. The second pass matters only for zones with
 * DST, where the offset before local midnight can differ from the offset after it.
 */
export function startOfDay(key: DayKey): Date {
  const { year, month, day } = parseDayKey(key);
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0);

  let candidate = naive - offsetMsAt(new Date(naive));
  const refined = naive - offsetMsAt(new Date(candidate));
  if (refined !== candidate) candidate = refined;

  return new Date(candidate);
}

/** The last instant of `key` (inclusive, millisecond granularity). */
export function endOfDay(key: DayKey): Date {
  return new Date(startOfDay(nextDay(key)).getTime() - 1);
}

/** Half-open range `[start, end)` covering `key`. Use this for range queries. */
export function dayRange(key: DayKey): { start: Date; end: Date } {
  return { start: startOfDay(key), end: startOfDay(nextDay(key)) };
}

/** Shift a `DayKey` by whole days. Pure calendar math — no timezone involved. */
export function addDays(key: DayKey, days: number): DayKey {
  const { year, month, day } = parseDayKey(key);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * MS_PER_DAY);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

export function nextDay(key: DayKey): DayKey {
  return addDays(key, 1);
}

export function previousDay(key: DayKey): DayKey {
  return addDays(key, -1);
}

/** Whole days from `from` to `to`. Negative when `to` precedes `from`. */
export function diffDays(from: DayKey, to: DayKey): number {
  const a = parseDayKey(from);
  const b = parseDayKey(to);
  const ms =
    Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / MS_PER_DAY);
}

/** Day of week for a `DayKey`. 0 = Sunday … 6 = Saturday, matching `habit.weekdays`. */
export function weekdayOf(key: DayKey): number {
  const { year, month, day } = parseDayKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** True for Monday–Friday. Backs the `WEEKDAYS` recurrence kind (PRD §3.4). */
export function isWeekday(key: DayKey): boolean {
  const dow = weekdayOf(key);
  return dow >= 1 && dow <= 5;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The `MONTHLY_NTH` occurrence within the month containing `key`.
 *
 * Per ADR 0001 this means day-of-month ("the 15th"), not "the 2nd Tuesday". A `monthDay`
 * past the end of a short month clamps to the last day, so 31 lands on Feb 28/29 rather
 * than being skipped. Clamping is enforced here rather than in SQL.
 */
export function monthlyNthOccurrence(key: DayKey, monthDay: number): DayKey {
  if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) {
    throw new RangeError(`monthDay must be an integer in 1..31, got ${monthDay}`);
  }
  const { year, month } = parseDayKey(key);
  const clamped = Math.min(monthDay, daysInMonth(year, month));
  return `${year}-${pad2(month)}-${pad2(clamped)}`;
}

/** Monday of the week containing `key`. Weeks run Monday–Sunday. */
export function startOfWeek(key: DayKey): DayKey {
  const dow = weekdayOf(key);
  return addDays(key, dow === 0 ? -6 : 1 - dow);
}

/** Inclusive list of `DayKey`s from `from` to `to`. Throws if the range is inverted. */
export function eachDay(from: DayKey, to: DayKey): DayKey[] {
  const span = diffDays(from, to);
  if (span < 0) throw new RangeError(`Inverted range: ${from} → ${to}`);
  const out: DayKey[] = [];
  for (let i = 0; i <= span; i++) out.push(addDays(from, i));
  return out;
}

/** Minutes since local midnight — the y-axis of the §3.2 timebox grid. */
export function minutesIntoDay(instant: Date): number {
  const p = zonedParts(instant);
  return p.hour * 60 + p.minute;
}

/** The instant `minutes` after local midnight on `key`. Inverse of `minutesIntoDay`. */
export function atMinutesIntoDay(key: DayKey, minutes: number): Date {
  return new Date(startOfDay(key).getTime() + minutes * MS_PER_MINUTE);
}

/** Local wall-clock hour (0–23) of `instant` — the bucket for §3.6 "top focus hours". */
export function hourOf(instant: Date): number {
  return zonedParts(instant).hour;
}

/** `instant` broken into `APP_TIMEZONE` wall-clock fields. */
export function appWallClock(instant: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  return zonedParts(instant);
}

/**
 * A Date whose HOST-local fields read as `APP_TIMEZONE`'s wall clock.
 *
 * Needed for natural-language date parsing. Libraries like chrono resolve "tomorrow" and
 * "next monday" by reading the host-local fields of a reference Date — so on a machine set to
 * UTC-7, "tomorrow" would be computed against the wrong day for a Phnom Penh user, and the
 * resulting task would be due a day early.
 *
 * `new Date(y, m, d, …)` interprets its arguments as host-local, so constructing one from the
 * app-timezone components gives a Date that *reads* correctly to such a library. The instant it
 * represents is meaningless — only its fields matter, and it must never be stored or compared.
 * Convert the parser's output back through `atMinutesIntoDay` to get a real instant.
 */
export function appWallClockAsHostLocal(instant: Date = new Date()): Date {
  const p = zonedParts(instant);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}
