import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { pendingCount } from "../../db/outbox";
import { createTask, createWriteContext, patch, put, softDelete } from "../../db/repo";
import { RainflowDB } from "../../db/schema";
import type { AnyRow, TaskRow } from "../../wire";
import { applyRemoteRows } from "../apply-remote";
import { getCursor, pullAll, pullTable } from "../pull";
import { drain, drainUntilQuiet } from "../push";
import { FakeServer } from "./fake-server";

/**
 * Convergence tests.
 *
 * These are the highest-value tests in the project. The sync engine is where the genuinely
 * hard bugs live, and every one of them is an ordering problem that only shows up under a
 * specific interleaving of local write / remote echo / tombstone / retry. Driving the real
 * engine against a fake server is the only way to actually exercise those.
 */

let dbCounter = 0;

function freshDb(): RainflowDB {
  return new RainflowDB(`rainflow-test-${++dbCounter}`);
}

/** A client peer: its own Dexie, its own device id, its own clock. */
function peer(server: FakeServer, clientId: string, startClock = 1_700_000_000_000) {
  const db = freshDb();
  let clock = startClock;
  const ctx = createWriteContext(clientId, () => new Date(clock));
  return {
    db,
    ctx,
    transport: server.transport(),
    tick: (ms = 1000) => {
      clock += ms;
    },
    setClock: (v: number) => {
      clock = v;
    },
    now: () => clock,
  };
}

async function taskById(db: RainflowDB, id: string): Promise<TaskRow | undefined> {
  return db.task.get(id);
}

describe("write repository", () => {
  let server: FakeServer;

  beforeEach(() => {
    server = new FakeServer();
  });

  it("writes the row and its outbox op atomically", async () => {
    const a = peer(server, "laptop");
    const task = await createTask(a.db, a.ctx, { title: "Write the SRS" });

    expect(await taskById(a.db, task.id)).toMatchObject({ title: "Write the SRS" });
    expect(await pendingCount(a.db)).toBe(1);
  });

  it("coalesces repeated edits into a single pending op", async () => {
    const a = peer(server, "laptop");
    const task = await createTask(a.db, a.ctx, { title: "R" });

    // Simulate typing.
    for (const title of ["Re", "Rev", "Revi", "Revie", "Review"]) {
      a.tick(50);
      await patch(a.db, a.ctx, "task", task.id, { title });
    }

    expect(await pendingCount(a.db)).toBe(1);
    const op = await a.db.outbox.toArray();
    expect((op[0]!.row as unknown as TaskRow).title).toBe("Review");
  });

  it("sends only the final coalesced value", async () => {
    const a = peer(server, "laptop");
    const task = await createTask(a.db, a.ctx, { title: "draft" });
    a.tick();
    await patch(a.db, a.ctx, "task", task.id, { title: "final" });

    await drainUntilQuiet(a.db, a.transport);

    expect((server.get("task", task.id) as TaskRow).title).toBe("final");
    expect(await pendingCount(a.db)).toBe(0);
  });

  it("never sends the server-owned updated_at", async () => {
    const a = peer(server, "laptop");
    await createTask(a.db, a.ctx, { title: "x" });
    const op = (await a.db.outbox.toArray())[0]!;
    expect(op.row).not.toHaveProperty("updated_at");
  });
});

describe("offline write then reconnect — the Phase 1 exit gate", () => {
  it("delivers an offline write to a second device on reconnect", async () => {
    const server = new FakeServer();
    const laptop = peer(server, "laptop");
    const phone = peer(server, "phone");

    // Wi-Fi off.
    server.offline = true;
    const task = await createTask(laptop.db, laptop.ctx, { title: "Buy oat milk" });

    const failed = await drain(laptop.db, server.transport());
    expect(failed.failed).toBe(1);
    expect(await pendingCount(laptop.db)).toBe(1);
    // The row is nonetheless usable locally — that is the whole point.
    expect(await taskById(laptop.db, task.id)).toBeDefined();

    // Wi-Fi on. Backoff would otherwise gate the retry, so drive time forward.
    server.offline = false;
    const later = () => Date.now() + 60_000;
    await drainUntilQuiet(laptop.db, server.transport(), 5, later);
    expect(await pendingCount(laptop.db)).toBe(0);

    // Second device pulls.
    server.tick();
    await pullAll(phone.db, phone.transport);
    expect(await taskById(phone.db, task.id)).toMatchObject({ title: "Buy oat milk" });
  });

  it("loses nothing when the tab dies mid-write and a fresh db reopens the same store", async () => {
    const server = new FakeServer();
    const db1 = new RainflowDB("rainflow-crash-test");
    const ctx = createWriteContext("laptop", () => new Date(1_700_000_000_000));

    await createTask(db1, ctx, { title: "survive the crash", id: "crash-1" });
    db1.close(); // tab dies before any drain

    const db2 = new RainflowDB("rainflow-crash-test");
    expect(await db2.task.get("crash-1")).toMatchObject({ title: "survive the crash" });
    expect(await pendingCount(db2)).toBe(1);

    await drainUntilQuiet(db2, server.transport());
    expect((server.get("task", "crash-1") as TaskRow).title).toBe("survive the crash");
    db2.close();
  });

  it("reproduces identical state from a cold bootstrap after clearing IndexedDB", async () => {
    const server = new FakeServer();
    const a = peer(server, "laptop");

    await createTask(a.db, a.ctx, { title: "one", id: "t1" });
    a.tick();
    await createTask(a.db, a.ctx, { title: "two", id: "t2" });
    a.tick();
    await softDelete(a.db, a.ctx, "task", "t2");
    await drainUntilQuiet(a.db, a.transport);

    // "Clear IndexedDB": a brand new local database, same server.
    const cold = peer(server, "laptop-reinstalled");
    server.tick();
    await pullAll(cold.db, cold.transport);

    expect(await taskById(cold.db, "t1")).toMatchObject({ title: "one" });
    // The tombstone is hydrated, not silently dropped.
    const t2 = await taskById(cold.db, "t2");
    expect(t2?.deleted_at).not.toBeNull();
  });
});

describe("RULE 1 — a pending op is never overwritten by a remote row", () => {
  it("ignores the server's echo of our own pre-edit row", async () => {
    const server = new FakeServer();
    const a = peer(server, "laptop");

    const task = await createTask(a.db, a.ctx, { title: "original" });
    await drainUntilQuiet(a.db, a.transport);

    // Local edit, not yet drained.
    a.tick();
    await patch(a.db, a.ctx, "task", task.id, { title: "edited locally" });
    expect(await pendingCount(a.db)).toBe(1);

    // The server still holds "original" and re-delivers it (cursor rewind / Realtime echo).
    const stale = server.get("task", task.id)!;
    await applyRemoteRows(a.db, "task", [stale]);

    // The in-progress edit survives. This is the bug that silently eats typing.
    expect((await taskById(a.db, task.id))!.title).toBe("edited locally");
  });

  it("keeps a newer edit made while its op was in flight", async () => {
    const server = new FakeServer();
    const a = peer(server, "laptop");
    const task = await createTask(a.db, a.ctx, { title: "v1" });

    // Send v1, but edit to v2 before completion is recorded.
    const op = (await a.db.outbox.toArray())[0]!;
    await server.transport().upsert("task", [op.row]);
    a.tick();
    await patch(a.db, a.ctx, "task", task.id, { title: "v2" });

    // Completing the v1 op must NOT clear the queue, or v2 never ships.
    const { completeOp } = await import("../../db/outbox");
    const removed = await completeOp(a.db, op.seq!, op.client_updated_at);
    expect(removed).toBe(false);
    expect(await pendingCount(a.db)).toBe(1);

    await drainUntilQuiet(a.db, a.transport);
    expect((server.get("task", task.id) as TaskRow).title).toBe("v2");
  });
});

describe("RULE 2 — last-write-wins on client_updated_at", () => {
  it("applies a strictly newer remote row", async () => {
    const server = new FakeServer();
    const a = peer(server, "laptop");
    await createTask(a.db, a.ctx, { title: "local", id: "t1" });
    await drainUntilQuiet(a.db, a.transport);

    const remote = {
      ...(server.get("task", "t1") as TaskRow),
      title: "from phone",
      client_updated_at: new Date(a.now() + 10_000).toISOString(),
      client_id: "phone",
    };
    await applyRemoteRows(a.db, "task", [remote]);

    expect((await taskById(a.db, "t1"))!.title).toBe("from phone");
  });

  it("rejects an older remote row", async () => {
    const server = new FakeServer();
    const a = peer(server, "laptop");
    await createTask(a.db, a.ctx, { title: "local newer", id: "t1" });
    await drainUntilQuiet(a.db, a.transport);

    const remote = {
      ...(server.get("task", "t1") as TaskRow),
      title: "stale from phone",
      client_updated_at: new Date(a.now() - 60_000).toISOString(),
      client_id: "phone",
    };
    const res = await applyRemoteRows(a.db, "task", [remote]);

    expect(res.skippedStale).toBe(1);
    expect((await taskById(a.db, "t1"))!.title).toBe("local newer");
  });

  it("is immune to a wildly wrong server clock", async () => {
    // A device whose client clock is correct must not lose to a row that merely has a newer
    // SERVER timestamp — that is what comparing updated_at would get wrong.
    const server = new FakeServer();
    const a = peer(server, "laptop");
    await createTask(a.db, a.ctx, { title: "correct", id: "t1" });
    await drainUntilQuiet(a.db, a.transport);

    server.tick(10_000_000); // server clock lurches forward
    const remote = {
      ...(server.get("task", "t1") as TaskRow),
      title: "older edit, newer server stamp",
      updated_at: new Date(server.clock).toISOString(),
      client_updated_at: new Date(a.now() - 60_000).toISOString(),
      client_id: "phone",
    };
    await applyRemoteRows(a.db, "task", [remote]);

    expect((await taskById(a.db, "t1"))!.title).toBe("correct");
  });

  it("converges both peers on the same winner for an exact tie", async () => {
    // Deterministic-and-arbitrary is the requirement: both devices must pick the SAME row.
    const server = new FakeServer();
    const a = peer(server, "laptop");
    const b = peer(server, "phone");

    const sameInstant = 1_700_000_500_000;
    a.setClock(sameInstant);
    b.setClock(sameInstant);

    await createTask(a.db, a.ctx, { title: "from laptop", id: "tie" });
    await createTask(b.db, b.ctx, { title: "from phone", id: "tie" });

    await drainUntilQuiet(a.db, a.transport);
    server.tick();
    await drainUntilQuiet(b.db, b.transport);

    server.tick();
    await pullAll(a.db, a.transport);
    await pullAll(b.db, b.transport);

    const ta = await taskById(a.db, "tie");
    const tb = await taskById(b.db, "tie");
    expect(ta!.title).toBe(tb!.title);
  });
});

describe("cursor rewind (R6)", () => {
  it("does not skip rows that share one updated_at across a page boundary", async () => {
    const server = new FakeServer();
    const a = peer(server, "laptop");

    // One batch, one timestamp, many rows — the shape that breaks strict `>` pagination.
    const rows: Partial<AnyRow>[] = [];
    for (let i = 0; i < 50; i++) {
      rows.push({
        id: `bulk-${String(i).padStart(3, "0")}`,
        title: `bulk ${i}`,
        description: null,
        status: "INBOX",
        is_urgent: false,
        is_important: false,
        estimated_mins: null,
        due_at: null,
        due_is_all_day: true,
        completed_at: null,
        parent_id: null,
        sort_order: i,
        client_updated_at: new Date(1_700_000_000_000 + i).toISOString(),
        deleted_at: null,
        client_id: "phone",
      });
    }
    server.seed("task", rows);

    await pullTable(a.db, a.transport, "task");
    expect(await a.db.task.count()).toBe(50);
  });

  it("re-delivers recent rows harmlessly and idempotently", async () => {
    const server = new FakeServer();
    const a = peer(server, "laptop");

    await createTask(a.db, a.ctx, { title: "one", id: "t1" });
    await drainUntilQuiet(a.db, a.transport);
    server.tick();

    await pullTable(a.db, a.transport, "task");
    const first = await taskById(a.db, "t1");

    // Pull again: the rewind re-fetches the same row. Nothing should change.
    await pullTable(a.db, a.transport, "task");
    expect(await taskById(a.db, "t1")).toEqual(first);
    expect(await a.db.task.count()).toBe(1);
  });

  it("advances the cursor only after rows are applied", async () => {
    const server = new FakeServer();
    const a = peer(server, "laptop");
    expect(await getCursor(a.db, "task")).toBeNull();

    server.seed("task", [
      {
        id: "seeded",
        title: "seeded",
        description: null,
        status: "INBOX",
        is_urgent: false,
        is_important: false,
        estimated_mins: null,
        due_at: null,
        due_is_all_day: true,
        completed_at: null,
        parent_id: null,
        sort_order: 0,
        client_updated_at: new Date(1_700_000_000_000).toISOString(),
        deleted_at: null,
        client_id: "phone",
      },
    ]);

    await pullTable(a.db, a.transport, "task");
    expect(await getCursor(a.db, "task")).not.toBeNull();
    expect(await a.db.task.count()).toBe(1);
  });
});

describe("retry and backoff", () => {
  it("retries after a transient failure without losing the op", async () => {
    const server = new FakeServer();
    const a = peer(server, "laptop");
    await createTask(a.db, a.ctx, { title: "flaky", id: "t1" });

    server.failNext = 1;
    const r1 = await drain(a.db, a.transport);
    expect(r1.failed).toBe(1);
    expect(await pendingCount(a.db)).toBe(1);

    // Backoff gates the immediate retry; jump past it.
    await drainUntilQuiet(a.db, a.transport, 5, () => Date.now() + 60_000);
    expect(await pendingCount(a.db)).toBe(0);
    expect(server.get("task", "t1")).toBeDefined();
  });

  it("records the error and escalates the backoff", async () => {
    const server = new FakeServer();
    const a = peer(server, "laptop");
    await createTask(a.db, a.ctx, { title: "doomed", id: "t1" });

    server.offline = true;
    await drain(a.db, a.transport);
    const afterOne = (await a.db.outbox.toArray())[0]!;
    expect(afterOne.attempts).toBe(1);
    expect(afterOne.last_error).toContain("offline");

    await drain(a.db, a.transport, () => afterOne.next_attempt_at + 1);
    const afterTwo = (await a.db.outbox.toArray())[0]!;
    expect(afterTwo.attempts).toBe(2);
    expect(afterTwo.next_attempt_at).toBeGreaterThan(afterOne.next_attempt_at);
  });

  it("does not send an op still inside its backoff window", async () => {
    const server = new FakeServer();
    const a = peer(server, "laptop");
    await createTask(a.db, a.ctx, { title: "waiting", id: "t1" });

    server.failNext = 1;
    await drain(a.db, a.transport);

    const before = server.requestCount;
    await drain(a.db, a.transport, () => 0); // "now" is before next_attempt_at
    expect(server.requestCount).toBe(before);
  });
});

describe("tombstones", () => {
  it("propagates a delete to another device", async () => {
    const server = new FakeServer();
    const a = peer(server, "laptop");
    const b = peer(server, "phone");

    await createTask(a.db, a.ctx, { title: "temporary", id: "t1" });
    await drainUntilQuiet(a.db, a.transport);
    server.tick();
    await pullAll(b.db, b.transport);
    expect((await taskById(b.db, "t1"))!.deleted_at).toBeNull();

    a.tick();
    await softDelete(a.db, a.ctx, "task", "t1");
    await drainUntilQuiet(a.db, a.transport);
    server.tick();
    await pullAll(b.db, b.transport);

    expect((await taskById(b.db, "t1"))!.deleted_at).not.toBeNull();
  });

  it("does not resurrect a deleted row from a stale update", async () => {
    const server = new FakeServer();
    const a = peer(server, "laptop");

    await createTask(a.db, a.ctx, { title: "gone", id: "t1" });
    await drainUntilQuiet(a.db, a.transport);
    const beforeDelete = server.get("task", "t1")!;

    a.tick(10_000);
    await softDelete(a.db, a.ctx, "task", "t1");
    await drainUntilQuiet(a.db, a.transport);

    // A stale pre-delete copy arrives late.
    await applyRemoteRows(a.db, "task", [beforeDelete]);

    expect((await taskById(a.db, "t1"))!.deleted_at).not.toBeNull();
  });
});

describe("two-peer convergence", () => {
  it("converges after interleaved edits on both devices", async () => {
    const server = new FakeServer();
    const a = peer(server, "laptop");
    const b = peer(server, "phone");

    await createTask(a.db, a.ctx, { title: "shared", id: "s1" });
    await drainUntilQuiet(a.db, a.transport);
    server.tick();
    await pullAll(b.db, b.transport);

    // Both edit; the phone's edit is later by client clock, so it must win.
    a.setClock(1_700_000_100_000);
    b.setClock(1_700_000_200_000);
    await patch(a.db, a.ctx, "task", "s1", { title: "laptop edit" });
    await patch(b.db, b.ctx, "task", "s1", { title: "phone edit" });

    await drainUntilQuiet(a.db, a.transport);
    server.tick();
    await drainUntilQuiet(b.db, b.transport);
    server.tick();
    await pullAll(a.db, a.transport);
    await pullAll(b.db, b.transport);

    const ta = await taskById(a.db, "s1");
    const tb = await taskById(b.db, "s1");
    expect(ta!.title).toBe("phone edit");
    expect(tb!.title).toBe("phone edit");
  });

  it("converges under randomised interleavings", async () => {
    // Not a fuzzer with a random seed — the sequence is fixed so a failure reproduces.
    const script = [0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 0, 0, 1, 0, 1];
    const server = new FakeServer();
    const a = peer(server, "laptop");
    const b = peer(server, "phone");

    await createTask(a.db, a.ctx, { title: "seed", id: "r1" });
    await drainUntilQuiet(a.db, a.transport);
    server.tick();
    await pullAll(b.db, b.transport);

    let clock = 1_700_001_000_000;
    for (const [i, who] of script.entries()) {
      clock += 1_000;
      const actor = who === 0 ? a : b;
      actor.setClock(clock);
      await patch(actor.db, actor.ctx, "task", "r1", { title: `edit-${i}-by-${who}` });
      await drainUntilQuiet(actor.db, actor.transport);
      server.tick();
      // The other peer pulls, sometimes lagging a step behind.
      if (i % 3 !== 0) {
        const other = who === 0 ? b : a;
        await pullAll(other.db, other.transport);
      }
    }

    server.tick();
    await pullAll(a.db, a.transport);
    await pullAll(b.db, b.transport);

    const ta = await taskById(a.db, "r1");
    const tb = await taskById(b.db, "r1");
    expect(ta!.title).toBe(tb!.title);
    expect(ta!.title).toBe(`edit-${script.length - 1}-by-${script.at(-1)}`);
    expect(await pendingCount(a.db)).toBe(0);
    expect(await pendingCount(b.db)).toBe(0);
  });
});

describe("realtime", () => {
  it("applies a change pushed from another device", async () => {
    const server = new FakeServer();
    server.realtimeEnabled = true;
    const a = peer(server, "laptop");

    const received: AnyRow[] = [];
    const unsub = a.transport.subscribe(async (table, row) => {
      received.push(row);
      await applyRemoteRows(a.db, table, [row]);
    });

    await server.pushRealtime("task", {
      id: "rt1",
      title: "from the phone",
      description: null,
      status: "INBOX",
      is_urgent: false,
      is_important: false,
      estimated_mins: null,
      due_at: null,
      due_is_all_day: true,
      completed_at: null,
      parent_id: null,
      sort_order: 1,
      updated_at: new Date(server.clock).toISOString(),
      client_updated_at: new Date(1_700_000_000_000).toISOString(),
      deleted_at: null,
      client_id: "phone",
    } as AnyRow);

    expect(received).toHaveLength(1);
    expect(await taskById(a.db, "rt1")).toMatchObject({ title: "from the phone" });
    unsub();
  });

  it("survives its own write being echoed straight back", async () => {
    const server = new FakeServer();
    server.realtimeEnabled = true;
    const a = peer(server, "laptop");

    const echoed: string[] = [];
    a.transport.subscribe(async (table, row) => {
      echoed.push((row as TaskRow).title);
      await applyRemoteRows(a.db, table, [row]);
    });

    // Establish v1 on the server and drain to empty.
    await createTask(a.db, a.ctx, { title: "v1", id: "e1" });
    await drainUntilQuiet(a.db, a.transport);
    const v1OnServer = server.get("task", "e1")!;

    // Local edit to v2, still pending.
    a.tick();
    await patch(a.db, a.ctx, "task", "e1", { title: "v2 being typed" });
    expect(await pendingCount(a.db)).toBe(1);

    /*
     * The server echoes v1 — the version it still holds. This happens for real whenever
     * another subscriber's write, a reconnect replay, or the pull's cursor rewind re-delivers
     * a row we have already moved past locally.
     */
    await server.pushRealtime("task", v1OnServer);
    await server.flushRealtime();

    // Guard that the echo genuinely arrived, so this cannot pass by doing nothing at all.
    expect(echoed).toContain("v1");
    // Rule 1: the pending edit wins. Without it, the user watches their typing get reverted.
    expect((await taskById(a.db, "e1"))!.title).toBe("v2 being typed");
  });
});

describe("multi-table integrity", () => {
  it("drains parents before children", async () => {
    const server = new FakeServer();
    const a = peer(server, "laptop");

    const task = await createTask(a.db, a.ctx, { title: "tagged", id: "t1" });
    a.tick();
    await put(a.db, a.ctx, "tag", { id: "g1", name: "project", color: "#38bdf8" });
    a.tick();
    await put(a.db, a.ctx, "task_tag", { task_id: task.id, tag_id: "g1" });

    await drainUntilQuiet(a.db, a.transport);

    expect(server.get("tag", "g1")).toBeDefined();
    expect(server.get("task", "t1")).toBeDefined();
    expect(server.get("task_tag", "t1|g1")).toBeDefined();
    expect(await pendingCount(a.db)).toBe(0);
  });

  it("round-trips a composite-key row", async () => {
    const server = new FakeServer();
    const a = peer(server, "laptop");
    const b = peer(server, "phone");

    await createTask(a.db, a.ctx, { title: "t", id: "t1" });
    await put(a.db, a.ctx, "tag", { id: "g1", name: "work", color: "#34d399" });
    await put(a.db, a.ctx, "task_tag", { task_id: "t1", tag_id: "g1" });
    await drainUntilQuiet(a.db, a.transport);

    server.tick();
    await pullAll(b.db, b.transport);

    expect(await b.db.task_tag.get(["t1", "g1"])).toMatchObject({
      task_id: "t1",
      tag_id: "g1",
    });
  });
});
