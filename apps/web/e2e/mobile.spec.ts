import { expect, signIn, test, visit } from "./fixtures";

/**
 * The phone.
 *
 * These specs are not about layout — a narrow viewport would catch that, and a screenshot would
 * catch it better. They are about the three capabilities that were *absent* on a touchscreen
 * rather than merely cramped, each because the only route to it needed hardware a phone does not
 * have:
 *
 *   1. CREATING A TASK. Capture is bound to ⌘K and `C` and to nothing else — there was no button
 *      anywhere in the app. Without a keyboard, RainFlow was read-only.
 *   2. REACHING FIVE OF THE EIGHT SCREENS. Navigation is `G`-chords plus a sidebar that is now
 *      hidden below `md`.
 *   3. SCHEDULING. Both calendar drag paths are HTML5 drag-and-drop, which no mobile browser
 *      fires for touch input.
 *
 * `hasTouch` in the project config is what makes these meaningful: `tap()` dispatches real touch
 * events, so a handler that only listens for a mouse fails here and passes everywhere else.
 */

test("creates a task from the bottom bar, with no keyboard involved", async ({ page }) => {
  await signIn(page, "/inbox");

  // The sidebar is gone below `md`, so its sign-out — the one control that only lived there — has
  // to have found a home. It is in the More sheet.
  await expect(page.getByRole("link", { name: "Analytics" })).toHaveCount(0);

  /*
   * The ＋ in the middle of the bar. This is the single most important control on a phone: it is
   * the only way to create a task at all once ⌘K and `C` are unavailable.
   */
  await page.getByRole("button", { name: "Capture a task" }).tap();

  const input = page.getByRole("textbox", { name: "Task title" });
  await expect(input).toBeFocused();
  await input.fill("Buy milk on the way home");
  await input.press("Enter");

  await expect(
    page.getByRole("button", { name: "Buy milk on the way home", exact: true }),
  ).toBeVisible();
});

test("reaches the screens the bar has no room for", async ({ page }) => {
  await signIn(page, "/today");

  // Three destinations fit; the other five live behind More. A route that is in neither is
  // unreachable on a phone, which is the failure this asserts against.
  await page.getByRole("button", { name: "More" }).tap();
  await page.getByRole("link", { name: "Matrix" }).tap();
  await expect(page).toHaveURL(/\/matrix$/);

  // The sheet closes on navigation rather than lingering over the screen it just opened.
  await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0);

  // And the bar admits where you are: "More" stays lit while you are on one of the five it hides,
  // or five of the eight screens would show nothing selected.
  await expect(page.getByRole("button", { name: "More" })).toHaveClass(/text-rain/);
});

test("blocks out time by tapping the calendar", async ({ page }) => {
  await signIn(page, "/inbox");

  await page.getByRole("button", { name: "Capture a task" }).tap();
  const input = page.getByRole("textbox", { name: "Task title" });
  await input.fill("Draft the proposal");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "Draft the proposal", exact: true })).toBeVisible();

  await visit(page, "/calendar");

  /*
   * A TAP, not a drag. The grid is also the scroll container, so the mouse's draw-a-range gesture
   * cannot be offered to a finger without making the day unscrollable — a tap opens the picker for
   * a default-length block at the tapped time instead.
   *
   * The rail is hidden here, so unlike the desktop spec there is no second element carrying this
   * task's name; `data-block` scoping is kept anyway so the two specs read the same.
   */
  const grid = page.getByRole("main").locator("div.overflow-y-auto").first();
  await grid.tap({ position: { x: 200, y: 150 } });

  const picker = page.getByRole("textbox", { name: "Filter tasks" });
  await expect(picker).toBeVisible();
  await picker.fill("Draft");
  await picker.press("Enter");

  const block = page.locator("[data-block]").filter({ hasText: "Draft the proposal" });
  await expect(block).toBeVisible();

  /*
   * Unscheduling. On a desktop this button appears on hover; there is no hover here, so if it
   * were still `group-hover`-only the block could be created and never removed.
   */
  await block.getByRole("button", { name: "Unschedule" }).tap();
  await expect(block).toHaveCount(0);
});

test("moves a block by dragging its grip, which native drag-and-drop cannot do", async ({
  page,
}) => {
  await signIn(page, "/inbox");

  await page.getByRole("button", { name: "Capture a task" }).tap();
  const input = page.getByRole("textbox", { name: "Task title" });
  await input.fill("Review the numbers");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "Review the numbers", exact: true })).toBeVisible();

  await visit(page, "/calendar");

  const grid = page.getByRole("main").locator("div.overflow-y-auto").first();
  await grid.tap({ position: { x: 200, y: 150 } });

  const picker = page.getByRole("textbox", { name: "Filter tasks" });
  await picker.fill("Review");
  await picker.press("Enter");

  const block = page.locator("[data-block]").filter({ hasText: "Review the numbers" });
  await expect(block).toBeVisible();

  /*
   * The card is `draggable`, and on a desktop that native drag is what moves it. `dragstart` is
   * never dispatched for touch input on any mobile browser, so this grip — a pointer-event drag
   * along the block's top edge — is the only way a block created on a phone can be moved off the
   * time it landed on.
   *
   * A REAL TOUCH DRAG, dispatched through CDP. `page.mouse` will not do: Chromium turns a
   * mouse-down-and-move on a `draggable` element into a native HTML5 drag, so the block moves via
   * the desktop path and the spec passes with the grip completely unwired. Verified — that is
   * exactly what the first version of this test did. `page.touchscreen` only offers `tap`, with
   * no drag, so the touch points go in directly.
   *
   * `textContent`, NOT `innerText`, for the baseline. `toHaveText` compares against textContent
   * with whitespace collapsed, and `innerText` inserts a newline between the title and the time
   * that textContent does not have — so `toHaveText(innerText)` can never match and the negated
   * form passes whatever the block does. Also verified the hard way.
   */
  const before = await block.textContent();
  // Narrowing, not defensiveness — but a thrown error rather than `?? ""`, because an empty
  // baseline would make the negated assertion below pass unconditionally, which is the exact
  // failure mode this comparison already fell into once.
  if (before === null) throw new Error("the block has no text to compare against");
  const grip = block.getByRole("separator", { name: "Move block" });
  const box = (await grip.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  // Several moves rather than one: the handler snaps to 15-minute slots off the running delta,
  // and a single jump would not exercise that.
  for (const step of [20, 45, 75, 90]) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + step }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  await expect(block).not.toHaveText(before);
});
