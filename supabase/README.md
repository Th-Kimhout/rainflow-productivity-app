# Supabase — RainFlow

Project ref: `twxkbcxudvrwqkkaecks` · Postgres 17.6 · `ap-southeast-1` (Singapore)

Migrations are plain SQL. There is no Prisma — see
[`../apps/web/docs/adr/0001-deviations-from-prd.md`](../apps/web/docs/adr/0001-deviations-from-prd.md).

## Status

| | |
|---|---|
| Migrations 0001–0007 | ✅ applied |
| 8 tables live | ✅ `task` `tag` `task_tag` `time_block` `habit` `habit_log` `focus_session` `app_owner` |
| Generated types | ✅ `packages/data/src/types.gen.ts`, pinned by `types.assert.ts` |
| Anonymous access denied | ✅ verified — HTTP 401 on all 8 tables, read and write |
| Signups disabled | ✅ applied via `config push` |
| Password floor 12 chars | ✅ applied via `config push` |
| **Owner claimed** | ❌ **blocked — see below** |

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
| `20260730000800_claim_owner.sql` | ⏳ **not yet applied** — needs the account to exist first |

## The one remaining step

**The database is currently closed to everything.** `app_owner` is empty, so `is_app_owner()`
returns false for every request and RLS denies all access. That is deliberate deny-by-default,
not a fault — but nothing works until ownership is claimed.

### 1. Create the account

Dashboard → **Authentication → Users → Add user → Create new user**

- your email address
- a password of **at least 12 characters** with upper, lower and a digit (the policy is enforced
  server-side, so a weaker one is rejected)
- tick **Auto Confirm User**

Signups are disabled, so this dashboard path is the only way to create it — which is the point.

### 2. Claim ownership

```bash
cd /Users/theamkimhout/Kimhout/app
supabase db push
```

`20260730000800_claim_owner.sql` inserts the earliest `auth.users` row into `app_owner`. It
**raises an exception and fails the migration** if no account exists, rather than silently
recording itself as applied and leaving the database locked out.

Verify:

```sql
select u.email, o.claimed_at from app_owner o join auth.users u on u.id = o.user_id;
```

Exactly one row, your account.

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
replacement is a client-side JSON export (Phase 9). Manual dump:

```bash
supabase db dump --project-ref twxkbcxudvrwqkkaecks -f backup.sql
```

## Free-tier notes

- Projects pause after ~7 days with no database activity; waking takes ~30s. Daily use never hits
  this; a long holiday will.
- 500 MB database. RainFlow is text — not a real constraint.
- Two active projects per free account.
- Email templates locked, and custom SMTP required to change them.
