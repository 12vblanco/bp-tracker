-- BP Tracker — server schema.
--
-- Run this once in the Supabase SQL editor, on a project created in an EU
-- region. Mirrors StoredSession and ProfileRecord minus `syncState`, which is
-- this device's bookkeeping about what it still owes the server and has no
-- business being on it.
--
-- No category, band, grade or "in target" column appears here, deliberately and
-- permanently. Those are derived at render time from the active guideline
-- standard, which is what lets switching standards reclassify history
-- retroactively. A stored band would freeze a label that is supposed to move.

create table if not exists sessions (
  id            uuid primary key,
  user_id       uuid not null references auth.users on delete cascade,
  taken_at      timestamptz not null,
  period        text not null check (period in ('morning', 'evening', 'other')),
  arm           text check (arm in ('left', 'right')),

  -- jsonb rather than a child table: nothing queries inside it. Every aggregate
  -- the app computes runs on the averages below, and the CSV export reads the
  -- whole session anyway. The check keeps a malformed push from landing.
  readings      jsonb not null check (jsonb_typeof(readings) = 'array'),

  avg_systolic  numeric not null,
  avg_diastolic numeric not null,
  avg_pulse     numeric,
  tags          text[] not null default '{}',
  notes         text,

  -- Metric, with the unit in the column name for the same reason it is in the
  -- field name locally: a column headed `weight` is exactly how 78 kg becomes
  -- 78 lb on a settings change. Null is the common case, not the exception.
  weight_kg     numeric,
  waist_cm      numeric,

  -- Set by the client, never defaulted to now(). A server-side now() on upsert
  -- would restamp a reading written offline hours earlier and hand
  -- last-write-wins the wrong winner.
  updated_at    timestamptz not null,

  -- Soft delete. A hard delete would resurrect the row on the next pull from a
  -- device that had not yet heard about it.
  deleted_at    timestamptz
);

-- The only access pattern: this user's rows changed since my watermark.
create index if not exists sessions_user_updated on sessions (user_id, updated_at);

create table if not exists profiles (
  user_id          uuid primary key references auth.users on delete cascade,
  standard         text not null,
  target_systolic  int,
  target_diastolic int,
  tags             text[] not null default '{}',
  timezone         text,
  updated_at       timestamptz not null
);

-- RLS on both tables, no exceptions. The anon key ships in the client by
-- design and is not the protection; these two policies are the only thing
-- standing between one account's readings and another's. A table left without
-- one is readable by every authenticated user on the project.
alter table sessions enable row level security;
alter table profiles enable row level security;

drop policy if exists own_sessions on sessions;
create policy own_sessions on sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists own_profile on profiles;
create policy own_profile on profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
