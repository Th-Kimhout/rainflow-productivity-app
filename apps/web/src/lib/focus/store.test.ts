import { isActive, isRunning } from "@rainflow/data";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as store from "./store";

/**
 * The focus store's ORCHESTRATION — the part that is not in `@rainflow/data`'s pure reducers.
 *
 * Run with no database attached, so every `focus_session` write is a no-op. That is deliberate:
 * what is under test here is which transitions happen and when the energy prompt appears, not
 * Dexie, which the sync suite already covers.
 */

beforeEach(() => {
  store.__reset();
});

describe("session lifecycle", () => {
  it("starts a focus phase running", async () => {
    await store.start("t1");
    const { state } = store.getSnapshot();

    expect(state.phase).toBe("FOCUS");
    expect(state.taskId).toBe("t1");
    expect(isRunning(state)).toBe(true);
    expect(state.sessionId).not.toBeNull();
  });

  it("toggles pause and resume", async () => {
    await store.start("t1");
    await store.toggle();
    expect(isRunning(store.getSnapshot().state)).toBe(false);

    await store.toggle();
    expect(isRunning(store.getSnapshot().state)).toBe(true);
  });

  it("arms the next phase without starting it", async () => {
    await store.start("t1");
    await store.advance(true);

    const { state } = store.getSnapshot();
    // A break that begins the instant focus ends is a break you spend the first minute of not
    // realising has started.
    expect(state.phase).toBe("SHORT_BREAK");
    expect(isActive(state)).toBe(true);
    expect(isRunning(state)).toBe(false);
    expect(state.sessionId).toBeNull();
  });

  it("opens a session when the armed phase is started", async () => {
    await store.start("t1");
    await store.advance(true);
    await store.toggle();

    const { state } = store.getSnapshot();
    expect(isRunning(state)).toBe(true);
    // The armed phase had no session row; pressing play has to create one, or the break goes
    // unrecorded and §3.6 cannot tell a break that was taken from one that was not.
    expect(state.sessionId).not.toBeNull();
  });

  it("stop returns to a standing start", async () => {
    await store.start("t1");
    await store.stop();

    const { state } = store.getSnapshot();
    expect(isActive(state)).toBe(false);
    expect(state.sessionId).toBeNull();
    // The task is kept, so pressing play again resumes the same work.
    expect(state.taskId).toBe("t1");
  });

  it("ignores toggle when nothing is active", async () => {
    await store.toggle();
    expect(isActive(store.getSnapshot().state)).toBe(false);
  });
});

describe("the energy prompt", () => {
  it("appears after a completed focus phase", async () => {
    await store.start("t1");
    await store.advance(true);

    expect(store.getSnapshot().pendingEnergy).toMatchObject({ taskId: "t1" });
  });

  it("does not appear after a skipped focus phase", async () => {
    await store.start("t1");
    // Skipping is not finishing. Rating an interruption would pollute §3.6's correlation of
    // energy with time of day, and junk data is worse than none.
    await store.advance(false);

    expect(store.getSnapshot().pendingEnergy).toBeNull();
  });

  it("does not appear after a break", async () => {
    await store.start("t1");
    await store.advance(true); // focus done → prompt
    await store.answerEnergy(null);
    await store.toggle(); // start the break
    await store.advance(true); // break done

    expect(store.getSnapshot().pendingEnergy).toBeNull();
  });

  it("clears when answered or dismissed", async () => {
    await store.start("t1");
    await store.advance(true);
    await store.answerEnergy("HIGH");
    expect(store.getSnapshot().pendingEnergy).toBeNull();

    await store.start("t2");
    await store.advance(true);
    await store.answerEnergy(null);
    expect(store.getSnapshot().pendingEnergy).toBeNull();
  });
});

describe("cross-tab adoption", () => {
  it("takes on state written by another tab", () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.adopt({
      writer: "some-other-tab",
      state: {
        phase: "FOCUS",
        runningSince: 1_700_000_000_000,
        accumulatedMs: 0,
        completedFocus: 2,
        taskId: "remote-task",
        sessionId: "remote-session",
        phaseStartedAt: 1_700_000_000_000,
      },
    });

    expect(store.getSnapshot().state.taskId).toBe("remote-task");
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("ignores its own echo", async () => {
    await store.start("mine");
    const before = store.getSnapshot();

    /*
     * The loop this prevents: tab persists → Dexie broadcasts → the same tab's live query fires
     * → it adopts its own write → persists again, for ever. Every persisted payload carries the
     * id of the tab that wrote it, and a matching id is skipped.
     */
    store.adopt({ writer: store.__tabId(), state: { ...before.state, taskId: "echo" } });

    expect(store.getSnapshot().state.taskId).toBe("mine");
    expect(store.getSnapshot()).toBe(before);
  });

  it("ignores malformed payloads rather than throwing", () => {
    const before = store.getSnapshot().state;

    store.adopt(null);
    store.adopt("nonsense");
    store.adopt({ writer: "other" }); // no state

    expect(store.getSnapshot().state).toEqual(before);
  });
});

describe("snapshot stability", () => {
  it("returns the same reference until something changes", async () => {
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);

    await store.start("t1");
    // useSyncExternalStore compares by reference and loops forever if a new object comes back
    // every call, so this pair of assertions is load-bearing rather than pedantic.
    const second = store.getSnapshot();
    expect(second).not.toBe(first);
    expect(store.getSnapshot()).toBe(second);
  });

  it("gives a stable, stopped server snapshot", () => {
    expect(store.getServerSnapshot()).toBe(store.getServerSnapshot());
    expect(isActive(store.getServerSnapshot().state)).toBe(false);
  });
});
