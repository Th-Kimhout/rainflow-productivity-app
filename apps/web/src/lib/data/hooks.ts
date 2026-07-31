"use client";

import {
  type DayKey,
  type HabitRow,
  type PositionedBlock,
  type Quadrant,
  type StreakSummary,
  type TaskRow,
  type TaskStatus,
  type TimeBlockRow,
  completedDaysOf,
  dayRange,
  displayPriority,
  layoutDay,
  previousDay,
  quadrantOf,
  scheduledMinutes,
  summarise,
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

/** A positioned block plus the task it is for. `null` task = the row is an orphan; see below. */
export interface ScheduledBlock extends PositionedBlock<TimeBlockRow> {
  task: TaskRow | null;
}

export interface DaySchedule {
  blocks: ScheduledBlock[];
  /** Committed minutes, counting overlapping blocks once. */
  plannedMinutes: number;
}

/**
 * A day's timebox grid (§3.2).
 *
 * The Dexie index is `[task_id+starts_at]`, not a plain range on `starts_at`, so this reads the
 * table and filters in JS. Deliberate: an IndexedDB range query on `starts_at` would compare ISO
 * strings, which sorts correctly only while every timestamp shares one offset — true today,
 * silently wrong the moment a row is written with a `+07:00` suffix instead of `Z`. At one day's
 * worth of blocks the filter is a few microseconds.
 *
 * A block whose task is missing or deleted keeps `task: null` rather than being dropped. The
 * cascade in `softDelete` means that should be impossible, but a row that arrives from another
 * device mid-cascade can be briefly orphaned — and showing it greyed out is more honest than
 * silently hiding time the user has committed.
 */
export function useDaySchedule(day: DayKey): DaySchedule | undefined {
  const { db } = useData();

  return useLiveQuery(async () => {
    /*
     * Yesterday is included because a block that started before midnight still occupies part of
     * this morning, and `layoutDay` clips it. Filtering by `starts_at >= today` would make an
     * overnight block vanish from the day it actually runs into.
     */
    const { start } = dayRange(previousDay(day));
    const { end } = dayRange(day);

    const rows = live(
      await db.time_block
        .toArray()
        .then((all) =>
          all.filter((b) => {
            const s = Date.parse(b.starts_at);
            return s >= start.getTime() && s < end.getTime();
          }),
        ),
    );

    const positioned = layoutDay(rows, day);
    const tasks = await db.task.bulkGet(positioned.map((p) => p.block.task_id));

    return {
      blocks: positioned.map((p, i) => {
        const task = tasks[i];
        return { ...p, task: task && task.deleted_at === null ? task : null };
      }),
      plannedMinutes: scheduledMinutes(rows, day),
    };
  }, [db, day]);
}

/** Every live block for a task, oldest first — the inspector's "when am I doing this" list. */
export function useTaskBlocks(taskId: string | null): TimeBlockRow[] | undefined {
  const { db } = useData();

  return useLiveQuery(async () => {
    if (!taskId) return [];
    const rows = await db.time_block.where("task_id").equals(taskId).toArray();
    return live(rows).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }, [db, taskId]);
}

/**
 * Candidates for the drag-onto-the-grid rail.
 *
 * Anything open and unfinished, with already-scheduled tasks pushed to the bottom rather than
 * removed — a task often needs a second sitting, and hiding it once it has one block would make
 * that impossible to arrange by drag.
 */
export function useSchedulableTasks(day: DayKey): TaskRow[] | undefined {
  const { db } = useData();

  return useLiveQuery(async () => {
    const tasks = live(await db.task.toArray()).filter(
      (t) => t.status !== "COMPLETED" && t.status !== "ARCHIVED",
    );

    const { start, end } = dayRange(day);
    const scheduled = new Set(
      live(await db.time_block.toArray())
        .filter((b) => {
          const s = Date.parse(b.starts_at);
          return s >= start.getTime() && s < end.getTime();
        })
        .map((b) => b.task_id),
    );

    return tasks.sort((a, b) => {
      const aOn = scheduled.has(a.id) ? 1 : 0;
      const bOn = scheduled.has(b.id) ? 1 : 0;
      if (aOn !== bOn) return aOn - bOn;
      return byListOrder(a, b);
    });
  }, [db, day]);
}

/** A habit with its completion history and derived §3.4 numbers. */
export interface HabitSummary {
  habit: HabitRow;
  completed: Set<DayKey>;
  streak: StreakSummary;
}

/**
 * Every live habit with its streak, sorted so what needs doing today floats up (§3.4).
 *
 * The logs are read ONCE for all habits rather than per habit. A `useLiveQuery` per row would
 * re-run every one of them on any habit_log write — tick one box and every habit on the page
 * recomputes — and would make the number of IndexedDB round trips grow with the list.
 */
export function useHabits(
  day: DayKey = todayKey(),
  includeArchived = false,
): HabitSummary[] | undefined {
  const { db } = useData();

  return useLiveQuery(async () => {
    const habits = live(await db.habit.toArray()).filter(
      (h) => includeArchived || h.archived_at === null,
    );
    const logs = live(await db.habit_log.toArray());

    return habits
      .map((habit) => {
        const completed = completedDaysOf(logs, habit.id);
        return { habit, completed, streak: summarise(habit, completed, day) };
      })
      .sort((a, b) => {
        // Due and unticked first — the list is a checklist before it is a record.
        const aTodo = a.streak.dueToday ? 0 : 1;
        const bTodo = b.streak.dueToday ? 0 : 1;
        if (aTodo !== bTodo) return aTodo - bTodo;
        // Then longest streak, because that is what there is most to lose.
        if (a.streak.current !== b.streak.current) return b.streak.current - a.streak.current;
        return a.habit.title.localeCompare(b.habit.title);
      });
  }, [db, day, includeArchived]);
}

/**
 * Open tasks grouped by Eisenhower quadrant (§3.2).
 *
 * Completed and archived tasks are excluded: the matrix is a triage surface, and finished work
 * would crowd out the decisions still to be made. Subtasks are excluded too — they belong to their
 * parent's quadrant, and listing them separately would double-count the same commitment.
 */
export function useMatrixTasks(): Record<Quadrant, TaskRow[]> | undefined {
  const { db } = useData();

  return useLiveQuery(async () => {
    const rows = live(await db.task.toArray()).filter(
      (t) =>
        t.parent_id === null && t.status !== "COMPLETED" && t.status !== "ARCHIVED",
    );

    const grouped: Record<Quadrant, TaskRow[]> = {
      DO_FIRST: [],
      SCHEDULE: [],
      DELEGATE: [],
      ELIMINATE: [],
    };

    for (const task of rows) grouped[quadrantOf(task)].push(task);
    for (const q of Object.keys(grouped) as Quadrant[]) {
      grouped[q].sort((a, b) => a.sort_order - b.sort_order);
    }

    return grouped;
  }, [db]);
}
