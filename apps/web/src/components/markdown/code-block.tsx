"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { type SupportedLanguage, highlight, resolveLanguage } from "@/lib/markdown/highlighter";
import { cn } from "@/lib/utils";

/**
 * A fenced code block (§3.5, "embedded code blocks with syntax highlighting").
 *
 * Renders the plain code IMMEDIATELY and swaps in the highlighted version when Shiki resolves.
 * The alternative — render nothing until highlighting finishes — means a blank rectangle on
 * first paint while a grammar loads, and a permanently blank one if that import ever fails.
 * Plain-then-coloured degrades to something readable in both cases.
 */
export function CodeBlock({ code, tag }: { code: string; tag: string | null }) {
  const language = resolveLanguage(tag);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!language) return;

    let cancelled = false;
    void highlight(code, language)
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      // A failed grammar import leaves the plain rendering in place rather than blanking the
      // block. Nothing here is worth interrupting the user over.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  return (
    <div className="group relative my-2">
      <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1.5">
        {tag && (
          <span className="rounded bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
            {language ?? tag}
          </span>
        )}
        <CopyButton code={code} />
      </div>

      {html ? (
        /*
         * Shiki's own output. Safe: it escapes the source it is given and emits only its own
         * <pre>/<span> structure — raw input is never reflected through. Nothing else in this
         * file uses dangerouslySetInnerHTML, and react-markdown does not render raw HTML at all.
         */
        <div
          className="overflow-x-auto rounded-md border border-border text-xs [&_pre]:p-3"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs text-foreground">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

/** Copy to clipboard, with the confirmation the gesture needs to feel like it worked. */
function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(code)
          .then(() => setCopied(true))
          // Clipboard access can be denied outright; silently doing nothing is better than an
          // error toast for a convenience affordance.
          .catch(() => undefined);
      }}
      aria-label={copied ? "Copied" : "Copy code"}
      className={cn(
        "rounded bg-background/70 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100",
        copied && "opacity-100 text-success",
      )}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}

/** Inline `code`. Distinct component so the block styling does not leak into prose. */
export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
      {children}
    </code>
  );
}

export type { SupportedLanguage };
