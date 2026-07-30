"use client";

import { MatrixView } from "@/components/views/matrix-view";

/**
 * §5.1 step 2, first half: prioritisation.
 *
 * The grid fills the canvas rather than sitting under a tall header — triage is a spatial task and
 * the four cells want the room.
 */
export default function MatrixPage() {
  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-border px-6 py-3">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">PRD §3.2</p>
        <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-foreground">
          Eisenhower Matrix
        </h1>
      </header>

      <div className="min-h-0 flex-1">
        <MatrixView />
      </div>
    </div>
  );
}
