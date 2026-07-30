# ADR 0001 — Deviations from the PRD

**Date:** 2026-07-30
**Status:** Accepted
**Supersedes:** parts of `../RainFlow_PRD_Requirements.md` v1.0

## Context

The PRD was written before any infrastructure existed. Reviewing it against the actual repo
surfaced one hard contradiction (Neon vs. the already-provisioned Supabase project) and nine
places where the §6 schema could not express what §3 promises.

This ADR is the authoritative record of where the implementation diverges. **Where this file and
the PRD disagree, this file wins.** The PRD is kept for the product intent in §1, §3, §4 and §5,
which remain accurate.

## Stack decisions

| # | Decision | Supersedes | Rationale |
|---|---|---|---|
| 1 | **Supabase**, not Neon | §1.4, §2.2, §7.2 | Neon free meters 100 compute-hours/mo, which an always-open tab burns through; Supabase does not meter. Supabase also bundles Realtime (device sync) and Auth (replacing the shared-secret scheme) at no cost. Accepted trade: no free PITR, no free DB branching. |
| 2 | **Supabase-native data layer** — SQL migrations + generated types + `supabase-js`. No Prisma | §2.2, §6, §8.3 | Prisma connects as a privileged role and bypasses RLS; Realtime authorises channels *through* RLS. Keeping Prisma would forfeit both features that motivated decision 1. |
| 3 | **Local-cache-first, no service worker** | §1.2 | Dexie/IndexedDB is the render source, so reads are instant and work offline; writes go to Dexie plus an outbox. A cold load with no network **fails** — see Known limits. Serwist would fix it but requires webpack, which fails `next build` under Turbopack. |
| 4 | **Sync bypasses Server Actions** — browser ↔ PostgREST direct, Realtime back | §2.1 | Next 16 Server Actions dispatch sequentially (no parallel queue drain), cap bodies at 1MB, and rotate action IDs ~every 14 days, producing `Failed to find Server Action` in exactly the long-lived tab an offline-first app depends on. |
| 5 | **RLS authenticated-only + owner-pin, no `user_id` columns** | §7.2 | Honours §1.3's N=1 simplicity while still giving real defence in depth. `PERSONAL_APP_SECRET` is dropped. **Signups must be disabled** — see Known limits. |
| 6 | **Real Next routes per destination**; `?view=`/`?task=`/`?zen=` as shallow searchParams. `cacheComponents` stays **off** | — | No route has server data, so each page prerenders to CDN-static HTML — that is the §7.1 FCP budget. `cacheComponents` would buy nothing and its `<Activity>` hiding pauses `setInterval`, breaking the pomodoro. |
| 7 | **No `proxy.ts`** (the Next 16 rename of `middleware.ts`) | §7.2 | RLS is the real boundary. A proxy would make every route dynamic and forfeit the static-shell FCP win. A client `<AuthGate>` is sufficient. |
| 8 | **Weekly digest computed on view** from Dexie | §3.6 "Automated" | No cron or scheduled function needed; the data is already local. |
| 9 | **Backups via client-side JSON export** | §7.2 | Supabase's free tier has no point-in-time recovery. §7.2's "Automated Database Backups … via Neon point-in-time recovery" is not achievable and is replaced by an explicit export. |
| 10 | Repo is **public**, named `rainflow-productivity-app` | §8.1 | Safe because decision 5 provides real auth + RLS rather than a shared secret. |

## Schema deviations from §6

| §6 | Change | Why |
|---|---|---|
| `enum Priority` | removed | Derived from the Eisenhower booleans |
| `enum MatrixQuadrant` | removed as a column | Derived in TypeScript; no server query needs it |
| `Task.priority`, `Task.quadrant` | → `is_urgent` + `is_important` | §6 stored two overlapping facts with no single source of truth, so §3.1's `@high` parsing and §3.2's matrix drag could silently disagree |
| `Task.isCompleted` | removed | §6 had *three* representations of completion; `status` + `completed_at` is enough |
| `Task.actualMins` | removed, derived in Dexie | **Hard rule: no server-side writes to any column the client full-row-upserts.** A trigger maintaining it and a client upsert clobber each other |
| `Task.timeboxStart/End` | → separate `time_block` table | §6 allowed exactly one calendar slot per task ever, contradicting §3.2 drag-and-drop and §3.6 planned-vs-actual |
| `Task.energyRating String` | → `focus_session.energy` enum | §3.6 maps energy "against time of day", which requires a time-anchored row |
| `Task.dueDate` | → `due_at` + `due_is_all_day` | §3.1 parses both "tomorrow" and "tomorrow at 3pm" |
| `Task` (no ordering) | + `sort_order` | §3.2 drag-and-drop had nothing to persist |
| `@@index([status, dueDate])`, `@@index([quadrant])` | removed; recreated in Dexie | All reads are local |
| `Tag`, `TaskTag` | + full sync column set; partial unique on `lower(name)` | Renames, deletes and un-tagging must propagate |
| `Habit.frequency String`, `targetDays` | → `kind` / `interval_days` / `weekdays` / `month_day` / `target_per_period` | §6 **could not express** §3.4's "Interval (Every X days)" or "Nth day of month" |
| `Habit` | + `archived_at` | Stop tracking without destroying history |
| `HabitLog.completedAt` | → `log_date date` + `completed_at`, `unique(habit_id, log_date)` | §6 permitted completing the same habit twice in one day; streaks need a date, not a timestamp |
| `FocusSession.durationMin`, `completedAt` | → `started_at` / `ended_at` / `planned_mins` / `actual_secs` / `was_completed` / `phase` | §3.6's "top focus hours" is uncomputable without a start time; §3.3 needs resumability |
| everywhere | + `updated_at`, `deleted_at`, `client_updated_at`, `client_id`; **no `gen_random_uuid()` default** | Offline writes must know their own id before reaching the server, and deletes must propagate as tombstones |
| `onDelete: Cascade` / `SetNull` | kept as deferrable constraints, never actually triggered | Soft delete; deferral removes intra-batch ordering requirements |
| `Note`, `NoteLink`, `[[backlinks]]` | never created | §3.5 reduced — see below |

## Scope reductions

- **§3.5 reduced** to markdown rendering with syntax-highlighted code fences on `task.description`.
  No standalone notes, no bi-directional `[[Note Title]]` links.
- **§3.2 task dependencies cut.** Mentioned in prose, never modelled in §6. Deferred.
- **§3.4 `MONTHLY_NTH` means day-of-month** ("the 15th"), not "the 2nd Tuesday". Day 29–31 clamps
  to the last day of the month, enforced client-side.
- **`@medium` is not a valid capture token.** There is no clean mapping from four priority levels
  onto two booleans. The grammar is `@urgent` / `@important`, with `@high` = both and `@low` = neither.

## Additions the PRD did not specify

- **Fixed timezone `Asia/Phnom_Penh`** for every day boundary. The PRD never named a timezone, yet
  streaks, the Today view, "Nth day of month" and daily velocity all depend on when a day starts.
- **Board view is the last thing built and a candidate to cut.** List + Matrix + Calendar already
  cover every step of §5.1.

## Known limits (accepted, not oversights)

1. **Offline is narrower than §1.2's "fully functional without active network".** An already-loaded
   tab works completely, and prefetched routes navigate fine. A **cold load with no network fails**,
   because the HTML/RSC payload must come over the network.
2. **Signups must be disabled in Supabase Auth settings.** With `auth.uid() is not null` policies and
   Supabase's default-open signups, anyone who signs up with any email would get full read/write via
   the public anon key. Mitigated by disabling signups, `signInWithOtp({ shouldCreateUser: false })`,
   and pinning policies to the owner's uid (migration `0008_owner_pin`).
3. **No cross-device field-level merge.** Full-row upsert with last-write-wins means two devices
   editing *different fields* of the same task will lose one. Correct for N=1; deliberately not
   "fixed" with per-field timestamps or a CRDT.
4. **IndexedDB eviction is the real data-loss risk.** Safari/iOS evicts storage for origins unused
   ~7 days, and this is not an installed PWA so there is no exemption. Mitigated by
   `navigator.storage.persist()`, a persistent banner while the outbox is non-empty, and JSON export.
5. **Supabase free tier pauses after ~7 days idle.** Fine for daily use; a long holiday needs a
   manual unpause.

## Note on §4.1's colour palette

Every hex in §4.1 is a **Tailwind v3** value. Tailwind v4 ships those colours in oklch with slightly
different rendered values, so the palette is defined as **hex literals** in `@theme` and never
references `--color-slate-900` and friends.
