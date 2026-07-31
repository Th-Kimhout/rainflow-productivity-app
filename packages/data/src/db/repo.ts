import {
  DEFAULT_BLOCK_MINUTES,
  SLOT_MINUTES,
  durationMinutes,
  placeBlock,
} from "../domain/schedule";
import { newId } from "../ids";
import type { DayKey } from "../time/tz";
import {
  CASCADE_CHILDREN,
  type AnyRow,
  type TableName,
  type WireTables,
  dexieKey,
} from "../wire";
import { enqueue } from "./outbox";
import type { RainflowDB } from "./schema";

/**
 * The write repository. EVERY local mutation goes through here.
 *
 * The single invariant this file exists to enforce: the Dexie row and its outbox op are
 * written in ONE transaction. If they were separate, a crash or a closed tab between them
 * would produce either a row that never syncs, or an op referencing a row that was never
 * stored. Both are silent, and both are the kind of bug you discover weeks later when a task
 * is missing from your phone.
 *
 * Writes are also optimistic by construction: the row lands in Dexie immediately, live
 * queries repaint, and the network is somebody else's problem. That is what makes §1.2's
 * "instantaneous in-memory local feedback" true rather than aspirational.
 */

export interface WriteContext {
  /** Identifies this device. Diagnostics, and echo attribution in Realtime. */
  clientId: string;
  /** Injectable so tests can advance time deterministically. */
  now: () => Date;
}

export function createWriteContext(clientId: string, now: () => Date = () => new Date()): WriteContext {
  return { clientId, now };
}

/**
 * Stamp the sync columns on an outgoing row.
 *
 * `updated_at` is set to the client's clock purely as a placeholder — the Postgres trigger
 * overwrites it on arrival, and `stripServerOwned` removes it before sending. It exists on
 * the local row only so Dexie rows and wire rows share one type.
 */
function stamp<T extends object>(ctx: WriteContext, row: T): T & {
  updated_at: string;
  client_updated_at: string;
  client_id: string;
} {
  const iso = ctx.now().toISOString();
  return { ...row, updated_at: iso, client_updated_at: iso, client_id: ctx.clientId };
}

/**
 * Write a full row locally and queue it for upload, atomically.
 *
 * Full-row rather than patch-based on purpose (ADR 0001 R10): with one user, two devices
 * editing different fields of the same row simultaneously is rare, and a field-level merge
 * or CRDT would be a large amount of machinery to buy very little.
 */
export async function put<K extends TableName>(
  db: RainflowDB,
  ctx: WriteContext,
  table: K,
  row: Omit<WireTables[K], keyof import("../wire").SyncColumns> &
    Partial<import("../wire").SyncColumns>,
): Promise<WireTables[K]> {
  const stamped = stamp(ctx, { deleted_at: null, ...row }) as unknown as WireTables[K];

  await db.transaction("rw", [db.table(table), db.outbox], async () => {
    await db.table(table).put(stamped);
    await enqueue(db, table, stamped as AnyRow);
  });

  return stamped;
}

/**
 * Patch an existing local row: read, merge, write the merged whole.
 *
 * The read-merge-write happens inside the transaction so two concurrent patches to the same
 * row cannot interleave and lose one another's fields.
 */
export async function patch<K extends TableName>(
  db: RainflowDB,
  ctx: WriteContext,
  table: K,
  key: string | string[],
  changes: Partial<WireTables[K]>,
): Promise<WireTables[K] | undefined> {
  let merged: WireTables[K] | undefined;

  await db.transaction("rw", [db.table(table), db.outbox], async () => {
    const current = (await db.table(table).get(key)) as WireTables[K] | undefined;
    if (!current) return;

    merged = stamp(ctx, { ...current, ...changes }) as unknown as WireTables[K];
    await db.table(table).put(merged);
    await enqueue(db, table, merged as AnyRow);
  });

  return merged;
}

/**
 * Soft delete, cascading to dependent rows.
 *
 * Never a hard delete: a removed row would simply vanish from this device while other devices
 * kept it, with nothing on the wire to tell them otherwise. The tombstone IS the message.
 *
 * THE CASCADE IS THE POINT. Because this is an update rather than a `DELETE`, the SQL
 * `on delete cascade` on `time_block.task_id` never fires — so without the walk below, deleting
 * a task leaves live time blocks pointing at a tombstone and the calendar goes on drawing them.
 * `CASCADE_CHILDREN` in wire.ts declares which relationships need it and why.
 *
 * Depth-first and idempotent: an already-deleted row is skipped rather than re-stamped, which
 * both avoids pointless outbox traffic and terminates the `task.parent_id` self-reference on a
 * cycle. A cycle should be impossible, but "should be" is not a termination condition.
 */
export async function softDelete<K extends TableName>(
  db: RainflowDB,
  ctx: WriteContext,
  table: K,
  key: string | string[],
): Promise<void> {
  const at = ctx.now().toISOString();
  await softDeleteInto(db, ctx, table, key, at, new Set());
}

async function softDeleteInto(
  db: RainflowDB,
  ctx: WriteContext,
  table: TableName,
  key: string | string[],
  at: string,
  seen: Set<string>,
): Promise<void> {
  const marker = `${table}:${Array.isArray(key) ? key.join("|") : key}`;
  if (seen.has(marker)) return;
  seen.add(marker);

  const current = (await db.table(table).get(key)) as AnyRow | undefined;
  if (!current || current.deleted_at !== null) return;

  /*
   * Children first, then the parent. The order is what keeps the drain valid: `TABLE_ORDER`
   * sends parents before children, so a partially-drained batch can leave a live child under a
   * deleted parent — recoverable, since the child's tombstone is still queued — but never the
   * reverse, which would be a foreign key violation if these were hard deletes and is simply
   * confusing here.
   */
  for (const child of CASCADE_CHILDREN[table] ?? []) {
    // Every cascade points at the parent's `id`; nothing here cascades off a compound key.
    const parentId = (current as { id?: string }).id;
    if (parentId === undefined) continue;

    const rows = (await db
      .table(child.table)
      .where(child.column)
      .equals(parentId)
      .toArray()) as AnyRow[];

    for (const row of rows) {
      await softDeleteInto(db, ctx, child.table, dexieKey(child.table, row as never), at, seen);
    }
  }

  await patch(db, ctx, table, key, { deleted_at: at } as Partial<WireTables[TableName]>);
}

/**
 * Create a task. Convenience wrapper over `put` that fills in the §6 defaults so callers
 * only supply what they actually know — which for §3.1 quick capture is often just a title.
 */
export async function createTask(
  db: RainflowDB,
  ctx: WriteContext,
  input: {
    title: string;
    description?: string | null;
    status?: WireTables["task"]["status"];
    isUrgent?: boolean;
    isImportant?: boolean;
    estimatedMins?: number | null;
    dueAt?: string | null;
    dueIsAllDay?: boolean;
    parentId?: string | null;
    sortOrder?: number;
    id?: string;
  },
): Promise<WireTables["task"]> {
  return put(db, ctx, "task", {
    id: input.id ?? newId(),
    title: input.title,
    description: input.description ?? null,
    status: input.status ?? "INBOX",
    is_urgent: input.isUrgent ?? false,
    is_important: input.isImportant ?? false,
    estimated_mins: input.estimatedMins ?? null,
    due_at: input.dueAt ?? null,
    due_is_all_day: input.dueIsAllDay ?? true,
    completed_at: null,
    parent_id: input.parentId ?? null,
    sort_order: input.sortOrder ?? Date.now(),
  });
}

/**
 * Create a task from parsed §3.1 quick-capture input, including its tags.
 *
 * Tags are resolved find-or-create by lower-cased name, matching the partial unique index
 * `tag_name_unique_live`. The lookup is local: at N=1 the whole tag set is a handful of rows, and
 * going to the network would defeat the point of instant capture.
 *
 * Not wrapped in a single transaction across all three tables on purpose. `put` already pairs
 * each row with its outbox op atomically, and the FKs are `deferrable initially deferred`, so a
 * partially-drained batch cannot violate them. Sequencing tag → task → task_tag also matches
 * TABLE_ORDER, so the drain sends them in a valid order.
 */
export async function createTaskFromCapture(
  db: RainflowDB,
  ctx: WriteContext,
  parsed: {
    title: string;
    dueAt: string | null;
    dueIsAllDay: boolean;
    isUrgent: boolean;
    isImportant: boolean;
    tags: readonly string[];
  },
  status: WireTables["task"]["status"] = "INBOX",
): Promise<WireTables["task"]> {
  const tagIds: string[] = [];

  for (const name of parsed.tags) {
    const existing = (await db.tag.toArray()).find(
      (t) => t.deleted_at === null && t.name.toLowerCase() === name,
    );

    if (existing) {
      tagIds.push(existing.id);
      continue;
    }

    const created = await put(db, ctx, "tag", {
      id: newId(),
      name,
      color: "#38bdf8", // §4.1 Rain Blue; per-tag colours are a later affordance.
    });
    tagIds.push(created.id);
  }

  const task = await createTask(db, ctx, {
    title: parsed.title,
    status,
    isUrgent: parsed.isUrgent,
    isImportant: parsed.isImportant,
    dueAt: parsed.dueAt,
    dueIsAllDay: parsed.dueIsAllDay,
  });

  for (const tagId of tagIds) {
    await put(db, ctx, "task_tag", { task_id: task.id, tag_id: tagId });
  }

  return task;
}

/**
 * Put a task on the calendar (§3.2 timeboxing).
 *
 * A task can have MANY blocks. §6 modelled timeboxing as `timeboxStart`/`timeboxEnd` columns on
 * the task itself, which gave each task exactly one slot for its whole life — so rescheduling
 * destroyed the original plan and "I'll do an hour now and finish it tonight" was unsayable.
 * ADR 0001 decision 8 split it into its own table for exactly that reason.
 *
 * Length falls back to the task's own estimate before the global default, so dragging a task
 * you have already sized onto the grid reserves the time you said it needed.
 */
export async function scheduleTask(
  db: RainflowDB,
  ctx: WriteContext,
  input: {
    taskId: string;
    day: DayKey;
    /** Minutes into the day. Snapped to the grid by `placeBlock`. */
    startMinute: number;
    lengthMinutes?: number;
    id?: string;
  },
): Promise<WireTables["time_block"]> {
  const task = await db.task.get(input.taskId);
  const length =
    input.lengthMinutes ?? task?.estimated_mins ?? DEFAULT_BLOCK_MINUTES;

  return put(db, ctx, "time_block", {
    id: input.id ?? newId(),
    task_id: input.taskId,
    ...placeBlock(input.day, input.startMinute, length),
  });
}

/**
 * Drag a block to a new time, keeping its length.
 *
 * Length is read from the block itself rather than passed in, so a move can never silently
 * resize. The two operations stay separate because they are separate gestures — dragging the
 * body versus dragging the edge — and conflating them is how a 45-minute block quietly becomes
 * an hour.
 */
export async function moveTimeBlock(
  db: RainflowDB,
  ctx: WriteContext,
  id: string,
  day: DayKey,
  startMinute: number,
): Promise<WireTables["time_block"] | undefined> {
  const block = await db.time_block.get(id);
  if (!block) return undefined;

  return patch(db, ctx, "time_block", id, placeBlock(day, startMinute, durationMinutes(block)));
}

/** Drag a block's bottom edge. The start is fixed; only the end moves. */
export async function resizeTimeBlock(
  db: RainflowDB,
  ctx: WriteContext,
  id: string,
  lengthMinutes: number,
): Promise<WireTables["time_block"] | undefined> {
  const block = await db.time_block.get(id);
  if (!block) return undefined;

  const startMs = Date.parse(block.starts_at);
  // The DB enforces `ends_at > starts_at`; refuse to build a row it would reject.
  const length = Math.max(SLOT_MINUTES, Math.round(lengthMinutes));

  return patch(db, ctx, "time_block", id, {
    ends_at: new Date(startMs + length * 60_000).toISOString(),
  });
}

/**
 * Open a `focus_session` row when a phase begins (§3.3).
 *
 * The row is written at the START, not at the end. §6 recorded only a duration and a completion
 * time, which makes §3.6's "top focus hours" uncomputable — you cannot bucket a session by hour
 * of day without knowing when it began. Writing it up front also means a session interrupted by
 * a crashed tab still leaves evidence, rather than vanishing.
 *
 * Breaks get rows too. `phase` is what distinguishes them, and analytics filters on it — the
 * alternative is having no idea whether the breaks were ever actually taken.
 */
export async function openFocusSession(
  db: RainflowDB,
  ctx: WriteContext,
  input: {
    id: string;
    taskId: string | null;
    phase: WireTables["focus_session"]["phase"];
    plannedMins: number;
    startedAt: string;
  },
): Promise<WireTables["focus_session"]> {
  return put(db, ctx, "focus_session", {
    id: input.id,
    task_id: input.taskId,
    started_at: input.startedAt,
    ended_at: null,
    planned_mins: Math.max(1, Math.round(input.plannedMins)),
    actual_secs: 0,
    was_completed: false,
    phase: input.phase,
    energy: null,
    notes: null,
  });
}

/**
 * Close a session.
 *
 * `actualSecs` is the time genuinely spent working, which is NOT `ended_at - started_at` —
 * paused time sits between the two and counting it would inflate every §3.6 number. The caller
 * takes it from the pomodoro state's accumulated segments.
 */
export async function closeFocusSession(
  db: RainflowDB,
  ctx: WriteContext,
  id: string,
  input: { actualSecs: number; wasCompleted: boolean; endedAt?: string },
): Promise<WireTables["focus_session"] | undefined> {
  return patch(db, ctx, "focus_session", id, {
    ended_at: input.endedAt ?? ctx.now().toISOString(),
    actual_secs: Math.max(0, Math.round(input.actualSecs)),
    was_completed: input.wasCompleted,
  });
}

/** §3.6 energy logging. Separate from closing, because it is answered after the fact. */
export async function setSessionEnergy(
  db: RainflowDB,
  ctx: WriteContext,
  id: string,
  energy: WireTables["focus_session"]["energy"],
): Promise<WireTables["focus_session"] | undefined> {
  return patch(db, ctx, "focus_session", id, { energy });
}

/**
 * Toggle completion.
 *
 * `status` and `completed_at` move together — §6 carried a third field (`isCompleted`) that
 * could disagree with both, which is exactly why ADR 0001 collapsed them. The SQL check
 * constraint `task_completed_has_timestamp` enforces the pairing server-side too.
 */
export async function setTaskCompleted(
  db: RainflowDB,
  ctx: WriteContext,
  id: string,
  completed: boolean,
): Promise<void> {
  await patch(db, ctx, "task", id, completed
    ? { status: "COMPLETED", completed_at: ctx.now().toISOString() }
    : { status: "TODAY", completed_at: null });
}
