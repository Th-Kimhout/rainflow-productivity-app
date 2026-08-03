"use client";

import type { EnergyLevel } from "@rainflow/data";

import * as store from "@/lib/focus/store";
import { useFocus } from "@/lib/focus/use-focus";
import { PRIORITY, useKeyHandler } from "@/lib/keyboard/provider";
import { cn } from "@/lib/utils";

/**
 * The §3.6 energy rating, asked the moment a focus phase completes.
 *
 * The timing is the design. §3.6 wants energy correlated with time of day, which only works if
 * the answer is about the session that just happened — asked in an analytics screen the next
 * morning it is a guess, and a guess systematically biased by how the rest of the day went.
 *
 * That is also why the ADR moved `energyRating` off `Task` and onto `focus_session`: a task
 * worked on across four sittings has four energies, not one.
 *
 * Dismissible without answering, and it dismisses itself if ignored. A prompt you must clear
 * before starting a break is a prompt you learn to click through at random, which is worse than
 * no data at all.
 */
const OPTIONS: Array<{ value: EnergyLevel; label: string; key: string; className: string }> = [
  { value: "HIGH", label: "High", key: "1", className: "hover:bg-success/15 hover:text-success" },
  { value: "MEDIUM", label: "Medium", key: "2", className: "hover:bg-rain/15 hover:text-rain" },
  {
    value: "LOW",
    label: "Low",
    key: "3",
    className: "hover:bg-priority-high/15 hover:text-priority-high",
  },
];

export function EnergyPrompt() {
  const { pendingEnergy } = useFocus();

  useKeyHandler(PRIORITY.overlay, (event) => {
    if (!pendingEnergy) return false;

    const option = OPTIONS.find((o) => o.key === event.key);
    if (option) {
      event.preventDefault();
      void store.answerEnergy(option.value);
      return true;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      void store.answerEnergy(null);
      return true;
    }

    return false;
  });

  if (!pendingEnergy) return null;

  return (
    <div
      role="dialog"
      aria-label="How was your energy?"
      className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-1/2 z-50 max-w-[calc(100vw-1.5rem)] -translate-x-1/2 rounded-lg border border-border bg-card p-3 shadow-2xl md:bottom-14"
    >
      <p className="mb-2 text-center text-xs text-muted-foreground">
        How was your energy?
      </p>

      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => void store.answerEnergy(option.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-border transition-colors",
              option.className,
            )}
          >
            {option.label}
            <span className="ml-1.5 text-[10px] text-muted-foreground">{option.key}</span>
          </button>
        ))}

        <button
          type="button"
          onClick={() => void store.answerEnergy(null)}
          className="ml-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
