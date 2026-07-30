"use client";

import type { ReactNode } from "react";

import { CommandPalette } from "@/components/palette/command-palette";
import { Sidebar } from "@/components/shell/sidebar";
import { StatusBar } from "@/components/shell/status-bar";
import { KeyboardProvider, useChordHint } from "@/lib/keyboard/provider";

/**
 * The §4.1 three-pane frame: collapsible left sidebar, main canvas, right inspector drawer.
 * (The inspector arrives in Phase 2 with `?task=`.)
 *
 * This lives in `(app)/layout.tsx`, and that placement is doing real work: React preserves
 * layout component instances across sibling page navigations, so the mounted command palette,
 * the keyboard provider, the sync engine's live queries and — from Phase 5 — the pomodoro all
 * survive G+T → G+E → G+T without remounting. No `cacheComponents` needed, which is fortunate
 * since enabling it would pause effects on hidden routes and quietly stop the timer.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <KeyboardProvider>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex-1 overflow-y-auto">{children}</main>
          <StatusBar />
        </div>
      </div>

      <CommandPalette />
      <ChordHint />
    </KeyboardProvider>
  );
}

/**
 * Shows the held chord prefix.
 *
 * Without this, pressing `G` looks like nothing happened — the app swallows the key and waits.
 * A 1.5s invisible modal state is exactly the kind of thing that makes a keyboard UI feel
 * broken rather than fast.
 */
function ChordHint() {
  const chord = useChordHint();
  if (!chord) return null;

  return (
    <div className="fixed bottom-12 left-1/2 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-1.5 font-mono text-sm text-rain shadow-lg">
      {chord.toUpperCase()}…
    </div>
  );
}
