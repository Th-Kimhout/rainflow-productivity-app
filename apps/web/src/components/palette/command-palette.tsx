"use client";

import { createTask } from "@rainflow/data";
import { useCallback, useEffect, useRef, useState } from "react";

import { Kbd } from "@/components/common/kbd";
import { useWriteContext } from "@/lib/data/provider";
import { PRIORITY, useKeyHandler } from "@/lib/keyboard/provider";

/**
 * Universal quick capture (§3.1) — Cmd/Ctrl+K from anywhere.
 *
 * Phase 1 captures raw text only. NLP parsing of dates, `#tags` and `@urgent` arrives in
 * Phase 2; the point of shipping it plain first is that the capture path — keystroke to Dexie
 * to outbox — gets exercised end to end before any parsing complexity sits on top of it.
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

  async function submit() {
    const title = value.trim();
    if (!title) return;

    /*
     * Close first, then write. The write is local so it completes in about a millisecond, but
     * closing first means the UI never appears to hang on it — and if the write somehow threw,
     * a stuck-open palette would be a worse failure than a missing task.
     */
    close();
    await createTask(db, ctx, { title });
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
            placeholder="Capture a task…"
            aria-label="Task title"
            className="w-full bg-transparent px-4 py-3.5 text-base text-foreground outline-none placeholder:text-muted-foreground"
          />
        </form>

        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <span>Goes to Inbox</span>
          <span className="flex items-center gap-1.5">
            <Kbd>Enter</Kbd> save
            <Kbd>Esc</Kbd> cancel
          </span>
        </div>
      </div>
    </div>
  );
}
