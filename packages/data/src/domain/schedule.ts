import { type DayKey, atMinutesIntoDay, dayRange, minutesIntoDay } from "../time/tz";
import type { TimeBlockRow } from "../wire";

/**
 * Timebox scheduling (PRD §3.2, second half).
 *
 * Pure functions over `time_block` rows: no Dexie, no React, no clock unless one is passed in.
 * The calendar component does nothing but render what comes out of here, which is what makes the
 * fiddly parts — midnight crossings, overlapping blocks, DST — testable without a browser.
 *
 * EVERYTHING IS MINUTES-INTO-DAY IN `APP_TIMEZONE`. A block is stored as two absolute instants
 * (`starts_at` / `ends_at` are timestamptz), but the grid is a wall clock, so every position on
 * it has to be resolved through the app timezone. Deriving y-positions from UTC hours would put
 * a 9am block at 2am on the grid for a Phnom Penh user, and would drift by an hour twice a year
 * for anyone in a DST zone.
 */

/** Grid granularity. Drags and resizes snap to this. */
export const SLOT_MINUTES = 15;

/** Minutes in a calendar day, for a day without a DST transition. */
export const DAY_MINUTES = 24 * 60;

/** Default length for a block created from a task with no estimate. */
export const DEFAULT_BLOCK_MINUTES = 60;

/** A block's footprint on one particular day, clipped to that day's bounds. */
export interface DaySpan {
  /** Minutes from local midnight. `0` for a block that started on an earlier day. */
  startMin: number;
  /** Minutes from local midnight. `DAY_MINUTES` for a block running into the next day. */
  endMin: number;
  /** True when the block began before this day started. */
  clippedStart: boolean;
  /** True when the block runs past the end of this day. */
  clippedEnd: boolean;
}

/** A block placed on the grid, with the horizontal slot it occupies among its overlaps. */
export interface PositionedBlock<T extends TimeBlockRow = TimeBlockRow> extends DaySpan {
  block: T;
  /** 0-based column within the overlap cluster. */
  column: number;
  /** How many columns the cluster needs. Width is `1 / columns`. */
  columns: number;
}

/**
 * Where a block sits on `day`'s grid, or `null` if it does not touch that day at all.
 *
 * The day's bounds come from `dayRange`, which is half-open `[start, end)`. That matters at the
 * edges: a block ending exactly at midnight belongs to the day that is ending, not the one
 * beginning, and a block starting exactly at midnight belongs to the new day. Getting this
 * backwards duplicates every midnight-aligned block onto two days.
 */
export function daySpanOf(block: TimeBlockRow, day: DayKey): DaySpan | null {
  const { start, end } = dayRange(day);
  const startMs = Date.parse(block.starts_at);
  const endMs = Date.parse(block.ends_at);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;

  const dayStart = start.getTime();
  const dayEnd = end.getTime();

  // Half-open on both sides: no touching, no span.
  if (endMs <= dayStart || startMs >= dayEnd) return null;

  const clippedStart = startMs < dayStart;
  const clippedEnd = endMs > dayEnd;

  /*
   * Minutes are derived from the day's own start rather than from `minutesIntoDay(instant)`.
   * The two agree on an ordinary day, but on a DST-shift day they do not: a 23- or 25-hour day
   * makes wall-clock minutes non-linear, and the grid is drawn in linear pixels. Measuring the
   * offset from `dayStart` keeps position and duration consistent with each other, which is what
   * a calendar actually needs. `Asia/Phnom_Penh` has no DST, so this is insurance rather than a
   * live concern — but it is insurance that costs nothing.
   */
  const startMin = clippedStart ? 0 : Math.round((startMs - dayStart) / 60_000);
  const endMin = clippedEnd
    ? Math.round((dayEnd - dayStart) / 60_000)
    : Math.round((endMs - dayStart) / 60_000);

  return { startMin, endMin, clippedStart, clippedEnd };
}

/** A block's full length in minutes, independent of any day. */
export function durationMinutes(block: TimeBlockRow): number {
  return Math.round(
    (Date.parse(block.ends_at) - Date.parse(block.starts_at)) / 60_000,
  );
}

/** Do two half-open minute ranges intersect? Touching end-to-start does NOT count. */
export function spansOverlap(a: DaySpan, b: DaySpan): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

/**
 * Lay out a day's blocks, splitting overlapping ones into side-by-side columns.
 *
 * Two passes:
 *
 *   1. CLUSTER. Walk the blocks in start order, accumulating a run whose union is contiguous.
 *      A cluster ends the moment a block starts at or after the furthest end seen so far. Every
 *      block in a cluster shares one column count, so a 3-way overlap does not leave the two
 *      blocks either side of it rendered at a different width than their neighbour.
 *
 *   2. ASSIGN. Within a cluster, give each block the first column that is free at its start
 *      time. Greedy is optimal here for the same reason it is in interval-graph colouring:
 *      processing in start order means the number of columns used never exceeds the maximum
 *      number of blocks simultaneously live.
 *
 * `clusterEnd` must track the MAXIMUM end seen, not the previous block's end. A long block
 * followed by two short ones inside it would otherwise close the cluster early and let the short
 * ones render on top of the long one at full width.
 */
export function layoutDay<T extends TimeBlockRow>(
  blocks: readonly T[],
  day: DayKey,
): PositionedBlock<T>[] {
  const spans: Array<{ block: T; span: DaySpan }> = [];

  for (const block of blocks) {
    if (block.deleted_at !== null) continue;
    const span = daySpanOf(block, day);
    if (span) spans.push({ block, span });
  }

  spans.sort(
    (a, b) =>
      a.span.startMin - b.span.startMin ||
      a.span.endMin - b.span.endMin ||
      // Stable and identical on every device, so two peers draw the same picture.
      (a.block.id < b.block.id ? -1 : a.block.id > b.block.id ? 1 : 0),
  );

  const out: PositionedBlock<T>[] = [];

  let cluster: Array<{ block: T; span: DaySpan; column: number }> = [];
  let columnEnds: number[] = [];
  let clusterEnd = -1;

  function flush() {
    const columns = Math.max(columnEnds.length, 1);
    for (const item of cluster) {
      out.push({ ...item.span, block: item.block, column: item.column, columns });
    }
    cluster = [];
    columnEnds = [];
    clusterEnd = -1;
  }

  for (const { block, span } of spans) {
    if (cluster.length > 0 && span.startMin >= clusterEnd) flush();

    let column = columnEnds.findIndex((end) => end <= span.startMin);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(span.endMin);
    } else {
      columnEnds[column] = span.endMin;
    }

    cluster.push({ block, span, column });
    clusterEnd = Math.max(clusterEnd, span.endMin);
  }

  if (cluster.length > 0) flush();

  return out;
}

/** Round to the nearest grid slot, clamped into the day. */
export function snapToSlot(minutes: number, slot: number = SLOT_MINUTES): number {
  const snapped = Math.round(minutes / slot) * slot;
  return Math.min(Math.max(snapped, 0), DAY_MINUTES);
}

/**
 * Resolve a drop at `minutes` into a concrete start/end pair.
 *
 * The start snaps and the duration is preserved, rather than snapping both ends independently —
 * dragging a 45-minute block should not silently turn it into an hour. If the result would run
 * past midnight it is pulled back so the whole block still fits in the day; a block that is
 * itself longer than a day (which the UI cannot create) simply starts at 00:00.
 */
export function placeBlock(
  day: DayKey,
  minutes: number,
  lengthMinutes: number,
): { starts_at: string; ends_at: string } {
  const length = Math.max(SLOT_MINUTES, Math.round(lengthMinutes));
  const latestStart = Math.max(0, DAY_MINUTES - length);
  const startMin = Math.min(snapToSlot(minutes), latestStart);

  return {
    starts_at: atMinutesIntoDay(day, startMin).toISOString(),
    ends_at: atMinutesIntoDay(day, startMin + length).toISOString(),
  };
}

/**
 * Total minutes committed on `day`.
 *
 * Overlaps are counted ONCE. Summing durations would report 3 hours planned for two 90-minute
 * blocks scheduled on top of each other, which reads as a full afternoon when it is actually a
 * double-booking — the opposite of what §3.6's planned-vs-actual is for.
 */
export function scheduledMinutes(blocks: readonly TimeBlockRow[], day: DayKey): number {
  const spans = blocks
    .filter((b) => b.deleted_at === null)
    .map((b) => daySpanOf(b, day))
    .filter((s): s is DaySpan => s !== null)
    .sort((a, b) => a.startMin - b.startMin);

  let total = 0;
  let covered = -1;

  for (const span of spans) {
    const from = Math.max(span.startMin, covered);
    if (span.endMin > from) {
      total += span.endMin - from;
      covered = span.endMin;
    }
  }

  return total;
}

/**
 * Minutes-into-day of `now`, or `null` when `now` is not on `day`.
 *
 * The null case is what stops the now-line being drawn on a day the user has navigated to but
 * is not living in.
 */
export function nowLineMinutes(day: DayKey, now: Date = new Date()): number | null {
  const { start, end } = dayRange(day);
  const ms = now.getTime();
  if (ms < start.getTime() || ms >= end.getTime()) return null;
  return minutesIntoDay(now);
}

/** `540` → `"09:00"`. 24-hour, because the grid labels have to line up in a narrow gutter. */
export function formatMinutes(minutes: number): string {
  const m = ((Math.round(minutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
