-- RainFlow — sync infrastructure.
--
-- Two timestamps, two owners. This split is the core of the sync protocol, so it is worth
-- being precise about:
--
--   updated_at        SERVER-owned. Forced to now() by trigger on every write. Used ONLY as
--                     the incremental-pull cursor. The client never sends it; if it does,
--                     the trigger overwrites it.
--   client_updated_at CLIENT-owned. The writing device's own clock. Used ONLY for
--                     last-write-wins conflict resolution.
--
-- Keeping them separate is what makes the cursor immune to client clock skew. A device with
-- a wildly wrong clock can still be ordered correctly for pagination, and LWW stays a
-- comparison between two client clocks rather than a mix of the two.
--
-- Note this does NOT violate the "no server-side writes to columns the client upserts" rule
-- from ADR 0001: the client never writes updated_at, so there is nothing to clobber.

create or replace function set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function set_updated_at() is
  'Forces server-owned updated_at on every write. Backs the incremental-pull cursor.';

-- Single-row table naming the one account allowed to touch any data.
--
-- This exists so RLS can be pinned to a specific user WITHOUT adding a user_id column to
-- every table (ADR 0001 decision 5 keeps the §1.3 N=1 schema shape). Supabase allows signups
-- by default, so a bare `auth.uid() is not null` policy would let anyone who signs up read
-- and write everything. Pinning closes that.
--
-- Deny-by-default: while this table is empty, no authenticated user matches, so no row is
-- readable. That is the correct failure mode.
create table app_owner (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  claimed_at timestamptz not null default now()
);

comment on table app_owner is
  'The single account permitted to access RainFlow data. Seed exactly one row after first '
  'login, via the SQL editor or service role — see supabase/README.md. Empty = deny all.';

-- Stable, inlinable predicate used by every policy.
create or replace function is_app_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_owner o where o.user_id = auth.uid()
  );
$$;

comment on function is_app_owner() is
  'True only for the account recorded in app_owner. Returns false when app_owner is empty.';
