"use client";

import { Hash } from "lucide-react";
import { TaskList } from "@/components/task/task-list";
import { useTags, useTasksByTag } from "@/lib/data/hooks";
import { useUrlState } from "@/lib/url-state";

/**
 * Everything carrying one tag.
 *
 * Reuses `TaskList` wholesale rather than growing a third list implementation — J/K, Space,
 * Enter and F all work here for free, which is what §4.2's "100% operable without a mouse" means
 * in practice: it has to be true on every screen, not just the ones built first.
 */
export function TagView() {
  const { tag: name, setTag } = useUrlState();
  const result = useTasksByTag(name ?? "");
  const allTags = useTags();

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-border px-6 py-3">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">PRD §3.1</p>
        <h1 className="mt-0.5 flex items-center gap-1.5 text-lg font-semibold tracking-tight text-foreground">
          <Hash className="size-4" style={{ color: result?.tag?.color }} />
          {name ?? "Tags"}
        </h1>

        {allTags && allTags.length > 0 && (
          <nav aria-label="Other tags" className="mt-2 flex flex-wrap gap-1.5">
            {allTags.map(({ tag, count }) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => setTag(tag.name)}
                className={
                  tag.name.toLowerCase() === (name ?? "").toLowerCase()
                    ? "rounded-full bg-rain-soft px-2 py-0.5 text-[10px] text-rain"
                    : "rounded-full px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border hover:text-foreground"
                }
              >
                #{tag.name}
                {count > 0 && <span className="ml-1 tabular-nums opacity-60">{count}</span>}
              </button>
            ))}
          </nav>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {name === null ? (
          // Landing on /tags with nothing chosen. The chip row above IS the picker, so this only
          // has to say so rather than duplicate it.
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            {allTags && allTags.length > 0
              ? "Pick a tag above."
              : "No tags yet. Type #something while capturing a task."}
          </p>
        ) : result && result.tag === null ? (
          // A tag can vanish when its last task is deleted and the row is tidied away on
          // another device. Saying so beats an empty list that looks like a bug.
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No tag called <span className="text-foreground">#{name}</span>.
          </p>
        ) : (
          <TaskList
            tasks={result?.tasks}
            emptyMessage={`Nothing tagged #${name} right now.`}
          />
        )}
      </div>
    </div>
  );
}
