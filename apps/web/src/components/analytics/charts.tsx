"use client";

import {
  type DailyFocus,
  type EnergyByHour,
  type HourBucket,
  formatFocusMinutes,
  formatHour,
} from "@rainflow/data";

/**
 * §3.6's charts, as hand-written SVG.
 *
 * No charting library. Recharts and friends are 100–300KB for what is, here, three bar charts
 * with fixed axes — and every one of them ships its own responsive-container machinery that
 * fights the flex layout. These are around sixty lines each and do exactly what is needed.
 *
 * They share one rule: NEVER SILENTLY DROP AN EMPTY BUCKET. A chart of only the hours that had
 * focus, or only the days with work, compresses a sparse week into something that looks busy.
 * The gaps are the information.
 */

/** Focus minutes per hour of day (§3.6 "top focus hours"). */
export function HourChart({ buckets }: { buckets: readonly HourBucket[] }) {
  const peak = Math.max(1, ...buckets.map((b) => b.minutes));
  const best = Math.max(0, ...buckets.map((b) => b.minutes));

  return (
    <div className="flex h-32 items-end gap-px" role="img" aria-label="Focus minutes by hour">
      {buckets.map((bucket) => (
        <div key={bucket.hour} className="group relative flex flex-1 flex-col justify-end">
          <div
            className={
              // The peak hour is highlighted rather than labelled — the whole question this
              // chart answers is "when am I best", so the answer should be visible at a glance.
              bucket.minutes === best && best > 0
                ? "rounded-t-sm bg-rain"
                : "rounded-t-sm bg-rain/35"
            }
            style={{ height: `${(bucket.minutes / peak) * 100}%` }}
          />
          <span className="pointer-events-none absolute -top-5 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-card px-1.5 py-0.5 text-[10px] text-foreground shadow group-hover:block">
            {formatHour(bucket.hour)} · {formatFocusMinutes(bucket.minutes)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Axis for the 24-hour charts. Every fourth hour, or the labels collide below ~600px. */
export function HourAxis() {
  return (
    <div className="mt-1 flex text-[9px] text-muted-foreground">
      {Array.from({ length: 24 }, (_, hour) => (
        <span key={hour} className="flex-1 text-center">
          {hour % 4 === 0 ? formatHour(hour) : ""}
        </span>
      ))}
    </div>
  );
}

/**
 * Mean energy by hour (§3.6 "mapped against time of day").
 *
 * An unrated hour renders as NOTHING, not as a zero-height bar at the bottom. Plotting it as zero
 * would claim rock-bottom energy for hours that were simply never worked, and the chart would
 * advise against times that were never tried.
 */
export function EnergyChart({ rows }: { rows: readonly EnergyByHour[] }) {
  const rated = rows.filter((r) => r.score !== null);

  if (rated.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        No energy ratings yet. They are asked for after a completed focus phase.
      </p>
    );
  }

  return (
    <>
      <div className="flex h-24 items-end gap-px" role="img" aria-label="Average energy by hour">
        {rows.map((row) => (
          <div key={row.hour} className="group relative flex flex-1 flex-col justify-end">
            {row.score === null ? (
              // A faint tick, so the hour is still findable on the axis without asserting a value.
              <div className="h-px bg-border" />
            ) : (
              <div
                className={
                  row.score >= 2.5
                    ? "rounded-t-sm bg-success"
                    : row.score >= 1.75
                      ? "rounded-t-sm bg-rain"
                      : "rounded-t-sm bg-priority-high"
                }
                // Scores run 1–3, so the bar is scaled from 1 rather than 0 — a LOW hour should
                // read as low, not as almost-absent.
                style={{ height: `${((row.score - 1) / 2) * 90 + 10}%` }}
              />
            )}
            <span className="pointer-events-none absolute -top-5 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-card px-1.5 py-0.5 text-[10px] text-foreground shadow group-hover:block">
              {formatHour(row.hour)} ·{" "}
              {row.score === null
                ? "no data"
                : `${ENERGY_WORD(row.score)} (${row.samples})`}
            </span>
          </div>
        ))}
      </div>
      <HourAxis />
    </>
  );
}

function ENERGY_WORD(score: number): string {
  if (score >= 2.5) return "high";
  if (score >= 1.75) return "medium";
  return "low";
}

/** Focus minutes per day over a trailing window. */
export function DailyChart({ days }: { days: readonly DailyFocus[] }) {
  const peak = Math.max(1, ...days.map((d) => d.minutes));

  return (
    <>
      <div className="flex h-24 items-end gap-px" role="img" aria-label="Focus minutes by day">
        {days.map((day) => (
          <div key={day.day} className="group relative flex flex-1 flex-col justify-end">
            <div
              className="rounded-t-sm bg-rain/60"
              style={{ height: day.minutes === 0 ? "1px" : `${(day.minutes / peak) * 100}%` }}
            />
            <span className="pointer-events-none absolute -top-5 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-card px-1.5 py-0.5 text-[10px] text-foreground shadow group-hover:block">
              {day.day} · {formatFocusMinutes(day.minutes)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
        <span>{days[0]?.day}</span>
        <span>{days[days.length - 1]?.day}</span>
      </div>
    </>
  );
}

/** A headline number with its week-on-week change. */
export function Stat({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: string;
  delta?: number | null;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        {delta === null || delta === undefined ? (
          (hint ?? " ")
        ) : delta === 0 ? (
          "same as last week"
        ) : (
          <span className={delta > 0 ? "text-success" : "text-priority-high"}>
            {delta > 0 ? "▲" : "▼"} {Math.abs(Math.round(delta))}% vs last week
          </span>
        )}
      </p>
    </div>
  );
}

/** Percentage change, or `null` when the baseline is zero and a ratio would be meaningless. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
