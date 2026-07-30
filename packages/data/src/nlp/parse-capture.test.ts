import { describe, expect, it } from "vitest";

import { dayKeyOf, hourOf, minutesIntoDay, todayKey } from "../time/tz";
import { parseCapture } from "./parse-capture";

/**
 * These run under three host timezones (see `test:tz`). Any assertion about which DAY a task is
 * due would break if the parser leaned on the host clock instead of Asia/Phnom_Penh — which is
 * the single most likely bug in natural-language date handling.
 */

// A fixed "now": 2026-07-30 09:00 Asia/Phnom_Penh (Thursday) = 02:00Z.
const NOW = new Date("2026-07-30T02:00:00Z");

describe("the PRD §3.1 example", () => {
  it("parses title, date, time, tag and priority", () => {
    const r = parseCapture(
      "Complete API documentation tomorrow at 3pm #project @high",
      NOW,
    );

    expect(r.title).toBe("Complete API documentation");
    expect(r.tags).toEqual(["project"]);
    expect(r.isUrgent).toBe(true);
    expect(r.isImportant).toBe(true);

    expect(r.dueAt).not.toBeNull();
    const due = new Date(r.dueAt!);
    expect(dayKeyOf(due)).toBe("2026-07-31");
    expect(hourOf(due)).toBe(15);
    expect(r.dueIsAllDay).toBe(false);
  });
});

describe("dates", () => {
  it("resolves 'tomorrow' in the app timezone, not the host's", () => {
    const r = parseCapture("ship it tomorrow", NOW);
    expect(dayKeyOf(new Date(r.dueAt!))).toBe("2026-07-31");
  });

  it("resolves 'today'", () => {
    const r = parseCapture("call the bank today", NOW);
    expect(dayKeyOf(new Date(r.dueAt!))).toBe("2026-07-30");
  });

  it("treats a bare weekday as forward-looking", () => {
    // NOW is Thursday 2026-07-30; "monday" must mean the coming Monday, not the past one.
    const r = parseCapture("review PR monday", NOW);
    const due = new Date(r.dueAt!);
    expect(dayKeyOf(due)).toBe("2026-08-03");
  });

  it("marks a date with no stated time as all-day", () => {
    const r = parseCapture("dentist friday", NOW);
    expect(r.dueIsAllDay).toBe(true);
    // Anchored to local midnight, NOT chrono's implied noon.
    expect(minutesIntoDay(new Date(r.dueAt!))).toBe(0);
  });

  it("keeps an explicit time and is not all-day", () => {
    const r = parseCapture("standup at 9:30am tomorrow", NOW);
    expect(r.dueIsAllDay).toBe(false);
    expect(minutesIntoDay(new Date(r.dueAt!))).toBe(9 * 60 + 30);
  });

  it("handles an explicit calendar date", () => {
    const r = parseCapture("file taxes on March 15 2027", NOW);
    expect(dayKeyOf(new Date(r.dueAt!))).toBe("2027-03-15");
  });

  it("leaves dueAt null when there is no date", () => {
    const r = parseCapture("think about the thing", NOW);
    expect(r.dueAt).toBeNull();
    expect(r.dueIsAllDay).toBe(true);
    expect(r.title).toBe("think about the thing");
  });

  it("does not read a due time out of a tag that looks like one", () => {
    // Without blanking tags before date parsing, chrono would find "3pm" inside the tag.
    const r = parseCapture("prep #3pm-standup", NOW);
    expect(r.tags).toEqual(["3pm-standup"]);
    expect(r.dueAt).toBeNull();
    expect(r.title).toBe("prep");
  });

  it("anchors midnight to the app timezone", () => {
    const r = parseCapture("something tomorrow", NOW);
    // 00:00 in Phnom Penh is 17:00Z the previous day.
    expect(r.dueAt).toBe("2026-07-30T17:00:00.000Z");
  });
});

describe("tags", () => {
  it("extracts multiple tags and strips them from the title", () => {
    const r = parseCapture("refactor sync #rainflow #tech-debt", NOW);
    expect(r.tags).toEqual(["rainflow", "tech-debt"]);
    expect(r.title).toBe("refactor sync");
  });

  it("lower-cases and dedupes", () => {
    const r = parseCapture("a #Work b #work c #WORK", NOW);
    expect(r.tags).toEqual(["work"]);
    expect(r.title).toBe("a b c");
  });

  it("supports non-ASCII tags", () => {
    const r = parseCapture("read notes #ភាសាខ្មែរ", NOW);
    expect(r.tags).toEqual(["ភាសាខ្មែរ"]);
    expect(r.title).toBe("read notes");
  });

  it("does not treat a bare # as a tag", () => {
    const r = parseCapture("issue # 42", NOW);
    expect(r.tags).toEqual([]);
  });
});

describe("priority flags", () => {
  it("@urgent sets only urgent", () => {
    const r = parseCapture("pay invoice @urgent", NOW);
    expect(r).toMatchObject({ isUrgent: true, isImportant: false, title: "pay invoice" });
  });

  it("@important sets only important", () => {
    const r = parseCapture("plan Q4 @important", NOW);
    expect(r).toMatchObject({ isUrgent: false, isImportant: true, title: "plan Q4" });
  });

  it("@high is sugar for both", () => {
    const r = parseCapture("fix prod @high", NOW);
    expect(r).toMatchObject({ isUrgent: true, isImportant: true });
  });

  it("@low is sugar for neither", () => {
    const r = parseCapture("tidy desk @low", NOW);
    expect(r).toMatchObject({ isUrgent: false, isImportant: false, title: "tidy desk" });
  });

  it("combines @urgent and @important", () => {
    const r = parseCapture("escalate @urgent @important", NOW);
    expect(r).toMatchObject({ isUrgent: true, isImportant: true, title: "escalate" });
  });

  it("leaves @medium in the title, since it is deliberately unsupported", () => {
    // ADR 0001 R4: there is no honest 4->2 mapping, so it must not silently guess.
    const r = parseCapture("something @medium", NOW);
    expect(r.title).toBe("something @medium");
    expect(r.isUrgent).toBe(false);
    expect(r.isImportant).toBe(false);
  });

  it("leaves an unknown @mention alone", () => {
    const r = parseCapture("ask @sokha about it", NOW);
    expect(r.title).toBe("ask @sokha about it");
  });

  it("is case-insensitive", () => {
    expect(parseCapture("x @URGENT", NOW).isUrgent).toBe(true);
  });
});

describe("title cleanup", () => {
  it("collapses whitespace left behind by stripped tokens", () => {
    const r = parseCapture("write   the  #docs   report @high", NOW);
    expect(r.title).toBe("write the report");
  });

  it("returns an empty title when the input is only tokens", () => {
    const r = parseCapture("#project @high tomorrow", NOW);
    expect(r.title).toBe("");
  });

  it("handles empty input", () => {
    const r = parseCapture("", NOW);
    expect(r).toMatchObject({ title: "", dueAt: null, tags: [], isUrgent: false });
    expect(r.tokens).toEqual([]);
  });

  it("preserves interior punctuation", () => {
    const r = parseCapture("e-mail Bopha re: the Q3 report #work", NOW);
    expect(r.title).toBe("e-mail Bopha re: the Q3 report");
  });
});

describe("tokens", () => {
  it("reports every recognised span in source order", () => {
    const input = "Complete API documentation tomorrow at 3pm #project @high";
    const r = parseCapture(input, NOW);

    expect(r.tokens.map((t) => t.type)).toEqual(["date", "tag", "flag"]);
    // Offsets must index the ORIGINAL string, so the palette can chip the right characters.
    for (const t of r.tokens) {
      expect(input.slice(t.start, t.end)).toBe(t.text);
    }
  });

  it("reports no tokens for plain text", () => {
    expect(parseCapture("just a task", NOW).tokens).toEqual([]);
  });
});

describe("defaults", () => {
  it("uses the current time when no reference is given", () => {
    // Only assertion safe without a fixed clock: "today" is today.
    const r = parseCapture("ping today");
    expect(dayKeyOf(new Date(r.dueAt!))).toBe(todayKey());
  });
});
