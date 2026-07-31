"use client";

import { useRouter } from "next/navigation";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * The keyboard system (§4.2). RainFlow is meant to be 100% operable without a mouse.
 *
 * Three things make this harder than a switch on `event.key`:
 *
 * 1. TEXT FIELDS. `C` must create a task — but not while the user is typing the letter C into a
 *    title. Single-key bindings are suppressed whenever focus is in an editable element.
 *    Modifier combos (Cmd+K) and Escape are NOT suppressed, because those are exactly the keys
 *    you need while typing.
 *
 * 2. CHORDS. `G` then `T` navigates to Today. That is a two-key sequence with a timeout, so `G`
 *    has to be swallowed and held rather than acted on. A stale pending chord is worse than
 *    none — press G, get distracted, come back and press T, and you would teleport
 *    unexpectedly — hence the expiry.
 *
 * 3. ORDER. Overlays (palette, zen mode) must win over global bindings, or Escape closes the
 *    wrong thing. Handlers are registered with a priority and the highest one that claims the
 *    event stops propagation.
 */

const CHORD_TIMEOUT_MS = 1_500;

/**
 * The `G`-prefixed navigation chords (§4.2).
 *
 * `as const` is required, not stylistic: `typedRoutes` checks `router.push` against a union of
 * real routes, so a widened `string` here is a build error. That is the feature working — it
 * also means adding a chord for a route that does not exist fails at compile time rather than
 * 404ing under someone's fingers.
 */
const CHORD_ROUTES = {
  t: "/today",
  i: "/inbox",
  e: "/matrix",
  c: "/calendar",
  h: "/habits",
  a: "/analytics",
  s: "/settings",
} as const;

type ChordKey = keyof typeof CHORD_ROUTES;

/** Higher priority sees the event first. */
export const PRIORITY = {
  global: 0,
  view: 10,
  overlay: 100,
} as const;

type Handler = (event: KeyboardEvent) => boolean | void;

export interface HandlerOptions {
  /**
   * Receive events while focus is in a text field. Defaults to FALSE.
   *
   * Almost nothing should opt in. `1`–`4` in the matrix and `J`/`K` in a list must not fire while
   * the user is typing a task title — otherwise typing "1" into the estimate field silently moves
   * the task to another quadrant, and typing "j" moves the selection out from under them.
   *
   * The exceptions are handlers whose whole job is to work mid-typing: the command palette
   * (⌘K, Escape) and the inspector (Escape).
   */
  whenTyping?: boolean;
}

interface Registration {
  id: number;
  priority: number;
  handler: Handler;
  whenTyping: boolean;
}

interface KeyboardContextValue {
  /** Register a handler. Return `true` from it to claim the event. */
  register: (priority: number, handler: Handler, options?: HandlerOptions) => () => void;
  /** The chord prefix currently held, for the status hint. */
  pendingChord: string | null;
}

const KeyboardContext = createContext<KeyboardContextValue | null>(null);

/** True when the event target is somewhere the user is typing. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable ||
    // Radix dialogs and comboboxes; treat their internals as text context.
    target.getAttribute("role") === "textbox"
  );
}

export function KeyboardProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const registrations = useRef<Registration[]>([]);
  const nextId = useRef(0);

  const [pendingChord, setPendingChord] = useState<string | null>(null);
  const chordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearChord = useCallback(() => {
    if (chordTimer.current) clearTimeout(chordTimer.current);
    chordTimer.current = null;
    setPendingChord(null);
  }, []);

  const register = useCallback(
    (priority: number, handler: Handler, options?: HandlerOptions) => {
      const id = nextId.current++;
      registrations.current.push({
        id,
        priority,
        handler,
        whenTyping: options?.whenTyping ?? false,
      });
      return () => {
        registrations.current = registrations.current.filter((r) => r.id !== id);
      };
    },
    [],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const editable = isEditable(event.target);
      const hasModifier = event.metaKey || event.ctrlKey || event.altKey;

      /*
       * ---------------------------------------------------------------- chords
       *
       * BOTH halves of a chord are resolved BEFORE handlers are dispatched. `G` is reserved
       * globally, and so is whatever key follows it.
       *
       * Dispatching first breaks the chord system in two ways, and only the second is obvious:
       *
       *   * A view that claims `G` for anything would stop the chord ever starting, silently
       *     disabling navigation on that page.
       *   * A view that binds a letter which is also a chord target eats the second half. The
       *     calendar binds `T` for "jump to today", so `G T` would navigate everywhere in the
       *     app except from the calendar.
       *
       * The alternative is asking every view to check for a pending chord before claiming a
       * key, which is the kind of rule that gets followed three times and forgotten the fourth.
       */
      if (pendingChord === "g" && !hasModifier) {
        const key = event.key.toLowerCase();
        clearChord();

        if (key in CHORD_ROUTES) {
          event.preventDefault();
          router.push(CHORD_ROUTES[key as ChordKey]);
        }
        // Any other key simply cancels the chord — no navigation, no side effect.
        return;
      }

      if (event.key.toLowerCase() === "g" && !hasModifier && !editable) {
        event.preventDefault();
        setPendingChord("g");
        if (chordTimer.current) clearTimeout(chordTimer.current);
        chordTimer.current = setTimeout(clearChord, CHORD_TIMEOUT_MS);
        return;
      }

      /*
       * Overlays first, then views, then global.
       *
       * The `editable` filter has to happen HERE, before dispatch. Handlers used to receive
       * every event regardless, which meant typing "1" into the inspector's estimate field
       * moved the task to another quadrant and typing "j" into a title moved the list
       * selection.
       */
      const ordered = [...registrations.current].sort((a, b) => b.priority - a.priority);
      for (const { handler, whenTyping } of ordered) {
        if (editable && !whenTyping) continue;
        if (handler(event) === true) return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, pendingChord, clearChord]);

  const value = useMemo<KeyboardContextValue>(
    () => ({ register, pendingChord }),
    [register, pendingChord],
  );

  return <KeyboardContext.Provider value={value}>{children}</KeyboardContext.Provider>;
}

export function useKeyboard(): KeyboardContextValue {
  const value = useContext(KeyboardContext);
  if (!value) throw new Error("useKeyboard must be used inside <KeyboardProvider>");
  return value;
}

/**
 * Register a keyboard handler for the lifetime of a component.
 *
 * The handler is kept in a ref so callers do not have to memoise it — an inline arrow function
 * would otherwise re-register on every render, which is both wasteful and a source of
 * ordering surprises.
 */
export function useKeyHandler(
  priority: number,
  handler: Handler,
  options?: HandlerOptions,
): void {
  const { register } = useKeyboard();
  const ref = useRef(handler);

  /*
   * Refreshed in an effect rather than assigned during render. Writing a ref during render is
   * unsafe under concurrent rendering — a render that React discards would still have mutated
   * it — and there is no cost here, because effects run before the user can physically press a
   * key after a repaint.
   */
  useEffect(() => {
    ref.current = handler;
  });

  const whenTyping = options?.whenTyping ?? false;

  useEffect(
    () => register(priority, (event) => ref.current(event), { whenTyping }),
    [register, priority, whenTyping],
  );
}

/** True while a chord prefix is held — drives the "G…" hint. */
export function useChordHint(): string | null {
  return useKeyboard().pendingChord;
}

export { isEditable };
