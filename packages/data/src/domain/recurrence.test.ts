import { describe, expect, it } from "vitest";

import type { DayKey } from "../time/tz";
import {
  type RecurrenceRule,
  describeRule,
  dueDays,
  isDueOn,
  nextDueOn,
  ruleColumns,
} from "./recurrence";

/**
 * 2026-08-10 is a Monday, which every weekday assertion below depends on. Stated here rather
 * than trusted: an off-by-one in `weekdayOf` would otherwise make these tests agree with the bug.
 */
const MON: DayKey = "2026-08-10";
const days = (start: DayKey, n: number): DayKey[] =>
  Array.from({ length: n }, (_, i) => shift(start, i));

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
const weekdays: RecurrenceRule = {
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
const monthly31: RecurrenceRule = {
  kind: "MONTHLY_NTH",
  interval_days: null,
  weekdays: null,
  month_day: 31,
};

describe("DAILY", () => {
  it("is due every day", () => {
    expect(days(MON, 10).every((d) => isDueOn(daily, d))).toBe(true);
  });
});

describe("WEEKDAYS", () => {
  it("is due Monday to Friday and not at the weekend", () => {
    const week = days(MON, 7).map((d) => isDueOn(weekdays, d));
    expect(week).toEqual([true, true, true, true, true, false, false]);
  });

  it("honours a custom set", () => {
    // Sunday and Saturday only.
    const weekend: RecurrenceRule = { ...weekdays, weekdays: [0, 6] };
    expect(days(MON, 7).map((d) => isDueOn(weekend, d))).toEqual([
      false, false, false, false, false, true, true,
    ]);
  });

  it("falls back to Mon–Fri on a malformed row rather than never firing", () => {
    // A null array violates the CHECK constraint, so it should be unreachable — but degrading
    // to "never due" would hide a broken habit for ever instead of showing something usable.
    const broken: RecurrenceRule = { ...weekdays, weekdays: null };
    expect(isDueOn(broken, MON)).toBe(true);
    expect(isDueOn(broken, shift(MON, 5))).toBe(false);
  });
});

describe("INTERVAL", () => {
  it("is due immediately when never completed", () => {
    // A habit you created and have not started is waiting on you, not "not yet scheduled".
    expect(isDueOn(everyThree, MON, new Set())).toBe(true);
  });

  it("counts from the last completion", () => {
    const done = new Set([MON]);
    expect(isDueOn(everyThree, shift(MON, 1), done)).toBe(false);
    expect(isDueOn(everyThree, shift(MON, 2), done)).toBe(false);
    expect(isDueOn(everyThree, shift(MON, 3), done)).toBe(true);
  });

  it("stays due once overdue instead of skipping to the next multiple", () => {
    /*
     * The behaviour a fixed calendar grid gets wrong. Done on Monday, then ignored: it must be
     * due on every subsequent day, not blink out on day 4 and reappear on day 6.
     */
    const done = new Set([MON]);
    for (const offset of [3, 4, 5, 6, 7]) {
      expect(isDueOn(everyThree, shift(MON, offset), done)).toBe(true);
    }
  });

  it("re-anchors on a late completion rather than staying behind the grid", () => {
    // Due Thursday, actually done Friday → next due is Monday, not Sunday. Anchoring on a fixed
    // grid would leave the user permanently a day late against their own habit.
    const done = new Set([MON, shift(MON, 4)]);
    expect(isDueOn(everyThree, shift(MON, 6), done)).toBe(false);
    expect(isDueOn(everyThree, shift(MON, 7), done)).toBe(true);
  });

  it("re-anchors on an early completion too", () => {
    const done = new Set([MON, shift(MON, 1)]);
    expect(isDueOn(everyThree, shift(MON, 3), done)).toBe(false);
    expect(isDueOn(everyThree, shift(MON, 4), done)).toBe(true);
  });

  it("treats a zero or missing interval as never due rather than every day", () => {
    // `interval_days >= 1` is enforced by the CHECK constraint; a 0 here would otherwise mean
    // `diffDays >= 0`, i.e. due every single day, which is a very loud way to fail.
    expect(isDueOn({ ...everyThree, interval_days: 0 }, MON, new Set())).toBe(false);
    expect(isDueOn({ ...everyThree, interval_days: null }, MON, new Set())).toBe(false);
  });
});

describe("MONTHLY_NTH", () => {
  it("fires on the given day of month", () => {
    const fifteenth: RecurrenceRule = { ...monthly31, month_day: 15 };
    expect(isDueOn(fifteenth, "2026-08-15")).toBe(true);
    expect(isDueOn(fifteenth, "2026-08-14")).toBe(false);
  });

  it("clamps the 31st to the last day of a short month", () => {
    // Otherwise a "the 31st" habit is silently skipped in four months of the year.
    expect(isDueOn(monthly31, "2026-02-28")).toBe(true);
    expect(isDueOn(monthly31, "2026-02-27")).toBe(false);
    expect(isDueOn(monthly31, "2026-04-30")).toBe(true);
    expect(isDueOn(monthly31, "2026-08-31")).toBe(true);
  });

  it("clamps to February 29 in a leap year", () => {
    expect(isDueOn(monthly31, "2028-02-29")).toBe(true);
    expect(isDueOn(monthly31, "2028-02-28")).toBe(false);
  });
});

describe("dueDays", () => {
  it("lists scheduled days across a range", () => {
    expect(dueDays(weekdays, MON, shift(MON, 6))).toEqual(days(MON, 5));
  });

  it("threads INTERVAL completions through the walk", () => {
    // Day 0 due (never done) → completed. Next due day 3 → completed. Then day 6.
    const done = new Set([MON, shift(MON, 3)]);
    expect(dueDays(everyThree, MON, shift(MON, 6), done)).toEqual([
      MON,
      shift(MON, 3),
      shift(MON, 6),
    ]);
  });

  it("re-anchors the walk on a late completion", () => {
    /*
     * The case that separates "last completion" from a fixed calendar grid. Done day 0, then
     * late on day 4: the next due day must be day 7, not day 6. Both are the same under a grid,
     * so a test where completions happen to land on schedule cannot tell the two apart.
     */
    const done = new Set([MON, shift(MON, 4)]);
    expect(dueDays(everyThree, MON, shift(MON, 8), done)).toEqual([
      MON,
      shift(MON, 3),
      shift(MON, 4),
      shift(MON, 7),
      shift(MON, 8),
    ]);
  });

  it("seeds INTERVAL from completions before the window", () => {
    /*
     * Without the seed, the first day of any range would look overdue for an INTERVAL habit,
     * which would make a heatmap invent misses that never happened.
     */
    const done = new Set([MON]);
    const from = shift(MON, 1);
    expect(dueDays(everyThree, from, shift(MON, 3), done)).toEqual([shift(MON, 3)]);
  });

  it("returns nothing for an inverted range", () => {
    expect(dueDays(daily, shift(MON, 3), MON)).toEqual([]);
  });

  it("agrees with isDueOn day by day", () => {
    // The two are separate implementations for INTERVAL; they must not disagree.
    const done = new Set([MON, shift(MON, 5)]);
    const range = days(MON, 14);
    const fromRange = new Set(dueDays(everyThree, MON, shift(MON, 13), done));
    const oneByOne = range.filter((d) => isDueOn(everyThree, d, done));
    expect([...fromRange]).toEqual(oneByOne);
  });
});

describe("nextDueOn", () => {
  it("returns today when today is due", () => {
    expect(nextDueOn(daily, MON)).toBe(MON);
  });

  it("skips the weekend", () => {
    expect(nextDueOn(weekdays, shift(MON, 5))).toBe(shift(MON, 7));
  });

  it("returns the interval offset from the last completion", () => {
    expect(nextDueOn(everyThree, shift(MON, 1), new Set([MON]))).toBe(shift(MON, 3));
  });

  it("returns the queried day when already overdue", () => {
    expect(nextDueOn(everyThree, shift(MON, 9), new Set([MON]))).toBe(shift(MON, 9));
  });

  it("gives up rather than looping on an impossible rule", () => {
    expect(nextDueOn({ ...everyThree, interval_days: 0 }, MON)).toBeNull();
    expect(nextDueOn({ ...monthly31, month_day: null }, MON)).toBeNull();
  });
});

describe("ruleColumns", () => {
  it("clears every field that does not belong to the kind", () => {
    /*
     * `habit_params_match_kind` rejects leftovers, so switching INTERVAL → DAILY must null
     * `interval_days`. A partial patch would appear to work locally and then fail server-side,
     * long after the user moved on.
     */
    expect(ruleColumns("DAILY")).toEqual({
      kind: "DAILY",
      interval_days: null,
      weekdays: null,
      month_day: null,
    });
    expect(ruleColumns("INTERVAL", { intervalDays: 4 })).toEqual({
      kind: "INTERVAL",
      interval_days: 4,
      weekdays: null,
      month_day: null,
    });
  });

  it("normalises weekdays to a sorted unique 0–6 set", () => {
    expect(ruleColumns("WEEKDAYS", { weekdays: [5, 1, 1, 9, -2, 3] }).weekdays).toEqual([1, 3, 5]);
  });

  it("never emits an empty weekday array", () => {
    // `array_length(weekdays, 1) between 1 and 7` would reject it.
    expect(ruleColumns("WEEKDAYS", { weekdays: [] }).weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(ruleColumns("WEEKDAYS", { weekdays: [42] }).weekdays).toEqual([1, 2, 3, 4, 5]);
  });

  it("clamps the interval and the day of month into their constraints", () => {
    expect(ruleColumns("INTERVAL", { intervalDays: 0 }).interval_days).toBe(1);
    expect(ruleColumns("MONTHLY_NTH", { monthDay: 0 }).month_day).toBe(1);
    expect(ruleColumns("MONTHLY_NTH", { monthDay: 99 }).month_day).toBe(31);
  });
});

describe("describeRule", () => {
  it("names the common weekday shapes", () => {
    expect(describeRule(weekdays)).toBe("Weekdays");
    expect(describeRule({ ...weekdays, weekdays: [0, 6] })).toBe("Weekends");
    expect(describeRule({ ...weekdays, weekdays: [1, 3] })).toBe("Mon, Wed");
    expect(describeRule({ ...weekdays, weekdays: [0, 1, 2, 3, 4, 5, 6] })).toBe("Every day");
  });

  it("describes intervals and monthly days", () => {
    expect(describeRule(daily)).toBe("Every day");
    expect(describeRule(everyThree)).toBe("Every 3 days");
    expect(describeRule({ ...everyThree, interval_days: 1 })).toBe("Every day");
    expect(describeRule({ ...monthly31, month_day: 1 })).toBe("Monthly on the 1st");
    expect(describeRule({ ...monthly31, month_day: 2 })).toBe("Monthly on the 2nd");
    expect(describeRule({ ...monthly31, month_day: 3 })).toBe("Monthly on the 3rd");
    expect(describeRule({ ...monthly31, month_day: 4 })).toBe("Monthly on the 4th");
  });

  it("gets the teens right", () => {
    // 11th/12th/13th are the cases a bare `n % 10` turns into 11st, 12nd, 13rd.
    expect(describeRule({ ...monthly31, month_day: 11 })).toBe("Monthly on the 11th");
    expect(describeRule({ ...monthly31, month_day: 12 })).toBe("Monthly on the 12th");
    expect(describeRule({ ...monthly31, month_day: 13 })).toBe("Monthly on the 13th");
    expect(describeRule({ ...monthly31, month_day: 21 })).toBe("Monthly on the 21st");
  });
});
