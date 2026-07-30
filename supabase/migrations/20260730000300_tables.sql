-- RainFlow — tables. Translated from PRD §6's Prisma DSL, with the deviations in ADR 0001.
--
-- Conventions applied to EVERY table:
--   * id uuid primary key with NO default. Ids are minted in the browser, because an offline
--     write must know its own key before it ever reaches the server (ADR 0001 decision 6).
--   * updated_at / client_updated_at — see 20260730000200_sync.sql.
--   * deleted_at — soft delete. Rows are never physically removed, so a delete propagates to
--     other devices as an ordinary update rather than vanishing silently.
--   * client_id — which device last wrote the row. Diagnostics and echo suppression.
--
-- Foreign keys are `deferrable initially deferred` so a batch drained from the outbox can
-- insert a child before its parent within one transaction, removing any need for the client
-- to topologically sort its queue. The cascade rules are declared for correctness but never
-- actually fire, because deletes are soft.

--------------------------------------------------------------------------------------------
-- task
--------------------------------------------------------------------------------------------
create table task (
  id                uuid primary key,
  title             text not null,
  description       text,
  status            task_status not null default 'INBOX',

  -- §3.2 Eisenhower. These two booleans ARE the priority model; quadrant and display
  -- priority are derived (ADR 0001 decision 9). §6's separate priority/quadrant pair could
  -- silently disagree, since §3.1 parsed one and §3.2 dragged the other.
  is_urgent         boolean not null default false,
  is_important      boolean not null default false,

  -- §3.6 planned-vs-actual. `actual_mins` from §6 is deliberately absent: it is a rollup of
  -- focus_session and is derived in Dexie. A trigger maintaining it would be clobbered by
  -- the client's next full-row upsert (ADR 0001, R3).
  estimated_mins    integer,

  -- §3.1 parses both "tomorrow" and "tomorrow at 3pm"; the flag records which, so an
  -- all-day task is not rendered at an arbitrary midnight.
  due_at            timestamptz,
  due_is_all_day    boolean not null default true,

  -- §6 had three representations of completion (status, isCompleted, completedAt). Collapsed:
  -- status is truth, this is the transition timestamp.
  completed_at      timestamptz,

  -- §3.2 subtask tree.
  parent_id         uuid references task (id) on delete cascade deferrable initially deferred,

  -- §3.2 drag-and-drop ordering. Absent from §6, which left reordering unpersistable.
  -- double precision so an insert between two neighbours is a midpoint, not a renumber.
  sort_order        double precision not null default 0,

  updated_at        timestamptz not null default now(),
  client_updated_at timestamptz not null,
  deleted_at        timestamptz,
  client_id         text,

  constraint task_no_self_parent check (parent_id is null or parent_id <> id),
  constraint task_completed_has_timestamp
    check (status <> 'COMPLETED' or completed_at is not null),
  constraint task_estimate_positive
    check (estimated_mins is null or estimated_mins > 0),
  constraint task_title_not_blank check (length(btrim(title)) > 0)
);

--------------------------------------------------------------------------------------------
-- tag  /  task_tag        §3.1 `#project` parsing, §3.2 filtering
--------------------------------------------------------------------------------------------
create table tag (
  id                uuid primary key,
  name              text not null,
  color             text not null default '#38bdf8',  -- §4.1 Rain Blue

  updated_at        timestamptz not null default now(),
  client_updated_at timestamptz not null,
  deleted_at        timestamptz,
  client_id         text,

  constraint tag_name_not_blank check (length(btrim(name)) > 0),
  constraint tag_color_is_hex check (color ~* '^#[0-9a-f]{6}$')
);

create table task_tag (
  task_id           uuid not null references task (id) on delete cascade deferrable initially deferred,
  tag_id            uuid not null references tag (id) on delete cascade deferrable initially deferred,

  -- §6 had a bare join table. Un-tagging has to propagate like any other edit, so it carries
  -- the full sync column set.
  updated_at        timestamptz not null default now(),
  client_updated_at timestamptz not null,
  deleted_at        timestamptz,
  client_id         text,

  primary key (task_id, tag_id)
);

--------------------------------------------------------------------------------------------
-- time_block             §3.2 timeboxing calendar
--------------------------------------------------------------------------------------------
-- Replaces §6's timeboxStart/timeboxEnd columns on task, which allowed a task exactly one
-- calendar slot for its whole life. §3.2 wants drag-and-drop rescheduling and §3.6 wants
-- planned-vs-actual, both of which imply work spread across multiple sittings.
create table time_block (
  id                uuid primary key,
  task_id           uuid not null references task (id) on delete cascade deferrable initially deferred,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,

  updated_at        timestamptz not null default now(),
  client_updated_at timestamptz not null,
  deleted_at        timestamptz,
  client_id         text,

  constraint time_block_ends_after_start check (ends_at > starts_at)
);

--------------------------------------------------------------------------------------------
-- habit  /  habit_log    §3.4 habit tracking and streaks
--------------------------------------------------------------------------------------------
create table habit (
  id                uuid primary key,
  title             text not null,
  description       text,

  -- §3.4's four rules, structurally. Exactly one parameter set is valid per kind; the check
  -- constraint below enforces that rather than trusting the client.
  kind              habit_kind not null,
  interval_days     integer,      -- INTERVAL:     every N days
  weekdays          smallint[],   -- WEEKDAYS:     0=Sun .. 6=Sat, matching weekdayOf()
  month_day         integer,      -- MONTHLY_NTH:  day-of-month, clamped client-side

  target_per_period integer not null default 1,
  color             text not null default '#34d399',  -- §4.1 Emerald / success

  -- Stop tracking without destroying the streak history behind it.
  archived_at       timestamptz,

  updated_at        timestamptz not null default now(),
  client_updated_at timestamptz not null,
  deleted_at        timestamptz,
  client_id         text,

  constraint habit_title_not_blank check (length(btrim(title)) > 0),
  constraint habit_color_is_hex check (color ~* '^#[0-9a-f]{6}$'),
  constraint habit_target_positive check (target_per_period > 0),

  -- One parameter shape per kind, and no stray parameters from a previous kind left behind.
  constraint habit_params_match_kind check (
    case kind
      when 'DAILY' then
        interval_days is null and weekdays is null and month_day is null
      when 'WEEKDAYS' then
        interval_days is null and month_day is null
        and weekdays is not null and array_length(weekdays, 1) between 1 and 7
      when 'INTERVAL' then
        weekdays is null and month_day is null
        and interval_days is not null and interval_days >= 1
      when 'MONTHLY_NTH' then
        interval_days is null and weekdays is null
        and month_day is not null and month_day between 1 and 31
    end
  ),

  -- Guard the array contents too; a smallint[] would otherwise accept 9 or -1.
  constraint habit_weekdays_in_range check (
    weekdays is null or (
      (select bool_and(d between 0 and 6) from unnest(weekdays) as d)
    )
  )
);

create table habit_log (
  id                uuid primary key,
  habit_id          uuid not null references habit (id) on delete cascade deferrable initially deferred,

  -- A DATE, not a timestamp. §6's `completedAt DateTime` made "did I do this today?" depend
  -- on the reader's timezone and permitted logging the same habit twice in one day. Streak
  -- math needs a calendar day; this is dayKeyOf() in Asia/Phnom_Penh (ADR 0001 decision 10).
  log_date          date not null,

  -- Retained for "what time of day do I actually do this" analytics.
  completed_at      timestamptz not null,

  updated_at        timestamptz not null default now(),
  client_updated_at timestamptz not null,
  deleted_at        timestamptz,
  client_id         text
);

--------------------------------------------------------------------------------------------
-- focus_session          §3.3 pomodoro, §3.6 analytics
--------------------------------------------------------------------------------------------
create table focus_session (
  id                uuid primary key,

  -- Nullable: §3.3 allows a bare pomodoro with no task attached. §6 used SetNull; soft
  -- delete means this never actually fires.
  task_id           uuid references task (id) on delete set null deferrable initially deferred,

  -- §6 had only durationMin + completedAt, which makes §3.6's "top focus hours" impossible
  -- to compute. An explicit start is required.
  started_at        timestamptz not null,
  ended_at          timestamptz,

  planned_mins      integer not null,
  actual_secs       integer not null default 0,
  was_completed     boolean not null default false,
  phase             focus_phase not null default 'FOCUS',

  -- §3.6 energy logging, moved here from task and given a type.
  energy            energy_level,
  notes             text,

  updated_at        timestamptz not null default now(),
  client_updated_at timestamptz not null,
  deleted_at        timestamptz,
  client_id         text,

  constraint focus_ends_after_start check (ended_at is null or ended_at >= started_at),
  constraint focus_planned_positive check (planned_mins > 0),
  constraint focus_actual_not_negative check (actual_secs >= 0)
);

--------------------------------------------------------------------------------------------
-- updated_at triggers
--------------------------------------------------------------------------------------------
create trigger task_set_updated_at
  before insert or update on task
  for each row execute function set_updated_at();

create trigger tag_set_updated_at
  before insert or update on tag
  for each row execute function set_updated_at();

create trigger task_tag_set_updated_at
  before insert or update on task_tag
  for each row execute function set_updated_at();

create trigger time_block_set_updated_at
  before insert or update on time_block
  for each row execute function set_updated_at();

create trigger habit_set_updated_at
  before insert or update on habit
  for each row execute function set_updated_at();

create trigger habit_log_set_updated_at
  before insert or update on habit_log
  for each row execute function set_updated_at();

create trigger focus_session_set_updated_at
  before insert or update on focus_session
  for each row execute function set_updated_at();
