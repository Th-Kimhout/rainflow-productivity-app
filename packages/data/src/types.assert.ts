/**
 * Compile-time proof that the hand-written wire types in `wire.ts` match the types generated
 * from the live database in `types.gen.ts`.
 *
 * `wire.ts` was written before the Supabase CLI was available, so the two could drift — and a
 * drift here is the worst kind of bug, because TypeScript would keep insisting everything is
 * fine while PostgREST rejects rows at runtime. This file makes that a TYPE ERROR instead.
 *
 * Workflow after ANY schema change:
 *   1. write the migration, `supabase db push`
 *   2. `supabase gen types typescript --project-id … > src/types.gen.ts`
 *   3. `pnpm --filter @rainflow/data typecheck` — if it fails, update `wire.ts` to match
 *
 * This module has no runtime content. It exists purely to be typechecked.
 */

import type { Database } from "./types.gen";
import type {
  EnergyLevel,
  FocusPhase,
  FocusSessionRow,
  HabitKind,
  HabitLogRow,
  HabitRow,
  TableName,
  TagRow,
  TaskRow,
  TaskStatus,
  TaskTagRow,
  TimeBlockRow,
} from "./wire";

type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];

/** Mutual assignability. Both directions, so a missing OR an extra column fails. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Fails to compile unless `T` is exactly `true`. */
declare function assertExact<_T extends true>(): void;

// ------------------------------------------------------------------ table rows
assertExact<Exact<TaskRow, Tables["task"]["Row"]>>();
assertExact<Exact<TagRow, Tables["tag"]["Row"]>>();
assertExact<Exact<TaskTagRow, Tables["task_tag"]["Row"]>>();
assertExact<Exact<TimeBlockRow, Tables["time_block"]["Row"]>>();
assertExact<Exact<HabitRow, Tables["habit"]["Row"]>>();
assertExact<Exact<HabitLogRow, Tables["habit_log"]["Row"]>>();
assertExact<Exact<FocusSessionRow, Tables["focus_session"]["Row"]>>();

// ------------------------------------------------------------------ enums
assertExact<Exact<TaskStatus, Enums["task_status"]>>();
assertExact<Exact<HabitKind, Enums["habit_kind"]>>();
assertExact<Exact<EnergyLevel, Enums["energy_level"]>>();
assertExact<Exact<FocusPhase, Enums["focus_phase"]>>();

/**
 * Every synced table in `wire.ts` exists in the database.
 *
 * Note this is deliberately one-directional: `app_owner` is a real table that is intentionally
 * NOT synced (it changes once, ever, and the client has no reason to replicate it), so
 * requiring the reverse would be wrong.
 */
type SyncedTablesExistInDb = TableName extends keyof Tables ? true : false;
assertExact<SyncedTablesExistInDb>();

/**
 * Ids are client-generated, so `id` must be REQUIRED on insert.
 *
 * If a `default gen_random_uuid()` ever gets added to a table, `id` becomes optional in the
 * generated Insert type and this assertion fails — which is exactly the signal we want, since
 * a server-generated id breaks offline writes (ADR 0001 decision 6: an offline write has to
 * know its own primary key before it ever reaches the server).
 */
type IdIsRequiredOnInsert = "id" extends keyof Omit<Tables["task"]["Insert"], "id">
  ? false
  : undefined extends Tables["task"]["Insert"]["id"]
    ? false
    : true;
assertExact<IdIsRequiredOnInsert>();

/**
 * `client_updated_at` must also be required on insert — it is the last-write-wins comparator,
 * and a row that arrives without one cannot be ordered against anything.
 */
type ClientUpdatedAtRequired = undefined extends Tables["task"]["Insert"]["client_updated_at"]
  ? false
  : true;
assertExact<ClientUpdatedAtRequired>();

export {};
