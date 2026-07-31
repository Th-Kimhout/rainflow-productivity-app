import type { FocusPhase } from "../wire";

/**
 * The §3.3 Pomodoro state machine. Pure: no timers, no storage, no React.
 *
 * THE CENTRAL DECISION — TIME IS DERIVED FROM TIMESTAMPS, NEVER COUNTED.
 *
 * The obvious implementation is a `setInterval` that decrements a counter every second. It is
 * also wrong, and wrong in a way that only shows up in real use:
 *
 *   * Browsers throttle timers in background tabs to at best once per second, and Chrome drops
 *     hidden tabs to once per MINUTE after a few minutes. A counting timer left in the
 *     background finishes a "25 minute" focus phase somewhere north of an hour later.
 *   * A sleeping laptop stops firing timers entirely.
 *   * Every dropped tick is permanent. The error accumulates and there is nothing to correct
 *     against.
 *
 * So the state stores WHEN the phase started, and elapsed time is `now - runningSince` computed
 * on demand. The interval in the UI exists only to trigger a repaint; if it fires late, or not
 * at all, the next render still shows the correct time. That also makes the whole module
 * testable by passing `now` in, and makes two tabs agree without exchanging a single message —
 * they are reading the same timestamps, not running two independent clocks.
 */

export interface PomodoroConfig {
  focusMins: number;
  shortBreakMins: number;
  longBreakMins: number;
  /** A long break replaces the short one after this many focus phases. */
  cyclesBeforeLongBreak: number;
}

/** §3.3's stated defaults: 25 work, 5 break, 15 long break after 4 cycles. */
export const DEFAULT_CONFIG: PomodoroConfig = {
  focusMins: 25,
  shortBreakMins: 5,
  longBreakMins: 15,
  cyclesBeforeLongBreak: 4,
};

export interface PomodoroState {
  phase: FocusPhase;
  /**
   * Epoch ms at which the current RUN SEGMENT began, or `null` when paused or idle.
   *
   * A segment, not the phase: pausing banks the elapsed time into `accumulatedMs` and clears
   * this, so a phase resumed three times is still measured correctly.
   */
  runningSince: number | null;
  /** Milliseconds already spent in this phase during earlier segments. */
  accumulatedMs: number;
  /** Focus phases finished since the last long break. Drives long-break scheduling. */
  completedFocus: number;
  /** The task being worked on, or `null` for a bare pomodoro (§3.3 allows one). */
  taskId: string | null;
  /** The open `focus_session` row for this phase, or `null` when nothing is recorded. */
  sessionId: string | null;
  /** Epoch ms the phase began — `focus_session.started_at`. Survives pauses. */
  phaseStartedAt: number | null;
}

export function idleState(taskId: string | null = null): PomodoroState {
  return {
    phase: "FOCUS",
    runningSince: null,
    accumulatedMs: 0,
    completedFocus: 0,
    taskId,
    sessionId: null,
    phaseStartedAt: null,
  };
}

/** True when a phase is under way, whether or not the clock is currently running. */
export function isActive(state: PomodoroState): boolean {
  return state.phaseStartedAt !== null;
}

export function isRunning(state: PomodoroState): boolean {
  return state.runningSince !== null;
}

export function phaseDurationMs(config: PomodoroConfig, phase: FocusPhase): number {
  const mins =
    phase === "FOCUS"
      ? config.focusMins
      : phase === "SHORT_BREAK"
        ? config.shortBreakMins
        : config.longBreakMins;
  return Math.max(1, Math.round(mins)) * 60_000;
}

/** Time spent in the current phase, banked plus the segment in progress. */
export function elapsedMs(state: PomodoroState, now: number): number {
  const live = state.runningSince === null ? 0 : Math.max(0, now - state.runningSince);
  return state.accumulatedMs + live;
}

/** Time left, floored at zero — an overrun reads as "done", never as negative. */
export function remainingMs(
  state: PomodoroState,
  config: PomodoroConfig,
  now: number,
): number {
  return Math.max(0, phaseDurationMs(config, state.phase) - elapsedMs(state, now));
}

/** 0 → 1. Clamped, so a phase that overran while the tab slept does not exceed the ring. */
export function progress(
  state: PomodoroState,
  config: PomodoroConfig,
  now: number,
): number {
  const total = phaseDurationMs(config, state.phase);
  return Math.min(1, Math.max(0, elapsedMs(state, now) / total));
}

/**
 * Has the phase run out?
 *
 * Checked on every repaint rather than fired by a timer, which is what makes a phase that
 * expired while the tab was hidden — or while the laptop was shut — complete correctly the
 * moment the tab is looked at again.
 */
export function isExpired(
  state: PomodoroState,
  config: PomodoroConfig,
  now: number,
): boolean {
  return isActive(state) && remainingMs(state, config, now) === 0;
}

/**
 * Which phase follows the current one.
 *
 * `completedFocus` is incremented by `completePhase` BEFORE this is consulted, so the count
 * already includes the phase just finished — after the 4th focus phase, `4 % 4 === 0` gives the
 * long break. It resets to zero when the long break is taken, so the cycle repeats rather than
 * drifting into "every focus phase is now followed by a long break".
 */
export function nextPhaseOf(state: PomodoroState, config: PomodoroConfig): FocusPhase {
  if (state.phase !== "FOCUS") return "FOCUS";

  const every = Math.max(1, Math.round(config.cyclesBeforeLongBreak));
  return state.completedFocus > 0 && state.completedFocus % every === 0
    ? "LONG_BREAK"
    : "SHORT_BREAK";
}

/**
 * What the user is about to get, for a "up next: long break" hint.
 *
 * Separate from `nextPhaseOf` because that one expects the count to have been incremented
 * already, and calling it on the live state would advertise a short break right before the
 * long one. Two functions rather than one with a flag, so the wrong one cannot be reached by
 * forgetting an argument.
 */
export function upcomingPhase(state: PomodoroState, config: PomodoroConfig): FocusPhase {
  if (state.phase !== "FOCUS") return "FOCUS";
  return nextPhaseOf({ ...state, completedFocus: state.completedFocus + 1 }, config);
}

// --------------------------------------------------------------------------- transitions
// All of these are pure: state in, new state out. The store that owns side effects (writing a
// focus_session row, playing the chime) sits above them.

/** Begin a phase from a standing start. Clears any banked time from a previous one. */
export function beginPhase(
  state: PomodoroState,
  phase: FocusPhase,
  now: number,
  opts: { taskId?: string | null; sessionId?: string | null } = {},
): PomodoroState {
  return {
    ...state,
    phase,
    runningSince: now,
    accumulatedMs: 0,
    taskId: opts.taskId !== undefined ? opts.taskId : state.taskId,
    sessionId: opts.sessionId ?? null,
    phaseStartedAt: now,
  };
}

/** Bank the running segment and stop the clock. A second pause is a no-op. */
export function pause(state: PomodoroState, now: number): PomodoroState {
  if (state.runningSince === null) return state;
  return {
    ...state,
    accumulatedMs: elapsedMs(state, now),
    runningSince: null,
  };
}

/** Restart the clock. A resume while already running is a no-op, not a lost segment. */
export function resume(state: PomodoroState, now: number): PomodoroState {
  if (state.runningSince !== null) return state;
  if (!isActive(state)) return state;
  return { ...state, runningSince: now };
}

/**
 * Finish the current phase and move to the next.
 *
 * A completed FOCUS phase counts toward the long break; an interrupted one does not, which is
 * the difference between `completePhase` and `abandon` below. A finished LONG_BREAK resets the
 * cycle counter.
 */
export function completePhase(
  state: PomodoroState,
  config: PomodoroConfig,
  now: number,
  opts: { autoStart?: boolean } = {},
): PomodoroState {
  const counted: PomodoroState = {
    ...state,
    completedFocus:
      state.phase === "FOCUS"
        ? state.completedFocus + 1
        : state.phase === "LONG_BREAK"
          ? 0
          : state.completedFocus,
  };

  const next = nextPhaseOf(counted, config);

  const advanced = beginPhase(counted, next, now, { sessionId: null });

  /*
   * Auto-start is opt-in and defaults OFF. A break that begins the instant focus ends is a
   * break you spend the first minute of not realising has started, and §3.3 promises a
   * notification cue — which only means anything if something is waiting on the user.
   */
  return opts.autoStart ? advanced : pause(advanced, now);
}

/** Stop everything and return to a standing start, keeping the attached task. */
export function reset(state: PomodoroState): PomodoroState {
  return { ...idleState(state.taskId), phase: "FOCUS" };
}

/**
 * Abandon the phase in progress: stop, discard it, and do NOT count it toward the long break.
 *
 * Distinct from `completePhase` on purpose. Counting an abandoned 3-minute focus phase toward
 * the cycle would let four false starts earn a 15-minute long break, which quietly turns the
 * mechanism into something that rewards not working.
 */
export function abandon(state: PomodoroState): PomodoroState {
  return {
    ...state,
    // Back to a standing start on FOCUS, whichever phase was interrupted — nobody abandons a
    // break in order to take a different break.
    phase: "FOCUS",
    runningSince: null,
    accumulatedMs: 0,
    sessionId: null,
    phaseStartedAt: null,
  };
}

/** Attach or detach the task a running session is about. */
export function setTask(state: PomodoroState, taskId: string | null): PomodoroState {
  return { ...state, taskId };
}

// --------------------------------------------------------------------------- formatting

/** `mm:ss`, and `h:mm:ss` past an hour. Used in the UI and in the tab title. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export const PHASE_LABELS: Record<FocusPhase, string> = {
  FOCUS: "Focus",
  SHORT_BREAK: "Break",
  LONG_BREAK: "Long break",
};

/**
 * The §3.3 tab title: `(18:24) Focus: RainFlow PRD`.
 *
 * Leading with the countdown is not cosmetic — a browser tab shows only its first few
 * characters, so anything before the number makes the whole feature useless at the width a
 * pinned tab actually gets.
 */
export function tabTitle(
  state: PomodoroState,
  config: PomodoroConfig,
  now: number,
  taskTitle: string | null,
  fallback = "RainFlow",
): string {
  if (!isActive(state)) return fallback;

  const time = formatDuration(remainingMs(state, config, now));
  const label = PHASE_LABELS[state.phase];
  const suffix = state.phase === "FOCUS" && taskTitle ? `: ${taskTitle}` : "";
  return `(${time}) ${label}${suffix}`;
}
