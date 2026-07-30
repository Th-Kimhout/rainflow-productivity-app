"use client";

import { type TaskRow, quadrantOf, setTaskCompleted, softDelete } from "@rainflow/data";
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Kbd } from "@/components/common/kbd";
import { useWriteContext } from "@/lib/data/provider";
import { PRIORITY, useKeyHandler } from "@/lib/keyboard/provider";
import { cn } from "@/lib/utils";

/**
 * A keyboard-navigable task list.
 *
 * J/K move the selection, Space toggles completion, Enter will open the inspector in Phase 2.
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
  const [selected, setSelected] = useState(0);
  const containerRef = useRef<HTMLUListElement>(null);

  const count = tasks?.length ?? 0;

  // Keep the cursor in range as the list changes under it.
  useEffect(() => {
    setSelected((s) => (count === 0 ? 0 : Math.min(s, count - 1)));
  }, [count]);

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
      <div className="px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Press <Kbd>C</Kbd> or <Kbd>⌘K</Kbd> to capture one.
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
          onSelect={() => setSelected(i)}
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
  onSelect,
  onToggle,
  onDelete,
}: {
  task: TaskRow;
  selected: boolean;
  onSelect: () => void;
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
        "group flex items-center gap-3 px-6 py-2.5 transition-colors",
        selected ? "bg-rain-soft" : "hover:bg-accent/40",
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
        className="size-4 shrink-0 cursor-pointer accent-rain"
      />

      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          done ? "text-muted-foreground line-through" : "text-foreground",
        )}
      >
        {task.title}
      </span>

      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete "${task.title}"`}
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-priority-high group-hover:opacity-100"
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}
