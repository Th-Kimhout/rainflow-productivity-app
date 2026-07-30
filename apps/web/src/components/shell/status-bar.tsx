"use client";

import { AlertTriangle, Check, CloudOff, RefreshCw } from "lucide-react";

import { usePendingWrites } from "@/lib/data/hooks";
import { useData } from "@/lib/data/provider";
import { cn } from "@/lib/utils";

/**
 * Sync state, always visible.
 *
 * The pending-writes indicator is not cosmetic. Unsynced work lives only in IndexedDB, and
 * Safari/iOS evicts storage for origins unused ~7 days — RainFlow is not an installed PWA, so it
 * gets no exemption. If the browser clears storage while the outbox is non-empty, that work is
 * gone. `navigator.storage.persist()` is requested at boot, but it can be refused, so the user
 * needs to be able to see at a glance that something has not landed yet.
 */
export function StatusBar() {
  const { status, syncNow } = useData();
  const pending = usePendingWrites();

  const stale = pending > 0;

  return (
    <div className="flex h-8 shrink-0 items-center justify-between border-t border-border bg-card px-3 text-xs">
      <div className="flex items-center gap-2">
        {!status.online ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <CloudOff className="size-3.5" aria-hidden />
            Offline — changes are saved locally
          </span>
        ) : status.phase === "syncing" || status.phase === "hydrating" ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <RefreshCw className="size-3.5 animate-spin" aria-hidden />
            {status.phase === "hydrating" ? "Loading…" : "Syncing…"}
          </span>
        ) : status.phase === "error" ? (
          <span className="flex items-center gap-1.5 text-priority-high">
            <AlertTriangle className="size-3.5" aria-hidden />
            Sync failed
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Check className="size-3.5 text-success" aria-hidden />
            Synced
          </span>
        )}

        {stale ? (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 font-medium",
              // Amber-ish via the priority colour: this is a warning, not an error.
              "bg-priority-high/15 text-priority-high",
            )}
            title="These changes exist only on this device until they sync."
          >
            {pending} unsynced
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        {status.lastError && status.phase === "error" ? (
          <span className="max-w-80 truncate text-muted-foreground" title={status.lastError}>
            {status.lastError}
          </span>
        ) : null}
        <button
          type="button"
          onClick={syncNow}
          className="text-muted-foreground underline-offset-2 hover:text-rain hover:underline"
        >
          Sync now
        </button>
      </div>
    </div>
  );
}
