import {
  DEFAULT_CONFIG,
  type PomodoroConfig,
  type PomodoroState,
  type RainflowDB,
  type WriteContext,
  abandon,
  beginPhase,
  closeFocusSession,
  completePhase,
  elapsedMs,
  idleState,
  isActive,
  isRunning,
  newId,
  openFocusSession,
  pause,
  phaseDurationMs,
  resume,
  setSessionEnergy,
  setTask,
} from "@rainflow/data";

/**
 * The focus session store (§3.3).
 *
 * MODULE SCOPE IS THE POINT. React state would be destroyed by any navigation that unmounts the
 * component holding it, and a pomodoro that resets when you check the calendar is worse than no
 * pomodoro. Living at module scope means the timer belongs to the tab, not to a subtree.
 *
 * Deliberately not a Context either: a context value that changes every second re-renders every
 * consumer beneath it, and the whole app sits beneath the shell. `useSyncExternalStore` lets
 * only the components that actually read the clock repaint.
 *
 * Side effects live here — writing `focus_session` rows, persistence — while every state
 * transition itself comes from the pure reducers in `@rainflow/data`. Nothing in this file
 * decides what the timer does, only when the world hears about it.
 */

/** What gets written to Dexie so a reload does not lose a session in progress. */
interface PersistedFocus {
  state: PomodoroState;
  config: PomodoroConfig;
  /** Which tab wrote this. See `adopt` — it is how a tab ignores its own echo. */
  writer: string;
}

const META_KEY = "focus";

/**
 * Identifies THIS tab. Random per module load, so two tabs of the same browser differ.
 *
 * `crypto.randomUUID` is not available on every path this module can be loaded from (the module
 * is evaluated during SSR of the client bundle), hence the guard.
 */
const TAB_ID =
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random());

let state: PomodoroState = idleState();
let config: PomodoroConfig = DEFAULT_CONFIG;

/** Set once the provider knows the database and the write context. */
let db: RainflowDB | null = null;
let ctx: WriteContext | null = null;

/** A completed FOCUS session waiting for its §3.6 energy answer. */
let pendingEnergy: { sessionId: string; taskId: string | null } | null = null;

const listeners = new Set<() => void>();

/*
 * `useSyncExternalStore` compares snapshots by reference and will loop forever if a new object
 * is returned every call. So the snapshot is rebuilt ONLY inside `commit`, and read from here.
 */
export interface FocusSnapshot {
  state: PomodoroState;
  config: PomodoroConfig;
  pendingEnergy: { sessionId: string; taskId: string | null } | null;
  ready: boolean;
}

let snapshot: FocusSnapshot = {
  state,
  config,
  pendingEnergy: null,
  ready: false,
};

function commit(): void {
  snapshot = { state, config, pendingEnergy, ready: db !== null };
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSnapshot(): FocusSnapshot {
  return snapshot;
}

/**
 * The server snapshot. Must be a stable reference and must describe a stopped timer, or
 * hydration mismatches — the server has no idea what the clock says.
 */
const SERVER_SNAPSHOT: FocusSnapshot = {
  state: idleState(),
  config: DEFAULT_CONFIG,
  pendingEnergy: null,
  ready: false,
};

export function getServerSnapshot(): FocusSnapshot {
  return SERVER_SNAPSHOT;
}

// --------------------------------------------------------------------------- persistence

async function persist(): Promise<void> {
  if (!db) return;
  const payload: PersistedFocus = { state, config, writer: TAB_ID };
  await db.meta.put({ key: META_KEY, value: payload });
}

/**
 * Take on state another tab wrote.
 *
 * Two tabs running independent timers would open two `focus_session` rows for the same stretch
 * of time and double-count every §3.6 figure. They converge here instead, and cheaply: because
 * elapsed time is derived from `runningSince` rather than counted, adopting a peer's state is
 * enough to make both tabs agree — there are no local counters to reconcile.
 *
 * The `writer` check is what stops the obvious feedback loop, where a tab adopts its own write,
 * re-persists, and adopts it again.
 */
export function adopt(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const payload = value as Partial<PersistedFocus>;
  if (payload.writer === TAB_ID || !payload.state) return;

  state = payload.state;
  if (payload.config) config = payload.config;
  commit();
}

/**
 * Wire up the database. Called by the provider once a write context exists.
 *
 * Rehydration is what makes a refresh survivable: a 20-minute focus phase that vanishes because
 * you reloaded the page is a reason to stop trusting the timer.
 */
export async function attach(database: RainflowDB, writeCtx: WriteContext): Promise<void> {
  db = database;
  ctx = writeCtx;

  const row = await database.meta.get(META_KEY);
  const payload = row?.value as Partial<PersistedFocus> | undefined;

  if (payload?.state) {
    state = payload.state;
    if (payload.config) config = payload.config;
  }

  commit();
}

export function detach(): void {
  db = null;
  ctx = null;
  commit();
}

// --------------------------------------------------------------------------- actions

function now(): number {
  return Date.now();
}

/** Begin a FOCUS phase on `taskId`, replacing whatever was running. */
export async function start(taskId: string | null): Promise<void> {
  const at = now();
  const sessionId = newId();

  // Anything already open is abandoned rather than left dangling with no `ended_at`.
  await closeOpenSession(at, /* completed */ false);

  state = beginPhase(state, "FOCUS", at, { taskId, sessionId });
  commit();

  await openSession(sessionId, at);
  await persist();
}

/**
 * Play / pause.
 *
 * Also covers the third case: a phase that `advance` ARMED but never started has no session row
 * yet, so pressing play here opens one. Folding that into the same control is deliberate — the
 * user sees one button and should not have to know which of three internal states they are in.
 */
export async function toggle(): Promise<void> {
  const at = now();
  if (!isActive(state)) return;

  if (isRunning(state)) {
    state = pause(state, at);
    commit();
    /*
     * `actual_secs` is refreshed on pause rather than only at the end. If the tab dies mid-phase
     * the row still carries a truthful figure up to the last pause, instead of the zero it was
     * opened with.
     */
    if (state.sessionId) await patchElapsed(state.sessionId, at);
    await persist();
    return;
  }

  if (state.sessionId === null) {
    const sessionId = newId();
    state = beginPhase(state, state.phase, at, { sessionId });
    commit();
    await openSession(sessionId, at);
  } else {
    state = resume(state, at);
    commit();
  }

  await persist();
}

/**
 * Finish the current phase and move to the next.
 *
 * Called both by the user ("skip") and automatically when the phase expires. `completed` says
 * which, and it matters: `was_completed` is what separates a phase seen through from one cut
 * short, and an abandoned phase must not count toward the long break.
 */
export async function advance(completed: boolean): Promise<void> {
  const at = now();
  if (!isActive(state)) return;

  const finishedSessionId = state.sessionId;
  const wasFocus = state.phase === "FOCUS";
  const finishedTaskId = state.taskId;

  await closeOpenSession(at, completed);

  state = completed ? completePhase(state, config, at) : abandon(state);
  commit();

  /*
   * Ask for energy only after a focus phase actually finished. Asking after a break is noise,
   * and asking after an abandoned phase invites a rating of an interruption rather than of the
   * work — §3.6 wants to correlate energy with time of day, so a junk answer is worse than none.
   */
  if (completed && wasFocus && finishedSessionId) {
    pendingEnergy = { sessionId: finishedSessionId, taskId: finishedTaskId };
  }

  // The next phase is armed but not running (see `completePhase`), so no session opens until
  // the user presses play.
  commit();
  await persist();
}

/** Stop everything. The open session is closed as incomplete. */
export async function stop(): Promise<void> {
  const at = now();
  await closeOpenSession(at, false);

  state = abandon(state);
  commit();
  await persist();
}

export function setActiveTask(taskId: string | null): void {
  state = setTask(state, taskId);
  commit();
  void persist();
}

export function setConfig(next: PomodoroConfig): void {
  config = next;
  commit();
  void persist();
}

/** Answer the §3.6 energy prompt, or dismiss it. */
export async function answerEnergy(
  energy: "HIGH" | "MEDIUM" | "LOW" | null,
): Promise<void> {
  const pending = pendingEnergy;
  pendingEnergy = null;
  commit();

  if (!pending || energy === null || !db || !ctx) return;
  await setSessionEnergy(db, ctx, pending.sessionId, energy);
}

// --------------------------------------------------------------------------- session rows

async function openSession(sessionId: string, at: number): Promise<void> {
  if (!db || !ctx) return;
  await openFocusSession(db, ctx, {
    id: sessionId,
    taskId: state.phase === "FOCUS" ? state.taskId : null,
    phase: state.phase,
    plannedMins: Math.round(phaseDurationMs(config, state.phase) / 60_000),
    startedAt: new Date(at).toISOString(),
  });
}

async function patchElapsed(sessionId: string, at: number): Promise<void> {
  if (!db || !ctx) return;
  await closeFocusSession(db, ctx, sessionId, {
    actualSecs: elapsedMs(state, at) / 1000,
    wasCompleted: false,
    // Not finished — but `ended_at` has to hold something, and the last known moment of work is
    // a better answer than null if this row is never closed properly.
    endedAt: new Date(at).toISOString(),
  });
}

async function closeOpenSession(at: number, completed: boolean): Promise<void> {
  if (!db || !ctx || !state.sessionId) return;

  await closeFocusSession(db, ctx, state.sessionId, {
    // Paused time is excluded — `elapsedMs` sums only the running segments. `ended_at -
    // started_at` would count a lunch break as focus time and inflate every §3.6 number.
    actualSecs: elapsedMs(state, at) / 1000,
    wasCompleted: completed,
    endedAt: new Date(at).toISOString(),
  });
}

/**
 * Test seams. Not used by the app.
 *
 * `__tabId` exists so the echo guard can actually be tested rather than assumed — a test that
 * only checks a foreign writer IS adopted proves nothing about the case that causes the loop.
 */
export function __tabId(): string {
  return TAB_ID;
}

/** Resets module state between cases. */
export function __reset(): void {
  state = idleState();
  config = DEFAULT_CONFIG;
  db = null;
  ctx = null;
  pendingEnergy = null;
  commit();
}
