"use client";

import {
  DAY_MINUTES,
  SLOT_MINUTES,
  type TaskRow,
  addDays,
  formatMinutes,
  moveTimeBlock,
  nowLineMinutes,
  quadrantOf,
  resizeTimeBlock,
  scheduleTask,
  snapToSlot,
  softDelete,
  todayKey,
} from "@rainflow/data";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { Kbd } from "@/components/common/kbd";
import { useClock } from "@/lib/clock";
import { type ScheduledBlock, useDaySchedule, useSchedulableTasks } from "@/lib/data/hooks";
import { useWriteContext } from "@/lib/data/provider";
import { PRIORITY, useKeyHandler } from "@/lib/keyboard/provider";
import { useUrlState } from "@/lib/url-state";
import { cn } from "@/lib/utils";

/**
 * The §3.2 timebox calendar — one day, 24 hours, drag work onto it.
 *
 * The whole grid is a linear minutes-into-day axis: `PX_PER_MINUTE` converts between the two and
 * is the only place the mapping lives. Every position that reaches this component has already
 * been resolved through `APP_TIMEZONE` by `layoutDay`, so there is no date arithmetic here at all
 * — this file draws rectangles and reports where they were dropped.
 *
 * DRAG SOURCES ARE DISTINGUISHED BY DATA TYPE, not by component state. Dropping a task from the
 * rail creates a block; dropping an existing block moves it. Using one `dragging` state variable
 * for both would break the moment a drag started in one browser tab and ended in another, and
 * `dataTransfer` is the mechanism the platform already provides for exactly this.
 */

const PX_PER_MINUTE = 1;
const HOUR_HEIGHT = 60 * PX_PER_MINUTE;

/** MIME-ish keys so a drop can tell what it received. */
const DRAG_TASK = "application/x-rainflow-task";
const DRAG_BLOCK = "application/x-rainflow-block";

export function CalendarView() {
  const { db, ctx } = useWriteContext();
  const { day, setDay, openTask, taskId: openTaskId } = useUrlState();

  const schedule = useDaySchedule(day);
  const candidates = useSchedulableTasks(day);

  const gridRef = useRef<HTMLDivElement>(null);
  const [dropMinute, setDropMinute] = useState<number | null>(null);

  const isToday = day === todayKey();

  /**
   * Where a pointer y-coordinate falls on the grid, in minutes.
   *
   * Read from the scroll container's own rect plus its scrollTop rather than from
   * `event.nativeEvent.offsetY`: offsetY is relative to whatever element is under the cursor, so
   * dragging over an existing block would report a few pixels into that block instead of the
   * position on the day.
   */
  const minuteAt = useCallback((clientY: number): number => {
    const el = gridRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return snapToSlot((clientY - rect.top + el.scrollTop) / PX_PER_MINUTE);
  }, []);

  async function handleDrop(event: React.DragEvent, minute: number) {
    const blockId = event.dataTransfer.getData(DRAG_BLOCK);
    if (blockId) {
      await moveTimeBlock(db, ctx, blockId, day, minute);
      return;
    }

    const taskIdDropped = event.dataTransfer.getData(DRAG_TASK);
    if (taskIdDropped) {
      await scheduleTask(db, ctx, { taskId: taskIdDropped, day, startMinute: minute });
    }
  }

  useKeyHandler(PRIORITY.view, (event) => {
    // Day navigation. `[`/`]` because they sit together and mean "step" in most editors, with
    // arrows as the discoverable alternative.
    if (event.key === "[" || event.key === "ArrowLeft") {
      event.preventDefault();
      setDay(addDays(day, -1));
      return true;
    }
    if (event.key === "]" || event.key === "ArrowRight") {
      event.preventDefault();
      setDay(addDays(day, 1));
      return true;
    }
    if (event.key.toLowerCase() === "t") {
      event.preventDefault();
      setDay(todayKey());
      return true;
    }
    return false;
  });

  return (
    <div className="flex h-full min-h-0">
      <Rail tasks={candidates} openTaskId={openTaskId} onOpen={openTask} />

      <div className="flex min-w-0 flex-1 flex-col">
        <DayHeader
          day={day}
          isToday={isToday}
          plannedMinutes={schedule?.plannedMinutes ?? 0}
          onStep={(delta) => setDay(addDays(day, delta))}
          onToday={() => setDay(todayKey())}
        />

        <div
          ref={gridRef}
          className="relative min-h-0 flex-1 overflow-y-auto"
          onDragOver={(e) => {
            /*
             * `getData` is unreadable during dragover (the spec's protected mode), but `types`
             * is not — so the cursor can still say "copy" for a task coming off the rail and
             * "move" for a block being repositioned. A dropEffect that disagrees with the
             * source's `effectAllowed` makes some browsers refuse the drop outright.
             */
            e.preventDefault();
            e.dataTransfer.dropEffect = e.dataTransfer.types.includes(DRAG_BLOCK)
              ? "move"
              : "copy";
            setDropMinute(minuteAt(e.clientY));
          }}
          onDragLeave={(e) => {
            // Only clear when the pointer actually left the grid, not when it crossed onto a
            // child block — otherwise the guide flickers off under the cursor.
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropMinute(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            const minute = minuteAt(e.clientY);
            setDropMinute(null);
            void handleDrop(e, minute);
          }}
        >
          <div className="relative" style={{ height: DAY_MINUTES * PX_PER_MINUTE }}>
            <HourLines />

            {dropMinute !== null && <DropGuide minute={dropMinute} />}

            {/*
              Blocks live in their own lane, inset past the hour gutter. That inset is what lets
              a block's horizontal position be a plain percentage of the lane — mixing a rem
              offset into every block's own `left` calc gets unreadable fast, and gets the
              multi-column arithmetic wrong even faster.
            */}
            <div className="absolute inset-y-0 left-14 right-2">
              {schedule?.blocks.map((b) => (
                <BlockCard
                  key={b.block.id}
                  scheduled={b}
                  active={b.task?.id === openTaskId}
                  onOpen={() => b.task && openTask(b.task.id)}
                  onResize={(mins) => void resizeTimeBlock(db, ctx, b.block.id, mins)}
                  onRemove={() => void softDelete(db, ctx, "time_block", b.block.id)}
                />
              ))}
            </div>

            {isToday && <NowLine day={day} />}
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-1.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Kbd>[</Kbd>
            <Kbd>]</Kbd> change day
          </span>
          <span className="flex items-center gap-1">
            <Kbd>T</Kbd> today
          </span>
          <span className="ml-auto">
            drag a task onto the grid, drag a block to move it, drag its edge to resize
          </span>
        </footer>
      </div>
    </div>
  );
}

function DayHeader({
  day,
  isToday,
  plannedMinutes,
  onStep,
  onToday,
}: {
  day: string;
  isToday: boolean;
  plannedMinutes: number;
  onStep: (delta: number) => void;
  onToday: () => void;
}) {
  /*
   * Formatted with an explicit timeZone so the heading names the same day the grid is drawing.
   * `new Date(day)` parses a bare date as UTC midnight, which in Phnom Penh is 07:00 the same
   * morning — safe here, but only because the formatter is pinned to the app timezone too.
   */
  const label = useMemo(
    () =>
      new Intl.DateTimeFormat("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "Asia/Phnom_Penh",
      }).format(new Date(`${day}T12:00:00Z`)),
    [day],
  );

  const hours = Math.floor(plannedMinutes / 60);
  const mins = plannedMinutes % 60;

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
      <div className="flex items-center gap-0.5">
        <StepButton label="Previous day" onClick={() => onStep(-1)}>
          <ChevronLeft className="size-4" />
        </StepButton>
        <StepButton label="Next day" onClick={() => onStep(1)}>
          <ChevronRight className="size-4" />
        </StepButton>
      </div>

      <h2 className="text-sm font-medium text-foreground">{label}</h2>

      {isToday ? (
        <span className="rounded-full bg-rain-soft px-2 py-0.5 text-[10px] font-medium text-rain">
          Today
        </span>
      ) : (
        <button
          type="button"
          onClick={onToday}
          className="text-xs text-rain underline-offset-2 hover:underline"
        >
          Back to today
        </button>
      )}

      <span className="ml-auto text-xs text-muted-foreground">
        {plannedMinutes === 0
          ? "Nothing planned"
          : `${hours > 0 ? `${hours}h ` : ""}${mins > 0 ? `${mins}m` : ""} planned`.trim()}
      </span>
    </header>
  );
}

function StepButton({
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
      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  );
}

/** Hour rules and the time gutter. Purely decorative — no interaction, no state. */
function HourLines() {
  return (
    <>
      {Array.from({ length: 24 }, (_, hour) => (
        <div
          key={hour}
          className="absolute inset-x-0 border-t border-border/60"
          style={{ top: hour * HOUR_HEIGHT }}
        >
          <span className="absolute -top-2 left-2 bg-background px-1 text-[10px] tabular-nums text-muted-foreground">
            {formatMinutes(hour * 60)}
          </span>
        </div>
      ))}
    </>
  );
}

/** Where a drop would land, shown while dragging so the snap is visible before committing. */
function DropGuide({ minute }: { minute: number }) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-dashed border-rain/70"
      style={{ top: minute * PX_PER_MINUTE }}
    >
      <span className="absolute -top-2.5 right-2 rounded bg-rain px-1 text-[10px] font-medium tabular-nums text-background">
        {formatMinutes(minute)}
      </span>
    </div>
  );
}

/**
 * The current-time marker.
 *
 * Ticks on its own interval rather than being derived from a parent re-render, because nothing
 * else on this screen changes once a minute. `SLOT_MINUTES` would be too coarse — the line is the
 * one thing on the grid that is supposed to move — so it updates every 30 seconds, which is
 * within half a pixel of correct at all times.
 */
function NowLine({ day }: { day: string }) {
  /*
   * The shared clock rather than a local interval. `Date.now()` cannot be called during render
   * — it is impure and would differ between server and client — and a `setState` in an effect
   * paints the line in the wrong place for one frame before correcting it.
   */
  const now = useClock();
  const minute = now === 0 ? null : nowLineMinutes(day, new Date(now));

  if (minute === null) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-30 border-t border-priority-high"
      style={{ top: minute * PX_PER_MINUTE }}
      aria-hidden
    >
      <span className="absolute -left-0.5 -top-1 size-2 rounded-full bg-priority-high" />
    </div>
  );
}

/** A single scheduled block. Draggable to move, with a resize handle at the bottom edge. */
function BlockCard({
  scheduled,
  active,
  onOpen,
  onResize,
  onRemove,
}: {
  scheduled: ScheduledBlock;
  active: boolean;
  onOpen: () => void;
  onResize: (minutes: number) => void;
  onRemove: () => void;
}) {
  const { block, task, startMin, endMin, column, columns, clippedStart, clippedEnd } = scheduled;

  /*
   * The live resize position is held in BOTH a ref and state. The ref is what `pointerup` reads
   * to decide whether anything changed; the state is only there to repaint. Reading it out of a
   * `setState` updater instead would mean writing to the database from inside a reducer, which
   * React is free to call twice — and does, under StrictMode.
   */
  const [resizing, setResizing] = useState<number | null>(null);
  const resizingRef = useRef<number | null>(null);

  const length = (resizing ?? endMin) - startMin;

  /*
   * Resize is a pointer-event drag rather than an HTML5 one. `dragstart` on the handle would be
   * swallowed by the card's own move-drag, and native drag gives no continuous position — a
   * resize needs to follow the cursor to be usable at all.
   */
  // Typed to the element it is attached to, so `currentTarget` is an HTMLElement and its
  // `addEventListener` overloads actually know about pointer events.
  function beginResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();

    const startY = event.clientY;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);

    const onMove = (e: PointerEvent) => {
      const snapped = snapToSlot(endMin + (e.clientY - startY) / PX_PER_MINUTE);
      // Never shorter than one slot — the DB constraint is `ends_at > starts_at`, and a block
      // you cannot see is a block you cannot drag back.
      const next = Math.max(startMin + SLOT_MINUTES, snapped);
      resizingRef.current = next;
      setResizing(next);
    };

    const onUp = (e: PointerEvent) => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);

      const final = resizingRef.current;
      resizingRef.current = null;
      setResizing(null);
      // A click on the handle with no movement is not a resize.
      if (final !== null && final !== endMin) onResize(final - startMin);
    };

    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  }

  const quadrant = task ? quadrantOf(task) : null;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_BLOCK, block.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      style={{
        top: startMin * PX_PER_MINUTE,
        height: Math.max(length * PX_PER_MINUTE, SLOT_MINUTES * PX_PER_MINUTE),
        left: `${(column / columns) * 100}%`,
        width: `calc(${(1 / columns) * 100}% - 2px)`,
      }}
      className={cn(
        "group absolute z-10 flex cursor-grab flex-col overflow-hidden rounded-md border px-2 py-1 text-xs transition-colors active:cursor-grabbing",
        // A square edge is the signal that the block continues onto the neighbouring day.
        clippedStart && "rounded-t-none",
        clippedEnd && "rounded-b-none",
        task === null
          ? "border-dashed border-muted-foreground/40 bg-muted/40 text-muted-foreground"
          : active
            ? "border-rain/50 bg-rain-soft text-foreground"
            : quadrant === "DO_FIRST"
              ? "border-priority-high/40 bg-priority-high/10 text-foreground"
              : "border-border bg-card text-foreground hover:bg-accent",
      )}
    >
      <span className="truncate font-medium">{task ? task.title : "Orphaned block"}</span>
      <span className="text-[10px] tabular-nums text-muted-foreground">
        {formatMinutes(startMin)}–{formatMinutes(startMin + length)}
      </span>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label="Unschedule"
        className="absolute right-1 top-1 hidden text-muted-foreground hover:text-priority-high group-hover:block"
      >
        <Trash2 className="size-3" />
      </button>

      {/* Bottom edge. `touch-none` stops a touch drag scrolling the grid instead of resizing. */}
      <div
        onPointerDown={beginResize}
        role="separator"
        aria-label="Resize block"
        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize touch-none bg-transparent hover:bg-rain/40"
      />
    </div>
  );
}

/** The left rail of things you could schedule. Drag source only — no drop target. */
function Rail({
  tasks,
  openTaskId,
  onOpen,
}: {
  tasks: TaskRow[] | undefined;
  openTaskId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <aside
      aria-label="Unscheduled work"
      className="flex w-56 shrink-0 flex-col border-r border-border bg-card"
    >
      <header className="shrink-0 border-b border-border px-3 py-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Plan from
        </h2>
      </header>

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {tasks === undefined ? (
          <li className="px-1 text-xs text-muted-foreground">Loading…</li>
        ) : tasks.length === 0 ? (
          <li className="px-1 text-xs text-muted-foreground">Nothing open.</li>
        ) : (
          tasks.map((task) => (
            <li key={task.id}>
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TASK, task.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onOpen(task.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onOpen(task.id);
                }}
                className={cn(
                  "cursor-grab rounded-md border px-2 py-1.5 text-xs transition-colors active:cursor-grabbing",
                  task.id === openTaskId
                    ? "border-rain/40 bg-rain-soft text-foreground"
                    : "border-transparent bg-background text-foreground hover:bg-accent",
                )}
              >
                <span className="line-clamp-2">{task.title}</span>
                {task.estimated_mins !== null && (
                  <span className="mt-0.5 block text-[10px] tabular-nums text-muted-foreground">
                    {task.estimated_mins}m
                  </span>
                )}
              </div>
            </li>
          ))
        )}
      </ul>
    </aside>
  );
}
