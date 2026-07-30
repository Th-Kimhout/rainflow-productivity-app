import type { RainflowDB } from "../db/schema";
import { TABLE_ORDER, type TableName } from "../wire";
import { type ApplyResult, applyRemoteRows, emptyApplyResult } from "./apply-remote";
import type { SyncTransport } from "./transport";

/**
 * Incremental pull.
 *
 * The cursor is a server `updated_at` watermark per table, stored in `meta`.
 *
 * WHY THE CURSOR IS REWOUND (ADR 0001, R6). The obvious implementation —
 * `where updated_at > cursor`, then set cursor to the newest row seen — silently skips rows,
 * for two independent reasons:
 *
 *   1. A batch upsert stamps every row in it with the SAME `now()`. Fetching with a strict
 *      `>` and a row limit can land the page boundary in the middle of such a group, and the
 *      next request excludes the rest of it.
 *
 *   2. `now()` is evaluated when a statement runs, not when its transaction commits. A slow
 *      transaction can therefore become visible with an `updated_at` EARLIER than a cursor
 *      already advanced past it. No amount of care with `>` versus `>=` fixes this.
 *
 * So: rewind by REWIND_MS on every pull and use an inclusive bound. Rows get re-delivered,
 * which is free because `applyRemoteRows` is idempotent (`bulkPut`, plus the LWW comparison
 * rejects anything not actually newer). Cheap insurance against a class of bug that presents
 * as "one task just never showed up on my laptop".
 */

const REWIND_MS = 5_000;
const PAGE_LIMIT = 1_000;

function cursorKey(table: TableName): string {
  return `cursor:${table}`;
}

export async function getCursor(db: RainflowDB, table: TableName): Promise<string | null> {
  const row = await db.meta.get(cursorKey(table));
  return typeof row?.value === "string" ? row.value : null;
}

export async function setCursor(
  db: RainflowDB,
  table: TableName,
  updatedAt: string,
): Promise<void> {
  await db.meta.put({ key: cursorKey(table), value: updatedAt });
}

/** Reset every cursor. Forces the next pull to re-hydrate from scratch. */
export async function resetCursors(db: RainflowDB): Promise<void> {
  await db.meta.bulkDelete(TABLE_ORDER.map(cursorKey));
}

export interface PullReport extends ApplyResult {
  fetched: number;
  byTable: Partial<Record<TableName, number>>;
}

/**
 * Pull one table. Pages until the server returns less than a full page.
 *
 * The cursor advances only after rows are durably applied, so an interrupted pull re-fetches
 * rather than skipping. Combined with idempotent apply, an aborted pull costs bandwidth and
 * nothing else.
 */
export async function pullTable(
  db: RainflowDB,
  transport: SyncTransport,
  table: TableName,
): Promise<PullReport> {
  const report: PullReport = { ...emptyApplyResult(), fetched: 0, byTable: {} };

  const stored = await getCursor(db, table);
  // No cursor yet: hydrate from the beginning of time.
  let since = stored
    ? new Date(Date.parse(stored) - REWIND_MS).toISOString()
    : new Date(0).toISOString();

  for (;;) {
    const rows = await transport.fetchSince(table, since, PAGE_LIMIT);
    if (rows.length === 0) break;

    report.fetched += rows.length;

    const applied = await applyRemoteRows(db, table, rows);
    report.applied += applied.applied;
    report.skippedPending += applied.skippedPending;
    report.skippedStale += applied.skippedStale;
    report.byTable[table] = (report.byTable[table] ?? 0) + rows.length;

    // Rows are ordered by updated_at, so the last one carries the high watermark.
    const newest = rows[rows.length - 1]!.updated_at;
    await setCursor(db, table, newest);

    if (rows.length < PAGE_LIMIT) break;

    /*
     * Guard against a page entirely composed of rows sharing one timestamp: without this the
     * inclusive bound would re-fetch the identical page forever. Nudging past it can only
     * skip rows that we have, by definition, just applied.
     */
    const next = new Date(Date.parse(newest) + 1).toISOString();
    if (next === since) break;
    since = next;
  }

  return report;
}

/** Pull every table, parents first. */
export async function pullAll(
  db: RainflowDB,
  transport: SyncTransport,
): Promise<PullReport> {
  const total: PullReport = { ...emptyApplyResult(), fetched: 0, byTable: {} };

  for (const table of TABLE_ORDER) {
    const r = await pullTable(db, transport, table);
    total.fetched += r.fetched;
    total.applied += r.applied;
    total.skippedPending += r.skippedPending;
    total.skippedStale += r.skippedStale;
    Object.assign(total.byTable, r.byTable);
  }

  return total;
}
