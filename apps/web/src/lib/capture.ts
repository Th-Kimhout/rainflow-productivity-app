"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether quick capture is open.
 *
 * Module-scoped rather than `useState` inside `<CommandPalette>`, because the palette now has two
 * openers that cannot see each other: its own ⌘K handler, and the ＋ button in the phone's bottom
 * bar, which is a sibling several levels up the tree.
 *
 * On a phone this is not a convenience. §3.1's capture is bound to ⌘K and `C` and to nothing
 * else — no button exists anywhere in the app — so on a device with no keyboard there is no way
 * to create a task at all. The store is what lets a button reach the palette without threading a
 * setter through the shell or re-rendering it on every keystroke.
 *
 * Same shape as `lib/focus/store.ts`, for the same reason: a plain external store, read through
 * `useSyncExternalStore`, so only the components that care re-render.
 */
let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function openCapture() {
  if (open) return;
  open = true;
  emit();
}

export function closeCapture() {
  if (!open) return;
  open = false;
  emit();
}

export function toggleCapture() {
  open = !open;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCaptureOpen(): boolean {
  // The server snapshot is a constant `false` — a prerendered shell never has the palette open,
  // and returning the mutable `open` there would make the static HTML depend on module state.
  return useSyncExternalStore(subscribe, () => open, () => false);
}

/** Test seam: module state outlives a test file's components. */
export function __reset() {
  open = false;
  listeners.clear();
}
