"use client";

import {
  type DayKey,
  type TaskRow,
  type TaskStatus,
  dayRange,
  displayPriority,
  todayKey,
} from "@rainflow/data";
import { useLiveQuery } from "dexie-react-hooks";

import { useData } from "@/lib/data/provider";

/**
 * Read hooks. Every one of these reads from Dexie, never from the network — that is what makes
 * views paint instantly and work offline (ADR 0001 decision 3).
 *
 * `useLiveQuery` re-runs its query whenever a relevant Dexie table changes, including changes
 * written by the sync engine. So a task arriving from another device repaints the list with no
 * explicit subscription or invalidation anywhere in the UI.
 *
 * TOMBSTONES: soft-deleted rows are kept in Dexie (a locally-deleted row needs something for a
 * late stale update to lose to). Every query here therefore MUST exclude `deleted_at`. That is
 * what `live()` is for — do not hand-roll the filter.
 */

function live<T extends { deleted_at: string | null }>(rows: T[] | undefined): T[] {
  return (rows ?? []).filter((r) => r.deleted_at === null);
}

/** Sort for list views: incomplete first, then Eisenhower weight, then manual order. */
function byListOrder(a: TaskRow, b: TaskRow): number {
  const aDone = a.status === "COMPLETED" ? 1 : 0;
  const bDone = b.status === "COMPLETED" ? 1 : 0;
  if (aDone !== bDone) return aDone - bDone;

  const p = displayPriority(b) - displayPriority(a);
  if (p !== 0) return p;

  return a.sort_order - b.sort_order;
}

/** Tasks with a given status. Top-level only — subtasks render inside their parent. */
export function useTasksByStatus(status: TaskStatus): TaskRow[] | undefined {
  const { db } = useData();

  return useLiveQuery(async () => {
    const rows = await db.task.where("status").equals(status).toArray();
    return live(rows)
      .filter((t) => t.parent_id === null)
      .sort(byListOrder);
  }, [db, status]);
}

/**
 * The §5.1 "Today" set: anything explicitly moved to TODAY or IN_PROGRESS, plus anything due
 * today or overdue. Overdue is included deliberately — a task that slipped yesterday is still
 * today's problem, and hiding it is how things get silently dropped.
 */
export function useTodayTasks(day: DayKey = todayKey()): TaskRow[] | undefined {
  const { db } = useData();

  return useLiveQuery(async () => {
    const rows = live(await db.task.toArray());
    const { end } = dayRange(day);

    return rows
      .filter((t) => t.parent_id === null)
      .filter((t) => {
        if (t.status === "TODAY" || t.status === "IN_PROGRESS") return true;
        if (t.status === "COMPLETED" || t.status === "ARCHIVED") return false;
        return t.due_at !== null && Date.parse(t.due_at) < end.getTime();
      })
      .sort(byListOrder);
  }, [db, day]);
}

/** Unprocessed capture (§3.1). The default landing place for anything typed into Cmd+K. */
export function useInboxTasks(): TaskRow[] | undefined {
  return useTasksByStatus("INBOX");
}

export function useTask(id: string | null): TaskRow | undefined {
  const { db } = useData();

  return useLiveQuery(async () => {
    if (!id) return undefined;
    const row = await db.task.get(id);
    return row && row.deleted_at === null ? row : undefined;
  }, [db, id]);
}

export function useSubtasks(parentId: string | null): TaskRow[] | undefined {
  const { db } = useData();

  return useLiveQuery(async () => {
    if (!parentId) return [];
    const rows = await db.task.where("parent_id").equals(parentId).toArray();
    return live(rows).sort((a, b) => a.sort_order - b.sort_order);
  }, [db, parentId]);
}

/** Live count of unsynced writes. Drives the pending-writes banner. */
export function usePendingWrites(): number {
  const { db } = useData();
  return useLiveQuery(() => db.outbox.count(), [db]) ?? 0;
}
