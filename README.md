# RainFlow

A single-user personal productivity app: capture, prioritise, timebox, focus, review.

Local-first. Every view reads from IndexedDB, never from the network, so the UI is instant and an
already-loaded tab keeps working offline. Writes land locally and drain to Supabase in the
background.

---

## Running it

```bash
pnpm install
pnpm --filter web dev
```

`apps/web/.env.local` needs:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

| Command | |
|---|---|
| `pnpm -r typecheck` | `tsc --noEmit` in both packages |
| `pnpm -r test` | Vitest — 317 unit and integration tests |
| `pnpm --filter web lint` | ESLint, including the React Compiler rules |
| `pnpm --filter web build` | Production build; every route must stay `○ Static` |
| `pnpm --filter web test:e2e` | Playwright — 5 specs against a stubbed Supabase, no credentials needed |
| `cd packages/data && TZ=Pacific/Kiritimati pnpm exec vitest run` | The timezone sweep — see below |

## Layout

```
apps/web/          Next.js 16 app. UI only — no server data on any route.
packages/data/     @rainflow/data: wire types, Dexie schema, sync engine, pure domain logic.
supabase/          Migrations and config.toml. Must stay at the repo root for the CLI.
apps/web/docs/     PRD, and the ADR recording where the build deviates from it.
```

`packages/data` depends on `dexie` and `@supabase/supabase-js` and nothing else. That is not a
style preference — it structurally prevents the sync engine importing `react` or `next/*`, so the
whole thing runs in a plain Node test process. React bindings live in
`apps/web/src/lib/data/hooks.ts`.

## How it fits together

```
Browser ─── Dexie/IndexedDB  ← every view reads here
             │  a write = one Dexie row + one outbox op, in ONE transaction
             ▼
           outbox ──drain──► Supabase PostgREST (RLS)
                     ◄──────  Realtime ──► applyRemoteRow ──► Dexie
```

Next.js serves a static shell and the auth callback. No route fetches server data, so every page
prerenders to CDN-static HTML.

## Things that will bite you

**Read `apps/web/docs/adr/0001-deviations-from-prd.md` first.** It records every place the build
departs from the PRD and why, including about fifteen points where §6's schema could not express
what §3 asked for.

- **`packages/data/src/sync/apply-remote.ts` is the most important file here.** Two rules: never
  apply a remote row over one with a pending outbox op, and resolve conflicts on
  `client_updated_at` — never `updated_at`, which is a server clock and would make the most
  recently *synced* row win rather than the most recently *edited* one.
- **All day-boundary maths goes through `time/tz.ts`.** The app timezone is fixed to
  `Asia/Phnom_Penh`. Anything using host-local date methods is a bug that passes on your machine
  and fails on someone else's — hence the timezone sweep, which runs the data tests under
  Kiritimati (UTC+14), Los Angeles (−7), UTC and Phnom Penh.
- **Soft delete means SQL `on delete cascade` never fires.** Any new foreign key needs a matching
  entry in `CASCADE_CHILDREN` (`packages/data/src/wire.ts`) or its children become orphans.
- **`wire.ts` is hand-written and `types.assert.ts` proves it matches the live database at compile
  time.** After a schema change: `supabase db push`, regenerate `types.gen.ts`, then typecheck.
- **Turbopack: any `webpack` key in `next.config.ts` fails the build.** That rules out
  `@next/bundle-analyzer` and Serwist.
- **Do not edit an existing Dexie `version().stores()`.** Add a new version — see the note in
  `packages/data/src/db/schema.ts`.

## Deploying

Vercel, with **Root Directory set to `apps/web`** — the build fails otherwise — and the two
`NEXT_PUBLIC_*` variables above.

Supabase's free tier has no point-in-time recovery, so **Settings → Export JSON is the backup.**
Worth taking whenever the sync queue is not empty: unsynced writes exist only in IndexedDB, and
Safari and iOS evict it for sites unused for about a week.
