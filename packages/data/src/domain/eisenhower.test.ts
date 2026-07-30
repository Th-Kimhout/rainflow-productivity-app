import { describe, expect, it } from "vitest";

import {
  QUADRANT_LABELS,
  type Quadrant,
  displayPriority,
  quadrantOf,
  setQuadrant,
} from "./eisenhower";

const ALL: Quadrant[] = ["DO_FIRST", "SCHEDULE", "DELEGATE", "ELIMINATE"];

describe("quadrantOf", () => {
  it("maps the four flag combinations to §3.2's quadrants", () => {
    expect(quadrantOf({ is_urgent: true, is_important: true })).toBe("DO_FIRST");
    expect(quadrantOf({ is_urgent: false, is_important: true })).toBe("SCHEDULE");
    expect(quadrantOf({ is_urgent: true, is_important: false })).toBe("DELEGATE");
    expect(quadrantOf({ is_urgent: false, is_important: false })).toBe("ELIMINATE");
  });

  it("is total — a default task lands somewhere", () => {
    expect(ALL).toContain(quadrantOf({ is_urgent: false, is_important: false }));
  });
});

describe("setQuadrant", () => {
  it("round-trips with quadrantOf for every quadrant", () => {
    // This is the property that makes dragging between cells safe: dropping a task in a
    // quadrant must produce flags that map back to that same quadrant.
    for (const q of ALL) {
      expect(quadrantOf(setQuadrant(q))).toBe(q);
    }
  });

  it("produces the expected flags", () => {
    expect(setQuadrant("DO_FIRST")).toEqual({ is_urgent: true, is_important: true });
    expect(setQuadrant("SCHEDULE")).toEqual({ is_urgent: false, is_important: true });
    expect(setQuadrant("DELEGATE")).toEqual({ is_urgent: true, is_important: false });
    expect(setQuadrant("ELIMINATE")).toEqual({ is_urgent: false, is_important: false });
  });
});

describe("displayPriority", () => {
  it("ranks important-not-urgent ABOVE urgent-not-important", () => {
    /*
     * This is the entire argument of the Eisenhower method — "Schedule" work is what actually
     * moves things forward, and a list that sorted urgency first would quietly undermine §3.2's
     * purpose. Worth a test precisely because the intuitive ordering is the wrong one.
     */
    const schedule = displayPriority({ is_urgent: false, is_important: true });
    const delegate = displayPriority({ is_urgent: true, is_important: false });
    expect(schedule).toBeGreaterThan(delegate);
  });

  it("orders all four distinctly, highest first", () => {
    const scores = ALL.map((q) => displayPriority(setQuadrant(q)));
    expect(scores).toEqual([3, 2, 1, 0]);
    expect(new Set(scores).size).toBe(4);
  });

  it("sorts a mixed list into quadrant order", () => {
    const tasks = [
      { id: "eliminate", is_urgent: false, is_important: false },
      { id: "do-first", is_urgent: true, is_important: true },
      { id: "delegate", is_urgent: true, is_important: false },
      { id: "schedule", is_urgent: false, is_important: true },
    ];
    const sorted = [...tasks].sort((a, b) => displayPriority(b) - displayPriority(a));
    expect(sorted.map((t) => t.id)).toEqual([
      "do-first",
      "schedule",
      "delegate",
      "eliminate",
    ]);
  });
});

describe("QUADRANT_LABELS", () => {
  it("labels every quadrant", () => {
    for (const q of ALL) {
      expect(QUADRANT_LABELS[q]).toBeTruthy();
    }
  });

  it("uses §3.2's wording", () => {
    expect(QUADRANT_LABELS.DO_FIRST).toBe("Do First");
    expect(QUADRANT_LABELS.SCHEDULE).toBe("Schedule");
    expect(QUADRANT_LABELS.DELEGATE).toBe("Delegate");
    expect(QUADRANT_LABELS.ELIMINATE).toBe("Eliminate");
  });
});
