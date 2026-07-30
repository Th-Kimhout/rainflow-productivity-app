import type { RainflowDB } from "../db/schema";
import { type AnyRow, type TableName, rowKey } from "../wire";

/**
 * THE most important function in the codebase. Everything arriving from the server — both the
 * incremental pull and Realtime pushes — funnels through here.
 *
 * Two rules, and getting either wrong produces data loss that is very hard to diagnose after
 * the fact:
 *
 * RULE 1 (ADR 0001, R7) — NEVER apply a remote row over a row with a pending outbox op.
 *   A local write sits in Dexie and in the outbox simultaneously. Between the write and a
 *   successful drain, the server still holds the OLD row, and it will happily send it back:
 *   the pull's cursor rewind re-reads recent rows, and Realtime echoes our own write back to
 *   us. Applying that would overwrite the text the user is still typing with the version
 *   they just replaced. The pending op is the signal that the local copy is authoritative.
 *
 * RULE 2 — last-write-wins on `client_updated_at`, never on `updated_at`.
 *   `updated_at` is server clock and moves every time ANY device writes, so comparing it
 *   would make the most recently *synced* row win rather than the most recently *edited*
 *   one. `client_updated_at` is the writing device's own clock. With one user this is almost
 *   always a clean comparison; the tie-break below keeps it deterministic when it isn't.
 */

export interface ApplyResult {
  applied: number;
  skippedPending: number;
  skippedStale: number;
}

export function emptyApplyResult(): ApplyResult {
  return { applied: 0, skippedPending: 0, skippedStale: 0 };
}

/**
 * Apply a batch of remote rows for a single table.
 *
 * Runs inside one Dexie transaction so a partially-applied batch cannot be observed by a
 * live query mid-flight. The caller is responsible for advancing the cursor only after this
 * resolves.
 */
export async function applyRemoteRows<K extends TableName>(
  db: RainflowDB,
  table: K,
  rows: readonly AnyRow[],
): Promise<ApplyResult> {
  const result = emptyApplyResult();
  if (rows.length === 0) return result;

  const store = db.table(table);

  await db.transaction("rw", [store, db.outbox], async () => {
    const keys = rows.map((r) => rowKey(table, r as never));

    // One indexed lookup for the whole batch rather than per row.
    const pending = await db.outbox.where("key").anyOf(keys).toArray();
    const pendingKeys = new Set(pending.map((op) => op.key));

    const existing = await store.bulkGet(keys.map((k) => primaryKeyFor(table, k)));

    const toPut: AnyRow[] = [];

    for (let i = 0; i < rows.length; i++) {
      const remote = rows[i]!;
      const key = keys[i]!;

      // RULE 1. The local copy is authoritative until its op drains.
      if (pendingKeys.has(key)) {
        result.skippedPending++;
        continue;
      }

      const local = existing[i] as AnyRow | undefined;

      // Unseen row — nothing to compare, just take it (tombstone included, so a delete that
      // happened on another device before this one ever saw the row stays deleted).
      if (!local) {
        toPut.push(remote);
        result.applied++;
        continue;
      }

      // RULE 2.
      if (isRemoteNewer(remote, local)) {
        toPut.push(remote);
        result.applied++;
      } else {
        result.skippedStale++;
      }
    }

    if (toPut.length > 0) await store.bulkPut(toPut);
  });

  return result;
}

/**
 * Last-write-wins comparison.
 *
 * Ties matter more than they look. Two devices editing in the same millisecond is rare, but a
 * batch write stamps every row in it with ONE `client_updated_at`, which makes exact ties far
 * more likely than clock precision alone suggests. An unresolved tie is not merely arbitrary —
 * it lets the two devices pick DIFFERENT winners and never converge.
 *
 * The tie-break is `client_id`, not `updated_at`. That is deliberate and worth explaining,
 * because `updated_at` looks like the obvious choice and is actively wrong here: a locally
 * written row carries a client-clock PLACEHOLDER in `updated_at` until some later pull
 * replaces it with the server's real value (the drain does not write the server's response
 * back). Comparing it would mean comparing a server timestamp against a client one — two
 * unrelated clocks — so whichever machine happened to be further ahead would win. That is how
 * a peer ends up permanently stuck on its own version.
 *
 * `client_id` is stable, present on both rows, and evaluated identically on every device, so
 * both peers reach the same verdict. Arbitrary but deterministic is exactly what convergence
 * requires.
 */
function isRemoteNewer(remote: AnyRow, local: AnyRow): boolean {
  const r = Date.parse(remote.client_updated_at);
  const l = Date.parse(local.client_updated_at);

  if (Number.isFinite(r) && Number.isFinite(l)) {
    if (r !== l) return r > l;
  } else if (Number.isFinite(r) !== Number.isFinite(l)) {
    // A malformed local timestamp loses to a well-formed remote one, and vice versa.
    return Number.isFinite(r);
  }

  // Exact tie on edit time. Order by device id so every peer agrees on the winner.
  const rid = remote.client_id ?? "";
  const lid = local.client_id ?? "";
  if (rid !== lid) return rid > lid;

  // Same device, same instant: genuinely the same write. Keep what we have.
  return false;
}

/**
 * Turn a `rowKey` string back into the key shape Dexie expects — a bare string for
 * single-column tables, an array for `task_tag`'s compound key.
 */
function primaryKeyFor(table: TableName, key: string): string | string[] {
  return table === "task_tag" ? key.split("|") : key;
}

export const __testing = { isRemoteNewer, primaryKeyFor };
