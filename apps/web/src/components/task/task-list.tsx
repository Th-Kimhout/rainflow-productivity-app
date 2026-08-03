"use client";

import { type TaskRow, quadrantOf, setTaskCompleted, softDelete } from "@rainflow/data";
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Kbd } from "@/components/common/kbd";
import { TagChips } from "@/components/task/tag-chips";
import { useTaskTags } from "@/lib/data/hooks";
import { useWriteContext } from "@/lib/data/provider";
import { start as startFocus } from "@/lib/focus/store";
import { PRIORITY, useKeyHandler } from "@/lib/keyboard/provider";
import { useUrlState } from "@/lib/url-state";
import { cn } from "@/lib/utils";

/**
 * A keyboard-navigable task list.
 *
 * J/K move the selection, Space toggles completion, Enter opens the inspector via ?task=.
 * Selection is an index rather than an id so it survives a task disappearing from the list —
 * completing the last item keeps the cursor at the end instead of losing it entirely.
 */
export function TaskList({
  tasks,
  emptyMessage,
}: {
  tasks: TaskRow[] | undefined;
  emptyMessage: string;
}) {
  const { db, ctx } = useWriteContext();
  const { taskId: openTaskId, openTask, openZen } = useUrlState();
  const [rawSelected, setSelected] = useState(0);
  const containerRef = useRef<HTMLUListElement>(null);

  const count = tasks?.length ?? 0;

  /*
   * The cursor is CLAMPED ON READ rather than corrected in an effect. Completing the last item
   * shortens the list under the selection, and an effect that writes the corrected value back
   * renders once with the stale index before fixing it — a visible flicker, and a frame in
   * which `tasks[selected]` is undefined.
   */
  const selected = count === 0 ? 0 : Math.min(rawSelected, count - 1);

  useKeyHandler(PRIORITY.view, (event) => {
    if (!tasks || tasks.length === 0) return false;
    const key = event.key.toLowerCase();

    if (key === "j" || event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((s) => Math.min(s + 1, tasks.length - 1));
      return true;
    }
    if (key === "k" || event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
      return true;
    }
    if (event.key === " ") {
      const task = tasks[selected];
      if (!task) return false;
      event.preventDefault();
      void setTaskCompleted(db, ctx, task.id, task.status !== "COMPLETED");
      return true;
    }
    if (event.key === "Enter") {
      const task = tasks[selected];
      if (!task) return false;
      event.preventDefault();
      openTask(task.id);
      return true;
    }
    if (key === "f") {
      // §3.3: start a focus session on the selected task and drop straight into zen mode.
      const task = tasks[selected];
      if (!task) return false;
      event.preventDefault();
      void startFocus(task.id);
      openZen(task.id);
      return true;
    }
    return false;
  });

  // Keep the selected row visible when navigating with the keyboard.
  useEffect(() => {
    const el = containerRef.current?.children[selected];
    if (el instanceof HTMLElement) el.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (tasks === undefined) {
    // `useLiveQuery` returns undefined only on the very first tick before IndexedDB responds.
    return <p className="px-6 py-4 text-sm text-muted-foreground">Loading…</p>;
  }

  if (tasks.length === 0) {
    return (
      <div className="px-4 py-10 text-center sm:px-6">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        {/*
          The advice has to match the hardware. On a phone there is no `C` and no ⌘K — telling
          someone to press a key they do not have, while the button that does the job sits at the
          bottom of the screen, is worse than saying nothing.
        */}
        <p className="mt-2 hidden text-xs text-muted-foreground sm:block">
          Press <Kbd>C</Kbd> or <Kbd>⌘K</Kbd> to capture one.
        </p>
        <p className="mt-2 text-xs text-muted-foreground sm:hidden">
          Tap <span className="font-medium text-rain">＋</span> below to capture one.
        </p>
      </div>
    );
  }

  return (
    <ul ref={containerRef} className="divide-y divide-border">
      {tasks.map((task, i) => (
        <TaskRowItem
          key={task.id}
          task={task}
          selected={i === selected}
          open={task.id === openTaskId}
          onSelect={() => setSelected(i)}
          onOpen={() => {
            setSelected(i);
            openTask(task.id);
          }}
          onToggle={() => void setTaskCompleted(db, ctx, task.id, task.status !== "COMPLETED")}
          onDelete={() => void softDelete(db, ctx, "task", task.id)}
        />
      ))}
    </ul>
  );
}

const QUADRANT_STYLES = {
  DO_FIRST: "bg-priority-high",
  SCHEDULE: "bg-rain",
  DELEGATE: "bg-rain-secondary",
  ELIMINATE: "bg-muted-foreground",
} as const;

function TaskRowItem({
  task,
  selected,
  open,
  onSelect,
  onOpen,
  onToggle,
  onDelete,
}: {
  task: TaskRow;
  selected: boolean;
  open: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const done = task.status === "COMPLETED";
  // Derived, never stored — see ADR 0001 decision 9.
  const quadrant = quadrantOf(task);

  return (
    <li
      onMouseDown={onSelect}
      className={cn(
        "group flex items-center gap-3 px-4 py-2.5 transition-colors sm:px-6",
        // The row shown in the inspector reads stronger than the mere keyboard cursor, so it
        // stays identifiable after focus moves on.
        open
          ? "bg-rain-soft ring-1 ring-inset ring-rain/30"
          : selected
            ? "bg-rain-soft"
            : "hover:bg-accent/40",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-8 w-0.5 shrink-0 rounded-full",
          // Only signal a quadrant once one of the flags is actually set; a default-false task
          // showing an "ELIMINATE" marker would be actively misleading.
          task.is_urgent || task.is_important ? QUADRANT_STYLES[quadrant] : "bg-transparent",
        )}
      />

      <input
        type="checkbox"
        checked={done}
        onChange={onToggle}
        aria-label={`Mark "${task.title}" as ${done ? "incomplete" : "complete"}`}
        // Larger where a fingertip has to hit it. 16px is comfortable with a cursor and
        // genuinely hard to tap.
        className="size-5 shrink-0 cursor-pointer accent-rain sm:size-4"
      />

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            "block w-full truncate text-left text-sm",
            done ? "text-muted-foreground line-through" : "text-foreground",
          )}
        >
          {task.title}
        </button>
        {/* Tags are read-only here; the inspector is where they are edited. */}
        <RowTags taskId={task.id} />
      </div>

      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete "${task.title}"`}
        /*
         * Hover-revealed with a mouse, permanently visible without one. A touchscreen has no
         * hover, so `group-hover` alone left this button unreachable — the row's only delete.
         *
         * Written as `pointer-fine:opacity-0` rather than `opacity-0 pointer-coarse:opacity-100`
         * so the two rules never compete: the hiding only ever applies where hovering can undo
         * it. The alternative depends on Tailwind's variant sort order to break the tie, and a
         * button that is invisible and untappable is not a tie worth risking.
         */
        className="-mr-1 shrink-0 p-1 text-muted-foreground transition-opacity hover:text-priority-high pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}

/**
 * A row's tags.
 *
 * Its own component so `useTaskTags` runs per row rather than the list joining every tag for
 * every task up front. At a few hundred tasks either shape is fine; this one keeps the change to
 * a single row when a tag is added, instead of re-running one query that repaints the whole list.
 */
function RowTags({ taskId }: { taskId: string }) {
  const tags = useTaskTags(taskId);
  if (!tags || tags.length === 0) return null;
  return <TagChips tags={tags} className="mt-0.5" />;
}
