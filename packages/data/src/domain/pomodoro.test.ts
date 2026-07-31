import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONFIG,
  type PomodoroConfig,
  type PomodoroState,
  abandon,
  beginPhase,
  completePhase,
  elapsedMs,
  formatDuration,
  idleState,
  isActive,
  isExpired,
  isRunning,
  nextPhaseOf,
  pause,
  phaseDurationMs,
  progress,
  remainingMs,
  reset,
  resume,
  tabTitle,
  upcomingPhase,
} from "./pomodoro";

const T0 = 1_700_000_000_000;
const MIN = 60_000;

/** A short config, so a full four-cycle run is readable in a test. */
const CONFIG: PomodoroConfig = {
  focusMins: 25,
  shortBreakMins: 5,
  longBreakMins: 15,
  cyclesBeforeLongBreak: 4,
};

function started(now = T0, taskId: string | null = "t1"): PomodoroState {
  return beginPhase(idleState(taskId), "FOCUS", now, { sessionId: "s1" });
}

describe("elapsed time is derived, not counted", () => {
  it("measures elapsed from the start timestamp", () => {
    const s = started();
    expect(elapsedMs(s, T0 + 10 * MIN)).toBe(10 * MIN);
    expect(remainingMs(s, CONFIG, T0 + 10 * MIN)).toBe(15 * MIN);
  });

  /*
   * The reason the whole module takes `now` as a parameter. A hidden tab has its timers
   * throttled to once a minute or stopped entirely, and a sleeping laptop fires none at all —
   * so a counting implementation would report ~24 minutes left after a real 25 minutes away.
   * Deriving from timestamps means the very first render after waking is already correct.
   */
  it("is correct after a gap in which no tick could have fired", () => {
    const s = started();
    const wokeUp = T0 + 90 * MIN;

    expect(remainingMs(s, CONFIG, wokeUp)).toBe(0);
    expect(isExpired(s, CONFIG, wokeUp)).toBe(true);
    expect(progress(s, CONFIG, wokeUp)).toBe(1);
  });

  it("never reports negative time or over-full progress", () => {
    const s = started();
    expect(remainingMs(s, CONFIG, T0 + 999 * MIN)).toBe(0);
    expect(progress(s, CONFIG, T0 + 999 * MIN)).toBe(1);
  });

  it("reports nothing expired before anything has started", () => {
    expect(isExpired(idleState(), CONFIG, T0 + 99 * MIN)).toBe(false);
    expect(isActive(idleState())).toBe(false);
  });
});

describe("pause and resume", () => {
  it("banks elapsed time and stops the clock", () => {
    const s = pause(started(), T0 + 10 * MIN);

    expect(isRunning(s)).toBe(false);
    // Ten minutes later and still ten minutes in: a paused timer must not drift.
    expect(elapsedMs(s, T0 + 20 * MIN)).toBe(10 * MIN);
    expect(remainingMs(s, CONFIG, T0 + 20 * MIN)).toBe(15 * MIN);
  });

  it("adds segments across several pauses", () => {
    let s = started();
    s = pause(s, T0 + 5 * MIN);
    s = resume(s, T0 + 30 * MIN); // 25 minutes away from the desk
    s = pause(s, T0 + 33 * MIN);

    // 5 + 3 worked minutes, regardless of the 25 spent paused.
    expect(elapsedMs(s, T0 + 60 * MIN)).toBe(8 * MIN);
  });

  it("ignores a redundant pause or resume", () => {
    const paused = pause(started(), T0 + 5 * MIN);
    expect(pause(paused, T0 + 10 * MIN)).toEqual(paused);

    const running = started();
    expect(resume(running, T0 + 10 * MIN)).toEqual(running);
  });

  it("will not resume something that never started", () => {
    const idle = idleState();
    expect(resume(idle, T0)).toEqual(idle);
  });
});

describe("cycle scheduling", () => {
  it("follows focus with a short break", () => {
    const after = completePhase(started(), CONFIG, T0 + 25 * MIN);
    expect(after.phase).toBe("SHORT_BREAK");
    expect(after.completedFocus).toBe(1);
  });

  it("follows the fourth focus phase with a long break", () => {
    let s = started();
    let now = T0;

    for (let i = 0; i < 3; i++) {
      now += 25 * MIN;
      s = completePhase(s, CONFIG, now); // → short break
      expect(s.phase).toBe("SHORT_BREAK");
      now += 5 * MIN;
      s = completePhase(s, CONFIG, now); // → focus
      expect(s.phase).toBe("FOCUS");
    }

    now += 25 * MIN;
    s = completePhase(s, CONFIG, now);
    expect(s.phase).toBe("LONG_BREAK");
    expect(s.completedFocus).toBe(4);
  });

  it("resets the cycle after the long break, rather than repeating it", () => {
    let s: PomodoroState = { ...started(), completedFocus: 3 };
    s = completePhase(s, CONFIG, T0 + 25 * MIN);
    expect(s.phase).toBe("LONG_BREAK");

    s = completePhase(s, CONFIG, T0 + 40 * MIN);
    expect(s.phase).toBe("FOCUS");
    expect(s.completedFocus).toBe(0);

    // The very next focus phase must earn a SHORT break, not another long one.
    s = completePhase(s, CONFIG, T0 + 65 * MIN);
    expect(s.phase).toBe("SHORT_BREAK");
  });

  it("previews the upcoming phase without advancing", () => {
    const third: PomodoroState = { ...started(), completedFocus: 3 };
    // `nextPhaseOf` expects the count to already include the phase being finished, so calling
    // it directly here would advertise a short break right before the long one.
    expect(nextPhaseOf(third, CONFIG)).toBe("SHORT_BREAK");
    expect(upcomingPhase(third, CONFIG)).toBe("LONG_BREAK");
  });

  it("does not auto-start the next phase by default", () => {
    const after = completePhase(started(), CONFIG, T0 + 25 * MIN);
    expect(isRunning(after)).toBe(false);
    expect(isActive(after)).toBe(true);
    // The clock is at zero for the new phase, waiting on the user.
    expect(elapsedMs(after, T0 + 30 * MIN)).toBe(0);
  });

  it("auto-starts when asked", () => {
    const after = completePhase(started(), CONFIG, T0 + 25 * MIN, { autoStart: true });
    expect(isRunning(after)).toBe(true);
    expect(elapsedMs(after, T0 + 26 * MIN)).toBe(MIN);
  });
});

describe("abandon", () => {
  it("does not count an abandoned focus phase toward the long break", () => {
    /*
     * Four false starts must not earn a 15-minute long break. Counting them would turn the
     * mechanism into one that rewards not working.
     */
    let s = started();
    for (let i = 0; i < 4; i++) {
      s = abandon(s);
      s = beginPhase(s, "FOCUS", T0, { sessionId: "s" });
    }
    expect(s.completedFocus).toBe(0);
    expect(nextPhaseOf({ ...s, completedFocus: 1 }, CONFIG)).toBe("SHORT_BREAK");
  });

  it("returns to a standing start on focus and keeps the task", () => {
    const s = abandon(pause(started(T0, "t9"), T0 + 3 * MIN));
    expect(s.phase).toBe("FOCUS");
    expect(s.taskId).toBe("t9");
    expect(isActive(s)).toBe(false);
    expect(s.sessionId).toBeNull();
  });

  it("returns to focus when a break is abandoned", () => {
    const onBreak = completePhase(started(), CONFIG, T0 + 25 * MIN);
    expect(abandon(onBreak).phase).toBe("FOCUS");
  });

  it("reset clears the cycle count too", () => {
    const s = reset({ ...started(), completedFocus: 3 });
    expect(s.completedFocus).toBe(0);
    expect(isActive(s)).toBe(false);
  });
});

describe("phase durations", () => {
  it("uses §3.3's stated defaults", () => {
    expect(DEFAULT_CONFIG).toMatchObject({
      focusMins: 25,
      shortBreakMins: 5,
      longBreakMins: 15,
      cyclesBeforeLongBreak: 4,
    });
    expect(phaseDurationMs(DEFAULT_CONFIG, "FOCUS")).toBe(25 * MIN);
    expect(phaseDurationMs(DEFAULT_CONFIG, "SHORT_BREAK")).toBe(5 * MIN);
    expect(phaseDurationMs(DEFAULT_CONFIG, "LONG_BREAK")).toBe(15 * MIN);
  });

  it("refuses a zero-length phase", () => {
    // A phase of length zero is instantly expired, which would spin the completion handler.
    expect(phaseDurationMs({ ...CONFIG, focusMins: 0 }, "FOCUS")).toBe(MIN);
  });
});

describe("formatDuration", () => {
  it("pads to mm:ss", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(65_000)).toBe("01:05");
    expect(formatDuration(25 * MIN)).toBe("25:00");
  });

  it("grows an hours field rather than showing 90 minutes", () => {
    expect(formatDuration(90 * MIN)).toBe("1:30:00");
  });

  it("clamps negatives", () => {
    expect(formatDuration(-5_000)).toBe("00:00");
  });
});

describe("tabTitle", () => {
  it("leads with the countdown", () => {
    // §3.3's own example. Leading with the time is not cosmetic: a pinned tab shows only the
    // first few characters, so anything before the number wastes the whole feature.
    const s = started();
    expect(tabTitle(s, CONFIG, T0 + 6 * MIN + 36_000, "RainFlow PRD")).toBe(
      "(18:24) Focus: RainFlow PRD",
    );
  });

  it("omits the task on a break", () => {
    const onBreak = resume(completePhase(started(), CONFIG, T0 + 25 * MIN), T0 + 25 * MIN);
    expect(tabTitle(onBreak, CONFIG, T0 + 26 * MIN, "RainFlow PRD")).toBe("(04:00) Break");
  });

  it("falls back when nothing is running", () => {
    expect(tabTitle(idleState(), CONFIG, T0, "anything")).toBe("RainFlow");
  });

  it("handles a bare pomodoro with no task", () => {
    expect(tabTitle(started(T0, null), CONFIG, T0, null)).toBe("(25:00) Focus");
  });
});
