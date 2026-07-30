-- RainFlow — enum types.
--
-- PRD §6 declared Priority and MatrixQuadrant. Both are gone: per ADR 0001 decision 9,
-- is_urgent + is_important are the single source of truth and quadrant/priority are derived
-- in TypeScript. Nothing in SQL needs to filter on them, so a generated column would be
-- dead weight.

create type task_status as enum (
  'INBOX',
  'BACKLOG',
  'TODAY',
  'IN_PROGRESS',
  'COMPLETED',
  'ARCHIVED'
);

-- §3.4's four recurrence rules. PRD §6's `frequency String` + `targetDays Int` could not
-- express INTERVAL ("every 3 days") or MONTHLY_NTH ("the 15th") at all.
create type habit_kind as enum (
  'DAILY',
  'WEEKDAYS',
  'INTERVAL',
  'MONTHLY_NTH'
);

-- §3.6 energy logging. Was an untyped String comment on Task in §6; now typed and attached
-- to focus_session, which is the row that actually has a time to map against.
create type energy_level as enum ('HIGH', 'MEDIUM', 'LOW');

-- §3.3 pomodoro cycle. Lets a session be resumed and lets breaks be excluded from
-- "focus hours" analytics.
create type focus_phase as enum ('FOCUS', 'SHORT_BREAK', 'LONG_BREAK');
