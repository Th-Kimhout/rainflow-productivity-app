"use client";

import { formatFocusMinutes, formatHour, todayKey } from "@rainflow/data";

import {
  DailyChart,
  EnergyChart,
  HourAxis,
  HourChart,
  Stat,
  percentChange,
} from "@/components/analytics/charts";
import { useDigest, useFocusPatterns } from "@/lib/data/hooks";

/**
 * §3.6 focus analytics and the weekly review digest.
 *
 * COMPUTED ON VIEW, never stored. §3.6 calls the digest "automated", which reads like a cron job
 * writing a summary row — at N=1 that would be a scheduled function, a table to hold results, and
 * a new class of bug where the digest disagrees with the data it came from and nothing says which
 * is right. Reading a few thousand Dexie rows and summing them takes microseconds and cannot go
 * stale.
 *
 * It also means the whole page works offline, like everything else here.
 */
export function AnalyticsView() {
  const today = todayKey();
  const digest = useDigest(today);
  const patterns = useFocusPatterns(today, 30);

  if (!digest || !patterns) {
    return <p className="px-6 py-4 text-sm text-muted-foreground">Loading…</p>;
  }

  const { previous } = digest;
  const hasHistory =
    digest.focusMinutes > 0 || digest.velocity.completed > 0 || digest.consistency.habits.length > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-5">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          Weekly review
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {digest.weekStart} → {digest.weekEnd}
        </p>
      </header>

      {!hasHistory && (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nothing recorded this week yet. Numbers appear as you run focus sessions, complete tasks
          and tick habits.
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Focus time"
          value={formatFocusMinutes(digest.focusMinutes)}
          delta={previous ? percentChange(digest.focusMinutes, previous.focusMinutes) : null}
          hint={`${digest.focusSessions} session${digest.focusSessions === 1 ? "" : "s"}`}
        />
        <Stat
          label="Tasks done"
          value={String(digest.velocity.completed)}
          delta={previous ? percentChange(digest.velocity.completed, previous.completed) : null}
          hint={`${digest.velocity.perDay.toFixed(1)} per day`}
        />
        <Stat
          label="Habit consistency"
          value={`${Math.round(digest.consistency.rate * 100)}%`}
          delta={
            previous ? percentChange(digest.consistency.rate, previous.consistency) : null
          }
          hint={`${digest.consistency.habits.length} tracked`}
        />
        <Stat
          label="Best hour"
          value={digest.topHours[0] ? formatHour(digest.topHours[0].hour) : "—"}
          hint={
            digest.topHours[0]
              ? formatFocusMinutes(digest.topHours[0].minutes)
              : "no focus sessions yet"
          }
        />
      </section>

      <Panel
        title="Planned vs actual"
        // §3.6's own framing: execution measured against timeboxing, not against estimates.
        subtitle="Time blocked on the calendar against time actually focused"
      >
        <PlannedVsActual digest={digest} />
      </Panel>

      <Panel title="When you focus" subtitle="Last 30 days, by hour of day">
        <HourChart buckets={patterns.hours} />
        <HourAxis />
        {digest.topHours.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            This week&rsquo;s best:{" "}
            {digest.topHours.map((h, i) => (
              <span key={h.hour}>
                {i > 0 && ", "}
                <span className="text-foreground">{formatHour(h.hour)}</span> (
                {formatFocusMinutes(h.minutes)})
              </span>
            ))}
          </p>
        )}
      </Panel>

      <Panel title="Energy by time of day" subtitle="Averaged from post-session ratings">
        <EnergyChart rows={patterns.energy} />
      </Panel>

      <Panel title="Focus over time" subtitle="Last 30 days">
        <DailyChart days={patterns.daily} />
      </Panel>

      {digest.consistency.habits.length > 0 && (
        <Panel title="Habits this week" subtitle="Completion rate over the last 7 days">
          <ul className="space-y-1.5">
            {digest.consistency.habits.map((h) => (
              <li key={h.id} className="flex items-center gap-3 text-xs">
                <span className="w-40 shrink-0 truncate text-foreground">{h.title}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-success"
                    style={{ width: `${Math.round(h.rate * 100)}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                  {Math.round(h.rate * 100)}%
                </span>
                <span className="w-14 shrink-0 text-right text-muted-foreground">
                  {h.current}d streak
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <header className="mb-3">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

function PlannedVsActual({ digest }: { digest: NonNullable<ReturnType<typeof useDigest>> }) {
  const { plannedMinutes, actualMinutes, ratio, tasks } = digest.plannedVsActual;

  if (plannedMinutes === 0 && actualMinutes === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        Nothing scheduled or focused this week.
      </p>
    );
  }

  const peak = Math.max(plannedMinutes, actualMinutes, 1);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Bar label="Planned" minutes={plannedMinutes} peak={peak} className="bg-rain/40" />
        <Bar label="Actual" minutes={actualMinutes} peak={peak} className="bg-rain" />
      </div>

      {ratio !== null && (
        <p className="text-xs text-muted-foreground">
          You focused for{" "}
          <span className="text-foreground">{Math.round(ratio * 100)}%</span> of the time you
          blocked out.
          {/* Both directions are worth naming: over-running is as much a planning signal as
              under-running, and only flagging shortfalls turns this into a scold. */}
          {ratio > 1.15 && " Consider blocking more time for what you take on."}
          {ratio < 0.6 && " Either the blocks are optimistic, or the day keeps winning."}
        </p>
      )}

      {tasks.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="pb-1 text-left font-medium">Task</th>
              <th className="pb-1 text-right font-medium">Estimate</th>
              <th className="pb-1 text-right font-medium">Actual</th>
            </tr>
          </thead>
          <tbody>
            {tasks.slice(0, 6).map((t) => (
              <tr key={t.taskId} className="border-t border-border">
                <td className="max-w-0 truncate py-1 pr-2 text-foreground">{t.title}</td>
                <td className="py-1 text-right tabular-nums text-muted-foreground">
                  {t.estimatedMins === null ? "—" : formatFocusMinutes(t.estimatedMins)}
                </td>
                <td className="py-1 text-right tabular-nums text-foreground">
                  {formatFocusMinutes(t.actualMins)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Bar({
  label,
  minutes,
  peak,
  className,
}: {
  label: string;
  minutes: number;
  peak: number;
  className: string;
}) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <span className="h-3 flex-1 overflow-hidden rounded bg-muted">
        <span
          className={`block h-full rounded ${className}`}
          style={{ width: `${(minutes / peak) * 100}%` }}
        />
      </span>
      <span className="w-16 shrink-0 text-right tabular-nums text-foreground">
        {formatFocusMinutes(minutes)}
      </span>
    </div>
  );
}
