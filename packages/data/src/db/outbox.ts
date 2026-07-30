import type { OutboxOp, RainflowDB } from "./schema";
import { type AnyRow, type TableName, rowKey, stripServerOwned } from "../wire";

/**
 * The outbox: pending local writes waiting to reach PostgREST.
 *
 * This queue is the only thing standing between an offline edit and permanent data loss, so
 * two properties matter more than anything else here:
 *
 * COALESCING. Typing in a task title produces a write per keystroke. Queueing one upsert each
 *   would drain hundreds of redundant requests. The `&key` unique index means a re-edit
 *   REPLACES the pending op, so the queue holds at most one op per row and always the latest
 *   version of it.
 *
 * NO LOST EDITS MID-DRAIN. Coalescing creates a race: if the user edits a row while its op is
 *   already in flight, naively deleting the op on success would discard that newer edit. So
 *   completion is conditional — the op is only removed if its `client_updated_at` still
 *   matches what was actually sent. See `completeOp`.
 */

export const BASE_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 5 * 60_000;

/**
 * Queue a full-row upsert. MUST be called inside the same Dexie transaction as the local row
 * write — see `repo.ts`. If the two were separate transactions, a crash between them would
 * leave a row that exists locally and will never sync, or an op for a row that was never
 * written.
 */
export async function enqueue<K extends TableName>(
  db: RainflowDB,
  table: K,
  row: AnyRow,
): Promise<void> {
  const key = rowKey(table, row as never);

  const op: OutboxOp = {
    table,
    key,
    row: stripServerOwned(row) as Record<string, unknown>,
    client_updated_at: row.client_updated_at,
    attempts: 0,
    last_error: null,
    next_attempt_at: 0,
  };

  const existing = await db.outbox.where("key").equals(key).first();

  if (existing) {
    /*
     * Keep the original `seq` so this row holds its place in the drain order, and reset the
     * failure state: this is new content, so it deserves a fresh attempt rather than
     * inheriting a backoff earned by the version it replaced.
     */
    await db.outbox.update(existing.seq!, {
      row: op.row,
      client_updated_at: op.client_updated_at,
      attempts: 0,
      last_error: null,
      next_attempt_at: 0,
    });
    return;
  }

  await db.outbox.add(op);
}

/**
 * Ops eligible to send right now, in queue order.
 *
 * Grouped by table because PostgREST upserts one table per request, and returned in
 * `TABLE_ORDER` by the caller so parents land before children.
 */
export async function dueOps(
  db: RainflowDB,
  now: number,
  limit = 500,
): Promise<OutboxOp[]> {
  return db.outbox
    .where("next_attempt_at")
    .belowOrEqual(now)
    .limit(limit)
    .sortBy("seq");
}

export async function pendingCount(db: RainflowDB): Promise<number> {
  return db.outbox.count();
}

export async function pendingKeys(db: RainflowDB): Promise<Set<string>> {
  const ops = await db.outbox.toArray();
  return new Set(ops.map((o) => o.key));
}

/**
 * Mark an op as successfully sent.
 *
 * `sentClientUpdatedAt` is what was actually on the wire. If the stored op no longer matches
 * it, the user edited the row while the request was in flight — the op has already been
 * rewritten with newer content by `enqueue`, and deleting it now would throw that edit away.
 * Leaving it queued costs one redundant upsert on the next drain, which is free; the
 * alternative costs the user their work.
 *
 * @returns true if the op was removed, false if a newer edit was preserved.
 */
export async function completeOp(
  db: RainflowDB,
  seq: number,
  sentClientUpdatedAt: string,
): Promise<boolean> {
  return db.transaction("rw", db.outbox, async () => {
    const current = await db.outbox.get(seq);
    if (!current) return true; // already gone; nothing to do

    if (current.client_updated_at !== sentClientUpdatedAt) {
      // Superseded mid-flight. Make sure it is eligible immediately rather than sitting
      // behind a stale backoff.
      await db.outbox.update(seq, { next_attempt_at: 0, attempts: 0, last_error: null });
      return false;
    }

    await db.outbox.delete(seq);
    return true;
  });
}

/**
 * Record a failed attempt and schedule a retry with exponential backoff plus jitter.
 *
 * Jitter is not cosmetic: without it, a batch that fails together retries together forever,
 * hammering the server in synchronised waves.
 */
export async function failOp(
  db: RainflowDB,
  seq: number,
  error: string,
  random: () => number = Math.random,
): Promise<void> {
  const current = await db.outbox.get(seq);
  if (!current) return;

  const attempts = current.attempts + 1;
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
  const jittered = exponential * (0.5 + random() * 0.5);

  await db.outbox.update(seq, {
    attempts,
    last_error: error.slice(0, 500),
    next_attempt_at: Date.now() + Math.round(jittered),
  });
}

/**
 * Ops that have failed enough times to be considered stuck. Surfaced in the Phase 9 sync
 * health panel — a permanently rejected op (a constraint violation, say) would otherwise
 * retry forever in silence.
 */
export async function deadLettered(db: RainflowDB, threshold = 8): Promise<OutboxOp[]> {
  return db.outbox.filter((op) => op.attempts >= threshold).toArray();
}
