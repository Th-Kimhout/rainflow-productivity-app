"use client";

import { APP_TIMEZONE, todayKey, weekdayOf } from "@rainflow/data";

import { TaskList } from "@/components/task/task-list";
import { useTodayTasks } from "@/lib/data/hooks";

/**
 * §5.1's morning-alignment surface: what is actually happening today.
 *
 * A Client Component, because the whole app renders from Dexie. `todayKey()` is computed here
 * at render rather than at build — a value baked into a static prerender would be frozen at
 * deploy time and the app would insist it was still July for weeks.
 */

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export default function TodayPage() {
  const day = todayKey();
  const tasks = useTodayTasks(day);

  return (
    <div>
      <header className="border-b border-border px-4 py-4 sm:px-6">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          {WEEKDAYS[weekdayOf(day)]}
        </p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-foreground">
          Today
          <span className="ml-2 text-sm font-normal text-muted-foreground">{day}</span>
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">{APP_TIMEZONE}</p>
      </header>

      <TaskList
        tasks={tasks}
        emptyMessage="Nothing scheduled for today, and nothing overdue."
      />
    </div>
  );
}
