import { describe, expect, it } from "vitest";

import { atMinutesIntoDay, type DayKey } from "../time/tz";
import type {
  FocusSessionRow,
  HabitLogRow,
  HabitRow,
  TaskRow,
  TimeBlockRow,
} from "../wire";
import {
  energyByHour,
  focusByDay,
  focusByHour,
  formatHour,
  formatMinutes,
  habitConsistency,
  plannedVsActual,
  topFocusHours,
  velocity,
  weeklyDigest,
} from "./analytics";

/** 2026-08-10 is a Monday, so it is also the start of its week. */
const MON: DayKey = "2026-08-10";

function shift(day: DayKey, n: number): DayKey {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const sync = {
  updated_at: "2026-08-10T00:00:00.000Z",
  client_updated_at: "2026-08-10T00:00:00.000Z",
  deleted_at: null,
  client_id: "dev",
};

/** A focus session starting at `minute` on `day`, lasting `mins` of genuine work. */
function session(
  day: DayKey,
  minute: number,
  mins: number,
  overrides: Partial<FocusSessionRow> = {},
): FocusSessionRow {
  return {
    id: overrides.id ?? `f-${day}-${minute}`,
    task_id: null,
    started_at: atMinutesIntoDay(day, minute).toISOString(),
    ended_at: atMinutesIntoDay(day, minute + mins).toISOString(),
    planned_mins: 25,
    actual_secs: mins * 60,
    was_completed: true,
    phase: "FOCUS",
    energy: null,
    notes: null,
    ...sync,
    ...overrides,
  };
}

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: overrides.id ?? "t1",
    title: "A task",
    description: null,
    status: "TODAY",
    is_urgent: false,
    is_important: false,
    estimated_mins: null,
    due_at: null,
    due_is_all_day: true,
    completed_at: null,
    parent_id: null,
    sort_order: 0,
    ...sync,
    ...overrides,
  };
}

function block(day: DayKey, minute: number, mins: number, taskId = "t1"): TimeBlockRow {
  return {
    id: `b-${day}-${minute}`,
    task_id: taskId,
    starts_at: atMinutesIntoDay(day, minute).toISOString(),
    ends_at: atMinutesIntoDay(day, minute + mins).toISOString(),
    ...sync,
  };
}

function habit(overrides: Partial<HabitRow> = {}): HabitRow {
  return {
    id: overrides.id ?? "h1",
    title: "A habit",
    description: null,
    kind: "DAILY",
    interval_days: null,
    weekdays: null,
    month_day: null,
    target_per_period: 1,
    color: "#34d399",
    archived_at: null,
    ...sync,
    ...overrides,
  };
}

function log(habitId: string, day: DayKey): HabitLogRow {
  return {
    id: `l-${habitId}-${day}`,
    habit_id: habitId,
    log_date: day,
    completed_at: `${day}T09:00:00.000Z`,
    ...sync,
  };
}

describe("focus time", () => {
  it("sums actual minutes per day and keeps empty days", () => {
    const rows = focusByDay([session(MON, 540, 25), session(MON, 600, 50)], MON, shift(MON, 2));

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ day: MON, minutes: 75, sessions: 2 });
    /*
     * Zero-days are kept deliberately. A chart that omits them compresses a week with two good
     * days into something that looks like consistent work.
     */
    expect(rows[1]).toMatchObject({ minutes: 0, sessions: 0 });
  });

  it("counts only FOCUS sessions, never breaks", () => {
    const rows = focusByDay(
      [
        session(MON, 540, 25),
        session(MON, 570, 5, { id: "brk", phase: "SHORT_BREAK" }),
        session(MON, 600, 15, { id: "lng", phase: "LONG_BREAK" }),
      ],
      MON,
      MON,
    );

    // Break rows exist so §3.4 can tell a break taken from one skipped; counting them here
    // would inflate every figure in the digest.
    expect(rows[0]!.minutes).toBe(25);
    expect(rows[0]!.sessions).toBe(1);
  });

  it("ignores tombstoned sessions", () => {
    const rows = focusByDay(
      [session(MON, 540, 25, { deleted_at: "2026-08-11T00:00:00Z" })],
      MON,
      MON,
    );
    expect(rows[0]!.minutes).toBe(0);
  });

  it("uses actual_secs, not the wall-clock span", () => {
    /*
     * A session paused for lunch has ended_at long after started_at. Deriving the duration from
     * those two would count the break as focus — the pomodoro store banks only running segments
     * into actual_secs precisely so this stays honest.
     */
    const paused = session(MON, 540, 25, {
      ended_at: atMinutesIntoDay(MON, 540 + 180).toISOString(),
    });
    expect(focusByDay([paused], MON, MON)[0]!.minutes).toBe(25);
  });

  it("excludes sessions outside the range", () => {
    const rows = focusByDay([session(shift(MON, -1), 540, 60)], MON, shift(MON, 1));
    expect(rows.every((r) => r.minutes === 0)).toBe(true);
  });
});

describe("focus by hour", () => {
  it("buckets by wall-clock hour in the app timezone", () => {
    // 09:00 in Phnom Penh is 02:00 UTC. Reading UTC hours would put this in bucket 2 and make
    // the whole chart a lie for anyone not on UTC.
    const buckets = focusByHour([session(MON, 9 * 60, 30)], MON, MON);
    expect(buckets[9]).toMatchObject({ hour: 9, minutes: 30, sessions: 1 });
    expect(buckets[2]!.minutes).toBe(0);
  });

  it("always returns all 24 buckets", () => {
    expect(focusByHour([], MON, MON)).toHaveLength(24);
  });

  it("ranks top hours and breaks ties deterministically", () => {
    const buckets = focusByHour(
      [
        session(MON, 9 * 60, 30),
        session(MON, 14 * 60, 30, { id: "b" }),
        session(MON, 20 * 60, 60, { id: "c" }),
      ],
      MON,
      MON,
    );

    const top = topFocusHours(buckets, 3);
    expect(top.map((b) => b.hour)).toEqual([20, 9, 14]);
  });

  it("omits hours with no focus from the ranking", () => {
    expect(topFocusHours(focusByHour([], MON, MON))).toEqual([]);
  });
});

describe("energy by hour", () => {
  it("averages the rated sessions", () => {
    const rows = energyByHour(
      [
        session(MON, 9 * 60, 25, { id: "a", energy: "HIGH" }),
        session(MON, 9 * 60 + 30, 25, { id: "b", energy: "MEDIUM" }),
      ],
      MON,
      MON,
    );

    expect(rows[9]).toMatchObject({ score: 2.5, samples: 2 });
  });

  it("reports null rather than zero for an hour never worked", () => {
    /*
     * Zero would plot as rock-bottom energy at 3am for someone who has simply never worked at
     * 3am, and the chart would advise avoiding hours that were never tried.
     */
    const rows = energyByHour([session(MON, 9 * 60, 25, { energy: "HIGH" })], MON, MON);
    expect(rows[3]).toMatchObject({ score: null, samples: 0 });
  });

  it("ignores sessions with no rating", () => {
    const rows = energyByHour([session(MON, 9 * 60, 25)], MON, MON);
    expect(rows[9]).toMatchObject({ score: null, samples: 0 });
  });
});

describe("planned vs actual", () => {
  it("compares blocked time against focused time", () => {
    const result = plannedVsActual(
      [block(MON, 9 * 60, 120)],
      [session(MON, 9 * 60, 90, { task_id: "t1" })],
      [task({ id: "t1", estimated_mins: 60 })],
      MON,
      MON,
    );

    expect(result.plannedMinutes).toBe(120);
    expect(result.actualMinutes).toBe(90);
    expect(result.ratio).toBeCloseTo(0.75);
  });

  it("reports null ratio rather than dividing by zero", () => {
    const result = plannedVsActual([], [session(MON, 540, 25)], [], MON, MON);
    expect(result.ratio).toBeNull();
    expect(result.actualMinutes).toBe(25);
  });

  it("attributes time per task and names a deleted one honestly", () => {
    const result = plannedVsActual(
      [],
      [
        session(MON, 540, 30, { id: "a", task_id: "t1" }),
        session(MON, 600, 45, { id: "b", task_id: "gone" }),
      ],
      [task({ id: "t1", title: "Real task", estimated_mins: 60 })],
      MON,
      MON,
    );

    expect(result.tasks).toEqual([
      { taskId: "gone", title: "Deleted task", estimatedMins: null, actualMins: 45 },
      { taskId: "t1", title: "Real task", estimatedMins: 60, actualMins: 30 },
    ]);
  });

  it("counts a bare pomodoro toward the total but not toward any task", () => {
    const result = plannedVsActual([], [session(MON, 540, 25)], [], MON, MON);
    expect(result.actualMinutes).toBe(25);
    expect(result.tasks).toEqual([]);
  });
});

describe("velocity", () => {
  it("counts completions by their completion day", () => {
    const v = velocity(
      [
        task({ id: "a", completed_at: atMinutesIntoDay(MON, 600).toISOString() }),
        task({ id: "b", completed_at: atMinutesIntoDay(shift(MON, 1), 600).toISOString() }),
        task({ id: "c" }),
      ],
      MON,
      shift(MON, 1),
    );

    expect(v.completed).toBe(2);
    expect(v.perDay).toBe(1);
    expect(v.byDay).toEqual([
      { day: MON, completed: 1 },
      { day: shift(MON, 1), completed: 1 },
    ]);
  });

  it("uses the app timezone for the completion day", () => {
    // 23:30 Phnom Penh is 16:30 UTC the same day, but 00:30 UTC would be the NEXT day for
    // anything after 17:00 local — the classic off-by-one this guards.
    const late = task({ id: "a", completed_at: atMinutesIntoDay(MON, 23 * 60 + 30).toISOString() });
    expect(velocity([late], MON, MON).completed).toBe(1);
  });

  it("ignores tombstones", () => {
    const v = velocity(
      [
        task({
          completed_at: atMinutesIntoDay(MON, 600).toISOString(),
          deleted_at: "2026-08-11T00:00:00Z",
        }),
      ],
      MON,
      MON,
    );
    expect(v.completed).toBe(0);
  });
});

describe("habit consistency", () => {
  it("averages each habit's own rate rather than pooling occurrences", () => {
    /*
     * The rule that matters. Pooling total completions over total due days lets one daily habit
     * outvote five weekly ones purely by having more occurrences, so a perfect week on everything
     * except the daily one would read as a bad week.
     */
    const daily = habit({ id: "d", title: "Daily" });
    const weekly = habit({
      id: "w",
      title: "Weekly",
      kind: "WEEKDAYS",
      weekdays: [1],
    });

    // Daily: done 1 of 5 days. Weekly (Mondays only): done its single occurrence.
    const logs = [log("d", MON), log("w", MON)];
    const result = habitConsistency([daily, weekly], logs, shift(MON, 4), 7);

    // Pooled would be 2/6 ≈ 0.33. Averaged is (0.25 + 1) / 2 ≈ 0.63.
    expect(result.rate).toBeGreaterThan(0.5);
    expect(result.habits.map((h) => h.id)).toEqual(["w", "d"]);
  });

  it("excludes archived habits", () => {
    // §3.4 archiving means "stop tracking"; scoring something you deliberately stopped is
    // exactly the wrong signal.
    const result = habitConsistency(
      [habit({ id: "a", archived_at: "2026-08-01T00:00:00Z" })],
      [],
      MON,
      7,
    );
    expect(result.habits).toEqual([]);
    expect(result.rate).toBe(0);
  });

  it("is zero rather than NaN with no habits", () => {
    expect(habitConsistency([], [], MON).rate).toBe(0);
  });
});

describe("weekly digest", () => {
  const input = {
    tasks: [task({ id: "t1", completed_at: atMinutesIntoDay(MON, 600).toISOString() })],
    blocks: [block(MON, 9 * 60, 60)],
    sessions: [
      session(MON, 9 * 60, 45, { id: "s1", task_id: "t1", energy: "HIGH" }),
      // Previous week.
      session(shift(MON, -6), 9 * 60, 20, { id: "s0" }),
    ],
    habits: [habit({ id: "h1" })],
    logs: [log("h1", MON)],
  };

  it("covers Monday to Sunday of the week containing the given day", () => {
    // Asked about a Thursday, it must still report that Monday's week.
    const digest = weeklyDigest(input, shift(MON, 3));
    expect(digest.weekStart).toBe(MON);
    expect(digest.weekEnd).toBe(shift(MON, 6));
  });

  it("reports focus, velocity and top hours for the week", () => {
    const digest = weeklyDigest(input, MON);
    expect(digest.focusMinutes).toBe(45);
    expect(digest.focusSessions).toBe(1);
    expect(digest.velocity.completed).toBe(1);
    expect(digest.topHours[0]).toMatchObject({ hour: 9, minutes: 45 });
  });

  it("includes the previous week so a number has something to mean", () => {
    // "4 hours of focus" says nothing without knowing whether last week was two or ten.
    const digest = weeklyDigest(input, MON);
    expect(digest.previous).toMatchObject({ focusMinutes: 20 });
  });

  it("excludes the previous week's focus from this week's total", () => {
    expect(weeklyDigest(input, MON).focusMinutes).toBe(45);
  });

  it("can skip the comparison", () => {
    expect(weeklyDigest(input, MON, false).previous).toBeNull();
  });

  it("survives a completely empty history", () => {
    const digest = weeklyDigest(
      { tasks: [], blocks: [], sessions: [], habits: [], logs: [] },
      MON,
    );
    expect(digest.focusMinutes).toBe(0);
    expect(digest.velocity.completed).toBe(0);
    expect(digest.consistency.rate).toBe(0);
    expect(digest.topHours).toEqual([]);
    expect(digest.plannedVsActual.ratio).toBeNull();
  });
});

describe("formatting", () => {
  it("formats minutes as hours and minutes", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(95)).toBe("1h 35m");
    expect(formatMinutes(-5)).toBe("0m");
  });

  it("formats hours for an axis label", () => {
    expect(formatHour(0)).toBe("12am");
    expect(formatHour(9)).toBe("9am");
    expect(formatHour(12)).toBe("12pm");
    expect(formatHour(14)).toBe("2pm");
    expect(formatHour(23)).toBe("11pm");
  });
});
