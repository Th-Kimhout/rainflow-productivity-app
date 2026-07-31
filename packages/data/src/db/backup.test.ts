import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import { pendingCount } from "./outbox";
import { createHabit, createTask, createWriteContext, setHabitLogged, softDelete } from "./repo";
import { RainflowDB } from "./schema";
import { BACKUP_VERSION, exportBackup, importBackup, parseBackup } from "./backup";

let counter = 0;
function freshDb(): RainflowDB {
  return new RainflowDB(`rainflow-backup-${++counter}`);
}

const ctx = createWriteContext("laptop", () => new Date(1_700_000_000_000));

describe("export", () => {
  it("captures every table as raw wire rows", async () => {
    const db = freshDb();
    await createTask(db, ctx, { title: "Keep me", id: "t1" });
    await createHabit(db, ctx, { title: "Gym", kind: "DAILY", id: "h1" });
    await setHabitLogged(db, ctx, "h1", "2026-08-10", true);

    const backup = await exportBackup(db);

    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.counts).toMatchObject({ task: 1, habit: 1, habit_log: 1 });
    // Raw snake_case wire rows, not a transformed shape. No transformation, nothing to get
    // wrong, and the file is diffable against what is actually in Postgres.
    expect(backup.tables.task?.[0]).toMatchObject({
      id: "t1",
      title: "Keep me",
      client_updated_at: expect.any(String),
    });
    db.close();
  });

  it("includes tombstones", async () => {
    const db = freshDb();
    await createTask(db, ctx, { title: "Deleted", id: "t1" });
    await softDelete(db, ctx, "task", "t1");

    const backup = await exportBackup(db);

    /*
     * An export that dropped tombstones would resurrect everything ever deleted on import, and
     * would leave the importing device unable to tell a late stale update from a genuine one.
     */
    expect(backup.tables.task).toHaveLength(1);
    expect(backup.tables.task?.[0]?.deleted_at).not.toBeNull();
    db.close();
  });

  it("records how many writes were still unsynced", async () => {
    const db = freshDb();
    await createTask(db, ctx, { title: "Unsynced", id: "t1" });

    // The whole point of the export as a safety net: it is taken precisely when the outbox is
    // full and the browser might evict it.
    expect((await exportBackup(db)).pendingWrites).toBe(1);
    db.close();
  });
});

describe("import", () => {
  it("restores rows into an empty database", async () => {
    const source = freshDb();
    await createTask(source, ctx, { title: "Restored", id: "t1" });
    await createHabit(source, ctx, { title: "Gym", kind: "DAILY", id: "h1" });
    const backup = await exportBackup(source);
    source.close();

    const target = freshDb();
    const report = await importBackup(target, backup);

    expect(report.imported).toBe(2);
    expect(await target.task.get("t1")).toMatchObject({ title: "Restored" });
    expect(await target.habit.get("h1")).toMatchObject({ title: "Gym" });
    target.close();
  });

  it("queues restored rows so the restore reaches the server", async () => {
    const source = freshDb();
    await createTask(source, ctx, { title: "Restored", id: "t1" });
    const backup = await exportBackup(source);
    source.close();

    const target = freshDb();
    await importBackup(target, backup);

    // Otherwise the data is back on ONE device and looks correct while the server still has
    // nothing — the difference between "my data is back" and "my data is back here".
    expect(await pendingCount(target)).toBe(1);
    target.close();
  });

  it("can skip queueing when only a local restore is wanted", async () => {
    const source = freshDb();
    await createTask(source, ctx, { title: "Local only", id: "t1" });
    const backup = await exportBackup(source);
    source.close();

    const target = freshDb();
    await importBackup(target, backup, { queueForSync: false });

    expect(await target.task.get("t1")).toBeDefined();
    expect(await pendingCount(target)).toBe(0);
    target.close();
  });

  it("preserves the original client_updated_at rather than re-stamping", async () => {
    const source = freshDb();
    await createTask(source, ctx, { title: "Old", id: "t1" });
    const original = (await source.task.get("t1"))!.client_updated_at;
    const backup = await exportBackup(source);
    source.close();

    const target = freshDb();
    await importBackup(target, backup);

    /*
     * Re-stamping with the restore time would make every restored row beat any concurrent edit
     * on another device — silently rolling that device back to the state of the backup file.
     */
    expect((await target.task.get("t1"))!.client_updated_at).toBe(original);
    target.close();
  });

  it("is idempotent", async () => {
    const source = freshDb();
    await createTask(source, ctx, { title: "Once", id: "t1" });
    const backup = await exportBackup(source);
    source.close();

    const target = freshDb();
    await importBackup(target, backup);
    await importBackup(target, backup);

    expect(await target.task.count()).toBe(1);
    // Coalesced by the outbox's unique key, so a double import does not double-send either.
    expect(await pendingCount(target)).toBe(1);
    target.close();
  });

  it("skips rows with no primary key or no client_updated_at", async () => {
    const target = freshDb();
    const report = await importBackup(target, {
      version: 1,
      tables: {
        task: [
          { id: "good", title: "Fine", client_updated_at: "2026-01-01T00:00:00Z" },
          { title: "No id", client_updated_at: "2026-01-01T00:00:00Z" },
          { id: "no-stamp", title: "No stamp" },
        ],
      },
    });

    // A row with no key cannot be stored; one with no client_updated_at breaks last-write-wins
    // for every future update to it. Both are dropped rather than poisoning the database.
    expect(report.imported).toBe(1);
    expect(report.skipped).toBe(2);
    expect(await target.task.count()).toBe(1);
    target.close();
  });

  it("refuses a file from a newer version", async () => {
    // Importing a newer schema would silently drop columns this build does not know about.
    expect(() => parseBackup({ version: BACKUP_VERSION + 1, tables: {} })).toThrow(/newer/);
  });

  it("refuses anything that is not a backup", () => {
    expect(() => parseBackup(null)).toThrow(/backup/i);
    expect(() => parseBackup("hello")).toThrow(/backup/i);
    expect(() => parseBackup({ tables: {} })).toThrow(/version/i);
    expect(() => parseBackup({ version: 1 })).toThrow(/tables/i);
  });

  it("survives a full round trip through JSON", async () => {
    const source = freshDb();
    await createTask(source, ctx, { title: "Round trip", id: "t1", estimatedMins: 45 });
    await createHabit(source, ctx, {
      title: "Read",
      kind: "WEEKDAYS",
      weekdays: [1, 3, 5],
      id: "h1",
    });
    const text = JSON.stringify(await exportBackup(source));
    source.close();

    const target = freshDb();
    await importBackup(target, JSON.parse(text));

    expect(await target.task.get("t1")).toMatchObject({ estimated_mins: 45 });
    // The weekdays array has to survive serialisation intact, or the habit's schedule changes
    // meaning on restore.
    expect((await target.habit.get("h1"))!.weekdays).toEqual([1, 3, 5]);
    target.close();
  });
});
