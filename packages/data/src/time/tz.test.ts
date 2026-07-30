import { describe, expect, it } from "vitest";

import {
  APP_TIMEZONE,
  addDays,
  atMinutesIntoDay,
  dayKeyOf,
  dayRange,
  daysInMonth,
  diffDays,
  eachDay,
  endOfDay,
  hourOf,
  isDayKey,
  isWeekday,
  minutesIntoDay,
  monthlyNthOccurrence,
  parseDayKey,
  previousDay,
  startOfDay,
  startOfWeek,
  todayKey,
  weekdayOf,
} from "./tz";

/**
 * Phnom Penh is UTC+7 with no DST, so a local day runs 17:00Z the previous day → 17:00Z.
 * These tests are written to fail loudly if anything falls back to the host timezone;
 * `pnpm --filter @rainflow/data test:tz` runs the same suite under TZ=Pacific/Kiritimati
 * (UTC+14), which would break every boundary assertion if the host TZ leaked in.
 */

describe("dayKeyOf", () => {
  it("uses the app timezone, not UTC", () => {
    // 22:30 UTC on the 14th is already 05:30 on the 15th in Phnom Penh.
    expect(dayKeyOf(new Date("2026-07-14T22:30:00Z"))).toBe("2026-07-15");
  });

  it("uses the app timezone, not the host timezone", () => {
    // 18:00Z is the 16th in Phnom Penh (+7) but the 17th in Kiritimati (+14).
    // If the host TZ leaked in, this would read 2026-07-17 under the tz-shifted run.
    expect(dayKeyOf(new Date("2026-07-16T18:00:00Z"))).toBe("2026-07-17");
    expect(dayKeyOf(new Date("2026-07-16T16:00:00Z"))).toBe("2026-07-16");
  });

  it("puts the day boundary at 17:00Z", () => {
    expect(dayKeyOf(new Date("2026-03-09T16:59:59.999Z"))).toBe("2026-03-09");
    expect(dayKeyOf(new Date("2026-03-09T17:00:00.000Z"))).toBe("2026-03-10");
  });

  it("is never derived from toISOString", () => {
    // The classic bug: `.toISOString().slice(0,10)` would give 2026-01-01 here.
    const instant = new Date("2026-01-01T02:00:00Z"); // 09:00 local, same day
    expect(dayKeyOf(instant)).toBe("2026-01-01");
    // ...and would give 2025-12-31 here, where local is already the 1st.
    expect(dayKeyOf(new Date("2025-12-31T17:00:00Z"))).toBe("2026-01-01");
  });

  it("agrees with todayKey", () => {
    const now = new Date();
    expect(todayKey(now)).toBe(dayKeyOf(now));
  });
});

describe("startOfDay / endOfDay", () => {
  it("resolves local midnight to 17:00Z the previous day", () => {
    expect(startOfDay("2026-07-15").toISOString()).toBe("2026-07-14T17:00:00.000Z");
  });

  it("ends one millisecond before the next day begins", () => {
    expect(endOfDay("2026-07-15").toISOString()).toBe("2026-07-15T16:59:59.999Z");
  });

  it("round-trips through dayKeyOf at both edges", () => {
    for (const key of ["2026-01-01", "2026-02-28", "2026-06-30", "2026-12-31"]) {
      expect(dayKeyOf(startOfDay(key))).toBe(key);
      expect(dayKeyOf(endOfDay(key))).toBe(key);
    }
  });

  it("produces a half-open range that exactly tiles consecutive days", () => {
    const a = dayRange("2026-07-15");
    const b = dayRange("2026-07-16");
    expect(a.end.getTime()).toBe(b.start.getTime());
    expect(b.start.getTime() - a.start.getTime()).toBe(86_400_000);
  });

  it("spans exactly 24 hours", () => {
    const { start, end } = dayRange("2026-07-15");
    expect(end.getTime() - start.getTime()).toBe(86_400_000);
  });
});

describe("parseDayKey / isDayKey", () => {
  it("accepts well-formed keys", () => {
    expect(parseDayKey("2026-02-28")).toEqual({ year: 2026, month: 2, day: 28 });
    expect(isDayKey("2026-02-28")).toBe(true);
  });

  it("rejects malformed and impossible dates", () => {
    for (const bad of [
      "2026-2-28",
      "26-02-28",
      "2026-02-28T00:00:00Z",
      "2026-13-01",
      "2026-00-10",
      "2026-02-30",
      "2026-04-31",
      "",
      "not-a-date",
    ]) {
      expect(isDayKey(bad), bad).toBe(false);
      expect(() => parseDayKey(bad), bad).toThrow(RangeError);
    }
  });

  it("accepts Feb 29 in a leap year and rejects it otherwise", () => {
    expect(isDayKey("2028-02-29")).toBe(true);
    expect(isDayKey("2026-02-29")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isDayKey(undefined)).toBe(false);
    expect(isDayKey(20260228)).toBe(false);
    expect(isDayKey(new Date())).toBe(false);
  });
});

describe("addDays / diffDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
  });

  it("handles leap years", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(diffDays("2028-01-01", "2029-01-01")).toBe(366);
    expect(diffDays("2026-01-01", "2027-01-01")).toBe(365);
  });

  it("is the inverse of diffDays", () => {
    const base = "2026-07-15";
    for (const n of [-400, -31, -1, 0, 1, 31, 400]) {
      expect(diffDays(base, addDays(base, n))).toBe(n);
    }
  });

  it("returns a negative diff for an inverted pair", () => {
    expect(diffDays("2026-07-15", "2026-07-10")).toBe(-5);
  });
});

describe("weekdayOf / isWeekday", () => {
  it("maps 0 to Sunday, matching habit.weekdays", () => {
    // 2026-07-30 is a Thursday.
    expect(weekdayOf("2026-07-30")).toBe(4);
    expect(weekdayOf("2026-08-01")).toBe(6); // Saturday
    expect(weekdayOf("2026-08-02")).toBe(0); // Sunday
  });

  it("treats Mon-Fri as weekdays", () => {
    expect(isWeekday("2026-07-31")).toBe(true); // Friday
    expect(isWeekday("2026-08-01")).toBe(false); // Saturday
    expect(isWeekday("2026-08-02")).toBe(false); // Sunday
    expect(isWeekday("2026-08-03")).toBe(true); // Monday
  });
});

describe("monthlyNthOccurrence", () => {
  it("resolves a day that exists in the month", () => {
    expect(monthlyNthOccurrence("2026-07-01", 15)).toBe("2026-07-15");
  });

  it("clamps to the last day rather than skipping the month", () => {
    expect(monthlyNthOccurrence("2026-02-10", 31)).toBe("2026-02-28");
    expect(monthlyNthOccurrence("2028-02-10", 31)).toBe("2028-02-29");
    expect(monthlyNthOccurrence("2026-04-10", 31)).toBe("2026-04-30");
    expect(monthlyNthOccurrence("2026-06-01", 31)).toBe("2026-06-30");
  });

  it("rejects out-of-range days", () => {
    for (const bad of [0, 32, -1, 1.5]) {
      expect(() => monthlyNthOccurrence("2026-07-01", bad)).toThrow(RangeError);
    }
  });
});

describe("startOfWeek", () => {
  it("returns the Monday of the containing week", () => {
    expect(startOfWeek("2026-07-30")).toBe("2026-07-27"); // Thu -> Mon
    expect(startOfWeek("2026-07-27")).toBe("2026-07-27"); // Mon -> itself
  });

  it("treats Sunday as the end of the week, not the start", () => {
    expect(startOfWeek("2026-08-02")).toBe("2026-07-27"); // Sun -> preceding Mon
  });
});

describe("eachDay", () => {
  it("is inclusive of both ends", () => {
    expect(eachDay("2026-07-15", "2026-07-18")).toEqual([
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
    ]);
  });

  it("returns a single day for an identical range", () => {
    expect(eachDay("2026-07-15", "2026-07-15")).toEqual(["2026-07-15"]);
  });

  it("throws on an inverted range", () => {
    expect(() => eachDay("2026-07-18", "2026-07-15")).toThrow(RangeError);
  });

  it("spans a full non-leap year", () => {
    expect(eachDay("2026-01-01", "2026-12-31")).toHaveLength(365);
  });
});

describe("minutesIntoDay / atMinutesIntoDay", () => {
  it("measures from local midnight", () => {
    expect(minutesIntoDay(new Date("2026-07-14T17:00:00Z"))).toBe(0);
    expect(minutesIntoDay(new Date("2026-07-15T08:00:00Z"))).toBe(15 * 60); // 15:00 local
  });

  it("round-trips", () => {
    for (const minutes of [0, 1, 9 * 60 + 30, 23 * 60 + 59]) {
      expect(minutesIntoDay(atMinutesIntoDay("2026-07-15", minutes))).toBe(minutes);
    }
  });

  it("stays within the day it was anchored to", () => {
    expect(dayKeyOf(atMinutesIntoDay("2026-07-15", 0))).toBe("2026-07-15");
    expect(dayKeyOf(atMinutesIntoDay("2026-07-15", 23 * 60 + 59))).toBe("2026-07-15");
  });
});

describe("hourOf", () => {
  it("returns the local wall-clock hour for focus-hour bucketing", () => {
    expect(hourOf(new Date("2026-07-15T02:15:00Z"))).toBe(9); // 09:15 local
    expect(hourOf(new Date("2026-07-14T17:30:00Z"))).toBe(0); // 00:30 local
  });
});

describe("daysInMonth", () => {
  it("handles February across leap and non-leap years", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
  });

  it("handles 30- and 31-day months", () => {
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe("timezone pinning", () => {
  it("is Asia/Phnom_Penh", () => {
    expect(APP_TIMEZONE).toBe("Asia/Phnom_Penh");
  });

  it("does not vary with the host timezone", () => {
    // Whatever TZ the suite runs under, local midnight is always 17:00Z the day before.
    // This is the assertion that would break if the host TZ leaked into the module.
    for (const key of ["2026-01-15", "2026-07-15", "2026-11-15"]) {
      const iso = startOfDay(key).toISOString();
      expect(iso.endsWith("T17:00:00.000Z")).toBe(true);
    }
  });
});
