-- RainFlow — row level security.
--
-- ADR 0001 decision 5: no user_id column on any table (§1.3 keeps the N=1 schema simple),
-- but access is still pinned to a single account via app_owner.
--
-- WHY NOT just `auth.uid() is not null`:
--   Supabase projects accept new signups by default. Under that policy, anyone who signs up
--   with any email address gets full read/write on this database using the PUBLIC anon key.
--   On a public repo that is a live exposure, not a theoretical one.
--
-- Defence in depth here is three separate things, and all three are required:
--   1. This file        — policies pinned to app_owner.
--   2. Auth settings    — signups DISABLED in the Supabase dashboard.
--   3. Client code      — signInWithOtp({ shouldCreateUser: false }).
--
-- Deny-by-default: is_app_owner() returns false while app_owner is empty, so a fresh database
-- is closed to everyone until the owner row is deliberately seeded.

alter table app_owner     enable row level security;
alter table task          enable row level security;
alter table tag           enable row level security;
alter table task_tag      enable row level security;
alter table time_block    enable row level security;
alter table habit         enable row level security;
alter table habit_log     enable row level security;
alter table focus_session enable row level security;

--------------------------------------------------------------------------------------------
-- app_owner: readable by the owner, writable by nobody through the API.
--------------------------------------------------------------------------------------------
-- No insert/update/delete policy exists, so the anon and authenticated roles cannot modify
-- it at all. Seeding is done with the service role (SQL editor), which bypasses RLS.
create policy app_owner_select on app_owner
  for select to authenticated
  using (user_id = auth.uid());

--------------------------------------------------------------------------------------------
-- Data tables: full access for the owner, nothing for anyone else.
--------------------------------------------------------------------------------------------
-- `for all` covers select/insert/update/delete. Both using and with_check are supplied:
-- using gates which existing rows are visible/modifiable, with_check gates the rows that may
-- be written. Omitting with_check would allow inserts that the policy could not then read.

create policy task_owner_all on task
  for all to authenticated
  using (is_app_owner()) with check (is_app_owner());

create policy tag_owner_all on tag
  for all to authenticated
  using (is_app_owner()) with check (is_app_owner());

create policy task_tag_owner_all on task_tag
  for all to authenticated
  using (is_app_owner()) with check (is_app_owner());

create policy time_block_owner_all on time_block
  for all to authenticated
  using (is_app_owner()) with check (is_app_owner());

create policy habit_owner_all on habit
  for all to authenticated
  using (is_app_owner()) with check (is_app_owner());

create policy habit_log_owner_all on habit_log
  for all to authenticated
  using (is_app_owner()) with check (is_app_owner());

create policy focus_session_owner_all on focus_session
  for all to authenticated
  using (is_app_owner()) with check (is_app_owner());
