import { completeOp, dueOps, failOp } from "../db/outbox";
import type { OutboxOp, RainflowDB } from "../db/schema";
import { TABLE_ORDER, type TableName } from "../wire";
import type { SyncTransport } from "./transport";

/**
 * Drain the outbox.
 *
 * Ops are grouped by table and sent one request per table, in `TABLE_ORDER` so parents land
 * before children. The FKs are `deferrable initially deferred`, which covers ordering within a
 * transaction — but PostgREST sends one request per table rather than one transaction, so the
 * ordering still has to be right on the wire.
 *
 * Failures are per-table, not global: if `task_tag` fails, `task` has already committed and
 * its ops are gone. That is intentional. Partial progress under a flaky connection is
 * strictly better than all-or-nothing, and every op is an idempotent full-row upsert, so a
 * retry of the remainder converges to the same state.
 */

export interface DrainReport {
  sent: number;
  failed: number;
  superseded: number;
  errors: string[];
}

function emptyDrainReport(): DrainReport {
  return { sent: 0, failed: 0, superseded: 0, errors: [] };
}

export async function drain(
  db: RainflowDB,
  transport: SyncTransport,
  now: () => number = Date.now,
): Promise<DrainReport> {
  const report = emptyDrainReport();

  const ops = await dueOps(db, now());
  if (ops.length === 0) return report;

  const byTable = new Map<TableName, OutboxOp[]>();
  for (const op of ops) {
    const bucket = byTable.get(op.table);
    if (bucket) bucket.push(op);
    else byTable.set(op.table, [op]);
  }

  for (const table of TABLE_ORDER) {
    const batch = byTable.get(table);
    if (!batch || batch.length === 0) continue;

    try {
      await transport.upsert(table, batch.map((op) => op.row));

      for (const op of batch) {
        /*
         * Conditional completion. If the row was edited again while this request was in
         * flight, `enqueue` has already overwritten the op with newer content and
         * `completeOp` refuses to delete it — one redundant upsert next drain, versus
         * silently discarding the user's most recent edit.
         */
        const removed = await completeOp(db, op.seq!, op.client_updated_at);
        if (removed) report.sent++;
        else report.superseded++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.errors.push(message);
      report.failed += batch.length;

      for (const op of batch) {
        await failOp(db, op.seq!, message);
      }
    }
  }

  return report;
}

/**
 * Drain repeatedly until the queue stops shrinking.
 *
 * Needed because coalescing can leave work behind: a superseded op stays queued, and an op
 * that arrived after `dueOps` snapshotted is not in this pass. Bounded by `maxPasses` so a
 * permanently-rejected op cannot spin — its backoff takes over instead.
 */
export async function drainUntilQuiet(
  db: RainflowDB,
  transport: SyncTransport,
  maxPasses = 5,
  now: () => number = Date.now,
): Promise<DrainReport> {
  const total = emptyDrainReport();

  for (let pass = 0; pass < maxPasses; pass++) {
    const before = await db.outbox.count();
    const r = await drain(db, transport, now);

    total.sent += r.sent;
    total.failed += r.failed;
    total.superseded += r.superseded;
    total.errors.push(...r.errors);

    const after = await db.outbox.count();
    if (after === 0 || after >= before) break;
  }

  return total;
}
