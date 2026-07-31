"use client";

import { useState } from "react";

import { Kbd } from "@/components/common/kbd";
import { PRIORITY, isEditable, useKeyHandler } from "@/lib/keyboard/provider";

/**
 * The `?` cheatsheet.
 *
 * §4.2 claims the app is 100% operable without a mouse, which is only true if the bindings are
 * discoverable. A keyboard-first app with undocumented shortcuts is a keyboard-first app for
 * exactly one person for exactly as long as they remember them.
 */
const GROUPS: Array<{ title: string; keys: Array<[string, string]> }> = [
  {
    title: "Capture",
    keys: [
      ["⌘K / Ctrl+K", "Quick capture from anywhere"],
      ["C", "Capture a task"],
    ],
  },
  {
    title: "Navigate",
    keys: [
      ["G T", "Today"],
      ["G I", "Inbox"],
      ["G E", "Eisenhower matrix"],
      ["G C", "Calendar"],
      ["G H", "Habits"],
      ["G A", "Analytics"],
    ],
  },
  {
    title: "Calendar",
    keys: [
      ["[ / ]", "Previous / next day"],
      ["T", "Jump to today"],
    ],
  },
  {
    title: "Lists",
    keys: [
      ["J / ↓", "Move down"],
      ["K / ↑", "Move up"],
      ["Space", "Toggle complete"],
      ["Enter", "Open inspector"],
      ["F", "Focus on this task"],
    ],
  },
  {
    title: "Habits",
    keys: [
      ["Space", "Tick today"],
      ["N", "New habit"],
    ],
  },
  {
    title: "Focus",
    keys: [
      ["Space", "Play / pause (in zen)"],
      ["1 / 2 / 3", "Energy: high / medium / low"],
      ["Esc", "Leave zen mode"],
    ],
  },
  {
    title: "General",
    keys: [
      ["?", "This cheatsheet"],
      ["Esc", "Close overlay or inspector"],
    ],
  },
];

export function ShortcutHelp() {
  const [open, setOpen] = useState(false);

  useKeyHandler(PRIORITY.overlay, (event) => {
    if (open && event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return true;
    }

    /*
     * `?` needs Shift on most layouts, so `hasModifier`-style filtering in the provider would
     * miss it — checked explicitly here. Suppressed while typing, or every "why?" typed into a
     * task title would open this.
     */
    if (event.key === "?" && !isEditable(event.target)) {
      event.preventDefault();
      setOpen((v) => !v);
      return true;
    }
    return false;
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <h2 className="mb-4 text-sm font-semibold text-foreground">Keyboard shortcuts</h2>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {group.title}
              </h3>
              <ul className="space-y-1">
                {group.keys.map(([key, label]) => (
                  <li key={key} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <Kbd className="shrink-0">{key}</Kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Single-key shortcuts are ignored while typing in a field.
        </p>
      </div>
    </div>
  );
}
