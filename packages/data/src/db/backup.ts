import { TABLE_ORDER, type AnyRow, type TableName, dexieKey } from "../wire";
import type { RainflowDB } from "./schema";
import { enqueue } from "./outbox";

/**
 * JSON export and import (§7.2, as reworded by ADR 0001 decision 9).
 *
 * §7.2 asked for "automated database backups via Neon point-in-time recovery". Supabase's free
 * tier has no PITR, so that is not achievable — and the honest replacement is a backup the user
 * holds themselves. This one also covers a risk PITR never would: Safari and iOS evict IndexedDB
 * for origins unused about a week, and RainFlow is not an installed PWA, so unsynced work in the
 * outbox has no protection beyond `navigator.storage.persist()` and that can be refused.
 *
 * The export is deliberately the RAW WIRE ROWS — the same snake_case shapes that cross the
 * network. No transformation means no transformation to get wrong, the file is diffable against
 * what is actually in Postgres, and a future importer only has to understand one schema.
 *
 * TOMBSTONES ARE INCLUDED. An export that dropped them would, on import, resurrect everything
 * ever deleted — and would leave the importing device unable to tell a late stale update from a
 * genuine one.
 */

/** Bumped whenever the file's shape changes, so an importer can refuse what it cannot read. */
export const BACKUP_VERSION = 1;

export interface Backup {
  version: number;
  exportedAt: string;
  /** Which device wrote it. Diagnostics only. */
  clientId: string | null;
  counts: Partial<Record<TableName, number>>;
  /** Unsynced writes at the moment of export, so a lost tab loses nothing. */
  pendingWrites: number;
  tables: Partial<Record<TableName, AnyRow[]>>;
}

export async function exportBackup(db: RainflowDB, now: () => Date = () => new Date()): Promise<Backup> {
  const tables: Partial<Record<TableName, AnyRow[]>> = {};
  const counts: Partial<Record<TableName, number>> = {};

  for (const table of TABLE_ORDER) {
    const rows = (await db.table(table).toArray()) as AnyRow[];
    tables[table] = rows;
    counts[table] = rows.length;
  }

  const clientId = await db.meta.get("client_id");

  return {
    version: BACKUP_VERSION,
    exportedAt: now().toISOString(),
    clientId: typeof clientId?.value === "string" ? clientId.value : null,
    counts,
    pendingWrites: await db.outbox.count(),
    tables,
  };
}

export interface ImportReport {
  imported: number;
  skipped: number;
  byTable: Partial<Record<TableName, number>>;
}

/**
 * Restore from a backup.
 *
 * Every restored row is ALSO queued in the outbox, so a restore propagates to the server rather
 * than sitting on one device looking correct. That is the difference between "my data is back"
 * and "my data is back here".
 *
 * Rows are written straight through rather than through `put`, because the sync columns already
 * on them are the ones that matter: re-stamping `client_updated_at` with the restore time would
 * make every restored row beat any concurrent edit on another device, silently rolling that
 * device back to the state of the backup file.
 */
export async function importBackup(
  db: RainflowDB,
  backup: unknown,
  opts: { queueForSync?: boolean } = {},
): Promise<ImportReport> {
  const parsed = parseBackup(backup);
  const report: ImportReport = { imported: 0, skipped: 0, byTable: {} };
  const queue = opts.queueForSync ?? true;

  for (const table of TABLE_ORDER) {
    const rows = parsed.tables[table];
    if (!rows || rows.length === 0) continue;

    const valid = rows.filter((row) => isPlausibleRow(table, row));
    report.skipped += rows.length - valid.length;
    if (valid.length === 0) continue;

    await db.transaction("rw", [db.table(table), db.outbox], async () => {
      await db.table(table).bulkPut(valid);
      if (queue) {
        for (const row of valid) await enqueue(db, table, row);
      }
    });

    report.imported += valid.length;
    report.byTable[table] = valid.length;
  }

  return report;
}

/** Throws on anything that is not a backup this version understands. */
export function parseBackup(value: unknown): Backup {
  if (!value || typeof value !== "object") {
    throw new Error("Not a RainFlow backup: expected a JSON object.");
  }

  const candidate = value as Partial<Backup>;

  if (typeof candidate.version !== "number") {
    throw new Error("Not a RainFlow backup: no version field.");
  }
  if (candidate.version > BACKUP_VERSION) {
    // Forward-compatible refusal. Importing a file written by a newer schema would silently
    // drop whatever columns this build does not know about.
    throw new Error(
      `Backup version ${candidate.version} is newer than this app understands (${BACKUP_VERSION}).`,
    );
  }
  if (!candidate.tables || typeof candidate.tables !== "object") {
    throw new Error("Not a RainFlow backup: no tables.");
  }

  return candidate as Backup;
}

/**
 * A row is plausible if it has the primary key its table needs and the sync columns the engine
 * depends on.
 *
 * Not full validation — the database's own constraints are the real gate, and duplicating them
 * here would be a second copy to keep in step. This only catches the shapes that would break
 * LOCALLY: a row with no key cannot be stored, and one with no `client_updated_at` breaks the
 * last-write-wins comparison for every future update to it.
 */
function isPlausibleRow(table: TableName, row: unknown): row is AnyRow {
  if (!row || typeof row !== "object") return false;
  const record = row as Record<string, unknown>;

  if (typeof record.client_updated_at !== "string") return false;

  try {
    dexieKey(table, record as never);
    return true;
  } catch {
    return false;
  }
}

/** Filename with a sortable timestamp: `rainflow-2026-07-31.json`. */
export function backupFilename(at: Date = new Date()): string {
  return `rainflow-${at.toISOString().slice(0, 10)}.json`;
}
