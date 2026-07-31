import type { HighlighterCore } from "shiki/core";

/**
 * Syntax highlighting for §3.5's code fences.
 *
 * Three decisions, each of which keeps a multi-megabyte dependency down to something a
 * local-first app can carry.
 *
 * 1. `createHighlighterCore` WITH AN EXPLICIT LANGUAGE LIST, not the bundled `shiki` entry.
 *    The full bundle carries every grammar and theme Shiki knows — several megabytes — and
 *    imports them eagerly. The core takes only what is passed to it.
 *
 * 2. THE JAVASCRIPT REGEX ENGINE, not Oniguruma. Oniguruma is faster on pathological grammars
 *    and is the default for good reason, but it is WASM and is FETCHED AT RUNTIME. RainFlow has
 *    no service worker (ADR 0001 decision 3), so that fetch fails offline — and the whole point
 *    of the local-first design is that an already-loaded tab keeps working. Highlighting that
 *    silently stops working on a train is worse than highlighting that is a few milliseconds
 *    slower. The JS engine is plain JavaScript and ships in the bundle.
 *
 * 3. LOADED ON DEMAND. Nothing here is imported until a code fence is actually rendered, so the
 *    cost lands on the first task that contains one rather than on every page load.
 */

/**
 * The languages worth carrying. Each grammar is tens of kilobytes, so this list is a budget,
 * not a preference — anything not on it renders as plain text rather than failing.
 *
 * Chosen for what actually gets pasted into a task note while building this app. `tsx` is
 * separate from `typescript` because the JSX grammar genuinely differs; `javascript` is included
 * because a fence tagged `js` is common and falling back to plaintext for it would be visible.
 */
const LANGUAGES = ["typescript", "tsx", "javascript", "json", "sql", "bash"] as const;

export type SupportedLanguage = (typeof LANGUAGES)[number];

/** The list, for anything that wants to show what is supported. */
export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = LANGUAGES;

/**
 * Aliases people actually type. `ts`, `sh` and `shell` are far more common in the wild than the
 * canonical grammar names, and a fence tagged `ts` rendering unhighlighted looks broken.
 */
const ALIASES: Record<string, SupportedLanguage> = {
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  jsx: "tsx",
  js: "javascript",
  javascript: "javascript",
  mjs: "javascript",
  json: "json",
  jsonc: "json",
  sql: "sql",
  postgres: "sql",
  postgresql: "sql",
  psql: "sql",
  sh: "bash",
  shell: "bash",
  bash: "bash",
  zsh: "bash",
};

/** The grammar for a fence tag, or `null` when it is not one we carry. */
export function resolveLanguage(tag: string | null | undefined): SupportedLanguage | null {
  if (!tag) return null;
  return ALIASES[tag.toLowerCase()] ?? null;
}

/**
 * The highlighter, created once.
 *
 * The PROMISE is cached rather than the resolved value, which is what makes two code blocks
 * rendering in the same frame share one initialisation instead of racing to build two
 * highlighters and load every grammar twice.
 */
let pending: Promise<HighlighterCore> | null = null;

async function getHighlighter(): Promise<HighlighterCore> {
  if (pending) return pending;

  pending = (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
    ]);

    const [githubLight, githubDark, ...langs] = await Promise.all([
      import("shiki/themes/github-light.mjs"),
      import("shiki/themes/github-dark.mjs"),
      import("shiki/langs/typescript.mjs"),
      import("shiki/langs/tsx.mjs"),
      import("shiki/langs/javascript.mjs"),
      import("shiki/langs/json.mjs"),
      import("shiki/langs/sql.mjs"),
      import("shiki/langs/bash.mjs"),
    ]);

    return createHighlighterCore({
      themes: [githubLight, githubDark],
      langs,
      engine: createJavaScriptRegexEngine(),
    });
  })();

  return pending;
}

/**
 * Highlight `code`, returning Shiki's HTML.
 *
 * DUAL THEME. Both themes are baked into the output as `--shiki-light` / `--shiki-dark` CSS
 * variables and picked between in globals.css. The alternative — re-highlighting on every theme
 * change — would mean a flash of unstyled code every time the theme flips, and would need the
 * highlighter to still be around long after it was used.
 *
 * The returned HTML is safe to inject: Shiki escapes the source it is given, and the only markup
 * it emits is its own `<pre>`/`<span>` structure. It never reflects raw input through.
 */
export async function highlight(code: string, lang: SupportedLanguage): Promise<string> {
  const highlighter = await getHighlighter();

  return highlighter.codeToHtml(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    // Emit variables for both themes rather than baking one in as the default.
    defaultColor: false,
  });
}
