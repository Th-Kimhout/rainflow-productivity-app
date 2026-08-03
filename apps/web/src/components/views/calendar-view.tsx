"use client";

import {
  DAY_MINUTES,
  DEFAULT_BLOCK_MINUTES,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Kbd } from "@/components/common/kbd";
import { useClock } from "@/lib/clock";
import { type ScheduledBlock, useDaySchedule, useSchedulableTasks } from "@/lib/data/hooks";
import { useWriteContext } from "@/lib/data/provider";
import { start as startFocus } from "@/lib/focus/store";
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
 *
 * HTML5 DRAG-AND-DROP DOES NOT EXIST ON A TOUCHSCREEN. Mobile Safari and Chrome for Android never
 * fire `dragstart` for a finger, so both drag paths above — rail onto the grid, and a block to a
 * new time — are simply absent on a phone, with no error to say so. Everything on this screen
 * therefore has a second, pointer-event route:
 *
 *   * creating   — tap empty grid for a default-length block (see `beginDraw`)
 *   * moving     — the grip along a block's top edge (see `beginMove`)
 *   * resizing   — the handle along its bottom edge, which already worked
 *
 * Pointer events are what both devices agree on. The HTML5 paths are kept for the mouse because
 * they are what a desktop calendar's muscle memory expects, not because they are needed.
 */

const PX_PER_MINUTE = 1;
const HOUR_HEIGHT = 60 * PX_PER_MINUTE;

/** MIME-ish keys so a drop can tell what it received. */
const DRAG_TASK = "application/x-rainflow-task";
const DRAG_BLOCK = "application/x-rainflow-block";

/**
 * Where the grid scrolls to when there is no now-line to aim at.
 *
 * Opening at 00:00 means the first thing anyone sees is eight empty hours of night, and every
 * visit starts with a scroll. 07:00 puts the working day at the top of the viewport.
 */
const DEFAULT_SCROLL_HOUR = 7;

export function CalendarView() {
  const { db, ctx } = useWriteContext();
  const { day, setDay, openTask, openZen, taskId: openTaskId } = useUrlState();

  const schedule = useDaySchedule(day);
  const candidates = useSchedulableTasks(day);

  const gridRef = useRef<HTMLDivElement>(null);
  const [dropMinute, setDropMinute] = useState<number | null>(null);

  /** The block the keyboard acts on. Held by id, because blocks reorder as they move. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** A range drawn on empty grid, waiting for a task to put in it. */
  const [drawing, setDrawing] = useState<{ from: number; to: number } | null>(null);
  const [pendingRange, setPendingRange] = useState<{ from: number; to: number } | null>(null);

  const isToday = day === todayKey();
  const blocks = useMemo(() => schedule?.blocks ?? [], [schedule]);

  /*
   * Selection is RESOLVED ON READ rather than corrected in an effect. A block can vanish under
   * the cursor — unscheduled here, or deleted on another device mid-render — and writing the
   * correction back from an effect renders one frame with a dangling id first.
   */
  const selectedIndex = blocks.findIndex((b) => b.block.id === selectedId);
  const selected = selectedIndex === -1 ? null : blocks[selectedIndex]!;

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

  /*
   * Open on the working day, not on midnight. Runs when the day changes, and jumps to an hour
   * before the now-line so the current moment sits in view with its context above it.
   *
   * A DOM mutation rather than state, so it does not participate in rendering at all — and it
   * deliberately does not depend on the clock, or every tick would yank the scroll position back.
   */
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const target = isToday
      ? (nowLineMinutes(day, new Date()) ?? DEFAULT_SCROLL_HOUR * 60) - 60
      : DEFAULT_SCROLL_HOUR * 60;
    el.scrollTop = Math.max(0, target * PX_PER_MINUTE);
  }, [day, isToday]);

  // Keep the keyboard selection in view as it moves.
  useEffect(() => {
    const el = gridRef.current;
    if (!el || !selected) return;
    const top = selected.startMin * PX_PER_MINUTE;
    const bottom = selected.endMin * PX_PER_MINUTE;
    if (top < el.scrollTop) el.scrollTop = Math.max(0, top - 40);
    else if (bottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = bottom - el.clientHeight + 40;
    }
  }, [selected]);

  async function handleDrop(event: React.DragEvent, minute: number) {
    const blockId = event.dataTransfer.getData(DRAG_BLOCK);
    if (blockId) {
      await moveTimeBlock(db, ctx, blockId, day, minute);
      return;
    }

    const taskIdDropped = event.dataTransfer.getData(DRAG_TASK);
    if (taskIdDropped) {
      const created = await scheduleTask(db, ctx, {
        taskId: taskIdDropped,
        day,
        startMinute: minute,
      });
      setSelectedId(created.id);
    }
  }

  /**
   * Draw a new block on empty grid.
   *
   * The gesture people already know from every other calendar, and the one this view was missing:
   * dragging from the rail can only answer "when does this task go", never "I have this hour free,
   * what goes in it". `time_block.task_id` is NOT NULL, so the drawn range opens a picker rather
   * than creating something empty — choose the time, then choose the work.
   */
  function beginDraw(event: React.PointerEvent<HTMLDivElement>) {
    // Blocks own their own pointer gestures (move, resize); only empty grid draws.
    if ((event.target as HTMLElement).closest("[data-block]")) return;
    if (event.button !== 0) return;

    const el = event.currentTarget;
    const from = minuteAt(event.clientY);

    /*
     * A FINGER TAPS; IT DOES NOT DRAW.
     *
     * This element is also the scroll container, and a vertical drag on it is how a phone moves
     * through the day. Capturing that gesture to draw a range would leave the calendar unable to
     * scroll at all — twenty-four hours, stuck on whichever three are in view.
     *
     * So on touch a *tap* opens the picker for a default-length block at the tapped time. It
     * reaches the same place in one gesture, and the length is adjustable straight afterwards
     * with the resize handle. Movement past a few pixels means the finger was scrolling, and
     * nothing happens.
     */
    if (event.pointerType !== "mouse") {
      const startY = event.clientY;
      const settle = (e: PointerEvent) => {
        el.removeEventListener("pointerup", settle);
        el.removeEventListener("pointercancel", settle);
        if (e.type === "pointerup" && Math.abs(e.clientY - startY) <= 8) {
          setPendingRange({ from, to: Math.min(DAY_MINUTES, from + DEFAULT_BLOCK_MINUTES) });
        }
      };
      el.addEventListener("pointerup", settle);
      el.addEventListener("pointercancel", settle);
      return;
    }

    el.setPointerCapture(event.pointerId);
    setDrawing({ from, to: from + SLOT_MINUTES });

    let latest = { from, to: from + SLOT_MINUTES };

    const onMove = (e: PointerEvent) => {
      const at = minuteAt(e.clientY);
      // Dragging upward is as valid as downward; normalise so `from` is always the earlier edge.
      latest = at < from ? { from: at, to: from } : { from, to: Math.max(at, from + SLOT_MINUTES) };
      setDrawing(latest);
    };

    const onUp = (e: PointerEvent) => {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      setDrawing(null);
      // A bare click is not a draw. Requiring real movement keeps a stray click on the grid from
      // opening the picker every time.
      if (latest.to - latest.from >= SLOT_MINUTES * 2) setPendingRange(latest);
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  }

  async function place(taskId: string) {
    const range = pendingRange;
    setPendingRange(null);
    if (!range) return;

    const created = await scheduleTask(db, ctx, {
      taskId,
      day,
      startMinute: range.from,
      lengthMinutes: range.to - range.from,
    });
    setSelectedId(created.id);
  }

  useKeyHandler(PRIORITY.view, (event) => {
    // The picker owns the keyboard while it is open.
    if (pendingRange) return false;

    const key = event.key;

    // ---------------------------------------------------------------- day navigation
    // Left/right move through days; up/down are reserved for moving through blocks, which is
    // the axis the grid itself runs along.
    if (key === "[" || key === "ArrowLeft") {
      event.preventDefault();
      setDay(addDays(day, -1));
      return true;
    }
    if (key === "]" || key === "ArrowRight") {
      event.preventDefault();
      setDay(addDays(day, 1));
      return true;
    }
    if (key.toLowerCase() === "t") {
      event.preventDefault();
      setDay(todayKey());
      return true;
    }

    if (key === "Escape" && selected) {
      event.preventDefault();
      setSelectedId(null);
      return true;
    }

    if (blocks.length === 0) return false;

    // ---------------------------------------------------------------- move and resize
    if (selected && event.shiftKey && (key === "ArrowUp" || key === "ArrowDown")) {
      event.preventDefault();
      const delta = key === "ArrowUp" ? -SLOT_MINUTES : SLOT_MINUTES;
      void moveTimeBlock(db, ctx, selected.block.id, day, selected.startMin + delta);
      return true;
    }

    if (selected && (key === "+" || key === "=" || key === "-")) {
      event.preventDefault();
      const length = selected.endMin - selected.startMin;
      const delta = key === "-" ? -SLOT_MINUTES : SLOT_MINUTES;
      // The floor is one slot: the DB requires `ends_at > starts_at`, and a block too small to
      // see is a block you cannot select again to fix.
      void resizeTimeBlock(db, ctx, selected.block.id, Math.max(SLOT_MINUTES, length + delta));
      return true;
    }

    // ---------------------------------------------------------------- selection
    if (key === "ArrowDown" || key.toLowerCase() === "j") {
      event.preventDefault();
      const next = selectedIndex === -1 ? 0 : Math.min(selectedIndex + 1, blocks.length - 1);
      setSelectedId(blocks[next]!.block.id);
      return true;
    }
    if (key === "ArrowUp" || key.toLowerCase() === "k") {
      event.preventDefault();
      const next = selectedIndex === -1 ? blocks.length - 1 : Math.max(selectedIndex - 1, 0);
      setSelectedId(blocks[next]!.block.id);
      return true;
    }

    if (!selected) return false;

    // ---------------------------------------------------------------- act on the selection
    if (key === "Enter") {
      event.preventDefault();
      if (selected.task) openTask(selected.task.id);
      return true;
    }
    if (key.toLowerCase() === "f" && selected.task) {
      // Same gesture as the lists and the matrix: start the timer and drop into zen.
      event.preventDefault();
      void startFocus(selected.task.id);
      openZen(selected.task.id);
      return true;
    }
    if (key === "Backspace" || key === "Delete") {
      event.preventDefault();
      void softDelete(db, ctx, "time_block", selected.block.id);
      setSelectedId(null);
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
          onPointerDown={beginDraw}
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
          <div
            className="relative select-none"
            style={{ height: DAY_MINUTES * PX_PER_MINUTE }}
          >
            <HourLines />

            {dropMinute !== null && <DropGuide minute={dropMinute} />}
            {drawing && <DrawGhost from={drawing.from} to={drawing.to} />}
            {pendingRange && <DrawGhost from={pendingRange.from} to={pendingRange.to} pending />}

            {/*
              Blocks live in their own lane, inset past the hour gutter. That inset is what lets
              a block's horizontal position be a plain percentage of the lane — mixing a rem
              offset into every block's own `left` calc gets unreadable fast, and gets the
              multi-column arithmetic wrong even faster.
            */}
            <div className="absolute inset-y-0 left-14 right-2">
              {blocks.map((b) => (
                <BlockCard
                  key={b.block.id}
                  scheduled={b}
                  active={b.task?.id === openTaskId}
                  selected={b.block.id === selectedId}
                  onSelect={() => setSelectedId(b.block.id)}
                  onOpen={() => b.task && openTask(b.task.id)}
                  onMove={(minute) => void moveTimeBlock(db, ctx, b.block.id, day, minute)}
                  onResize={(mins) => void resizeTimeBlock(db, ctx, b.block.id, mins)}
                  onRemove={() => void softDelete(db, ctx, "time_block", b.block.id)}
                />
              ))}
            </div>

            {isToday && <NowLine day={day} />}
          </div>
        </div>

        {pendingRange && (
          <TaskPicker
            tasks={candidates ?? []}
            from={pendingRange.from}
            to={pendingRange.to}
            onPick={(id) => void place(id)}
            onCancel={() => setPendingRange(null)}
          />
        )}

        {/*
          The keyboard legend, and only where there is a keyboard. On a phone it would be seven
          bindings you cannot press, above the one gesture that works — which is what this line
          says instead.
        */}
        <footer className="shrink-0 border-t border-border px-4 py-1.5 text-[10px] text-muted-foreground sm:hidden">
          Tap the grid to block out time · drag a block&rsquo;s top edge to move it, its bottom
          edge to resize
        </footer>

        <footer className="hidden shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-1.5 text-[10px] text-muted-foreground sm:flex">
          <span className="flex items-center gap-1">
            <Kbd>[</Kbd>
            <Kbd>]</Kbd> day
          </span>
          <span className="flex items-center gap-1">
            <Kbd>T</Kbd> today
          </span>
          <span className="flex items-center gap-1">
            <Kbd>J</Kbd>
            <Kbd>K</Kbd> select
          </span>
          <span className="flex items-center gap-1">
            <Kbd>⇧↑</Kbd>
            <Kbd>⇧↓</Kbd> move
          </span>
          <span className="flex items-center gap-1">
            <Kbd>+</Kbd>
            <Kbd>−</Kbd> resize
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Enter</Kbd> open
          </span>
          <span className="flex items-center gap-1">
            <Kbd>F</Kbd> focus
          </span>
          <span className="ml-auto">drag on the grid to block out time</span>
        </footer>
      </div>
    </div>
  );
}

/** The range being drawn, or the one waiting for a task. */
function DrawGhost({ from, to, pending = false }: { from: number; to: number; pending?: boolean }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute left-14 right-2 z-20 rounded-md border-2 border-dashed",
        pending ? "border-rain bg-rain/10" : "border-rain/70 bg-rain/5",
      )}
      style={{ top: from * PX_PER_MINUTE, height: Math.max(to - from, SLOT_MINUTES) * PX_PER_MINUTE }}
    >
      <span className="absolute -top-2.5 left-2 rounded bg-rain px-1 text-[10px] font-medium tabular-nums text-background">
        {formatMinutes(from)}–{formatMinutes(to)}
      </span>
    </div>
  );
}

/**
 * Choose what goes in a drawn range.
 *
 * Type-to-filter with Enter taking the first match, because the alternative — a scroll-and-click
 * list — makes the whole draw gesture slower than dragging from the rail, and then there would be
 * no reason to have built it.
 */
function TaskPicker({
  tasks,
  from,
  to,
  onPick,
  onCancel,
}: {
  tasks: readonly TaskRow[];
  from: number;
  to: number;
  onPick: (taskId: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const matches = tasks
    .filter((t) => t.title.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 6);

  // Overlay priority, and `whenTyping` because the input has focus the whole time this is open.
  useKeyHandler(
    PRIORITY.overlay,
    (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return true;
      }
      return false;
    },
    { whenTyping: true },
  );

  return (
    <div className="shrink-0 border-t border-border bg-card p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-xs text-foreground">
          What goes in{" "}
          <span className="tabular-nums text-rain">
            {formatMinutes(from)}–{formatMinutes(to)}
          </span>
          ?
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          Cancel <Kbd>Esc</Kbd>
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const first = matches[0];
          if (first) onPick(first.id);
        }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter tasks…"
          aria-label="Filter tasks"
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-rain"
        />
      </form>

      <ul className="mt-2 flex flex-wrap gap-1">
        {matches.length === 0 ? (
          <li className="px-1 text-[10px] text-muted-foreground">
            {tasks.length === 0 ? "Nothing open to schedule." : "No match."}
          </li>
        ) : (
          matches.map((task, i) => (
            <li key={task.id}>
              <button
                type="button"
                onClick={() => onPick(task.id)}
                className={cn(
                  "max-w-full truncate rounded-md px-2 py-1.5 text-xs transition-colors sm:max-w-56",
                  i === 0
                    ? "bg-rain text-background"
                    : "text-foreground ring-1 ring-border hover:bg-accent",
                )}
              >
                {task.title}
              </button>
            </li>
          ))
        )}
      </ul>
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
  // Two lengths, because "Wednesday, 12 August" plus the nav buttons, the Today chip and the
  // planned total do not coexist in 390px. The short form is rendered alongside and swapped by
  // breakpoint rather than measured — a layout that depends on measuring is a layout that flashes.
  const [label, shortLabel] = useMemo(() => {
    const at = new Date(`${day}T12:00:00Z`);
    const format = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "Asia/Phnom_Penh" }).format(at);
    return [
      format({ weekday: "long", day: "numeric", month: "long" }),
      format({ weekday: "short", day: "numeric", month: "short" }),
    ];
  }, [day]);

  const hours = Math.floor(plannedMinutes / 60);
  const mins = plannedMinutes % 60;

  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-2 sm:gap-3 sm:px-4">
      <div className="flex items-center gap-0.5">
        <StepButton label="Previous day" onClick={() => onStep(-1)}>
          <ChevronLeft className="size-4" />
        </StepButton>
        <StepButton label="Next day" onClick={() => onStep(1)}>
          <ChevronRight className="size-4" />
        </StepButton>
      </div>

      <h2 className="truncate text-sm font-medium text-foreground">
        <span className="hidden sm:inline">{label}</span>
        <span className="sm:hidden">{shortLabel}</span>
      </h2>

      {isToday ? (
        <span className="shrink-0 rounded-full bg-rain-soft px-2 py-0.5 text-[10px] font-medium text-rain">
          Today
        </span>
      ) : (
        <button
          type="button"
          onClick={onToday}
          className="shrink-0 text-xs text-rain underline-offset-2 hover:underline"
        >
          <span className="hidden sm:inline">Back to today</span>
          <span className="sm:hidden">Today</span>
        </button>
      )}

      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
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
      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
  selected,
  onSelect,
  onOpen,
  onMove,
  onResize,
  onRemove,
}: {
  scheduled: ScheduledBlock;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onMove: (startMinute: number) => void;
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

  /** The live drag position while moving. Same ref-plus-state shape, for the same reason. */
  const [moving, setMoving] = useState<number | null>(null);
  const movingRef = useRef<number | null>(null);

  const top = moving ?? startMin;
  const length = (resizing ?? endMin) - startMin;

  /**
   * Move the block by dragging the grip along its top edge.
   *
   * The card is `draggable`, and on a mouse that native drag is still what moves it. This exists
   * because a finger never triggers it: `dragstart` is not dispatched for touch input on any
   * mobile browser, so without a pointer-event path a block could be created on a phone and then
   * never moved off the time it landed on.
   *
   * `touch-none` on the grip claims the gesture, so the grid does not scroll away underneath the
   * drag. It is confined to the grip rather than the whole card precisely so that touching a
   * block anywhere else still scrolls the day — blocks cover most of a working day, and a card
   * that swallowed every touch would make the calendar feel stuck.
   */
  function beginMove(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();

    const startY = event.clientY;
    const target = event.currentTarget;
    const span = endMin - startMin;
    target.setPointerCapture(event.pointerId);

    const onPointerMove = (e: PointerEvent) => {
      const snapped = snapToSlot(startMin + (e.clientY - startY) / PX_PER_MINUTE);
      // Clamped to the day: `moveTimeBlock` writes an instant, and a block dragged off the top
      // would silently land on yesterday evening — off this grid, and hard to find again.
      const next = Math.max(0, Math.min(DAY_MINUTES - span, snapped));
      movingRef.current = next;
      setMoving(next);
    };

    const onUp = (e: PointerEvent) => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerup", onUp);

      const final = movingRef.current;
      movingRef.current = null;
      setMoving(null);
      if (final !== null && final !== startMin) onMove(final);
    };

    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", onUp);
  }

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
      // Marks this subtree as owning its own pointer gestures, so a drag that starts here draws
      // nothing — see `beginDraw`.
      data-block
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_BLOCK, block.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      // Clicking both selects and opens: selection is what the keyboard then acts on, and
      // requiring a separate click to "arm" a block people have already clicked reads as a bug.
      onClick={() => {
        onSelect();
        onOpen();
      }}
      role="button"
      aria-pressed={selected}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      style={{
        top: top * PX_PER_MINUTE,
        height: Math.max(length * PX_PER_MINUTE, SLOT_MINUTES * PX_PER_MINUTE),
        left: `${(column / columns) * 100}%`,
        width: `calc(${(1 / columns) * 100}% - 2px)`,
      }}
      className={cn(
        "group absolute z-10 flex cursor-grab flex-col overflow-hidden rounded-md border px-2 py-1 text-xs transition-colors active:cursor-grabbing",
        // A square edge is the signal that the block continues onto the neighbouring day.
        clippedStart && "rounded-t-none",
        clippedEnd && "rounded-b-none",
        // The keyboard cursor. A ring rather than a fill, so it reads on top of whichever of the
        // four background treatments below the block already has.
        selected && "z-20 ring-2 ring-rain ring-offset-1 ring-offset-background",
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
        {formatMinutes(top)}–{formatMinutes(top + length)}
      </span>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label="Unschedule"
        // Revealed on hover with a mouse, permanently present without one — a touchscreen has no
        // hover, so `group-hover` alone made unscheduling from the grid unreachable. Scoped to
        // `pointer-fine` so the hiding only applies where hovering can undo it.
        className="absolute right-1 top-1 p-1 text-muted-foreground hover:text-priority-high pointer-fine:hidden pointer-fine:group-hover:block"
      >
        <Trash2 className="size-3" />
      </button>

      {/*
        Top edge: move. Stops short of the right so it does not sit under the unschedule button.
        `touch-none` claims the gesture from the grid's scroll — see `beginMove`.
      */}
      <div
        onPointerDown={beginMove}
        role="separator"
        aria-label="Move block"
        className="absolute left-0 right-7 top-0 h-2 cursor-grab touch-none bg-transparent hover:bg-rain/40 active:cursor-grabbing"
      />

      {/* Bottom edge. `touch-none` stops a touch drag scrolling the grid instead of resizing. */}
      <div
        onPointerDown={beginResize}
        role="separator"
        aria-label="Resize block"
        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize touch-none bg-transparent hover:bg-rain/40"
      />
    </div>
  );
}

/**
 * The left rail of things you could schedule. Drag source only — no drop target.
 *
 * Hidden below `md`, and not replaced by a phone equivalent. Its only job is to be something to
 * drag from, and dragging from it is exactly what does not work on a touchscreen; a 224px column
 * of undraggable tasks would be taking a third of the screen to offer nothing. Tapping the grid
 * opens the same picker with the same list, filtered by typing instead of by scrolling.
 */
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
      className="hidden w-56 shrink-0 flex-col border-r border-border bg-card md:flex"
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
