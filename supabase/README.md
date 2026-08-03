# Supabase — RainFlow

Project ref: `twxkbcxudvrwqkkaecks` · Postgres 17.6 · `ap-southeast-1` (Singapore)

Migrations are plain SQL. There is no Prisma — see
[`../apps/web/docs/adr/0001-deviations-from-prd.md`](../apps/web/docs/adr/0001-deviations-from-prd.md).

All eight migrations are applied and the owner is claimed — the app syncs against this project.
Rather than a status table that goes stale, here is how to confirm it in one query:

```sql
select u.email, o.claimed_at from app_owner o join auth.users u on u.id = o.user_id;
```

Exactly one row means RLS will admit you. **Zero rows means the database is closed to everything**,
which is the deliberate deny-by-default state a fresh project starts in — see "Rebuilding from
scratch" below.

## Migrations

| File | Contents |
|---|---|
| `20260730000100_enums.sql` | `task_status`, `habit_kind`, `energy_level`, `focus_phase` |
| `20260730000200_sync.sql` | `set_updated_at()`, `app_owner`, `is_app_owner()` |
| `20260730000300_tables.sql` | 7 tables + `updated_at` triggers |
| `20260730000400_indexes.sql` | pull-cursor indexes, partial uniques, FK indexes |
| `20260730000500_rls.sql` | RLS pinned to `app_owner` |
| `20260730000600_grants.sql` | revoke `anon`, grant `authenticated` |
| `20260730000700_realtime.sql` | publication membership |
| `20260730000800_claim_owner.sql` | records the earliest `auth.users` row as the owner |

Auth settings applied via `config push`: signups disabled, anonymous sign-ins disabled, password
floor 12 characters with `lower_upper_letters_digits`, TOTP MFA enrolment enabled.

Verified when first applied: anonymous requests return HTTP 401 on all eight tables for both reads
and writes; an authenticated non-owner gets `200 []` on reads and **403 `42501`** on writes — which
is what earns the `with check` clause its place in the policies.

## Rebuilding from scratch

Only needed for a new project, or after a reset. The order matters: `0008_claim_owner` **raises an
exception and fails the migration** if no account exists, rather than recording itself as applied
and leaving the database permanently locked out.

### 1. Create the account first

Dashboard → **Authentication → Users → Add user → Create new user**

- your email address
- a password of **at least 12 characters** with upper, lower and a digit — the policy is enforced
  server-side, so a weaker one is rejected
- tick **Auto Confirm User**

Signups are disabled, so this dashboard path is the only way to create it. That is the point.

### 2. Apply the migrations

```bash
cd /Users/theamkimhout/Kimhout/app
supabase db push
```

Then re-run the verification query above.

## Login is email + password, not magic link

The free tier rejects email-template edits:

> Email template modification is not available for free tier projects using the default email
> provider.

Since the default template carries no `{{ .Token }}`, there is no 6-digit code and magic links
would only work on the device that requested them (PKCE keeps its verifier in the requesting
browser's localStorage). Password auth removes the email dependency from login altogether. Full
reasoning in ADR 0001, decision 11.

If custom SMTP is ever configured — Resend's free tier is 3k emails/month — templates unlock and
magic links become available again with no schema or RLS change.

## ⚠️ `supabase config push` pushes the WHOLE file

Any key omitted from `config.toml` is filled from CLI defaults, which then **overwrite the
remote value**. The first push here would have silently disabled TOTP MFA and dropped the email
rate limit from 1m to 1s. Those keys are now pinned explicitly with a warning comment.

When changing auth settings: add keys, never omit them and assume remote survives. Run without
`--yes` first and read the diff.

## Type generation

Re-run after **every** schema change, then typecheck:

```bash
supabase gen types typescript --project-id twxkbcxudvrwqkkaecks --schema public \
  > packages/data/src/types.gen.ts
pnpm --filter @rainflow/data typecheck
```

`types.assert.ts` fails the build if `wire.ts` has drifted, and additionally asserts that `id`
and `client_updated_at` stay **required on insert** — a `default gen_random_uuid()` appearing on
any table would break offline writes, so that shows up as a type error.

## Backups

The free tier has **no point-in-time recovery**, so PRD §7.2 is not achievable as written. The
replacement is in the app: **Settings → Export JSON**, which writes every local row — tombstones
included — and can be restored from the same screen.

That covers a risk PITR never would. Unsynced writes live only in IndexedDB, and Safari and iOS
evict it for sites unused for about a week, so the export is worth taking whenever the sync queue
shown on that screen is not empty.

A server-side dump, for the database rather than the device:

```bash
supabase db dump --project-ref twxkbcxudvrwqkkaecks -f backup.sql
```

## Free-tier notes

- Projects pause after ~7 days with no database activity; waking takes ~30s. Daily use never hits
  this; a long holiday will.
- 500 MB database. RainFlow is text — not a real constraint.
- Two active projects per free account.
- Email templates locked, and custom SMTP required to change them.
