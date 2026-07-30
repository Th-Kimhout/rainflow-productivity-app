"use client";

import {
  QUADRANT_LABELS,
  type Quadrant,
  type TaskRow,
  patch,
  setQuadrant,
  setTaskCompleted,
} from "@rainflow/data";
import { useEffect, useState } from "react";

import { Kbd } from "@/components/common/kbd";
import { useMatrixTasks } from "@/lib/data/hooks";
import { useWriteContext } from "@/lib/data/provider";
import { PRIORITY, useKeyHandler } from "@/lib/keyboard/provider";
import { useUrlState } from "@/lib/url-state";
import { cn } from "@/lib/utils";

/**
 * The §3.2 Eisenhower matrix.
 *
 * Quadrants are DERIVED from `is_urgent` + `is_important` (ADR 0001 decision 9), never stored. So
 * moving a task between cells is just a two-boolean patch — there is no quadrant column to keep in
 * sync, and no possibility of the grid disagreeing with the task's own flags.
 *
 * Reading order matters: DO_FIRST first, ELIMINATE last, which is also `displayPriority` order.
 */
const LAYOUT: Array<{ quadrant: Quadrant; hint: string; accent: string; ring: string }> = [
  {
    quadrant: "DO_FIRST",
    hint: "Urgent + Important",
    accent: "text-priority-high",
    ring: "ring-priority-high/40",
  },
  {
    quadrant: "SCHEDULE",
    hint: "Important, not urgent",
    accent: "text-rain",
    ring: "ring-rain/40",
  },
  {
    quadrant: "DELEGATE",
    hint: "Urgent, not important",
    accent: "text-rain-secondary",
    ring: "ring-rain-secondary/40",
  },
  {
    quadrant: "ELIMINATE",
    hint: "Neither",
    accent: "text-muted-foreground",
    ring: "ring-muted-foreground/40",
  },
];

/** Keys 1–4 map to quadrants in the same order they are displayed. */
const KEY_TO_QUADRANT: Record<string, Quadrant> = {
  "1": "DO_FIRST",
  "2": "SCHEDULE",
  "3": "DELEGATE",
  "4": "ELIMINATE",
};

export function MatrixView() {
  const { db, ctx } = useWriteContext();
  const groups = useMatrixTasks();
  const { taskId: openTaskId, openTask } = useUrlState();

  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<Quadrant | null>(null);

  /*
   * Selection is a flat index across every quadrant in reading order, rather than a
   * (quadrant, index) pair. J/K then walks the whole board in priority order, which matches how
   * triage actually goes — work down from Do First — and avoids needing a second axis of keys to
   * move between cells.
   */
  const flat: TaskRow[] = groups
    ? LAYOUT.flatMap(({ quadrant }) => groups[quadrant])
    : [];
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    setSelected((s) => (flat.length === 0 ? 0 : Math.min(s, flat.length - 1)));
  }, [flat.length]);

  function move(task: TaskRow, quadrant: Quadrant) {
    // Two booleans, and the grid follows. No quadrant column to update.
    void patch(db, ctx, "task", task.id, setQuadrant(quadrant));
  }

  useKeyHandler(PRIORITY.view, (event) => {
    if (flat.length === 0) return false;
    const key = event.key.toLowerCase();
    const current = flat[selected];

    if (key === "j" || event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((s) => Math.min(s + 1, flat.length - 1));
      return true;
    }
    if (key === "k" || event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
      return true;
    }
    if (event.key in KEY_TO_QUADRANT && current) {
      event.preventDefault();
      move(current, KEY_TO_QUADRANT[event.key]!);
      return true;
    }
    if (event.key === " " && current) {
      event.preventDefault();
      void setTaskCompleted(db, ctx, current.id, current.status !== "COMPLETED");
      return true;
    }
    if (event.key === "Enter" && current) {
      event.preventDefault();
      openTask(current.id);
      return true;
    }
    return false;
  });

  if (!groups) {
    return <p className="px-6 py-4 text-sm text-muted-foreground">Loading…</p>;
  }

  const selectedId = flat[selected]?.id ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-px bg-border">
        {LAYOUT.map(({ quadrant, hint, accent, ring }) => (
          <section
            key={quadrant}
            onDragOver={(e) => {
              // preventDefault is what makes an element a valid drop target at all.
              e.preventDefault();
              setDragOver(quadrant);
            }}
            onDragLeave={() => setDragOver((q) => (q === quadrant ? null : q))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const id = e.dataTransfer.getData("text/plain") || dragging;
              const task = flat.find((t) => t.id === id);
              if (task) move(task, quadrant);
              setDragging(null);
            }}
            className={cn(
              "flex min-h-0 flex-col bg-background transition-colors",
              dragOver === quadrant && `bg-accent/60 ring-1 ring-inset ${ring}`,
            )}
          >
            <header className="flex items-baseline justify-between px-4 pt-3">
              <h2 className={cn("text-xs font-semibold uppercase tracking-wider", accent)}>
                {QUADRANT_LABELS[quadrant]}
              </h2>
              <span className="text-[10px] text-muted-foreground">{hint}</span>
            </header>

            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
              {groups[quadrant].length === 0 ? (
                <li className="px-2 py-1 text-xs text-muted-foreground">Empty</li>
              ) : (
                groups[quadrant].map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", task.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(task.id);
                      }}
                      onDragEnd={() => setDragging(null)}
                      onClick={() => {
                        setSelected(flat.findIndex((t) => t.id === task.id));
                        openTask(task.id);
                      }}
                      className={cn(
                        "w-full cursor-grab rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors active:cursor-grabbing",
                        task.id === openTaskId
                          ? "border-rain/40 bg-rain-soft text-foreground"
                          : task.id === selectedId
                            ? "border-transparent bg-rain-soft text-foreground"
                            : "border-transparent bg-card text-foreground hover:bg-accent",
                        dragging === task.id && "opacity-40",
                      )}
                    >
                      <span className="line-clamp-2">{task.title}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </section>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-1.5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Kbd>1</Kbd>–<Kbd>4</Kbd> move quadrant
        </span>
        <span className="flex items-center gap-1">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd> select
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Enter</Kbd> open
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Space</Kbd> complete
        </span>
        <span className="ml-auto">or drag between cells</span>
      </div>
    </div>
  );
}
