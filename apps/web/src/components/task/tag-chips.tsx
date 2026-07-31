"use client";

import type { TagRow } from "@rainflow/data";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Tag chips.
 *
 * These exist because §3.1's capture grammar writes tags nobody could read: typing
 * `#project` created a `tag` row and a `task_tag` link, and then there was no surface anywhere in
 * the app that showed either. A parser that quietly discards half its own output is worse than one
 * that never had the feature.
 *
 * Each chip links to `/tag/<name>` — by name, not id, so the URL is readable and typeable.
 */
export function TagChips({
  tags,
  className,
  onRemove,
}: {
  tags: readonly TagRow[];
  className?: string;
  onRemove?: (tag: TagRow) => void;
}) {
  if (tags.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="group/tag inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ring-1"
          style={{ color: tag.color, borderColor: tag.color }}
        >
          <Link
            href={{ pathname: "/tags", query: { tag: tag.name } }}
            className="hover:underline"
            // The chip sits inside a clickable row; without this, following the tag would also
            // open the inspector behind it.
            onClick={(e) => e.stopPropagation()}
          >
            #{tag.name}
          </Link>
          {onRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(tag);
              }}
              aria-label={`Remove tag ${tag.name}`}
              className="opacity-0 transition-opacity hover:text-priority-high group-hover/tag:opacity-100"
            >
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
