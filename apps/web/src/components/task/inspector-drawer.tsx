"use client";

import {
  QUADRANT_LABELS,
  atMinutesIntoDay,
  type TaskRow,
  type TaskStatus,
  dayKeyOf,
  durationMinutes,
  formatMinutes,
  minutesIntoDay,
  patch,
  quadrantOf,
  softDelete,
} from "@rainflow/data";
import { AlertTriangle, Play, Star, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { SubtaskTree } from "@/components/task/subtask-tree";
import { start as startFocus } from "@/lib/focus/store";
import { useTask, useTaskBlocks } from "@/lib/data/hooks";
import { useWriteContext } from "@/lib/data/provider";
import { PRIORITY, isEditable, useKeyHandler } from "@/lib/keyboard/provider";
import { useUrlState } from "@/lib/url-state";
import { cn } from "@/lib/utils";

/**
 * The §4.1 right inspector drawer, driven by `?task=<uuid>`.
 *
 * A pane rather than a modal, because §4.1 describes a three-pane layout — the canvas stays
 * visible and usable while a task is open.
 */
export function InspectorDrawer() {
  const { taskId, closeTask } = useUrlState();
  const task = useTask(taskId);

  useKeyHandler(
    PRIORITY.overlay,
    (event) => {
      if (!taskId) return false;
      if (event.key !== "Escape") return false;
      event.preventDefault();

      /*
       * If the cursor is in one of the drawer's fields, blur FIRST and keep the drawer open.
       *
       * Title and notes commit on blur. Closing straight away would unmount the field, and an
       * unmount does not reliably fire `blur` — so the edit just in front of the user would be
       * silently discarded. A second Escape closes.
       */
      const active = document.activeElement;
      if (active instanceof HTMLElement && isEditable(active)) {
        active.blur();
        return true;
      }

      closeTask();
      return true;
    },
    // Escape has to reach this handler even while a field has focus, which is precisely the
    // case the blur-first branch above exists for.
    { whenTyping: true },
  );

  if (!taskId) return null;

  return (
    <aside
      aria-label="Task details"
      className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-card"
    >
      {task ? (
        <InspectorBody task={task} onClose={closeTask} />
      ) : (
        /*
         * Either still loading from Dexie, or the task was deleted — possibly on another device,
         * with the tombstone arriving while it was open. Both read the same to the user, and both
         * want the same affordance: a way out.
         */
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">This task is no longer available.</p>
          <button
            type="button"
            onClick={closeTask}
            className="text-xs text-rain underline-offset-2 hover:underline"
          >
            Close
          </button>
        </div>
      )}
    </aside>
  );
}

const STATUSES: TaskStatus[] = ["INBOX", "BACKLOG", "TODAY", "IN_PROGRESS", "COMPLETED"];

function InspectorBody({ task, onClose }: { task: TaskRow; onClose: () => void }) {
  const { db, ctx } = useWriteContext();
  const { openZen } = useUrlState();

  /*
   * Title and description are committed on blur rather than per keystroke.
   *
   * Not a performance concern — the write is local and coalesced in the outbox anyway. It is
   * about Rule 1 in apply-remote.ts: a row with a pending op refuses remote updates, so writing
   * on every keystroke would keep the row permanently pending and block legitimate incoming
   * changes for as long as the field has focus.
   *
   * THE DRAFT IS NULL UNTIL SOMETHING IS TYPED, and the displayed value falls back to the task.
   * The obvious shape — mirror the task into state, re-seed it from an effect — has a real bug
   * in it: the effect fires on every remote edit, so a change syncing in from another device
   * wipes whatever is half-typed here. Falling back only when there is no draft means the row
   * stays live until the moment the user starts editing, and their text wins after that.
   */
  const [draft, setDraft] = useState<{ id: string; title: string; description: string } | null>(
    null,
  );
  const editing = draft !== null && draft.id === task.id;
  const title = editing ? draft.title : task.title;
  const description = editing ? draft.description : (task.description ?? "");

  function edit(changes: { title?: string; description?: string }) {
    setDraft({ id: task.id, title, description, ...changes });
  }

  const quadrant = quadrantOf(task);

  function commitTitle() {
    const next = title.trim();
    // An empty title would leave an unnameable row, and the DB rejects it anyway
    // (task_title_not_blank). Dropping the draft reverts to the stored value.
    setDraft(null);
    if (next && next !== task.title) void patch(db, ctx, "task", task.id, { title: next });
  }

  function commitDescription() {
    const next = description.trim() || null;
    setDraft(null);
    if (next !== task.description) void patch(db, ctx, "task", task.id, { description: next });
  }

  return (
    <>
      <header className="flex items-start justify-between gap-2 border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {QUADRANT_LABELS[quadrant]}
          </p>
          <textarea
            value={title}
            onChange={(e) => edit({ title: e.target.value })}
            onBlur={commitTitle}
            rows={2}
            aria-label="Task title"
            className="mt-1 w-full resize-none bg-transparent text-sm font-medium text-foreground outline-none"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="flex-1 space-y-5 p-4">
        {/* Eisenhower — the only stored priority facts (ADR 0001 decision 9). */}
        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Priority
          </h3>
          <div className="flex gap-2">
            <FlagToggle
              active={task.is_urgent}
              icon={<AlertTriangle className="size-3.5" />}
              label="Urgent"
              activeClass="bg-priority-high/15 text-priority-high ring-priority-high/40"
              onClick={() =>
                void patch(db, ctx, "task", task.id, { is_urgent: !task.is_urgent })
              }
            />
            <FlagToggle
              active={task.is_important}
              icon={<Star className="size-3.5" />}
              label="Important"
              activeClass="bg-rain/15 text-rain ring-rain/40"
              onClick={() =>
                void patch(db, ctx, "task", task.id, { is_important: !task.is_important })
              }
            />
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Status
          </h3>
          <select
            value={task.status}
            onChange={(e) => {
              const status = e.target.value as TaskStatus;
              /*
               * status and completed_at move together — §6 had a third field that could disagree
               * with both, which is exactly why ADR 0001 collapsed them. The SQL check constraint
               * enforces the pairing server-side too.
               */
              void patch(db, ctx, "task", task.id, {
                status,
                completed_at:
                  status === "COMPLETED" ? (task.completed_at ?? new Date().toISOString()) : null,
              });
            }}
            aria-label="Status"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-rain"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Due
          </h3>
          <DueEditor task={task} />
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Estimate
          </h3>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              step={5}
              value={task.estimated_mins ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                const mins = raw === "" ? null : Number(raw);
                // The DB requires estimated_mins > 0; reject rather than send a rejected row.
                if (mins !== null && (!Number.isFinite(mins) || mins <= 0)) return;
                void patch(db, ctx, "task", task.id, { estimated_mins: mins });
              }}
              aria-label="Estimate in minutes"
              className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus:ring-1 focus:ring-rain"
            />
            <span className="text-xs text-muted-foreground">minutes</span>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Notes
          </h3>
          <textarea
            value={description}
            onChange={(e) => edit({ description: e.target.value })}
            onBlur={commitDescription}
            rows={5}
            placeholder="Markdown rendering arrives in Phase 7."
            aria-label="Notes"
            className="w-full resize-y rounded-md border border-border bg-background p-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-rain"
          />
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Scheduled
          </h3>
          <ScheduledBlocks taskId={task.id} />
        </section>

        <SubtaskTree parent={task} />
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-border p-4">
        <button
          type="button"
          onClick={() => {
            // Start the timer AND open zen in one gesture — §3.3's whole proposition is that
            // beginning focused work should not be a three-step errand.
            void startFocus(task.id);
            openZen(task.id);
          }}
          className="flex items-center gap-1.5 rounded-md bg-rain px-2.5 py-1.5 text-xs font-medium text-background transition-colors hover:bg-rain/90"
        >
          <Play className="size-3" />
          Focus
        </button>

        <button
          type="button"
          onClick={() => {
            void softDelete(db, ctx, "task", task.id);
            onClose();
          }}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-priority-high"
        >
          <Trash2 className="size-3.5" />
          Delete task
        </button>
      </footer>
    </>
  );
}

function FlagToggle({
  active,
  icon,
  label,
  activeClass,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  activeClass: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium ring-1 transition-colors",
        active
          ? activeClass
          : "text-muted-foreground ring-border hover:text-foreground hover:ring-muted-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * Every calendar block for this task (§3.2).
 *
 * A task can have several — ADR 0001 decision 8 split timeboxing out of the task row precisely so
 * "an hour now, finish it tonight" is expressible. Without this list the second block would be
 * invisible from the task's own view, and the inspector would quietly disagree with the calendar.
 */
function ScheduledBlocks({ taskId }: { taskId: string }) {
  const { db, ctx } = useWriteContext();
  const blocks = useTaskBlocks(taskId);

  if (blocks === undefined) {
    return <p className="text-xs text-muted-foreground">Loading…</p>;
  }

  if (blocks.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Not on the calendar yet — drag it onto the grid from{" "}
        <Link href="/calendar" className="text-rain underline-offset-2 hover:underline">
          Calendar
        </Link>
        .
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {blocks.map((block) => {
        const start = new Date(block.starts_at);
        // `dayKeyOf` resolves through APP_TIMEZONE. A UTC slice of the ISO string would name
        // the wrong day for anything after 17:00 Phnom Penh time.
        const day = dayKeyOf(start);
        const from = minutesIntoDay(start);
        const to = from + durationMinutes(block);

        return (
          <li key={block.id} className="flex items-center gap-2 text-xs">
            {/* The object form of `href` is what keeps `typedRoutes` happy with a query. */}
            <Link
              href={{ pathname: "/calendar", query: { day } }}
              className="flex-1 truncate text-foreground hover:text-rain"
            >
              <span className="tabular-nums">{day}</span>{" "}
              <span className="tabular-nums text-muted-foreground">
                {formatMinutes(from)}–{formatMinutes(to)}
              </span>
            </Link>
            <button
              type="button"
              onClick={() => void softDelete(db, ctx, "time_block", block.id)}
              aria-label="Unschedule this block"
              className="shrink-0 text-muted-foreground hover:text-priority-high"
            >
              <X className="size-3" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Due date editor.
 *
 * Uses `<input type="date">` and `type="time"` rather than a date picker component: both are
 * keyboard-native, which §4.2 requires, and neither adds a dependency.
 *
 * The date value must be derived with `dayKeyOf`, not `toISOString().slice(0,10)` — the latter
 * gives the UTC day, which for anything after 17:00 Phnom Penh time is tomorrow.
 */
function DueEditor({ task }: { task: TaskRow }) {
  const { db, ctx } = useWriteContext();
  const due = task.due_at ? new Date(task.due_at) : null;

  const dayValue = due ? dayKeyOf(due) : "";
  const timeValue = (() => {
    if (!due || task.due_is_all_day) return "";
    const mins = minutesIntoDay(due);
    return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  })();

  function write(dayKey: string, time: string) {
    if (!dayKey) {
      void patch(db, ctx, "task", task.id, { due_at: null, due_is_all_day: true });
      return;
    }

    const [h, m] = time ? time.split(":").map(Number) : [0, 0];
    const minutes = (h ?? 0) * 60 + (m ?? 0);

    /*
     * `atMinutesIntoDay` resolves the instant through APP_TIMEZONE, so "09:00" means 09:00 in
     * Phnom Penh rather than UTC. Hand-rolling the offset here would be a second implementation
     * of logic tz.ts already owns and tests under three host timezones.
     */
    void patch(db, ctx, "task", task.id, {
      due_at: atMinutesIntoDay(dayKey, minutes).toISOString(),
      due_is_all_day: !time,
    });
  }

  return (
    <div className="flex gap-2">
      <input
        type="date"
        value={dayValue}
        onChange={(e) => write(e.target.value, timeValue)}
        aria-label="Due date"
        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus:ring-1 focus:ring-rain"
      />
      <input
        type="time"
        value={timeValue}
        onChange={(e) => write(dayValue, e.target.value)}
        disabled={!dayValue}
        aria-label="Due time"
        className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus:ring-1 focus:ring-rain disabled:opacity-40"
      />
    </div>
  );
}

