-- RainFlow — claim ownership.
--
-- `app_owner` starts empty, and `is_app_owner()` returns false for everyone while it is, so
-- the database is closed to all API access until this runs. That is deliberate
-- deny-by-default (see 20260730000500_rls.sql), not an oversight.
--
-- ORDERING MATTERS: this must be applied AFTER the account exists in auth.users. If pushed
-- against an empty auth.users it inserts nothing, records itself as applied, and will not
-- re-run — leaving the database permanently closed until ownership is claimed by hand. The
-- verification block at the bottom turns that silent no-op into a loud failure.
--
-- Idempotent: safe to have in the migration history, and a no-op on every subsequent push.

insert into app_owner (user_id)
select u.id
from auth.users u
where not exists (select 1 from app_owner)
order by u.created_at
limit 1
on conflict (user_id) do nothing;

-- Fail the migration rather than leaving a locked-out database behind.
do $$
declare
  owner_count integer;
begin
  select count(*) into owner_count from app_owner;

  if owner_count = 0 then
    raise exception
      'app_owner is empty — no account exists in auth.users yet. Create the user first '
      '(Dashboard -> Authentication -> Users -> Add user), then re-run: supabase db push. '
      'Without an owner row, RLS denies every request and the app cannot read or write.';
  end if;

  raise notice 'RainFlow ownership claimed. app_owner rows: %', owner_count;
end $$;
