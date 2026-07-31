import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const { KeyboardProvider, PRIORITY, useKeyHandler } = await import("./provider");

/**
 * Tests for keyboard dispatch.
 *
 * Two separate bugs have already shipped here, both of the same shape: a key firing when it should
 * have been suppressed. They are invisible to typechecking and easy to miss by hand, because
 * reproducing one means having focus in exactly the right place. Hence tests.
 */

function press(key: string, target?: Element, init: KeyboardEventInit = {}) {
  act(() => {
    (target ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
    );
  });
}

/** Registers a handler and records the keys it saw. */
function Probe({
  seen,
  priority = PRIORITY.view,
  whenTyping = false,
  claim = false,
}: {
  seen: string[];
  priority?: number;
  whenTyping?: boolean;
  claim?: boolean;
}) {
  useKeyHandler(
    priority,
    (event) => {
      seen.push(event.key);
      return claim;
    },
    { whenTyping },
  );
  return null;
}

describe("suppression while typing", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    push.mockClear();
  });

  it("does not deliver single keys to a default handler while focus is in an input", () => {
    const seen: string[] = [];
    const input = document.createElement("input");
    document.body.appendChild(input);

    render(
      <KeyboardProvider>
        <Probe seen={seen} />
      </KeyboardProvider>,
    );

    // This is the bug that silently moved a task to another quadrant when "1" was typed into
    // the estimate field, and moved the list cursor when "j" was typed into a title.
    press("1", input);
    press("j", input);
    expect(seen).toEqual([]);
  });

  it("delivers the same keys when focus is not in a field", () => {
    const seen: string[] = [];
    render(
      <KeyboardProvider>
        <Probe seen={seen} />
      </KeyboardProvider>,
    );

    press("1");
    press("j");
    expect(seen).toEqual(["1", "j"]);
  });

  it("delivers to a whenTyping handler even inside an input", () => {
    const seen: string[] = [];
    const input = document.createElement("input");
    document.body.appendChild(input);

    render(
      <KeyboardProvider>
        <Probe seen={seen} whenTyping />
      </KeyboardProvider>,
    );

    // ⌘K and Escape must reach the palette and inspector mid-typing.
    press("k", input, { metaKey: true });
    press("Escape", input);
    expect(seen).toEqual(["k", "Escape"]);
  });

  it("treats a textarea and contenteditable as typing contexts", () => {
    const seen: string[] = [];
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    // jsdom does not implement isContentEditable from the attribute alone.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    document.body.append(textarea, editable);

    render(
      <KeyboardProvider>
        <Probe seen={seen} />
      </KeyboardProvider>,
    );

    press("c", textarea);
    press("c", editable);
    expect(seen).toEqual([]);
  });
});

describe("priority and claiming", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("dispatches overlays before views", () => {
    const order: string[] = [];
    function Ordered() {
      useKeyHandler(PRIORITY.view, () => void order.push("view"));
      useKeyHandler(PRIORITY.overlay, () => void order.push("overlay"));
      return null;
    }

    render(
      <KeyboardProvider>
        <Ordered />
      </KeyboardProvider>,
    );

    press("x");
    expect(order).toEqual(["overlay", "view"]);
  });

  it("stops dispatch once a handler claims the event", () => {
    const overlay: string[] = [];
    const view: string[] = [];

    render(
      <KeyboardProvider>
        <Probe seen={overlay} priority={PRIORITY.overlay} claim />
        <Probe seen={view} priority={PRIORITY.view} />
      </KeyboardProvider>,
    );

    // Escape must close the topmost thing only — not the overlay AND the drawer beneath it.
    press("Escape");
    expect(overlay).toEqual(["Escape"]);
    expect(view).toEqual([]);
  });

  it("stops delivering to an unmounted handler", () => {
    const seen: string[] = [];
    const { unmount } = render(
      <KeyboardProvider>
        <Probe seen={seen} />
      </KeyboardProvider>,
    );

    press("a");
    unmount();
    press("b");
    expect(seen).toEqual(["a"]);
  });
});

describe("G chords", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    push.mockClear();
  });

  it("navigates on a completed chord", () => {
    render(<KeyboardProvider>{null}</KeyboardProvider>);
    press("g");
    press("t");
    expect(push).toHaveBeenCalledWith("/today");
  });

  it("maps every documented chord target", () => {
    render(<KeyboardProvider>{null}</KeyboardProvider>);
    for (const [key, route] of [
      ["t", "/today"],
      ["i", "/inbox"],
      ["e", "/matrix"],
      ["c", "/calendar"],
      ["h", "/habits"],
      ["a", "/analytics"],
      ["s", "/settings"],
    ] as const) {
      push.mockClear();
      press("g");
      press(key);
      expect(push).toHaveBeenCalledWith(route);
    }
  });

  it("cancels on an unrecognised second key without navigating", () => {
    render(<KeyboardProvider>{null}</KeyboardProvider>);
    press("g");
    press("z");
    expect(push).not.toHaveBeenCalled();

    // And the chord is cleared, so a later 't' alone does nothing.
    press("t");
    expect(push).not.toHaveBeenCalled();
  });

  it("does not start a chord while typing", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    render(<KeyboardProvider>{null}</KeyboardProvider>);

    press("g", input);
    press("t", input);
    expect(push).not.toHaveBeenCalled();
  });

  it("resolves the chord even when a view binds the same letter", () => {
    /*
     * The calendar binds `T` for "jump to today", which is also the second half of `G T`. If
     * registered handlers saw the key first, `G T` would silently stop navigating on that one
     * page — the chord must own the key while it is held.
     */
    const seen: string[] = [];
    render(
      <KeyboardProvider>
        <Probe seen={seen} claim />
      </KeyboardProvider>,
    );

    press("g");
    press("t");

    expect(push).toHaveBeenCalledWith("/today");
    expect(seen).toEqual([]);
  });

  it("still delivers the key once the chord has resolved", () => {
    const seen: string[] = [];
    render(
      <KeyboardProvider>
        <Probe seen={seen} claim />
      </KeyboardProvider>,
    );

    press("g");
    press("t");
    press("t");

    // Only the second, chord-free `t` reaches the view.
    expect(seen).toEqual(["t"]);
  });

  it("expires a stale chord prefix", async () => {
    vi.useFakeTimers();
    try {
      render(<KeyboardProvider>{null}</KeyboardProvider>);
      press("g");
      // Press g, get distracted, come back later — 't' must not teleport you.
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      press("t");
      expect(push).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
