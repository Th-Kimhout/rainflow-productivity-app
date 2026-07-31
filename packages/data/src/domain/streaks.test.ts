import { describe, expect, it } from "vitest";

import type { DayKey } from "../time/tz";
import type { RecurrenceRule } from "./recurrence";
import { heatmap, summarise } from "./streaks";

/** 2026-08-10 is a Monday. Every weekday assertion below depends on it. */
const MON: DayKey = "2026-08-10";

function shift(day: DayKey, n: number): DayKey {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const daily: RecurrenceRule = {
  kind: "DAILY",
  interval_days: null,
  weekdays: null,
  month_day: null,
};
const weekdaysOnly: RecurrenceRule = {
  kind: "WEEKDAYS",
  interval_days: null,
  weekdays: [1, 2, 3, 4, 5],
  month_day: null,
};
const everyThree: RecurrenceRule = {
  kind: "INTERVAL",
  interval_days: 3,
  weekdays: null,
  month_day: null,
};

describe("current streak", () => {
  it("counts consecutive completed days", () => {
    const done = new Set([MON, shift(MON, 1), shift(MON, 2)]);
    expect(summarise(daily, done, shift(MON, 2)).current).toBe(3);
  });

  it("breaks on a missed due day", () => {
    // Monday and Wednesday done, Tuesday missed.
    const done = new Set([MON, shift(MON, 2)]);
    expect(summarise(daily, done, shift(MON, 2)).current).toBe(1);
  });

  /*
   * RULE 1. A weekdays-only habit must not lose its streak over the weekend. Counting calendar
   * days rather than SCHEDULED days makes every non-daily habit impossible to keep, which is the
   * fastest way to make someone stop using a habit tracker.
   */
  it("survives days the habit was never due", () => {
    const workweek = [0, 1, 2, 3, 4].map((i) => shift(MON, i));
    const done = new Set([...workweek, shift(MON, 7)]); // Fri, then the next Monday
    // Saturday and Sunday are not due, so the run continues through them: 5 + 1.
    expect(summarise(weekdaysOnly, done, shift(MON, 7)).current).toBe(6);
  });

  it("survives a whole month for a monthly habit", () => {
    const monthly: RecurrenceRule = {
      kind: "MONTHLY_NTH",
      interval_days: null,
      weekdays: null,
      month_day: 15,
    };
    const done = new Set(["2026-06-15", "2026-07-15", "2026-08-15"]);
    expect(summarise(monthly, done, "2026-08-20").current).toBe(3);
  });

  /*
   * RULE 2. Today is not over. A streak that resets at midnight is wrong for most of every day,
   * and reads as a punishment for not having done the thing yet.
   */
  it("does not break because today is not ticked yet", () => {
    const done = new Set([shift(MON, -2), shift(MON, -1)]);
    const s = summarise(daily, done, MON);
    expect(s.current).toBe(2);
    expect(s.dueToday).toBe(true);
    expect(s.doneToday).toBe(false);
  });

  it("includes today once it is ticked", () => {
    const done = new Set([shift(MON, -1), MON]);
    const s = summarise(daily, done, MON);
    expect(s.current).toBe(2);
    expect(s.doneToday).toBe(true);
    expect(s.dueToday).toBe(false);
  });

  it("is zero for a habit never done", () => {
    const s = summarise(daily, new Set(), MON);
    expect(s.current).toBe(0);
    expect(s.longest).toBe(0);
    expect(s.dueToday).toBe(true);
  });

  it("follows an INTERVAL habit's own schedule", () => {
    // Due day 0, done. Next due day 3, done. Next due day 6, done. Nothing missed.
    const done = new Set([MON, shift(MON, 3), shift(MON, 6)]);
    expect(summarise(everyThree, done, shift(MON, 6)).current).toBe(3);
  });

  it("breaks an INTERVAL streak only once the day is genuinely past", () => {
    // Done day 0, next due day 3 — and it is now day 4 with nothing since. Day 3 is a real miss.
    const done = new Set([MON]);
    const s = summarise(everyThree, done, shift(MON, 4));
    expect(s.current).toBe(0);
    expect(s.missed).toBeGreaterThan(0);
  });
});

describe("longest streak", () => {
  it("finds the best run, not the last one", () => {
    const done = new Set([
      MON,
      shift(MON, 1),
      shift(MON, 2),
      shift(MON, 3),
      // gap on day 4
      shift(MON, 5),
    ]);
    const s = summarise(daily, done, shift(MON, 5));
    expect(s.longest).toBe(4);
    expect(s.current).toBe(1);
  });

  it("equals the current streak when the best run is still going", () => {
    const done = new Set([MON, shift(MON, 1), shift(MON, 2)]);
    const s = summarise(daily, done, shift(MON, 2));
    expect(s.longest).toBe(3);
    expect(s.current).toBe(3);
  });
});

describe("completion rate", () => {
  it("is completed due days over due days", () => {
    // Five days, three done, and today (day 4) is done too → 4/5.
    const done = new Set([MON, shift(MON, 2), shift(MON, 3), shift(MON, 4)]);
    expect(summarise(daily, done, shift(MON, 4)).rate).toBeCloseTo(4 / 5);
  });

  it("excludes an unanswered today from the denominator", () => {
    /*
     * Otherwise the rate drops every morning purely because the day has not happened yet — the
     * number would be at its worst at breakfast and recover by evening, which tells the user
     * nothing about their habit.
     */
    const done = new Set([shift(MON, -1)]);
    expect(summarise(daily, done, MON).rate).toBe(1);
  });

  it("is zero rather than NaN when nothing was ever due", () => {
    const impossible: RecurrenceRule = {
      kind: "INTERVAL",
      interval_days: 0,
      weekdays: null,
      month_day: null,
    };
    expect(summarise(impossible, new Set(), MON).rate).toBe(0);
  });

  it("ignores weekends for a weekdays habit", () => {
    // Mon–Fri all done; the weekend must not count against the rate.
    const done = new Set([0, 1, 2, 3, 4].map((i) => shift(MON, i)));
    expect(summarise(weekdaysOnly, done, shift(MON, 6)).rate).toBe(1);
  });
});

describe("heatmap", () => {
  it("marks due, completed and future separately", () => {
    const done = new Set([MON]);
    const cells = heatmap(weekdaysOnly, done, MON, shift(MON, 6), shift(MON, 2));

    expect(cells).toHaveLength(7);
    expect(cells[0]).toMatchObject({ day: MON, due: true, completed: true, future: false });
    // Tuesday: due and missed.
    expect(cells[1]).toMatchObject({ due: true, completed: false, future: false });
    // Wednesday is today.
    expect(cells[2]).toMatchObject({ due: true, completed: false, future: false });
    // Thursday onwards is the future — blank, not missed.
    expect(cells[3]).toMatchObject({ future: true });
    // Saturday and Sunday are not due at all.
    expect(cells[5]).toMatchObject({ due: false });
    expect(cells[6]).toMatchObject({ due: false });
  });

  it("distinguishes a day off from a day missed", () => {
    // The single most useful thing the picture can say, and a completions-only grid cannot.
    const cells = heatmap(weekdaysOnly, new Set(), MON, shift(MON, 6), shift(MON, 6));
    const missed = cells.filter((c) => c.due && !c.completed).length;
    const off = cells.filter((c) => !c.due).length;
    expect(missed).toBe(5);
    expect(off).toBe(2);
  });

  it("seeds INTERVAL from completions before the window", () => {
    /*
     * Without the seed the first cells of any window look overdue, so the heatmap would invent
     * misses that never happened — the most damaging kind of wrong for a motivational graphic.
     */
    const done = new Set([MON]);
    const cells = heatmap(everyThree, done, shift(MON, 1), shift(MON, 3), shift(MON, 3));
    expect(cells.map((c) => c.due)).toEqual([false, false, true]);
  });

  it("returns nothing for an inverted range", () => {
    expect(heatmap(daily, new Set(), shift(MON, 3), MON)).toEqual([]);
  });
});

describe("counters", () => {
  it("counts misses excluding today", () => {
    const done = new Set([MON]);
    // Days 1 and 2 missed; day 3 is today and unanswered, so it is not a miss.
    const s = summarise(daily, done, shift(MON, 3));
    expect(s.missed).toBe(2);
  });

  it("counts completions including ones on days that were not due", () => {
    // Ticked on a Saturday for a weekdays habit: it happened, so it is counted, even though it
    // does not affect the streak.
    const done = new Set([MON, shift(MON, 5)]);
    const s = summarise(weekdaysOnly, done, shift(MON, 5));
    expect(s.completions).toBe(2);
  });
});
