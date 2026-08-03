# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

RainFlow is a single-user, local-first productivity app. pnpm workspace: `apps/web` (Next.js 16 +
Turbopack) and `packages/data` (`@rainflow/data`).

**`apps/web/docs/adr/0001-deviations-from-prd.md` is authoritative.** It records ~20 places where the
implementation departs from `apps/web/docs/RainFlow_PRD_Requirements.md` and why. Where the PRD and
the ADR disagree, the ADR wins. Read it before changing anything architectural.

`apps/web/AGENTS.md` also applies: this is Next.js 16, which differs from most training data. Read
the relevant guide in `node_modules/next/dist/docs/` before writing app code.

## Commands

```bash
pnpm dev                       # apps/web on :3000
pnpm -r typecheck              # both packages
pnpm -r test                   # Vitest, both packages
pnpm --filter web lint         # ESLint incl. React Compiler rules
pnpm --filter web build        # every route must stay ○ Static
pnpm test:e2e                  # Playwright (builds first, serves on :3100)
```

Single tests:

```bash
cd packages/data && pnpm exec vitest run src/domain/streaks.test.ts
cd packages/data && pnpm exec vitest run -t "breaks on a missed due day"
cd apps/web     && pnpm exec vitest run src/lib/focus
pnpm exec playwright test --config apps/web/playwright.config.ts -g "captures a task"
```

**The timezone sweep is part of "green".** Day-boundary logic must pass under every host timezone:

```bash
cd packages/data
for TZ_NAME in Pacific/Kiritimati America/Los_Angeles UTC Asia/Phnom_Penh; do
  TZ=$TZ_NAME pnpm exec vitest run
done
```

After a schema change, regenerate types or `types.assert.ts` will fail the build — see
`supabase/README.md` for the exact command.

App icons are generated, not drawn: `node apps/web/scripts/make-icons.mjs` (no image dependency —
it writes PNGs with `node:zlib`). Only needed if §4.1's palette changes.

## Architecture

```
Browser ─── Dexie/IndexedDB          ← EVERY view reads here, never the network
             │  a write = Dexie row + outbox op, in ONE transaction (db/repo.ts)
             ▼
           outbox ──drain──► Supabase PostgREST (RLS)
                     ◄──────  Realtime ──► applyRemoteRows ──► Dexie
```

Next serves a static shell and nothing else. **No route fetches server data**, which is what lets
every page prerender to CDN-static HTML. React bindings live in `apps/web/src/lib/data/hooks.ts`
wrapping `useLiveQuery`; the sync engine knows nothing about React.

`packages/data` depends only on `dexie`, `@supabase/supabase-js` and `chrono-node`. That dependency
list is the enforcement mechanism — it structurally prevents the sync engine importing `react` or
`next/*`, so the whole package runs in a plain Node test process. Do not add React to it.

### The invariants that will bite you

**`sync/apply-remote.ts` is the most important file here.** Two rules, and breaking either produces
data loss that is very hard to diagnose later:

1. Never apply a remote row over a row with a pending outbox op. The server still holds the *old*
   version and will echo it back; applying it overwrites text the user is still typing.
2. Last-write-wins compares `client_updated_at`, **never** `updated_at`. `updated_at` is server-owned
   and exists solely as the pull cursor — comparing it makes the most recently *synced* row win
   rather than the most recently *edited* one. Ties break on `client_id`, not on `updated_at`: a
   locally-written row carries a client-clock placeholder there until a pull replaces it, so
   comparing it pits two unrelated clocks against each other and peers diverge permanently.

**Soft delete means SQL `on delete cascade` never fires.** Deletes set `deleted_at` and sync as
ordinary updates. Any new foreign key needs a matching entry in `CASCADE_CHILDREN` (`wire.ts`) or its
children become orphans. `focus_session` is deliberately excluded — its FK is `on delete set null`.

**Tombstones are kept locally.** Every Dexie query must exclude `deleted_at` — use the `live()`
helper in `hooks.ts` rather than hand-rolling the filter.

**All day-boundary maths goes through `time/tz.ts`.** The app timezone is fixed to
`Asia/Phnom_Penh`. Host-local date methods (`getHours`, `toISOString().slice(0,10)`) are a bug that
passes on your machine and fails on someone else's.

**`wire.ts` is hand-written; `types.assert.ts` proves it matches the live database at compile time.**
It also asserts `id` and `client_updated_at` stay *required on insert* — a `default gen_random_uuid()`
appearing on a table would break offline writes and shows up as a type error.

**Never edit an existing Dexie `version().stores()`.** Add a new version; see the note in
`db/schema.ts`. Safe because every row also lives on the server — except the outbox, which does not.

### Domain modules are pure and heavily tested

`packages/data/src/domain/` — `eisenhower`, `schedule`, `pomodoro`, `recurrence`, `streaks`,
`analytics`. No Dexie, no React, no ambient clock (`now` is a parameter). Several encode decisions
that look arbitrary and are not; the file headers explain each. The highest-value tests in the repo
are `sync/__tests__/sync.test.ts`, which drives the real engine against a fake PostgREST.

Two that are easy to "fix" wrongly:

- **The pomodoro derives elapsed time from timestamps; it never counts ticks.** Background tabs are
  throttled to ~once a minute and sleeping laptops fire nothing, so a counting timer drifts
  unboundedly. The interval only triggers repaints.
- **`INTERVAL` habits anchor on the last completion, not a fixed grid**, and streaks only break on a
  *scheduled* day, with today never counted as a miss.

## App-layer constraints

- **Every route must stay `○ Static`.** A dynamic segment costs a server round trip on a page whose
  data is entirely local, and cannot be prefetched — so it fails offline while every other route
  works. Use a search param (`?tag=`, `?day=`, `?task=`, `?zen=`) via `lib/url-state.ts`, which
  mutates the URL with `window.history.pushState` rather than `router.push`.
- **`typedRoutes` requires a build to regenerate route types.** After adding a route, `pnpm --filter
  web build` before trusting `tsc`, or you get spurious `RouteImpl` errors.
- **No `webpack` key in `next.config.ts`** — Turbopack fails the build outright. That rules out
  `@next/bundle-analyzer` and Serwist.
- **Keyboard (`lib/keyboard/provider.tsx`)**: both halves of a `G` chord resolve *before* handlers
  dispatch, so `G` and every chord target are reserved globally. Single-key handlers are suppressed
  in text fields unless they opt into `whenTyping`.
- **Focus state is a module-scoped store** (`lib/focus/store.ts`), not React state — navigation
  unmounts components and a pomodoro that resets when you check the calendar is worse than none.
- **`Date.now()` cannot be called during render** (React Compiler rejects it, and it breaks
  hydration). Use `useClock()` from `lib/clock.ts`.
- **No `rehype-raw` in the markdown renderer.** A `task.description` arrives over the sync channel,
  so it is not simply trusted input. A test asserts this stays off.
- **Playwright lives in the ROOT `package.json`.** Next 16 declares `@playwright/test` as an optional
  peer, so installing it into `apps/web` forks `next` into two pnpm instances and breaks the dev
  server with a "module factory is not available" error.
- **HTML5 drag-and-drop is dead on touch.** No mobile browser dispatches `dragstart` for a finger,
  so anything draggable needs a pointer-event route beside it or it silently does not exist on a
  phone. See the mobile section of ADR 0001.
- **Hover-only affordances hide with `pointer-fine:`, never `pointer-coarse:`** — scope the hiding
  to where hovering can undo it, rather than letting two rules race on variant sort order.
- **The 16px form-control rule in `globals.css` is unlayered on purpose.** Tailwind's `utilities`
  layer beats `base`, so inside `@layer base` it would lose to every `text-xs` and do nothing.

## Testing conventions

- New tests are verified non-vacuous by reintroducing the bug and confirming they fail. Comments in
  the tests name the specific failure being guarded, not the mechanics.
- E2E specs are hermetic: a production build served with a fake Supabase URL and key, every request
  to that host intercepted (`apps/web/e2e/fixtures.ts`). No credentials, cannot touch the real
  project. The `server` fixture is `auto: true` — Playwright fixtures are lazy and an unused one
  silently never runs.
- `getByRole(name:)` matches accessible names as a **substring**; task rows carry both a title button
  and a `Delete "<title>"` button, so title assertions need `exact: true`.
- `toHaveText` compares `textContent`, so `toHaveText(await el.innerText())` **can never match** —
  `innerText` adds newlines between block children that `textContent` does not. The negated form
  then passes unconditionally.
- `page.mouse` cannot exercise a touch path: Chromium turns mouse-drag on a `draggable` element into
  a native HTML5 drag. Use CDP `Input.dispatchTouchEvent` (see `e2e/mobile.spec.ts`).
