import { describe, expect, it } from "vitest";

import { atMinutesIntoDay, startOfDay } from "../time/tz";
import type { TimeBlockRow } from "../wire";
import {
  DAY_MINUTES,
  SLOT_MINUTES,
  daySpanOf,
  durationMinutes,
  formatMinutes,
  layoutDay,
  nowLineMinutes,
  placeBlock,
  scheduledMinutes,
  snapToSlot,
} from "./schedule";

/**
 * These tests run under three host timezones (see the `test:tz` script). That is the point of
 * them: every assertion below is about wall-clock position in `Asia/Phnom_Penh`, and any use of
 * host-local date methods in schedule.ts would make them pass in one zone and fail in another.
 */

const DAY = "2026-08-12";

/** A block from `startMin` to `endMin` on `day`, minutes into the local day. */
function block(
  startMin: number,
  endMin: number,
  overrides: Partial<TimeBlockRow> = {},
): TimeBlockRow {
  return {
    id: overrides.id ?? `b-${startMin}-${endMin}`,
    task_id: overrides.task_id ?? "t1",
    starts_at: atMinutesIntoDay(DAY, startMin).toISOString(),
    ends_at: atMinutesIntoDay(DAY, endMin).toISOString(),
    updated_at: "2026-08-12T00:00:00.000Z",
    client_updated_at: "2026-08-12T00:00:00.000Z",
    deleted_at: null,
    client_id: "dev-a",
    ...overrides,
  };
}

describe("daySpanOf", () => {
  it("places a block at its wall-clock minutes, not its UTC ones", () => {
    // 09:00–10:30 in Phnom Penh is 02:00–03:30 UTC. Anything reading UTC hours puts this at
    // the top of the grid instead of mid-morning.
    const span = daySpanOf(block(9 * 60, 10 * 60 + 30), DAY);
    expect(span).toEqual({
      startMin: 540,
      endMin: 630,
      clippedStart: false,
      clippedEnd: false,
    });
  });

  it("returns null for a block on another day", () => {
    expect(daySpanOf(block(60, 120), "2026-08-13")).toBeNull();
    expect(daySpanOf(block(60, 120), "2026-08-11")).toBeNull();
  });

  it("clips a block that started yesterday", () => {
    const start = new Date(startOfDay(DAY).getTime() - 90 * 60_000);
    const b = block(0, 60, { starts_at: start.toISOString() });

    expect(daySpanOf(b, DAY)).toMatchObject({
      startMin: 0,
      endMin: 60,
      clippedStart: true,
      clippedEnd: false,
    });
  });

  it("clips a block that runs into tomorrow", () => {
    const end = new Date(startOfDay("2026-08-13").getTime() + 90 * 60_000);
    const b = block(23 * 60, 0, { ends_at: end.toISOString() });

    expect(daySpanOf(b, DAY)).toMatchObject({
      startMin: 23 * 60,
      endMin: DAY_MINUTES,
      clippedStart: false,
      clippedEnd: true,
    });
  });

  /*
   * The midnight boundary, both sides. `dayRange` is half-open, so a block ending exactly at
   * midnight belongs to the day that is ending and one starting exactly at midnight belongs to
   * the day beginning. Get either wrong and every midnight-aligned block renders on two days.
   */
  it("assigns a block ending at midnight to the day that is ending", () => {
    const b = block(22 * 60, DAY_MINUTES);
    expect(daySpanOf(b, DAY)?.endMin).toBe(DAY_MINUTES);
    expect(daySpanOf(b, "2026-08-13")).toBeNull();
  });

  it("assigns a block starting at midnight to the day that is beginning", () => {
    const b = block(DAY_MINUTES, DAY_MINUTES + 60);
    expect(daySpanOf(b, DAY)).toBeNull();
    expect(daySpanOf(b, "2026-08-13")?.startMin).toBe(0);
  });

  it("rejects an unparseable timestamp rather than rendering NaN", () => {
    expect(daySpanOf(block(60, 120, { starts_at: "not a date" }), DAY)).toBeNull();
  });
});

describe("layoutDay", () => {
  it("gives a lone block the full width", () => {
    const [only] = layoutDay([block(540, 600)], DAY);
    expect(only).toMatchObject({ column: 0, columns: 1 });
  });

  it("splits two overlapping blocks side by side", () => {
    const laid = layoutDay([block(540, 660), block(600, 720)], DAY);
    expect(laid.map((b) => [b.column, b.columns])).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });

  it("reuses a column once the earlier block has ended", () => {
    // A overlaps B; C starts after A ends, so C can sit in A's column.
    const laid = layoutDay([block(540, 600), block(570, 700), block(610, 660)], DAY);
    const byId = new Map(laid.map((b) => [b.block.id, b]));

    expect(byId.get("b-540-600")).toMatchObject({ column: 0 });
    expect(byId.get("b-570-700")).toMatchObject({ column: 1 });
    expect(byId.get("b-610-660")).toMatchObject({ column: 0 });
    // All three are one cluster, so all three render at the same width.
    expect(new Set(laid.map((b) => b.columns))).toEqual(new Set([2]));
  });

  /*
   * The regression this guards: closing a cluster on the PREVIOUS block's end rather than the
   * maximum end so far. A long block followed by short ones nested inside it would close the
   * cluster early, and the short ones would render full-width straight over the long one.
   */
  it("keeps blocks nested inside a long one in the same cluster", () => {
    const laid = layoutDay([block(540, 900), block(560, 580), block(600, 620)], DAY);
    expect(laid.every((b) => b.columns === 2)).toBe(true);
  });

  it("treats touching blocks as non-overlapping", () => {
    // 09:00–10:00 and 10:00–11:00 are back-to-back, not a double booking.
    const laid = layoutDay([block(540, 600), block(600, 660)], DAY);
    expect(laid.every((b) => b.columns === 1 && b.column === 0)).toBe(true);
  });

  it("skips tombstones", () => {
    const laid = layoutDay(
      [block(540, 600, { deleted_at: "2026-08-12T05:00:00.000Z" })],
      DAY,
    );
    expect(laid).toEqual([]);
  });

  it("orders identically regardless of input order", () => {
    const a = block(540, 600, { id: "aaa" });
    const b = block(540, 600, { id: "bbb" });
    // Same start and same end: only the id can break the tie, and it must break it the same way
    // on every device or two peers draw the same day differently.
    expect(layoutDay([a, b], DAY).map((x) => x.block.id)).toEqual(
      layoutDay([b, a], DAY).map((x) => x.block.id),
    );
  });
});

describe("snapToSlot and placeBlock", () => {
  it("snaps to the nearest slot", () => {
    expect(snapToSlot(0)).toBe(0);
    expect(snapToSlot(7)).toBe(0);
    expect(snapToSlot(8)).toBe(SLOT_MINUTES);
    expect(snapToSlot(541)).toBe(540);
  });

  it("clamps outside the day", () => {
    expect(snapToSlot(-30)).toBe(0);
    expect(snapToSlot(DAY_MINUTES + 30)).toBe(DAY_MINUTES);
  });

  it("preserves duration when placing", () => {
    const placed = placeBlock(DAY, 541, 45);
    expect(durationMinutes({ ...block(0, 0), ...placed })).toBe(45);
    expect(daySpanOf({ ...block(0, 0), ...placed }, DAY)?.startMin).toBe(540);
  });

  it("pulls a block back so it fits inside the day", () => {
    // Dropped at 23:30 with a 90-minute length: start at 22:30 rather than spilling past
    // midnight, because the grid only has one day on it.
    const placed = placeBlock(DAY, 23 * 60 + 30, 90);
    const span = daySpanOf({ ...block(0, 0), ...placed }, DAY);
    expect(span).toMatchObject({ startMin: 22 * 60 + 30, endMin: DAY_MINUTES });
  });

  it("never produces a zero-length block", () => {
    // The DB constraint is `ends_at > starts_at`; a row it would reject must not be built.
    const placed = placeBlock(DAY, 540, 0);
    expect(durationMinutes({ ...block(0, 0), ...placed })).toBe(SLOT_MINUTES);
  });
});

describe("scheduledMinutes", () => {
  it("sums disjoint blocks", () => {
    expect(scheduledMinutes([block(540, 600), block(660, 720)], DAY)).toBe(120);
  });

  it("counts overlapping time once", () => {
    // Two 90-minute blocks on top of each other is a double booking, not three hours of work.
    expect(scheduledMinutes([block(540, 630), block(570, 660)], DAY)).toBe(120);
  });

  it("counts a fully-nested block once", () => {
    expect(scheduledMinutes([block(540, 720), block(560, 580)], DAY)).toBe(180);
  });

  it("ignores blocks from other days and tombstones", () => {
    const other = block(60, 120);
    expect(scheduledMinutes([other], "2026-08-13")).toBe(0);
    expect(
      scheduledMinutes([block(540, 600, { deleted_at: "2026-08-12T00:00:00Z" })], DAY),
    ).toBe(0);
  });
});

describe("nowLineMinutes", () => {
  it("returns the wall-clock position on the current day", () => {
    expect(nowLineMinutes(DAY, atMinutesIntoDay(DAY, 555))).toBe(555);
  });

  it("returns null on any other day", () => {
    expect(nowLineMinutes("2026-08-13", atMinutesIntoDay(DAY, 555))).toBeNull();
    expect(nowLineMinutes("2026-08-11", atMinutesIntoDay(DAY, 555))).toBeNull();
  });
});

describe("formatMinutes", () => {
  it("pads to a fixed width so the gutter aligns", () => {
    expect(formatMinutes(0)).toBe("00:00");
    expect(formatMinutes(9 * 60 + 5)).toBe("09:05");
    expect(formatMinutes(23 * 60 + 59)).toBe("23:59");
  });

  it("wraps a full day to midnight", () => {
    expect(formatMinutes(DAY_MINUTES)).toBe("00:00");
  });
});
