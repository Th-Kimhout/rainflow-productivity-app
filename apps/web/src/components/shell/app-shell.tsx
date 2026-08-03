"use client";

import { type ReactNode, Suspense } from "react";

import { EnergyPrompt } from "@/components/focus/energy-prompt";
import { ZenMode } from "@/components/focus/zen-mode";
import { CommandPalette } from "@/components/palette/command-palette";
import { MobileNav } from "@/components/shell/mobile-nav";
import { ShortcutHelp } from "@/components/shell/shortcut-help";
import { Sidebar } from "@/components/shell/sidebar";
import { StatusBar } from "@/components/shell/status-bar";
import { InspectorDrawer } from "@/components/task/inspector-drawer";
import { FocusProvider } from "@/lib/focus/provider";
import { KeyboardProvider, useChordHint } from "@/lib/keyboard/provider";

/**
 * The §4.1 three-pane frame: collapsible left sidebar, main canvas, right inspector drawer.
 *
 * This lives in `(app)/layout.tsx`, and that placement is doing real work: React preserves layout
 * component instances across sibling page navigations, so the mounted command palette, the
 * keyboard provider, the sync engine's live queries and — from Phase 5 — the pomodoro all survive
 * G+T → G+E → G+T without remounting. No `cacheComponents` needed, which is fortunate since
 * enabling it would pause effects on hidden routes and quietly stop the timer.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <KeyboardProvider>
      {/*
       * `useSearchParams` requires a <Suspense> boundary inside a statically prerendered route or
       * `next build` fails outright. Everything reading `?task=` / `?view=` sits below this one —
       * that includes page content, since a list row opening the inspector needs the same state.
       */}
      {/*
        `FocusProvider` is INSIDE the Suspense boundary but OUTSIDE the panes, because it drives
        the module-scoped pomodoro store and must stay mounted across every navigation. A phase
        that only completes while the page showing the timer is mounted is exactly the bug the
        module-scoped store exists to prevent.
      */}
      <Suspense fallback={<ShellFallback />}>
        <FocusProvider>
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <Sidebar />

            <div className="flex min-w-0 flex-1 flex-col">
              <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
              <StatusBar />
            </div>

            {/*
              Docked as a third pane from `xl` up and an overlay sheet below it. 224 + 320px of
              permanent chrome leaves a 480px canvas at 1024px wide, which is narrower than the
              calendar's own grid — so the drawer stops taking width before it starts costing
              the view it is describing.
            */}
            <InspectorDrawer />
          </div>

          {/* The keyboard's stand-in on a touchscreen. Below `md` only — see MobileNav. */}
          <MobileNav />

          <ZenMode />
          <EnergyPrompt />
        </FocusProvider>
      </Suspense>

      <CommandPalette />
      <ShortcutHelp />
      <ChordHint />
    </KeyboardProvider>
  );
}

function ShellFallback() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}

/**
 * Shows the held chord prefix.
 *
 * Without this, pressing `G` looks like nothing happened — the app swallows the key and waits. A
 * 1.5s invisible modal state is exactly the kind of thing that makes a keyboard UI feel broken
 * rather than fast.
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
