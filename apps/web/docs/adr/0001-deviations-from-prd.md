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
| 11 | **Email + password login**, not magic link | §7.2 | Forced by a free-tier limit, then kept on merit — see below. |
| 12 | Password floor **12 characters**, `lower_upper_letters_digits` | — | Length dominates composition for credential strength, and this one lives in a password manager. |

### Decision 11 in detail — why login is a password, not a magic link

The plan called for magic-link auth with a 6-digit OTP fallback, because PKCE stores its code
verifier in the localStorage of the browser that **requested** the link: request on a laptop,
open the mail on a phone, and the exchange fails with an opaque error. The `{{ .Token }}` code
was the escape hatch.

That escape hatch is not available. Supabase rejects template edits on the free tier:

> Email template modification is not available for free tier projects using the default email
> provider. Please upgrade your plan or configure a custom SMTP provider.

Worth noting the failure mode: a `[auth.email.template.*]` block does not get *ignored*, it
makes the entire `supabase config push` fail with a 400 — so it silently blocks every other
auth setting in `config.toml` from being applied.

The default template contains no `{{ .Token }}`, so there is no code to fall back to, which
left three options: same-device-only magic links, wiring up free custom SMTP (Resend) to unlock
templates, or dropping email from the login path entirely.

**Password auth was chosen, and is arguably better here regardless of the free-tier limit:**

- No cross-device problem at all — no PKCE verifier to strand on the wrong machine.
- No dependency on email delivery for the ability to log in, which matters for an app whose
  whole premise is working when the network is unreliable.
- No email round-trip on every session expiry. For an app used daily, that friction is real and
  runs directly against §1.2's zero-friction principle.
- Signups stay **disabled**; the account is created via the dashboard, so the password being
  enabled does not open a registration path.

The cost is one credential to manage, which a password manager handles. `supabase/templates/`
was removed rather than left as a dead file; if custom SMTP is ever configured, magic links
become available again with no schema or RLS change.

### A trap in `supabase config push`

It pushes the **entire** `config.toml`, and any key omitted locally is filled from CLI defaults
which then overwrite the remote value. The first push would have silently **disabled TOTP MFA**
(remote `true` → CLI default `false`) and dropped the email rate limit from `1m0s` to `1s`.
Both are now pinned explicitly in `config.toml` with a warning comment. When adding settings
there, add — never omit and assume the remote value survives.

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
| `onDelete: Cascade` / `SetNull` | kept as deferrable constraints, never actually triggered; **cascade re-implemented client-side** | Soft delete; deferral removes intra-batch ordering requirements — see below |
| `Note`, `NoteLink`, `[[backlinks]]` | never created | §3.5 reduced — see below |

### Soft delete means SQL `on delete cascade` never fires

Every delete in RainFlow sets `deleted_at` and syncs it as an ordinary update, because a tombstone
is the only thing that can tell another device a row is gone. A consequence that is easy to miss:
the database's `on delete cascade` only runs on a real `DELETE`, so **it never runs here at all.**

Deleting a task therefore left its `time_block` rows alive, and the calendar went on drawing them
under a task that no longer existed. This went unnoticed through Phase 3 because every child up to
that point (`task_tag`, subtasks) is only ever reached *through* its parent — an orphan with no
view of its own is invisible. `time_block` is the first child with its own screen.

The fix is `CASCADE_CHILDREN` in `wire.ts`, a declarative mirror of the SQL relationships that
`softDelete` walks depth-first. `focus_session` is deliberately excluded: its FK is
`on delete set null`, and §3.6's record of time actually spent should outlive the task it was about.

**The general rule: any new FK needs a matching `CASCADE_CHILDREN` entry, or its children become
orphans on delete.** The tests in `sync.test.ts` under "soft delete cascades to dependent rows"
fail if the walk is removed.

### The pomodoro measures time, it does not count it

§3.3's timer is derived from timestamps (`runningSince`, `accumulatedMs`) and recomputed on every
render. It never decrements a counter on a `setInterval`, which is the obvious implementation and
is wrong in three independent ways:

- Browsers throttle background-tab timers to once a second at best, and Chrome drops hidden tabs to
  **once a minute** after a few minutes. A counting timer left in the background finishes a
  "25 minute" phase well over an hour later.
- A sleeping laptop fires no timers at all.
- Every dropped tick is permanent — the error accumulates with nothing to correct against.

The interval in `lib/clock.ts` exists **only to trigger repaints**. If it fires late, or not at all,
the next render is still correct. Three consequences fall out for free: the module is testable by
passing `now` in, a phase that expired while the tab was hidden completes on the first render after
waking, and two tabs agree without exchanging a single message — they are reading the same
timestamps rather than running two clocks.

`actual_secs` is the sum of the *running* segments, never `ended_at - started_at`. Paused time sits
between those two, and counting it would inflate every §3.6 figure.

### Energy is asked at the end of a focus phase, not in an analytics screen

§3.6 wants energy correlated with time of day, which only works if the answer is about the session
that just happened. Asked the next morning it is a guess, systematically biased by how the rest of
the day went. This is also why the ADR moved `energyRating` off `Task` and onto `focus_session` — a
task worked on across four sittings has four energies, not one.

The prompt is dismissible and never blocks. A prompt you must clear before starting a break is a
prompt you learn to click through at random, and junk data is worse than none. Skipped and abandoned
phases are not asked about at all.

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
2. ~~**Signups must be disabled in Supabase Auth settings.**~~ **DONE** — `enable_signup = false`
   and `enable_anonymous_sign_ins = false` are applied to the remote project via
   `supabase config push`. Without this, anyone who signed up with any email would have reached
   the `app_owner` check with a valid session; the policy pin would still have denied them, but
   there was no reason to leave the outer door open. Verified: anonymous requests to all 8 tables
   return HTTP 401 `permission denied for table`.
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
