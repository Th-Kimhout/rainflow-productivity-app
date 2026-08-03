"use client";

import {
  PHASE_LABELS,
  formatDuration,
  isActive,
  isRunning,
  progress,
  remainingMs,
  setTaskCompleted,
  upcomingPhase,
} from "@rainflow/data";
import { Check, Minimize2, Pause, Play, SkipForward, Square } from "lucide-react";

import { Ring } from "@/components/focus/focus-timer";
import { Kbd } from "@/components/common/kbd";
import { useTask } from "@/lib/data/hooks";
import { useWriteContext } from "@/lib/data/provider";
import * as store from "@/lib/focus/store";
import { useFocus, useFocusClock } from "@/lib/focus/use-focus";
import { PRIORITY, isEditable, useKeyHandler } from "@/lib/keyboard/provider";
import { useUrlState } from "@/lib/url-state";
import { cn } from "@/lib/utils";

/**
 * §3.3 Zen Mode — one task, nothing else.
 *
 * A fixed overlay above the whole shell rather than a route. Two reasons: it must cover the
 * sidebar and inspector that live in the layout, and leaving zen has to put you back exactly
 * where you were, which a route change cannot promise.
 *
 * Driven by `?zen=<taskId>`, so it survives a reload — walking back to a machine you left
 * mid-session should not mean re-entering the session.
 */
export function ZenMode() {
  const { zenTaskId, closeZen } = useUrlState();
  const { db, ctx } = useWriteContext();
  const task = useTask(zenTaskId);
  const { state, config } = useFocus();
  const now = useFocusClock();

  useKeyHandler(
    PRIORITY.overlay,
    (event) => {
      if (!zenTaskId) return false;

      if (event.key === "Escape") {
        event.preventDefault();
        closeZen();
        return true;
      }

      // Space is play/pause — the one control worth a key of its own in a mode where the
      // point is that you are not hunting for buttons.
      if (event.key === " " && !isEditable(event.target)) {
        event.preventDefault();
        void store.toggle();
        return true;
      }

      return false;
    },
    // Escape must land here even from a field, and zen has no fields — but the inspector
    // underneath might, and this overlay outranks it.
    { whenTyping: true },
  );

  if (!zenTaskId) return null;

  // 0 only on the server, and this overlay is client-only in practice; treating it as the
  // phase start keeps the first paint deterministic rather than reading the clock in render.
  const at = now === 0 ? (state.phaseStartedAt ?? 0) : now;
  const running = isRunning(state);
  const active = isActive(state);
  const onThisTask = state.taskId === zenTaskId;

  return (
    // Same escape as the inspector: `fixed` is positioned against the viewport, so the body's
    // safe-area padding does not apply and the app runs under the clock once installed.
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-background px-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] sm:gap-8">
      <button
        type="button"
        onClick={closeZen}
        aria-label="Leave zen mode"
        // Its own inset, because an absolutely positioned child is laid out against the
        // containing block's PADDING BOX — the parent's padding-top does not move it down, so
        // this would sit under the status bar however much the container padded itself.
        className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top))] rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Minimize2 className="size-4" />
      </button>

      <div className="max-w-2xl px-2 text-center sm:px-8">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          {active ? PHASE_LABELS[state.phase] : "Ready"}
        </p>
        <h1 className="mt-2 text-balance text-xl font-medium tracking-tight text-foreground sm:text-2xl">
          {task ? task.title : "This task is no longer available."}
        </h1>
      </div>

      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <Ring
            value={active ? progress(state, config, at) : 0}
            phase={state.phase}
            size={220}
            stroke={6}
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-5xl font-light tabular-nums text-foreground">
              {formatDuration(
                active
                  ? remainingMs(state, config, at)
                  : // Nothing running: show what a focus phase would be, not 00:00, so the
                    // button has an obvious meaning before it is pressed.
                    config.focusMins * 60_000,
              )}
            </span>
            {active && state.phase === "FOCUS" && upcomingPhase(state, config) === "LONG_BREAK" && (
              <span className="mt-1 text-[10px] uppercase tracking-widest text-success">
                Long break next
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {!active || !onThisTask ? (
            <ZenButton
              primary
              label="Start focus"
              onClick={() => void store.start(zenTaskId)}
            >
              <Play className="size-4" />
              Start focus
            </ZenButton>
          ) : (
            <>
              <ZenButton primary label={running ? "Pause" : "Resume"} onClick={() => void store.toggle()}>
                {running ? <Pause className="size-4" /> : <Play className="size-4" />}
                {running ? "Pause" : "Resume"}
              </ZenButton>
              <ZenButton label="Skip phase" onClick={() => void store.advance(false)}>
                <SkipForward className="size-4" />
              </ZenButton>
              <ZenButton label="Stop" onClick={() => void store.stop()}>
                <Square className="size-4" />
              </ZenButton>
            </>
          )}

          {task && task.status !== "COMPLETED" && (
            <ZenButton
              label="Mark complete"
              onClick={() => {
                void setTaskCompleted(db, ctx, task.id, true);
                void store.stop();
                closeZen();
              }}
            >
              <Check className="size-4" />
            </ZenButton>
          )}
        </div>
      </div>

      <p className="absolute bottom-6 hidden items-center gap-3 text-[10px] text-muted-foreground sm:flex">
        <span className="flex items-center gap-1">
          <Kbd>Space</Kbd> play / pause
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Esc</Kbd> leave
        </span>
      </p>
    </div>
  );
}

function ZenButton({
  label,
  primary = false,
  onClick,
  children,
}: {
  label: string;
  primary?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        primary
          ? "bg-rain text-background hover:bg-rain/90"
          : "text-muted-foreground ring-1 ring-border hover:text-foreground hover:ring-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}
