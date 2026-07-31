"use client";

import { isExpired, isRunning, tabTitle } from "@rainflow/data";
import { useLiveQuery } from "dexie-react-hooks";
import { type ReactNode, useEffect, useRef } from "react";

import { playChime } from "@/lib/audio/chime";
import { useData, useWriteContext } from "@/lib/data/provider";
import * as store from "@/lib/focus/store";
import { useFocus, useFocusClock } from "@/lib/focus/use-focus";

/**
 * Drives the module-scoped focus store: attaches it to the database, notices when a phase has
 * run out, rings the chime, and keeps the tab title current.
 *
 * All of that lives in ONE component mounted once in the shell. Spreading it across the widgets
 * that display the timer would mean a phase only completes while some particular component
 * happens to be mounted — so a session would silently stall the moment you navigated away from
 * the page showing it, which is precisely what the module-scoped store exists to prevent.
 */
export function FocusProvider({ children }: { children: ReactNode }) {
  const { db } = useData();
  const { ctx } = useWriteContext();

  useEffect(() => {
    void store.attach(db, ctx);
    return () => store.detach();
  }, [db, ctx]);

  return (
    <>
      <PhaseWatcher />
      <TabTitle />
      <PeerSync />
      {children}
    </>
  );
}

/**
 * Completes a phase the moment its time is up.
 *
 * Driven by the repaint clock rather than by a `setTimeout` scheduled for the end of the phase.
 * A timeout looks tidier and is wrong: it does not fire while the machine is asleep, and
 * browsers clamp long background timers, so a phase that ended during a lunch break would sit
 * there un-completed until something else happened to wake the tab. Checking a derived
 * `isExpired` on every repaint means the phase completes on the first render after waking, and
 * the completion is recorded with the correct timestamps regardless.
 */
function PhaseWatcher() {
  const { state, config, ready } = useFocus();
  const now = useFocusClock();

  // Guards against double-firing: `advance` is async, so several repaints can observe the
  // expired state before it clears.
  const firing = useRef(false);

  useEffect(() => {
    if (!ready || now === 0 || firing.current) return;
    if (!isRunning(state) || !isExpired(state, config, now)) return;

    firing.current = true;
    const wasFocus = state.phase === "FOCUS";

    void store.advance(true).finally(() => {
      firing.current = false;
    });

    // Rising when work ends, falling when a break ends: the direction carries the meaning, so
    // it is recognisable without looking — which is the point in a mode built around not looking.
    playChime(wasFocus ? "focus-ended" : "break-ended");
  }, [state, config, now, ready]);

  return null;
}

/** §3.3's browser tab progress indicator: `(18:24) Focus: RainFlow PRD`. */
function TabTitle() {
  const { db } = useData();
  const { state, config } = useFocus();
  const now = useFocusClock();

  const task = useLiveQuery(
    async () => (state.taskId ? ((await db.task.get(state.taskId)) ?? null) : null),
    [db, state.taskId],
  );

  useEffect(() => {
    const next = tabTitle(state, config, now || Date.now(), task?.title ?? null);
    if (document.title !== next) document.title = next;
  }, [state, config, now, task?.title]);

  useEffect(() => () => {
    document.title = "RainFlow";
  }, []);

  return null;
}

/**
 * Adopts focus state written by another tab.
 *
 * Two tabs each running their own timer would open two `focus_session` rows covering the same
 * stretch of time and double every §3.6 figure. Dexie already broadcasts writes between tabs, so
 * a live query on the persisted row is enough — no extra channel, no messages to design.
 *
 * `store.adopt` ignores this tab's own writes, which is what stops the obvious loop.
 */
function PeerSync() {
  const { db } = useData();
  const persisted = useLiveQuery(() => db.meta.get("focus"), [db]);

  useEffect(() => {
    if (persisted?.value) store.adopt(persisted.value);
  }, [persisted]);

  return null;
}
