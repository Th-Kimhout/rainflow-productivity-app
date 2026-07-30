"use client";

import { type TaskRow, createTask, setTaskCompleted, softDelete } from "@rainflow/data";
import { Plus, X } from "lucide-react";
import { type FormEvent, useState } from "react";

import { useSubtasks } from "@/lib/data/hooks";
import { useWriteContext } from "@/lib/data/provider";
import { cn } from "@/lib/utils";

/**
 * Subtask breakdown with a progress bar (§3.2 "Subtask Tree & Dependencies").
 *
 * One level deep only. §6 modelled `parent_id` as an unbounded self-relation, so arbitrary nesting
 * is representable — but a productivity app for one person does not benefit from a tree, and the
 * UI cost of drag-between-levels plus recursive progress rollup is real. Deeper nesting stays
 * possible in the schema if it is ever wanted.
 *
 * Task DEPENDENCIES from §3.2's heading are a conscious deferral (ADR 0001, R8) — §6 never
 * modelled them.
 */
export function SubtaskTree({ parent }: { parent: TaskRow }) {
  const { db, ctx } = useWriteContext();
  const subtasks = useSubtasks(parent.id);
  const [draft, setDraft] = useState("");

  const total = subtasks?.length ?? 0;
  const done = subtasks?.filter((t) => t.status === "COMPLETED").length ?? 0;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  async function add(event: FormEvent) {
    event.preventDefault();
    const title = draft.trim();
    if (!title) return;

    setDraft("");
    await createTask(db, ctx, {
      title,
      parentId: parent.id,
      // Inherit the parent's status so a subtask of a Today task is also Today.
      status: parent.status === "COMPLETED" ? "TODAY" : parent.status,
      // Append: monotonic, and cheap to reorder between neighbours later.
      sortOrder: Date.now(),
    });
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Subtasks
        </h3>
        {total > 0 ? (
          <span className="text-xs text-muted-foreground">
            {done}/{total}
          </span>
        ) : null}
      </div>

      {total > 0 ? (
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-accent"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Subtask progress"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-200",
              pct === 100 ? "bg-success" : "bg-rain",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}

      <ul className="space-y-0.5">
        {subtasks?.map((sub) => (
          <li key={sub.id} className="group flex items-center gap-2 py-0.5">
            <input
              type="checkbox"
              checked={sub.status === "COMPLETED"}
              onChange={() =>
                void setTaskCompleted(db, ctx, sub.id, sub.status !== "COMPLETED")
              }
              aria-label={`Mark "${sub.title}" as ${
                sub.status === "COMPLETED" ? "incomplete" : "complete"
              }`}
              className="size-3.5 shrink-0 cursor-pointer accent-rain"
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                sub.status === "COMPLETED"
                  ? "text-muted-foreground line-through"
                  : "text-foreground",
              )}
            >
              {sub.title}
            </span>
            <button
              type="button"
              onClick={() => void softDelete(db, ctx, "task", sub.id)}
              aria-label={`Delete "${sub.title}"`}
              className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-priority-high group-hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="flex items-center gap-2">
        <Plus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a subtask"
          aria-label="New subtask"
          className="min-w-0 flex-1 bg-transparent py-0.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </form>
    </section>
  );
}
