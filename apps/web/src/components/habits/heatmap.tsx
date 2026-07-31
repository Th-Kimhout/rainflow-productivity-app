"use client";

import {
  type CompletedDays,
  type DayKey,
  type RecurrenceRule,
  addDays,
  heatmap as buildHeatmap,
  startOfWeek,
  todayKey,
  weekdayOf,
} from "@rainflow/data";
import { useMemo } from "react";

/**
 * The §3.4 habit matrix, "inspired by GitHub contribution graphs".
 *
 * SVG rather than a CSS grid of divs. A year is 371 cells per habit, and a page of eight habits
 * is three thousand DOM nodes that React has to diff every time a box is ticked. One `<svg>` of
 * `<rect>`s costs a fraction of that, and the geometry — fixed columns of seven, aligned to week
 * boundaries — is exactly what SVG coordinates are for.
 *
 * THREE STATES, NOT TWO. GitHub's graph only has to say "how much", but a habit graph has to
 * distinguish a day OFF from a day MISSED: a weekdays-only habit with a completions-only grid
 * looks like it fails every weekend. That distinction is the most useful thing the picture says,
 * so it gets the strongest visual difference — colour for done, a faint outline for missed, and
 * nearly nothing for a day the habit was never scheduled.
 */

const CELL = 11;
const GAP = 3;
const PITCH = CELL + GAP;
/** Space for the weekday labels down the left. */
const LEFT = 22;
/** Space for the month labels across the top. */
const TOP = 14;

export function HabitHeatmap({
  habit,
  completed,
  color,
  weeks = 26,
  today = todayKey(),
}: {
  habit: RecurrenceRule;
  completed: CompletedDays;
  color: string;
  weeks?: number;
  today?: DayKey;
}) {
  const { cells, columns, months } = useMemo(() => {
    /*
     * Start on a week boundary so every column is a full Monday–Sunday and the weekday labels
     * line up. Starting at "26 weeks ago" exactly would put an arbitrary weekday at the top of
     * column 0 and make the whole grid unreadable.
     */
    const from = startOfWeek(addDays(today, -(weeks - 1) * 7));
    const to = addDays(from, weeks * 7 - 1);

    const built = buildHeatmap(habit, completed, from, to, today);

    // `startOfWeek` is Monday-based, so shift Sunday (0) to the bottom of its column.
    const rowOf = (day: DayKey) => (weekdayOf(day) + 6) % 7;

    const positioned = built.map((cell, i) => ({
      ...cell,
      column: Math.floor(i / 7),
      row: rowOf(cell.day),
    }));

    // One label per month, at the column where that month first appears.
    const seen = new Set<string>();
    const monthLabels: Array<{ column: number; label: string }> = [];
    for (const cell of positioned) {
      const key = cell.day.slice(0, 7);
      if (seen.has(key)) continue;
      seen.add(key);
      // Skip a month whose first visible day is late in the column — the label would sit over
      // the previous month's cells.
      if (cell.row > 3 && monthLabels.length > 0) continue;
      monthLabels.push({
        column: cell.column,
        label: MONTHS[Number(key.slice(5, 7)) - 1] ?? "",
      });
    }

    return { cells: positioned, columns: weeks, months: monthLabels };
  }, [habit, completed, weeks, today]);

  const width = LEFT + columns * PITCH;
  const height = TOP + 7 * PITCH;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Completion history for the last ${weeks} weeks`}
      className="max-w-full"
    >
      {months.map((m) => (
        <text
          key={`${m.column}-${m.label}`}
          x={LEFT + m.column * PITCH}
          y={TOP - 4}
          className="fill-muted-foreground text-[9px]"
        >
          {m.label}
        </text>
      ))}

      {/* Mon / Wed / Fri only — seven labels in 11px rows is unreadable. */}
      {[0, 2, 4].map((row) => (
        <text
          key={row}
          x={0}
          y={TOP + row * PITCH + CELL - 2}
          className="fill-muted-foreground text-[9px]"
        >
          {["Mon", "Wed", "Fri"][row / 2]}
        </text>
      ))}

      {cells.map((cell) => (
        <rect
          key={cell.day}
          x={LEFT + cell.column * PITCH}
          y={TOP + cell.row * PITCH}
          width={CELL}
          height={CELL}
          rx={2.5}
          fill={cell.completed ? color : "transparent"}
          // A missed due day is outlined; a day off is barely there. The contrast between those
          // two is the whole point of the graphic.
          className={
            cell.completed
              ? ""
              : cell.future
                ? "fill-muted/20"
                : cell.due
                  ? "fill-priority-high/10 stroke-priority-high/30"
                  : "fill-muted/40"
          }
          strokeWidth={cell.due && !cell.completed && !cell.future ? 1 : 0}
        >
          <title>
            {cell.day}
            {cell.future
              ? ""
              : cell.completed
                ? " — done"
                : cell.due
                  ? " — missed"
                  : " — not scheduled"}
          </title>
        </rect>
      ))}
    </svg>
  );
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** The legend. Without it, three shades of grey mean nothing. */
export function HeatmapLegend({ color }: { color: string }) {
  return (
    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <span className="size-2.5 rounded-[2px]" style={{ backgroundColor: color }} />
        Done
      </span>
      <span className="flex items-center gap-1">
        <span className="size-2.5 rounded-[2px] bg-priority-high/10 ring-1 ring-priority-high/30" />
        Missed
      </span>
      <span className="flex items-center gap-1">
        <span className="size-2.5 rounded-[2px] bg-muted/40" />
        Not scheduled
      </span>
    </div>
  );
}
