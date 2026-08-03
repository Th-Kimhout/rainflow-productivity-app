"use client";

import {
  type HabitKind,
  createHabit,
  describeRule,
  setHabitArchived,
  setHabitLogged,
  softDelete,
  todayKey,
} from "@rainflow/data";
import { Archive, ArchiveRestore, Check, Flame, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Kbd } from "@/components/common/kbd";
import { HabitHeatmap, HeatmapLegend } from "@/components/habits/heatmap";
import { type HabitSummary, useHabits } from "@/lib/data/hooks";
import { useWriteContext } from "@/lib/data/provider";
import { PRIORITY, useKeyHandler } from "@/lib/keyboard/provider";
import { cn } from "@/lib/utils";

/**
 * §3.4 habit tracking.
 *
 * A checklist first and a record second: the list is sorted so anything due and unticked floats
 * to the top, because the question "what do I still owe today" is the one being asked most days.
 * The heatmap sits under each habit rather than on a separate screen, so the streak you are
 * about to break is visible at the moment you would break it.
 */
export function HabitList() {
  const { db, ctx } = useWriteContext();
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [rawSelected, setSelected] = useState(0);

  const today = todayKey();
  const habits = useHabits(today, showArchived);

  const count = habits?.length ?? 0;
  // Clamped on read, not corrected in an effect — the same reason as the task list.
  const selected = count === 0 ? 0 : Math.min(rawSelected, count - 1);

  useKeyHandler(PRIORITY.view, (event) => {
    if (creating) return false;
    const key = event.key.toLowerCase();

    if (key === "n") {
      event.preventDefault();
      setCreating(true);
      return true;
    }

    if (!habits || habits.length === 0) return false;

    if (key === "j" || event.key === "ArrowDown") {
      event.preventDefault();
      setSelected(Math.min(selected + 1, habits.length - 1));
      return true;
    }
    if (key === "k" || event.key === "ArrowUp") {
      event.preventDefault();
      setSelected(Math.max(selected - 1, 0));
      return true;
    }
    if (event.key === " ") {
      const entry = habits[selected];
      if (!entry) return false;
      event.preventDefault();
      void setHabitLogged(db, ctx, entry.habit.id, today, !entry.streak.doneToday);
      return true;
    }
    return false;
  });

  if (habits === undefined) {
    return <p className="px-6 py-4 text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Habits</h1>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-md bg-rain px-2.5 py-1.5 text-xs font-medium text-background transition-colors hover:bg-rain/90"
          >
            <Plus className="size-3" />
            New habit
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {creating && (
          <NewHabitForm
            onCancel={() => setCreating(false)}
            onCreate={async (input) => {
              await createHabit(db, ctx, input);
              setCreating(false);
            }}
          />
        )}

        {habits.length === 0 && !creating ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">No habits yet.</p>
            {/* Same reason as the task list: no keyboard, no `N`. The button is in the header. */}
            <p className="mt-2 hidden text-xs text-muted-foreground sm:block">
              Press <Kbd>N</Kbd> to add one.
            </p>
            <p className="mt-2 text-xs text-muted-foreground sm:hidden">
              Use <span className="font-medium text-rain">New habit</span> above.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {habits.map((entry, i) => (
              <HabitRowItem
                key={entry.habit.id}
                entry={entry}
                today={today}
                selected={i === selected}
                onSelect={() => setSelected(i)}
                onToggle={() =>
                  void setHabitLogged(db, ctx, entry.habit.id, today, !entry.streak.doneToday)
                }
                onArchive={() =>
                  void setHabitArchived(
                    db,
                    ctx,
                    entry.habit.id,
                    entry.habit.archived_at === null,
                  )
                }
                onDelete={() => void softDelete(db, ctx, "habit", entry.habit.id)}
              />
            ))}
          </ul>
        )}
      </div>

      <footer className="hidden shrink-0 items-center gap-3 border-t border-border px-4 py-1.5 text-[10px] text-muted-foreground sm:flex">
        <span className="flex items-center gap-1">
          <Kbd>Space</Kbd> tick today
        </span>
        <span className="flex items-center gap-1">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd> select
        </span>
        <span className="flex items-center gap-1">
          <Kbd>N</Kbd> new habit
        </span>
      </footer>
    </div>
  );
}

function HabitRowItem({
  entry,
  today,
  selected,
  onSelect,
  onToggle,
  onArchive,
  onDelete,
}: {
  entry: HabitSummary;
  today: string;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const { habit, completed, streak } = entry;
  const archived = habit.archived_at !== null;

  return (
    <li
      onMouseDown={onSelect}
      className={cn(
        "group px-4 py-4 transition-colors sm:px-6",
        selected ? "bg-rain-soft" : "hover:bg-accent/30",
        archived && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={streak.doneToday}
          aria-label={`Mark "${habit.title}" as ${streak.doneToday ? "not done" : "done"} today`}
          disabled={archived}
          style={
            streak.doneToday
              ? { backgroundColor: habit.color, borderColor: habit.color }
              : undefined
          }
          className={cn(
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed",
            streak.doneToday
              ? "text-background"
              : streak.dueToday
                ? // Due and unticked: outlined in the habit's own colour so the row reads as
                  // an open item rather than as a neutral record.
                  "border-rain text-transparent hover:bg-accent"
                : "border-border text-transparent hover:bg-accent",
          )}
        >
          <Check className="size-3.5" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="truncate text-sm font-medium text-foreground">{habit.title}</h2>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {describeRule(habit)}
            </span>
            {archived && (
              <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
                Archived
              </span>
            )}
          </div>

          {habit.description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{habit.description}</p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Flame
                className={cn("size-3", streak.current > 0 ? "text-priority-high" : "opacity-40")}
              />
              <span className="tabular-nums text-foreground">{streak.current}</span> day
              {streak.current === 1 ? "" : "s"}
            </span>
            <span>
              best <span className="tabular-nums text-foreground">{streak.longest}</span>
            </span>
            <span>
              <span className="tabular-nums text-foreground">
                {Math.round(streak.rate * 100)}%
              </span>{" "}
              on time
            </span>
            {streak.missed > 0 && (
              <span>
                <span className="tabular-nums text-foreground">{streak.missed}</span> missed
              </span>
            )}
          </div>

          <div className="mt-3 overflow-x-auto">
            <HabitHeatmap
              habit={habit}
              completed={completed}
              color={habit.color}
              today={today}
            />
          </div>

          <div className="mt-1.5">
            <HeatmapLegend color={habit.color} />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100">
          <button
            type="button"
            onClick={onArchive}
            aria-label={archived ? "Restore habit" : "Archive habit"}
            title={archived ? "Restore" : "Archive — keeps the history"}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {archived ? (
              <ArchiveRestore className="size-3.5" />
            ) : (
              <Archive className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete habit"
            title="Delete — removes the history too"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-priority-high"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}

const KINDS: Array<{ value: HabitKind; label: string }> = [
  { value: "DAILY", label: "Every day" },
  { value: "WEEKDAYS", label: "Certain weekdays" },
  { value: "INTERVAL", label: "Every N days" },
  { value: "MONTHLY_NTH", label: "Day of the month" },
];

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/** §4.1 palette. A habit's colour is what identifies it in the heatmap. */
const COLORS = ["#34d399", "#38bdf8", "#a78bfa", "#f472b6", "#fbbf24", "#f87171"] as const;

function NewHabitForm({
  onCreate,
  onCancel,
}: {
  onCreate: (input: {
    title: string;
    kind: HabitKind;
    weekdays?: number[];
    intervalDays?: number;
    monthDay?: number;
    color?: string;
  }) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<HabitKind>("DAILY");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [intervalDays, setIntervalDays] = useState(2);
  const [monthDay, setMonthDay] = useState(1);
  const [color, setColor] = useState<string>(COLORS[0]);

  // Escape closes the form. Registered at overlay priority so it beats the list's own bindings.
  useKeyHandler(
    PRIORITY.overlay,
    (event) => {
      if (event.key !== "Escape") return false;
      event.preventDefault();
      onCancel();
      return true;
    },
    { whenTyping: true },
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        void onCreate({ title: title.trim(), kind, weekdays, intervalDays, monthDay, color });
      }}
      className="space-y-3 border-b border-border bg-card px-4 py-4 sm:px-6"
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Read 30 mins"
        aria-label="Habit name"
        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-rain"
      />

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as HabitKind)}
          aria-label="Recurrence"
          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-rain"
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>

        {kind === "WEEKDAYS" && (
          <div className="flex gap-1">
            {WEEKDAY_LABELS.map((label, day) => (
              <button
                key={day}
                type="button"
                onClick={() =>
                  setWeekdays((current) =>
                    current.includes(day)
                      ? current.filter((d) => d !== day)
                      : [...current, day].sort((a, b) => a - b),
                  )
                }
                aria-pressed={weekdays.includes(day)}
                aria-label={FULL_WEEKDAYS[day]}
                className={cn(
                  "size-6 rounded text-[10px] font-medium transition-colors",
                  weekdays.includes(day)
                    ? "bg-rain text-background"
                    : "bg-muted text-muted-foreground hover:bg-accent",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {kind === "INTERVAL" && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            every
            <input
              type="number"
              min={1}
              value={intervalDays}
              onChange={(e) => setIntervalDays(Math.max(1, Number(e.target.value) || 1))}
              aria-label="Interval in days"
              className="w-14 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-rain"
            />
            days, counting from the last time you did it
          </label>
        )}

        {kind === "MONTHLY_NTH" && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            on day
            <input
              type="number"
              min={1}
              max={31}
              value={monthDay}
              onChange={(e) =>
                setMonthDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))
              }
              aria-label="Day of month"
              className="w-14 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-rain"
            />
            {monthDay > 28 && (
              <span className="text-[10px]">(short months use their last day)</span>
            )}
          </label>
        )}

        <div className="flex gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Colour ${c}`}
              aria-pressed={color === c}
              style={{ backgroundColor: c }}
              className={cn(
                "size-5 rounded-full transition-transform",
                color === c ? "ring-2 ring-foreground ring-offset-2 ring-offset-card" : "",
              )}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!title.trim()}
          className="rounded-md bg-rain px-2.5 py-1.5 text-xs font-medium text-background transition-colors hover:bg-rain/90 disabled:opacity-40"
        >
          Create
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const FULL_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
