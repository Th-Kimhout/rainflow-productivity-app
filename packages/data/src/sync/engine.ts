import { newId } from "../ids";
import { pendingCount } from "../db/outbox";
import type { RainflowDB } from "../db/schema";
import { TABLE_ORDER } from "../wire";
import { applyRemoteRows } from "./apply-remote";
import { pullAll } from "./pull";
import { drainUntilQuiet } from "./push";
import type { SyncTransport } from "./transport";

/**
 * Sync engine orchestration: boot, the drain loop, Realtime wiring, and status reporting.
 *
 * Deliberately free of React and of `next/*` — this whole package is, and the dependency list
 * in package.json is what enforces it. React bindings live in the app at
 * `apps/web/src/lib/data/hooks.ts`.
 */

export type SyncPhase = "idle" | "hydrating" | "syncing" | "offline" | "error";

export interface SyncStatus {
  phase: SyncPhase;
  pending: number;
  lastSyncedAt: number | null;
  lastError: string | null;
  online: boolean;
}

export interface EngineOptions {
  db: RainflowDB;
  transport: SyncTransport;
  /** Backstop poll interval. Realtime is the primary signal; this covers a dead socket. */
  pollMs?: number;
  onStatus?: (status: SyncStatus) => void;
}

const CLIENT_ID_KEY = "client_id";
const DEFAULT_POLL_MS = 30_000;

/**
 * Stable per-device id, persisted in Dexie.
 *
 * Stable is the operative word: it is the tie-break in `apply-remote.ts`, so a value that
 * changed per session would make tie resolution non-deterministic across reloads and could
 * stop two devices converging.
 */
export async function getClientId(db: RainflowDB): Promise<string> {
  const existing = await db.meta.get(CLIENT_ID_KEY);
  if (typeof existing?.value === "string") return existing.value;

  const id = newId();
  await db.meta.put({ key: CLIENT_ID_KEY, value: id });
  return id;
}

/**
 * Ask the browser to exempt our storage from eviction.
 *
 * This is the single most important line of defence for unsynced work. Safari/iOS evicts
 * IndexedDB for origins unused ~7 days, and RainFlow is not an installed PWA (ADR 0001
 * decision 3) so it gets no installed-app exemption. If the tab is evicted while the outbox is
 * non-empty, those writes are gone — hence this, plus the loud banner the UI shows whenever
 * `pending > 0`.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/**
 * Run `fn` under a cross-tab exclusive lock.
 *
 * Two tabs draining the same outbox produce duplicate upserts and confusing races. Web Locks
 * makes this a non-issue with three lines, so it goes in from day one rather than being
 * retrofitted after the first weird bug report. Where the API is unavailable (older Safari,
 * and Node under test) it degrades to running directly, which is correct for a single context.
 */
async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks) return fn();

  return locks.request(name, { ifAvailable: true }, async (lock) => {
    // ifAvailable yields null rather than queueing when another tab holds it. Skipping is
    // right: the holder is already doing this work.
    if (!lock) return undefined;
    return fn();
  });
}

export class SyncEngine {
  private db: RainflowDB;
  private transport: SyncTransport;
  private pollMs: number;
  private onStatus?: (s: SyncStatus) => void;

  private unsubscribeRealtime: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private inFlight: Promise<void> | null = null;

  private status: SyncStatus = {
    phase: "idle",
    pending: 0,
    lastSyncedAt: null,
    lastError: null,
    online: true,
  };

  constructor(opts: EngineOptions) {
    this.db = opts.db;
    this.transport = opts.transport;
    this.pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
    this.onStatus = opts.onStatus;
  }

  getStatus(): SyncStatus {
    return { ...this.status };
  }

  private async emit(patch: Partial<SyncStatus>): Promise<void> {
    this.status = {
      ...this.status,
      ...patch,
      pending: await pendingCount(this.db),
    };
    this.onStatus?.(this.getStatus());
  }

  /** Hydrate, subscribe, and start the backstop poll. Safe to await before first render. */
  async start(): Promise<void> {
    await requestPersistentStorage();

    if (typeof window !== "undefined") {
      this.status.online = navigator.onLine;
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
      // A drain that failed while backgrounded should retry the moment we are looked at again.
      document.addEventListener("visibilitychange", this.handleVisibility);
    }

    await this.emit({ phase: "hydrating" });
    await this.sync();

    this.unsubscribeRealtime = this.transport.subscribe(async (table, row) => {
      // Straight through apply-remote, so Rule 1 and LWW apply to Realtime exactly as they do
      // to the pull. A Realtime row is not more trustworthy for arriving faster.
      await applyRemoteRows(this.db, table, [row]);
    });

    this.timer = setInterval(() => void this.sync(), this.pollMs);
  }

  /**
   * One full cycle: drain local writes, then pull remote changes.
   *
   * Push before pull, so a local edit reaches the server before we ask what the server has —
   * which keeps the window in which Rule 1 has to skip an echo as short as possible.
   *
   * Single-flighted: overlapping cycles would double-send and interleave cursor advances.
   */
  async sync(): Promise<void> {
    if (this.disposed) return;
    if (this.inFlight) return this.inFlight;

    this.inFlight = (async () => {
      try {
        await this.emit({ phase: "syncing" });

        await withLock("rainflow-sync", async () => {
          const drained = await drainUntilQuiet(this.db, this.transport);
          if (drained.errors.length > 0) throw new Error(drained.errors[0]);
          await pullAll(this.db, this.transport);
        });

        await this.emit({
          phase: "idle",
          lastSyncedAt: Date.now(),
          lastError: null,
          online: true,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const offline = typeof navigator !== "undefined" && !navigator.onLine;
        await this.emit({
          phase: offline ? "offline" : "error",
          lastError: message,
          online: !offline,
        });
      } finally {
        this.inFlight = null;
      }
    })();

    return this.inFlight;
  }

  private handleOnline = (): void => {
    void this.emit({ online: true }).then(() => this.sync());
  };

  private handleOffline = (): void => {
    void this.emit({ phase: "offline", online: false });
  };

  private handleVisibility = (): void => {
    if (document.visibilityState === "visible") void this.sync();
  };

  async stop(): Promise<void> {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.unsubscribeRealtime?.();
    this.unsubscribeRealtime = null;

    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("offline", this.handleOffline);
      document.removeEventListener("visibilitychange", this.handleVisibility);
    }
  }
}

export const SYNCED_TABLES = TABLE_ORDER;
