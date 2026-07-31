"use client";

import { type TaskRow, patch } from "@rainflow/data";
import { Eye, Pencil } from "lucide-react";
import { useRef, useState } from "react";

import { Markdown } from "@/components/markdown/markdown";
import { useWriteContext } from "@/lib/data/provider";
import { cn } from "@/lib/utils";

/**
 * The §3.5 in-line document notes: a markdown editor in the task inspector.
 *
 * EDIT AND PREVIEW ARE ONE PANE, not two side by side. The inspector is 320px wide (§4.1), which
 * is not enough for a split — each half would be ~150px and both would be useless. Toggling also
 * matches how these notes are actually used: written in bursts, read many times after.
 *
 * The default is PREVIEW when there is content and EDIT when there is not, so an empty note is
 * immediately typeable and a written one is immediately readable, without a click either way.
 */
export function NotesEditor({ task }: { task: TaskRow }) {
  const { db, ctx } = useWriteContext();
  const stored = task.description ?? "";

  const [editing, setEditing] = useState(stored.trim() === "");
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /*
   * Draft-or-stored, the same shape as the title field. Mirroring the row into state and
   * re-seeding from an effect would let a description syncing in from another device overwrite
   * whatever is half-typed here.
   */
  const text = draft !== null && draft.id === task.id ? draft.text : stored;

  function commit() {
    const next = text.trim() || null;
    setDraft(null);
    if (next !== task.description) void patch(db, ctx, "task", task.id, { description: next });
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Notes
        </h3>
        <button
          type="button"
          onClick={() => {
            /*
             * Leaving edit mode commits. Without this the text would only be saved on blur, and
             * clicking straight to preview is exactly the gesture that skips the blur — the note
             * would render correctly and then be gone on reload.
             */
            if (editing) commit();
            setEditing((v) => !v);
          }}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          {editing ? (
            <>
              <Eye className="size-3" /> Preview
            </>
          ) : (
            <>
              <Pencil className="size-3" /> Edit
            </>
          )}
        </button>
      </div>

      {editing ? (
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setDraft({ id: task.id, text: e.target.value })}
          onBlur={commit}
          onKeyDown={(e) => {
            /*
             * Tab inserts two spaces rather than leaving the field. In a markdown note — nested
             * lists, indented code — Tab meaning "indent" is what everyone expects, and the
             * drawer has no other focusable content worth tabbing to. Shift+Tab still escapes.
             */
            if (e.key === "Tab" && !e.shiftKey) {
              e.preventDefault();
              const el = e.currentTarget;
              const { selectionStart: from, selectionEnd: to } = el;
              const next = `${text.slice(0, from)}  ${text.slice(to)}`;
              setDraft({ id: task.id, text: next });
              // Restore the caret after React repaints, or it jumps to the end of the note.
              requestAnimationFrame(() => {
                el.selectionStart = el.selectionEnd = from + 2;
              });
            }
          }}
          rows={8}
          placeholder={"Markdown supported.\n\n- lists, **bold**, [links](https://…)\n- ```ts fenced code"}
          aria-label="Notes"
          className="w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-rain"
        />
      ) : (
        /*
         * A div, not a button. Rendered markdown contains paragraphs, lists, tables and links —
         * none of which may legally sit inside a <button>, and a link nested in one is
         * unreachable by keyboard. The header toggle is the accessible control; this click is
         * a convenience on top of it.
         */
        <div
          onClick={(e) => {
            // Clicking a link or the copy button must do that, not open the editor.
            if ((e.target as HTMLElement).closest("a, button")) return;
            setEditing(true);
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
          className={cn(
            "cursor-text rounded-md border border-transparent p-2 transition-colors hover:border-border",
            stored.trim() === "" && "text-muted-foreground",
          )}
        >
          {stored.trim() === "" ? (
            <span className="text-xs">No notes. Click to add.</span>
          ) : (
            <Markdown content={stored} />
          )}
        </div>
      )}
    </section>
  );
}
