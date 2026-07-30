"use client";

import { createTaskFromCapture, parseCapture } from "@rainflow/data";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Kbd } from "@/components/common/kbd";
import { ParsedChips } from "@/components/palette/parsed-chips";
import { useWriteContext } from "@/lib/data/provider";
import { PRIORITY, useKeyHandler } from "@/lib/keyboard/provider";

/**
 * Universal quick capture (§3.1) — Cmd/Ctrl+K from anywhere.
 *
 * Input is parsed live: dates, `#tags`, and `@urgent`/`@important` are resolved as you type and
 * shown as chips, so a misparse is visible before you commit rather than discovered days later
 * when the task fails to show up in Today.
 *
 * Captured tasks land in INBOX per §3.1's "smart fallbacks": capture must never block on
 * deciding where something goes.
 */
export function CommandPalette() {
  const { db, ctx } = useWriteContext();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setValue("");
  }, []);

  useKeyHandler(PRIORITY.overlay, (event) => {
    // Cmd+K / Ctrl+K. Deliberately NOT suppressed inside text fields — capturing a stray
    // thought while editing something else is the main use case (§5.1 step 3).
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      setOpen((v) => !v);
      return true;
    }

    if (!open) {
      // `C` creates a task. Single-key, so the provider only reaches here when not typing.
      if (event.key.toLowerCase() === "c" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setOpen(true);
        return true;
      }
      return false;
    }

    // Open: own Escape so it closes the palette rather than some outer thing.
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return true;
    }

    return false;
  });

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  /*
   * Re-parsed on every keystroke. Cheap enough to do synchronously — chrono over a single short
   * line is microseconds, and §7.1 budgets 50ms for the whole palette.
   */
  const parsed = useMemo(() => parseCapture(value), [value]);

  async function submit() {
    /*
     * Guard on the PARSED title, not the raw input. "#project @high" parses to an empty title,
     * and a task called "" is worse than no task — the tokens were metadata, not a name.
     */
    if (!parsed.title) return;

    /*
     * Close first, then write. The write is local so it completes in about a millisecond, but
     * closing first means the UI never appears to hang on it — and if the write somehow threw,
     * a stuck-open palette would be a worse failure than a missing task.
     */
    close();
    await createTaskFromCapture(db, ctx, parsed);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-4 pt-[15vh] backdrop-blur-sm"
      onClick={close}
      role="presentation"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Quick capture"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Capture a task…  tomorrow 3pm #project @urgent"
            aria-label="Task title"
            className="w-full bg-transparent px-4 py-3.5 text-base text-foreground outline-none placeholder:text-muted-foreground"
          />
        </form>

        <ParsedChips parsed={parsed} />

        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <span>
            {parsed.title ? (
              <>
                Goes to Inbox as{" "}
                <span className="text-foreground">&ldquo;{parsed.title}&rdquo;</span>
              </>
            ) : value.trim() ? (
              // Every word was metadata, so there is no name left to save.
              <span className="text-priority-high">Needs a title</span>
            ) : (
              "Goes to Inbox"
            )}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Enter</Kbd> save
            <Kbd>Esc</Kbd> cancel
          </span>
        </div>
      </div>
    </div>
  );
}
