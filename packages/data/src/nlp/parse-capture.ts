import * as chrono from "chrono-node";

import { type DayKey, appWallClockAsHostLocal, atMinutesIntoDay } from "../time/tz";

/**
 * Natural-language quick capture (PRD §3.1).
 *
 *   "Complete API documentation tomorrow at 3pm #project @high"
 *     → title "Complete API documentation"
 *       due   tomorrow 15:00 Asia/Phnom_Penh
 *       tag   #project
 *       flags urgent + important
 *
 * Pure and dependency-light on purpose: it lives in the data package, so it can be tested
 * exhaustively in Node without a browser or a React tree.
 *
 * TIMEZONE. chrono resolves "tomorrow" against the HOST-local fields of a reference Date, which
 * would be wrong for anyone whose machine is not on Asia/Phnom_Penh. So the reference is built
 * with `appWallClockAsHostLocal`, and chrono's returned *components* are converted back into a
 * real instant with `atMinutesIntoDay`. At no point is a chrono Date used directly as an
 * instant — that is what keeps this correct under any host timezone, which the tests enforce by
 * running under TZ=Pacific/Kiritimati.
 */

export interface CaptureToken {
  type: "date" | "tag" | "flag";
  /** Exact source text, for rendering a chip over the right characters. */
  text: string;
  start: number;
  end: number;
}

export interface ParsedCapture {
  /** Title with all recognised tokens stripped and whitespace collapsed. */
  title: string;
  dueAt: string | null;
  /** False only when an explicit time of day was given. */
  dueIsAllDay: boolean;
  isUrgent: boolean;
  isImportant: boolean;
  /** Lower-cased tag names, deduped, without the leading `#`. */
  tags: string[];
  /** Everything recognised, in source order — drives the live chips in the palette. */
  tokens: CaptureToken[];
}

/**
 * Priority grammar.
 *
 * §3.1's example uses `@high`, but ADR 0001 decision 9 made `is_urgent` + `is_important` the
 * only stored facts — and there is no honest mapping from four priority levels onto two
 * booleans. So the grammar exposes the booleans directly, with `@high`/`@low` as sugar.
 *
 * `@medium` is deliberately ABSENT (ADR 0001, R4). Every candidate meaning is arbitrary, so
 * rather than guess, it is left unrecognised — it stays visible in the title, which tells the
 * user it did not do anything instead of silently doing the wrong thing.
 */
const FLAGS: Record<string, { urgent?: boolean; important?: boolean }> = {
  urgent: { urgent: true },
  important: { important: true },
  high: { urgent: true, important: true },
  low: { urgent: false, important: false },
};

const FLAG_RE = /@([a-z]+)/gi;

/**
 * Tags allow internal hyphens and underscores; a trailing one is not consumed.
 *
 * `\p{M}` (combining marks) is REQUIRED, not optional polish. Khmer builds syllables from a base
 * consonant plus nonspacing marks — the vowel ា is U+17B6 and the subscript sign ្ is U+17D2,
 * both category Mn. Matching only `\p{L}\p{N}` truncated `#ភាសាខ្មែរ` to its first consonant,
 * `#ភ`. The same applies to Thai, Devanagari, Arabic and Hebrew.
 */
const TAG_RE = /#([\p{L}\p{N}\p{M}]+(?:[-_][\p{L}\p{N}\p{M}]+)*)/giu;

interface Match {
  start: number;
  end: number;
  token: CaptureToken;
}

export function parseCapture(input: string, now: Date = new Date()): ParsedCapture {
  const matches: Match[] = [];
  const tags: string[] = [];
  let isUrgent = false;
  let isImportant = false;

  // ------------------------------------------------------------------ #tags
  for (const m of input.matchAll(TAG_RE)) {
    const name = m[1]!.toLowerCase();
    if (!tags.includes(name)) tags.push(name);
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      token: { type: "tag", text: m[0], start: m.index, end: m.index + m[0].length },
    });
  }

  // ------------------------------------------------------------------ @flags
  for (const m of input.matchAll(FLAG_RE)) {
    const flag = FLAGS[m[1]!.toLowerCase()];
    // Unrecognised (`@medium`, `@someone`) — leave it in the title untouched.
    if (!flag) continue;

    if (flag.urgent !== undefined) isUrgent = flag.urgent;
    if (flag.important !== undefined) isImportant = flag.important;

    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      token: { type: "flag", text: m[0], start: m.index, end: m.index + m[0].length },
    });
  }

  /*
   * Dates are parsed from the text with tags and flags BLANKED OUT rather than removed, so
   * offsets still line up with the original string. Blanking matters: "#3pm-standup" would
   * otherwise hand chrono a bare "3pm" and invent a due time from a tag name.
   */
  const forDates = blankRanges(input, matches);

  let dueAt: string | null = null;
  let dueIsAllDay = true;

  const results = chrono.parse(forDates, appWallClockAsHostLocal(now), {
    // "monday" means the coming monday — for a task list, a date in the past is almost never
    // what was meant.
    forwardDate: true,
  });

  const first = results[0];
  if (first) {
    const c = first.start;
    const year = c.get("year");
    const month = c.get("month");
    const day = c.get("day");

    if (year !== null && month !== null && day !== null) {
      const dayKey: DayKey = `${year}-${pad2(month)}-${pad2(day)}`;

      /*
       * `isCertain` distinguishes a stated time from chrono's assumed one. "tomorrow" implies
       * 12:00, which must not be recorded as a real 12:00 deadline — that is exactly what
       * `due_is_all_day` exists to express.
       */
      const hasTime = c.isCertain("hour");
      const minutes = hasTime ? (c.get("hour") ?? 0) * 60 + (c.get("minute") ?? 0) : 0;

      dueAt = atMinutesIntoDay(dayKey, minutes).toISOString();
      dueIsAllDay = !hasTime;

      matches.push({
        start: first.index,
        end: first.index + first.text.length,
        token: {
          type: "date",
          text: first.text,
          start: first.index,
          end: first.index + first.text.length,
        },
      });
    }
  }

  matches.sort((a, b) => a.start - b.start);

  return {
    title: stripRanges(input, matches).replace(/\s{2,}/g, " ").trim(),
    dueAt,
    dueIsAllDay,
    isUrgent,
    isImportant,
    tags,
    tokens: matches.map((m) => m.token),
  };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Replace each range with spaces, preserving every character offset. */
function blankRanges(input: string, matches: readonly Match[]): string {
  if (matches.length === 0) return input;
  const chars = [...input];
  for (const { start, end } of matches) {
    for (let i = start; i < end && i < chars.length; i++) chars[i] = " ";
  }
  return chars.join("");
}

/** Remove each range. Ranges may overlap; the merge keeps the result well-formed. */
function stripRanges(input: string, matches: readonly Match[]): string {
  if (matches.length === 0) return input;

  const merged: Array<[number, number]> = [];
  for (const { start, end } of [...matches].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  let out = "";
  let cursor = 0;
  for (const [start, end] of merged) {
    out += input.slice(cursor, start);
    cursor = end;
  }
  return out + input.slice(cursor);
}
