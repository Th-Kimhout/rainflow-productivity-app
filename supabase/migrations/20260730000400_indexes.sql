-- RainFlow — indexes.
--
-- Deliberately sparse. PRD §6's @@index([status, dueDate]) and @@index([quadrant]) are NOT
-- recreated here: every read the UI performs is served from Dexie, so Postgres never sees a
-- filtered query on those columns. Indexing them would cost write throughput for nothing.
--
-- What Postgres DOES need indexes for is the sync protocol itself.

--------------------------------------------------------------------------------------------
-- Incremental-pull cursor
--------------------------------------------------------------------------------------------
-- Every pull is `where updated_at > cursor order by updated_at`. Include the primary key so
-- the ordering is total: a batched upsert stamps many rows with an identical now(), and
-- without a tiebreak the pull could interleave differently between pages and skip rows.
-- (The client additionally rewinds the cursor by a few seconds each pull — see ADR 0001, R6 —
-- which is what makes this correct rather than merely usually-correct.)
create index task_updated_at_idx          on task          (updated_at, id);
create index tag_updated_at_idx           on tag           (updated_at, id);
create index task_tag_updated_at_idx      on task_tag      (updated_at, task_id, tag_id);
create index time_block_updated_at_idx    on time_block    (updated_at, id);
create index habit_updated_at_idx         on habit         (updated_at, id);
create index habit_log_updated_at_idx     on habit_log     (updated_at, id);
create index focus_session_updated_at_idx on focus_session (updated_at, id);

--------------------------------------------------------------------------------------------
-- Uniqueness, scoped to live rows
--------------------------------------------------------------------------------------------
-- Partial (`where deleted_at is null`) because soft delete means a tombstone sticks around
-- forever. A plain unique constraint would make "delete the #project tag, then create a new
-- one with the same name" fail permanently.

-- Case-insensitive tag names: #Project and #project are the same tag.
create unique index tag_name_unique_live
  on tag (lower(name))
  where deleted_at is null;

-- §3.4 double-completion guard. §6 had no uniqueness at all, so a habit could be logged
-- twice on the same day and inflate a streak.
create unique index habit_log_one_per_day
  on habit_log (habit_id, log_date)
  where deleted_at is null;

--------------------------------------------------------------------------------------------
-- Foreign-key support
--------------------------------------------------------------------------------------------
-- Postgres does not auto-index the referencing side of a FK. These keep the (deferred)
-- constraint checks on the drain path cheap.
create index task_parent_id_idx          on task          (parent_id) where parent_id is not null;
create index task_tag_tag_id_idx         on task_tag      (tag_id);
create index time_block_task_id_idx      on time_block    (task_id);
create index habit_log_habit_id_idx      on habit_log     (habit_id);
create index focus_session_task_id_idx   on focus_session (task_id) where task_id is not null;
