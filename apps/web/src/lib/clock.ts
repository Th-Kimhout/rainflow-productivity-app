"use client";

/**
 * A once-a-second wall-clock tick, as an external store.
 *
 * Shared by the pomodoro countdown and the calendar's now-line — both need "what time is it"
 * during render, and both would otherwise reach for `Date.now()` or a `setState` in an effect.
 *
 * `Date.now()` cannot be called during render — it is impure, so the React Compiler rejects it,
 * and it would give the server and the client different HTML. But a countdown needs the current
 * time on its very FIRST paint: a timer that shows 25:00 for one frame before snapping to 04:12
 * looks broken.
 *
 * `useSyncExternalStore` resolves both. `subscribe` runs in the commit phase, where reading the
 * clock is allowed, and stamps the value before returning. React then re-reads the snapshot and,
 * if it changed, re-renders synchronously BEFORE the browser paints. So the first thing the user
 * sees is already correct, and the server still renders a deterministic `0`.
 *
 * The interval only causes repaints. It never advances anything — elapsed time is derived from
 * timestamps in `@rainflow/data`'s pomodoro module, so a throttled or suspended tab is still
 * correct the moment it renders again.
 */

import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

let value = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function stamp(): void {
  const next = Date.now();
  if (next === value) return;
  value = next;
  for (const fn of listeners) fn();
}

export function subscribeTick(onChange: () => void): () => void {
  listeners.add(onChange);

  if (timer === null) {
    // Called during commit, not render — reading the clock here is legitimate, and it is what
    // makes the first paint show the right number.
    value = Date.now();
    timer = setInterval(stamp, 1_000);

    /*
     * A hidden tab has its interval throttled to roughly once a minute, so the countdown would
     * be up to a minute stale the instant it is looked at again. Re-stamping on visibility
     * change costs nothing and makes the tab correct before the user has read it.
     */
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", stamp);
    }
  }

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", stamp);
      }
    }
  };
}

export function getTick(): number {
  return value;
}

/** Deterministic on the server, where there is no clock worth reading. */
export function getServerTick(): number {
  return 0;
}

/** `Date.now()`, refreshed once a second. `0` during server render only. */
export function useClock(): number {
  return useSyncExternalStore(subscribeTick, getTick, getServerTick);
}
