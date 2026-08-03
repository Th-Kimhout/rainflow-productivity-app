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

### `INTERVAL` is anchored on the last completion, not a fixed grid

"Every 3 days" is meaningless without a starting point, and `habit` has no creation or start date —
§6 never gave it one. Two ways to resolve that: add a `starts_on` column and lay a fixed calendar
grid from it, or anchor on the most recent completion. **The last completion wins**, and not only
because it avoids a migration.

A fixed grid means missing one occurrence leaves you permanently out of step with your own habit:
water the plants a day late and every future due date is still on the original grid, so you are late
for ever. Anchoring on the last completion is what "every three days" actually means. It also makes
an overdue habit **stay** due instead of skipping to the next grid slot, which is what keeps a
streak honest.

The cost is that `INTERVAL` is not a pure function of the day alone — it needs the completion
history — so every function in `domain/recurrence.ts` takes the completed-day set, and the kinds
that do not need it ignore it. A habit never completed is due immediately: it is waiting on you, not
"not yet scheduled".

### A habit's history begins at its first completion

Same missing-creation-date problem, different symptom. A streak window that simply ran back N days
would count every day before the habit existed as a miss — **a habit created this morning would open
with 729 misses and a 0.9% completion rate.** False, and the most discouraging thing a habit tracker
could say to someone on day one. So the window starts at the first completion, and a habit never
completed has no history at all.

Two more rules in `domain/streaks.ts`, both easy to get wrong in ways that punish the user:

- **Only a due day can break a streak.** A weekdays habit must not lose its streak over the weekend
  and a monthly one must not lose it on the 2nd. Counting calendar days instead of scheduled days
  makes every non-daily habit impossible to keep.
- **Today is not yet a miss.** The day is not over. A streak that resets at midnight is wrong for
  most of every day and reads as a punishment for not having done the thing yet. Today is excluded
  from the completion-rate denominator too, or the number would be at its worst at breakfast.

The heatmap distinguishes **three** states, not GitHub's two: done, missed, and *not scheduled*. A
completions-only grid makes a weekdays habit look like it fails every weekend, and gives no way to
tell a day off from a day dropped — which is the most useful thing the picture can say.

### Shiki uses the JavaScript regex engine, not Oniguruma

Oniguruma is Shiki's default and is faster on pathological grammars, but it is **WASM fetched at
runtime**. RainFlow has no service worker (decision 3), so that fetch fails offline — and an
already-loaded tab continuing to work is the entire point of the local-first design. Highlighting
that silently stops on a train is worse than highlighting a few milliseconds slower. The JS engine
is plain JavaScript and ships in the bundle.

Two more constraints on the same dependency:

- **`createHighlighterCore` with an explicit language list**, never the bundled `shiki` entry point,
  which carries every grammar and theme Shiki knows and imports them eagerly. Six languages are
  carried (`typescript`, `tsx`, `javascript`, `json`, `sql`, `bash`) plus aliases; anything else
  renders as plain text rather than failing.
- **Loaded on demand.** Measured after Phase 7: 680 KB of grammars across 7 chunks, **none of it on
  a cold page load**. The cost lands on the first task containing a fence.

Both themes are baked into the output as `--shiki-light` / `--shiki-dark` CSS variables, picked
between in `globals.css`. Re-highlighting on theme change would flash unstyled code on every toggle.

### No `rehype-raw`, and that is a security decision

react-markdown escapes embedded HTML by default. That default is doing real work here: a
`task.description` **arrives over the sync channel**, so it is not simply "the user's own trusted
input". Adding raw-HTML support to get a `<details>` or a `<kbd>` would open script injection
through a row, for formatting GFM already mostly covers. A test asserts it stays off.

Shiki's output is the one place `dangerouslySetInnerHTML` is used. Safe: Shiki escapes the source it
is given and emits only its own `<pre>`/`<span>` structure.

GFM task-list checkboxes render **read-only**. Ticking one would have to rewrite the markdown source,
and a checkbox that looks interactive and silently does nothing is worse than one that plainly is
not. Subtasks (§3.2) are the real mechanism.

### The weekly digest is computed on view, not generated

§3.6 calls the digest "automated", which reads like a cron job writing a summary row. At N=1 that
would mean a scheduled Edge Function, a table to store results in, and a new class of bug: a digest
that disagrees with the data it came from, with nothing to say which is right. A year of this user's
history is a few thousand rows — summing them takes microseconds, cannot go stale, and works
offline like everything else.

Three rules the analytics functions enforce, each of which would otherwise produce a plausible
wrong number:

- **Only `FOCUS` sessions count as focus time.** Breaks are recorded too (that is what the `phase`
  column is for), and counting them inflates every figure.
- **`actual_secs`, never `ended_at - started_at`.** Paused time sits between those two; a session
  interrupted by lunch would otherwise report three hours of focus.
- **Habit consistency is the mean of each habit's own rate, not pooled completions over pooled due
  days.** Pooling lets one daily habit outvote five weekly ones purely by having more occurrences,
  so a perfect week on everything except the daily one would read as a bad week.

An hour with no energy ratings reports `null`, not `0` — zero would plot as rock-bottom energy at
3am for someone who has simply never worked at 3am, and the chart would advise against hours that
were never tried.

Charts are hand-written SVG. Recharts and similar are 100–300 KB for what is three bar charts with
fixed axes, and each ships responsive-container machinery that fights the flex layout.

### Tags reach the UI late, and via `?tag=` rather than `/tag/[slug]`

§3.1's capture grammar wrote tags that nothing ever read: typing `#project` created a `tag` row and
a `task_tag` link, and no surface in the app showed either. A parser that discards half its own
output is worse than one that never had the feature, so `/tags`, the chips on task rows, and the
inspector's tag editor close that loop.

The route is a static page with `?tag=`, not the dynamic `/tag/[slug]` the plan named. The dynamic
segment was built first and was wrong twice: it renders on demand rather than prerendering, spending
the §7.1 FCP budget on a page whose data is entirely local; and `generateStaticParams` cannot help,
because the tags only exist in IndexedDB — so the route could never be prefetched, and navigating to
it offline would fail while every other route kept working.

### Board view: cut

Listed in the plan as a candidate. Cut. §5.1's flow is capture → prioritise → timebox → execute →
review, and List, Matrix and Calendar cover every step of it. A Kanban board is a fourth way to look
at `status`, which the list already groups by and the matrix already re-ranks — new surface area,
no new capability, and one more view to keep in step with every future schema change.

### End-to-end tests are hermetic — no credentials, no real database

Five Playwright specs, run against a production build with a **fake Supabase URL and key**, with
every request to that host intercepted. So they need no secrets, cannot touch the real project, and
behave identically on a laptop and in CI.

Signing in goes through the real login form rather than seeding a session. `@supabase/ssr` stores
the session in chunked, base64-prefixed cookies whose layout is an internal detail — a spec that
hand-writes them tests one reading of that library's source and breaks silently on any upgrade.

This works because the app is designed for it: no view reads from the network, so a stubbed server
is not a reduced version of the app. It is the app on a bad connection, which is a state it is meant
to handle perfectly — and one spec asserts exactly that.

The specs run against `build && start`, not `dev`, because Next 16 refuses a second dev server for a
directory that already has one — which is every machine anyone would run these on.

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

### The calendar is operable by keyboard, and drawing on it creates a block

§4.2 claims the app is 100% operable without a mouse, and the calendar was the one view where that
was false — it had day navigation and nothing else, so a block could only be created, moved, resized
or removed by dragging. Selection (`J`/`K`), move (`⇧↑`/`⇧↓`), resize (`+`/`−`), open, focus and
unschedule are all bound now.

Left/right change the day and up/down move through blocks, rather than the reverse: the grid's own
axis is vertical, so that is the direction the eye already reads it in.

**Drawing on empty grid opens a task picker rather than creating an empty block.** `time_block.task_id`
is `not null`, so there is nothing to create until a task is chosen — but the gesture is worth having
because dragging from the rail can only answer "when does this task go", never "I have this hour
free, what goes in it". A drag shorter than two slots is treated as a stray click and ignored.

The grid also scrolls to an hour before the now-line on open (07:00 on other days). Opening at 00:00
meant every visit began by scrolling past eight empty hours of night.

## The app is usable on a phone, which required more than a layout

The PRD never mentions mobile. Adding breakpoints turned out to be the small half of the job: three
capabilities were not cramped on a touchscreen, they were **absent**, because the only route to each
needed hardware a phone does not have.

**Capture had no button.** §3.1 binds quick capture to `⌘K` and `C` and to nothing else. Without a
keyboard there was no way to create a task at all — RainFlow was read-only on a phone. The `＋` in
the middle of the bottom bar is the fix, and the middle is deliberate: it is the one point a thumb
reaches from either hand without regripping. It opens the palette through a module-scoped store
(`lib/capture.ts`), because the button and the `⌘K` handler are siblings several levels apart.

**HTML5 drag-and-drop does not exist on a touchscreen.** Mobile Safari and Chrome for Android never
dispatch `dragstart` for a finger. That silently removed both calendar drag paths — rail onto the
grid, and a block to a new time — and quadrant drag in the matrix. Every one now has a pointer-event
route: tap empty grid to create, a grip along a block's top edge to move, and the existing bottom
handle to resize. Pointer events are the only input model both devices agree on.

Creating is a **tap**, not a drag, and that is not a simplification. The grid is also the scroll
container, so capturing a vertical drag to draw a range would leave the day unscrollable. A tap
opens the picker for a default-length block, which is adjustable immediately afterwards.

**Hover-only affordances were unreachable.** Row delete, block unschedule and habit archive were all
`group-hover`. They are written as `pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100` —
hiding scoped to where hovering can undo it — rather than `opacity-0 pointer-coarse:opacity-100`,
which relies on Tailwind's variant sort order to break a tie between two competing rules.

### Layout

| Below `md` | `md`–`xl` | `xl` and up |
|---|---|---|
| Bottom bar, sidebar hidden | Sidebar | Sidebar |
| Inspector is a full-height sheet | Inspector is a sheet | Inspector docks as a third pane |
| Matrix stacks to one column | 2×2 | 2×2 |
| Calendar rail hidden | Rail | Rail |

The inspector docks at `xl` rather than `md` because 224 + 320px of permanent chrome leaves a 480px
canvas at 1024px wide — narrower than the calendar grid the drawer is describing.

The calendar rail is **not** replaced by a phone equivalent. Its only job is to be something to drag
from, and dragging from it is exactly what does not work; the same task list is reachable by typing
into the picker.

### Two traps worth naming

**`viewportFit: "cover"`, and no `maximumScale`.** Capping the scale is the usual one-line cure for
iOS zooming into a focused input, and it works by disabling pinch-zoom for everyone, permanently.
The cure is a CSS rule putting form controls at 16px under 768px — the size iOS is actually asking
for. That rule is **unlayered on purpose**: Tailwind's `utilities` layer beats its `base` layer, so
written inside `@layer base` it loses to every `text-xs` in the app and does nothing at all.

**`h-dvh` on the body, not `h-full`.** `height: 100%` resolves against mobile Safari's *large*
viewport — the one that assumes the URL bar is hidden — so the status bar and the bottom bar sat
below the fold until you scrolled.

### Testing

A second Playwright project runs `e2e/mobile.spec.ts` on a Pixel 7 profile, and `hasTouch` is the
part that matters: `tap()` dispatches real touch events, so a mouse-only handler fails there and
passes everywhere else.

Two traps caught by mutation-testing those specs, both of which had produced a green test over a
broken feature:

- **`page.mouse` cannot test a touch drag.** Chromium turns mouse-down-and-move on a `draggable`
  element into a native HTML5 drag, so the block moved by the desktop path and the spec passed with
  the grip completely unwired. The move test dispatches touch points through CDP instead.
- **`toHaveText(await locator.innerText())` can never match.** `toHaveText` compares against
  `textContent` with whitespace collapsed, and `innerText` inserts a newline that `textContent` does
  not have — so the negated form passes whatever the element does. This had made the desktop
  calendar spec's move assertion vacuous too.

### Installed to the homescreen, and zoom is off

Rain runs this as a homescreen app, which changes the right answer to the iOS input-zoom problem.
The viewport now sets `maximum-scale=1, user-scalable=no`. That is normally the wrong fix — it
takes pinch-zoom from everyone to solve one app's problem — and is the right one here: single user,
installed, and the thing being protected is §4.1's own 12–14px type.

**It only works installed.** Safari has ignored `maximum-scale` since iOS 10 and always permits
pinch-zoom in a tab; only the standalone web view honours it. So the 16px-form-controls rule stays,
scoped to `@media (display-mode: browser)` — active in a Safari tab, inert once launched from the
homescreen, where the cap does the work and nothing gets inflated.

That dependency is why `app/manifest.ts` and `appleWebApp` exist at all: without standalone mode the
viewport cap is dead text. Two notes on getting there:

- Next 16 emits only the standardised `mobile-web-app-capable`. iOS honoured the Apple-prefixed
  name for a decade before adopting it, so `metadata.other` adds it back. Verified against the
  built HTML rather than assumed.
- `statusBarStyle: "black-translucent"` runs the app under the clock and the notch, which is what
  suits a slate-900 canvas — and obliges `<body>` to hold that space back with
  `env(safe-area-inset-top)`.

Icons are generated by `apps/web/scripts/make-icons.mjs`: a raindrop in Rain Blue on the slate
background, written straight to PNG with `node:zlib` rather than adding an image dependency to draw
four static files. Re-run it if the palette changes.

**Installing does not make it work offline.** There is still no service worker (decision 3; Serwist
needs a `webpack` key that Turbopack rejects), so a cold launch with no network fails on the HTML
itself. Known limit 1 is unchanged — installing changes how the app is framed, not what it can do
without a connection. A hand-written `public/sw.js` would sidestep the Turbopack objection, since
only Serwist's build-time manifest injection needs webpack.
