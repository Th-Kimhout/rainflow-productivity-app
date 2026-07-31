import { expect, signIn, test } from "./fixtures";

/**
 * Five specs, not fifty.
 *
 * The convergence suite in `packages/data` already drives the real sync engine against a fake
 * server, and that is where the genuinely hard bugs live. What it cannot see is the WIRING — that
 * a keystroke reaches the right handler, that a write reaches the outbox, that a route renders at
 * all. Each spec below covers one seam that unit tests structurally cannot.
 */

test("captures a task and lands it in the inbox", async ({ page }) => {
  await signIn(page, "/inbox");

  await page.keyboard.press("ControlOrMeta+k");

  const input = page.getByRole("textbox", { name: "Task title" });
  await expect(input).toBeFocused();

  // §3.1's grammar, end to end: title, tag and priority flag in one line.
  await input.fill("Write the release notes #docs @urgent");

  /*
   * The parse is shown before committing, which is the whole point of live feedback — a misparse
   * should be visible now, not discovered days later when the task fails to appear. The chips
   * carry the bare token; the `#` and the flag icon are drawn, not text.
   */
  await expect(page.getByText("docs", { exact: true })).toBeVisible();
  await expect(page.getByText("urgent", { exact: true })).toBeVisible();

  await input.press("Enter");

  // Tokens are metadata and must not survive into the stored title.
  /*
   * `exact: true` matters: Playwright matches an accessible name as a SUBSTRING by default, and
   * each row also carries a `Delete "<title>"` button — so the loose form resolves to two
   * elements and fails on strict mode rather than on anything real.
   */
  await expect(
    page.getByRole("button", { name: "Write the release notes", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("@urgent")).toHaveCount(0);
});

test("navigates by keyboard chord without touching the mouse", async ({ page }) => {
  await signIn(page, "/today");

  // §4.2 claims the app is 100% operable without a mouse. G-chords are the backbone of that.
  await page.keyboard.press("g");
  await page.keyboard.press("e");
  await expect(page).toHaveURL(/\/matrix$/);

  await page.keyboard.press("g");
  await page.keyboard.press("c");
  await expect(page).toHaveURL(/\/calendar/);

  // A chord that goes nowhere must cancel cleanly rather than leaving the prefix armed.
  await page.keyboard.press("g");
  await page.keyboard.press("z");
  await expect(page).toHaveURL(/\/calendar/);
});

test("moves a task between quadrants with 1–4", async ({ page }) => {
  await signIn(page, "/inbox");

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("textbox", { name: "Task title" }).fill("Triage me");
  await page.getByRole("textbox", { name: "Task title" }).press("Enter");
  await expect(page.getByRole("button", { name: "Triage me", exact: true })).toBeVisible();

  await page.keyboard.press("g");
  await page.keyboard.press("e");
  await expect(page).toHaveURL(/\/matrix$/);

  const doFirst = page.getByRole("heading", { name: "Do First" }).locator("..").locator("..");
  await expect(doFirst.getByText("Triage me")).toHaveCount(0);

  /*
   * The quadrant is DERIVED from two booleans (ADR 0001 decision 9), so this asserts the whole
   * chain: key → patch → Dexie write → live query → re-render into a different cell.
   */
  await page.keyboard.press("1");
  await expect(doFirst.getByText("Triage me")).toBeVisible();
});

test("keeps working with the server unreachable", async ({ page, server }) => {
  // Inbox, not Today: capture lands in INBOX by §3.1's smart fallbacks, so asserting on Today
  // would be testing the wrong screen.
  await signIn(page, "/inbox");

  // Wi-Fi off. Everything below this line happens with every Supabase request failing.
  server.offline = true;

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("textbox", { name: "Task title" }).fill("Written on a train");
  await page.getByRole("textbox", { name: "Task title" }).press("Enter");

  /*
   * The §1.2 promise. The write lands in Dexie and the list repaints regardless of the network,
   * because no view here reads from the network at all.
   */
  await expect(page.getByRole("button", { name: "Written on a train", exact: true })).toBeVisible();

  // And the user is TOLD it has not left the device. Unsynced work lives only in IndexedDB, which
  // Safari evicts after about a week — silence here would be the dangerous option.
  await expect(page.getByTitle(/only on this device/)).toBeVisible();
});

test("exports a backup containing the local rows", async ({ page }) => {
  await signIn(page, "/inbox");

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("textbox", { name: "Task title" }).fill("Back me up");
  await page.getByRole("textbox", { name: "Task title" }).press("Enter");
  await expect(page.getByRole("button", { name: "Back me up", exact: true })).toBeVisible();

  await page.keyboard.press("g");
  await page.keyboard.press("s");
  await expect(page).toHaveURL(/\/settings$/);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();

  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^rainflow-\d{4}-\d{2}-\d{2}\.json$/);

  /*
   * §7.2's replacement for point-in-time recovery, which the free tier does not offer. A backup
   * button that produces an empty or malformed file is worse than no button, so the contents are
   * checked rather than just the download event.
   */
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const backup = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    version: number;
    tables: { task?: Array<{ title: string }> };
  };

  expect(backup.version).toBe(1);
  expect(backup.tables.task?.some((t) => t.title === "Back me up")).toBe(true);
});
