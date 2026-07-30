-- RainFlow — role grants.
--
-- RLS decides WHICH ROWS a role may touch. Grants decide whether the role may touch the table
-- at all. Both are needed: RLS on a table with no grant is unreachable, and a grant without
-- RLS is wide open.
--
-- `anon` is the role attached to an unauthenticated request carrying the public key. It has
-- no business reading any RainFlow table, so it is revoked explicitly rather than left to
-- inherit whatever the project defaults happen to be.

revoke all on task          from anon;
revoke all on tag           from anon;
revoke all on task_tag      from anon;
revoke all on time_block    from anon;
revoke all on habit         from anon;
revoke all on habit_log     from anon;
revoke all on focus_session from anon;
revoke all on app_owner     from anon;

grant select, insert, update, delete on task          to authenticated;
grant select, insert, update, delete on tag           to authenticated;
grant select, insert, update, delete on task_tag      to authenticated;
grant select, insert, update, delete on time_block    to authenticated;
grant select, insert, update, delete on habit         to authenticated;
grant select, insert, update, delete on habit_log     to authenticated;
grant select, insert, update, delete on focus_session to authenticated;

-- Read-only, and further narrowed to the owner's own row by RLS. Never writable via the API.
grant select on app_owner to authenticated;

-- DELETE is granted above but should never be exercised by the client: deletes are soft
-- (set deleted_at) so they propagate to other devices as ordinary updates. The grant exists
-- only so a future hard-purge maintenance script can run as the owner rather than needing
-- the service role.
