"use client";

import { useSyncExternalStore } from "react";

import { useClock } from "@/lib/clock";
import * as store from "@/lib/focus/store";

/**
 * React bindings for the module-scoped focus store.
 *
 * Two hooks rather than one, and the split is the design:
 *
 *   `useFocus()`      — the state. Changes only on a real transition (start, pause, phase
 *                       change), so a component that just needs to know whether something is
 *                       running repaints a handful of times an hour.
 *
 *   `useFocusClock()` — the ticking number. Repaints once a second, and ONLY in the components
 *                       that call it. The energy prompt and the "long break next" hint do not,
 *                       and so do not repaint at all while the timer runs.
 *
 * Both go through `useSyncExternalStore`, which is what keeps the value render-pure and
 * consistent between server and client — see `tick.ts` for why that matters for the first paint.
 */

export function useFocus(): store.FocusSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}

/** `Date.now()`, refreshed once a second. `0` during server render only. */
export function useFocusClock(): number {
  return useClock();
}
