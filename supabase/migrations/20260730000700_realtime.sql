-- RainFlow — Realtime publication.
--
-- This is what replaces polling, and it is a large part of why Supabase was chosen over Neon
-- (ADR 0001 decision 1). When the phone completes a habit, the laptop's Dexie is told about
-- it over a WebSocket instead of discovering it on the next poll.
--
-- Realtime authorises subscriptions THROUGH RLS, which is also why Prisma was dropped:
-- Prisma connects as a privileged role that bypasses RLS, so a Prisma-based data layer could
-- not have used this at all.
--
-- No `replica identity full` is needed. That setting exists so DELETE events can carry the
-- old row, and RainFlow never issues a hard DELETE — a soft delete arrives as an UPDATE with
-- deleted_at set, and UPDATE payloads already carry the complete new row.

alter publication supabase_realtime add table task;
alter publication supabase_realtime add table tag;
alter publication supabase_realtime add table task_tag;
alter publication supabase_realtime add table time_block;
alter publication supabase_realtime add table habit;
alter publication supabase_realtime add table habit_log;
alter publication supabase_realtime add table focus_session;

-- app_owner is deliberately excluded. It changes once, ever, and a client has no reason to
-- react to it.
