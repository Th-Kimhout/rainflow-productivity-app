"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CodeBlock, InlineCode } from "@/components/markdown/code-block";
import { cn } from "@/lib/utils";

/**
 * Markdown rendering for `task.description` (§3.5, as reduced by ADR 0001 decision 11 — no
 * standalone notes, no `[[backlinks]]`).
 *
 * NO `rehype-raw`, DELIBERATELY. react-markdown escapes embedded HTML by default, and that
 * default is doing real security work here: a task description can arrive from another device
 * over the sync channel, so it is not simply "the user's own trusted input". Adding raw HTML
 * support to get a `<kbd>` or a `<details>` would open the door to script injection through a
 * row, for a formatting nicety GFM already mostly covers.
 *
 * Every element is styled explicitly rather than via a typography plugin. The plugin would be
 * another dependency to fight over defaults with, and there are only a dozen elements worth
 * styling in a 320px-wide drawer.
 */
export function Markdown({ content, className }: { content: string; className?: string }) {
  if (!content.trim()) return null;

  return (
    <div className={cn("text-sm leading-relaxed text-foreground", className)}>
      {/*
        `COMPONENTS` is a module constant, not an inline literal. react-markdown treats a new
        `components` object as new element types and remounts the whole tree — an inline map
        would rebuild the entire document on every keystroke of the editor beside it.
      */}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** Pull the ```lang tag off the className react-markdown puts on a fenced `code` element. */
function fenceTag(className: string | undefined): string | null {
  const match = /language-([\w+-]+)/.exec(className ?? "");
  return match?.[1] ?? null;
}

function toText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(toText).join("");
  return "";
}

const COMPONENTS = {
  /*
   * `pre` is flattened to nothing, because `code` below renders its own container for a fenced
   * block. Leaving the default `pre` in place would nest one scroll container inside another and
   * break the sticky copy button's positioning.
   */
  pre: ({ children }: { children?: ReactNode }) => <>{children}</>,

  code: ({ className, children }: ComponentPropsWithoutRef<"code">) => {
    const tag = fenceTag(className);

    /*
     * react-markdown v10 dropped the `inline` prop. A fenced block is identified by the
     * `language-*` class the parser attaches; anything without one is inline `code`.
     *
     * The exception is an untagged fence — ``` with no language — which has no class either.
     * Those are distinguished by containing a newline, which inline code cannot.
     */
    const text = toText(children);
    const fenced = tag !== null || text.includes("\n");

    if (!fenced) return <InlineCode>{children}</InlineCode>;

    // Markdown fences always end with a newline before the closing ```; keeping it would render
    // a blank final line in every block.
    return <CodeBlock code={text.replace(/\n$/, "")} tag={tag} />;
  },

  a: ({ href, children }: ComponentPropsWithoutRef<"a">) => (
    <a
      href={href}
      // §3.5 wants links to external resources. `noreferrer` also implies `noopener`, which
      // stops the opened page reaching back through `window.opener`.
      target="_blank"
      rel="noreferrer"
      className="text-rain underline underline-offset-2 hover:text-rain/80"
    >
      {children}
    </a>
  ),

  h1: ({ children }: { children?: ReactNode }) => (
    <h1 className="mb-1 mt-3 text-base font-semibold text-foreground first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className="mb-1 mt-3 text-sm font-semibold text-foreground first:mt-0">{children}</h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className="mb-1 mt-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">
      {children}
    </h3>
  ),

  p: ({ children }: { children?: ReactNode }) => (
    <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>
  ),

  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="my-1.5 ml-4 list-disc space-y-0.5 marker:text-muted-foreground">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="my-1.5 ml-4 list-decimal space-y-0.5 marker:text-muted-foreground">
      {children}
    </ol>
  ),

  /*
   * GFM task lists. The checkbox is rendered read-only on purpose: ticking it would have to
   * rewrite the markdown source, and a checkbox that looks interactive and silently does nothing
   * is worse than one that is visibly not. Subtasks (§3.2) are the real mechanism for this.
   */
  input: ({ checked, type }: ComponentPropsWithoutRef<"input">) =>
    type === "checkbox" ? (
      <input
        type="checkbox"
        checked={checked}
        readOnly
        aria-label={checked ? "Done" : "Not done"}
        className="mr-1 size-3 translate-y-px accent-rain"
      />
    ) : null,

  li: ({ children }: { children?: ReactNode }) => <li className="pl-0.5">{children}</li>,

  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="my-2 border-l-2 border-rain/40 pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),

  hr: () => <hr className="my-3 border-border" />,

  // GFM tables. Wrapped so a wide table scrolls inside the drawer rather than widening it.
  table: ({ children }: { children?: ReactNode }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="border border-border bg-muted/40 px-2 py-1 text-left font-medium">
      {children}
    </th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="border border-border px-2 py-1">{children}</td>
  ),

  del: ({ children }: { children?: ReactNode }) => (
    <del className="text-muted-foreground">{children}</del>
  ),
};
