"use client";

import {
  PHASE_LABELS,
  formatDuration,
  isActive,
  isRunning,
  progress,
  remainingMs,
  upcomingPhase,
} from "@rainflow/data";
import { Maximize2, Pause, Play, SkipForward, Square } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";

import { useData } from "@/lib/data/provider";
import * as store from "@/lib/focus/store";
import { useFocus, useFocusClock } from "@/lib/focus/use-focus";
import { useUrlState } from "@/lib/url-state";
import { cn } from "@/lib/utils";

/**
 * The always-visible timer, in the status bar (§4.1).
 *
 * Renders nothing when idle. A permanently-visible 25:00 invites you to look at it, and §3.3 is
 * about the opposite of that — the timer should be findable, not present.
 */
export function FocusTimer() {
  const { db } = useData();
  const { state, config } = useFocus();
  const now = useFocusClock();
  const { openZen } = useUrlState();

  const task = useLiveQuery(
    async () => (state.taskId ? ((await db.task.get(state.taskId)) ?? null) : null),
    [db, state.taskId],
  );

  // `now` is 0 only during server render, where nothing is ever active — see tick.ts.
  if (!isActive(state) || now === 0) return null;

  const at = now;
  const running = isRunning(state);

  return (
    <div className="flex items-center gap-2">
      <Ring value={progress(state, config, at)} phase={state.phase} />

      <span className="tabular-nums text-xs font-medium text-foreground">
        {formatDuration(remainingMs(state, config, at))}
      </span>

      <span className="max-w-40 truncate text-[10px] text-muted-foreground">
        {state.phase === "FOCUS" ? (task?.title ?? "Focus") : PHASE_LABELS[state.phase]}
      </span>

      <div className="flex items-center gap-0.5">
        <IconButton
          label={running ? "Pause" : "Start"}
          onClick={() => void store.toggle()}
        >
          {running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </IconButton>
        <IconButton label="Skip to next phase" onClick={() => void store.advance(false)}>
          <SkipForward className="size-3.5" />
        </IconButton>
        <IconButton label="Stop" onClick={() => void store.stop()}>
          <Square className="size-3.5" />
        </IconButton>
        {state.taskId && (
          <IconButton label="Zen mode" onClick={() => openZen(state.taskId!)}>
            <Maximize2 className="size-3.5" />
          </IconButton>
        )}
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  );
}

/**
 * Progress ring.
 *
 * An SVG circle with a dash offset rather than a `conic-gradient`: the gradient version cannot
 * be animated smoothly and cannot have a rounded cap, and this is the one moving element on an
 * otherwise still screen.
 */
export function Ring({
  value,
  phase,
  size = 18,
  stroke = 2.5,
}: {
  value: number;
  phase: string;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        className="stroke-border"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - value)}
        // Start at 12 o'clock rather than 3, which is where a clock face starts.
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className={cn(
          "transition-[stroke-dashoffset] duration-1000 ease-linear",
          phase === "FOCUS" ? "stroke-rain" : "stroke-success",
        )}
      />
    </svg>
  );
}

/** "Up next: long break" — visible before the break, so it can be planned for. */
export function NextPhaseHint() {
  const { state, config } = useFocus();
  if (!isActive(state) || state.phase !== "FOCUS") return null;

  const next = upcomingPhase(state, config);
  if (next !== "LONG_BREAK") return null;

  return (
    <span className="text-[10px] text-success">Long break next</span>
  );
}
