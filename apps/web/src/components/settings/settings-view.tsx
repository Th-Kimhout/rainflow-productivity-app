"use client";

import {
  TABLE_ORDER,
  type OutboxOp,
  type TableName,
  backupFilename,
  deadLettered,
  exportBackup,
  getCursor,
  importBackup,
  parseBackup,
} from "@rainflow/data";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, Check, Download, RefreshCw, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { useData } from "@/lib/data/provider";
import { cn } from "@/lib/utils";

/**
 * Settings, backup and sync health (§7.2, Phase 9).
 *
 * This screen exists because of two things the free tier cannot do for us:
 *
 *   * NO POINT-IN-TIME RECOVERY. §7.2 asked for automated backups via Neon PITR; Supabase's free
 *     tier has none, so the honest replacement is a file the user holds.
 *   * NO VISIBILITY INTO A STUCK QUEUE. Everything else in the app is deliberately quiet about
 *     sync. That is right for normal operation and wrong when an op has been failing for an hour
 *     — the status bar says "unsynced" and nothing says why. The dead-letter list below is the
 *     one place that answers it.
 */
export function SettingsView() {
  const { db, status, syncNow } = useData();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-5 sm:px-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          Data &amp; sync
        </h1>
      </header>

      <BackupPanel />
      <SyncHealthPanel onSyncNow={syncNow} phase={status.phase} lastError={status.lastError} />
      <StoragePanel />
      <RowCounts key={db.name} />
    </div>
  );
}

// ------------------------------------------------------------------------- backup

function BackupPanel() {
  const { db } = useData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const backup = await exportBackup(db);
      /*
       * A blob URL rather than a data: URI. A year of history is comfortably past the ~2MB some
       * browsers cap data URIs at, and a truncated backup is worse than no backup at all.
       */
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = backupFilename();
      link.click();
      URL.revokeObjectURL(url);

      const rows = Object.values(backup.counts).reduce((a, n) => a + (n ?? 0), 0);
      setMessage({ kind: "ok", text: `Exported ${rows} rows.` });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function restore(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const parsed = parseBackup(JSON.parse(await file.text()));
      const rows = Object.values(parsed.tables).reduce((a, t) => a + (t?.length ?? 0), 0);

      /*
       * Confirmed before writing, and the wording says what actually happens. An import MERGES —
       * it never clears first — so the honest risk is a restored row overwriting a newer local
       * one, not data loss by wipe.
       */
      const ok = window.confirm(
        `Restore ${rows} rows from ${file.name}?\n\n` +
          "This merges into your current data — nothing is deleted. Rows in the file replace " +
          "local rows with the same id, and the restore is queued to sync to the server.",
      );
      if (!ok) return;

      const report = await importBackup(db, parsed);
      setMessage({
        kind: "ok",
        text:
          `Restored ${report.imported} rows` +
          (report.skipped > 0 ? `, skipped ${report.skipped} malformed.` : "."),
      });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Panel
      title="Backup"
      subtitle="Supabase's free tier has no point-in-time recovery, so this file is the backup"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void download()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md bg-rain px-2.5 py-1.5 text-xs font-medium text-background transition-colors hover:bg-rain/90 disabled:opacity-50"
        >
          <Download className="size-3" />
          Export JSON
        </button>

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground ring-1 ring-border transition-colors hover:text-foreground disabled:opacity-50"
        >
          <Upload className="size-3" />
          Restore from file
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void restore(file);
          }}
          className="hidden"
        />
      </div>

      {message && (
        <p
          className={cn(
            "mt-2 text-xs",
            message.kind === "ok" ? "text-success" : "text-priority-high",
          )}
        >
          {message.text}
        </p>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        The export contains every row including deletions, so a restore cannot resurrect something
        you removed. Worth taking before clearing browser data — Safari and iOS evict local storage
        for sites unused for about a week, and anything not yet synced lives only there.
      </p>
    </Panel>
  );
}

// ------------------------------------------------------------------------- sync health

function SyncHealthPanel({
  onSyncNow,
  phase,
  lastError,
}: {
  onSyncNow: () => void;
  phase: string;
  lastError: string | null;
}) {
  const { db } = useData();

  const health = useLiveQuery(async () => {
    const pending = await db.outbox.toArray();
    const stuck = await deadLettered(db);
    const cursors: Array<{ table: TableName; cursor: string | null }> = [];
    for (const table of TABLE_ORDER) {
      cursors.push({ table, cursor: await getCursor(db, table) });
    }
    return { pending, stuck, cursors };
  }, [db]);

  if (!health) return null;

  return (
    <Panel title="Sync health" subtitle="What is queued, and what has stopped trying">
      <div className="flex items-center gap-3 text-xs">
        <span className="text-muted-foreground">
          Status: <span className="text-foreground">{phase}</span>
        </span>
        <span className="text-muted-foreground">
          Queued: <span className="text-foreground tabular-nums">{health.pending.length}</span>
        </span>
        <button
          type="button"
          onClick={onSyncNow}
          className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-rain"
        >
          <RefreshCw className="size-3" />
          Sync now
        </button>
      </div>

      {lastError && (
        <p className="mt-2 rounded border border-priority-high/30 bg-priority-high/10 p-2 text-[10px] text-priority-high">
          {lastError}
        </p>
      )}

      {health.stuck.length > 0 ? (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-priority-high">
            <AlertTriangle className="size-3.5" />
            {health.stuck.length} write{health.stuck.length === 1 ? "" : "s"} failing repeatedly
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            These have exhausted their backoff. They are still retried, but something is rejecting
            them — usually a constraint the server enforces and the client did not.
          </p>
          <ul className="mt-2 space-y-1">
            {health.stuck.slice(0, 5).map((op: OutboxOp) => (
              <li key={op.seq} className="rounded border border-border p-2 text-[10px]">
                <span className="text-foreground">{op.table}</span>{" "}
                <span className="text-muted-foreground">· {op.attempts} attempts</span>
                {op.last_error && (
                  <p className="mt-0.5 break-words text-priority-high">{op.last_error}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="size-3.5 text-success" />
          Nothing stuck.
        </p>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">
          Pull cursors
        </summary>
        <ul className="mt-1.5 space-y-0.5 text-[10px] text-muted-foreground">
          {health.cursors.map(({ table, cursor }) => (
            <li key={table} className="flex justify-between gap-3">
              <span>{table}</span>
              <span className="tabular-nums">{cursor ?? "never pulled"}</span>
            </li>
          ))}
        </ul>
      </details>
    </Panel>
  );
}

// ------------------------------------------------------------------------- storage

function StoragePanel() {
  const [state, setState] = useState<"unknown" | "persisted" | "best-effort">("unknown");
  const [checked, setChecked] = useState(false);

  async function check() {
    setChecked(true);
    if (typeof navigator === "undefined" || !navigator.storage?.persisted) return;
    setState((await navigator.storage.persisted()) ? "persisted" : "best-effort");
  }

  return (
    <Panel title="Local storage" subtitle="Where unsynced work lives until it reaches the server">
      {!checked ? (
        <button
          type="button"
          onClick={() => void check()}
          className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground ring-1 ring-border hover:text-foreground"
        >
          Check persistence
        </button>
      ) : state === "persisted" ? (
        <p className="flex items-center gap-1.5 text-xs text-success">
          <Check className="size-3.5" />
          Persistent — the browser will not evict this data automatically.
        </p>
      ) : (
        <p className="text-xs text-priority-high">
          Best-effort only. The browser may clear local data if the site goes unused, which would
          lose anything not yet synced. Export a backup if the queue above is not empty.
        </p>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------------- counts

function RowCounts() {
  const { db } = useData();

  const counts = useLiveQuery(async () => {
    const out: Array<{ table: TableName; total: number; live: number }> = [];
    for (const table of TABLE_ORDER) {
      const rows = await db.table(table).toArray();
      out.push({
        table,
        total: rows.length,
        // Tombstones are kept locally (a deleted row needs something for a late stale update to
        // lose to), so the two numbers legitimately differ.
        live: rows.filter((r: { deleted_at: string | null }) => r.deleted_at === null).length,
      });
    }
    return out;
  }, [db]);

  if (!counts) return null;

  return (
    <Panel title="Local rows" subtitle="Live rows, and how many tombstones sit behind them">
      <ul className="space-y-0.5 text-xs">
        {counts.map(({ table, total, live }) => (
          <li key={table} className="flex justify-between gap-3">
            <span className="text-muted-foreground">{table}</span>
            <span className="tabular-nums text-foreground">
              {live}
              {total > live && (
                <span className="text-muted-foreground"> (+{total - live} deleted)</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <header className="mb-3">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}
