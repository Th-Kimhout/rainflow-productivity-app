import { newId } from "../ids";
import { type AnyRow, type TableName, type WireTables } from "../wire";
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
 * Soft delete. Sets `deleted_at` and syncs it as an ordinary update.
 *
 * Never a hard delete: a removed row would simply vanish from this device while other devices
 * kept it, with nothing on the wire to tell them otherwise. The tombstone IS the message.
 */
export async function softDelete<K extends TableName>(
  db: RainflowDB,
  ctx: WriteContext,
  table: K,
  key: string | string[],
): Promise<void> {
  await patch(db, ctx, table, key, {
    deleted_at: ctx.now().toISOString(),
  } as Partial<WireTables[K]>);
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
