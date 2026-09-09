-- Run this in Supabase → SQL Editor

create table if not exists events (
  id          uuid        default gen_random_uuid() primary key,
  title       text        not null,
  description text,
  start_time  timestamptz not null,
  end_time    timestamptz,
  all_day     boolean     default false,
  reminder_minutes int,         -- null = no reminder
  color       text        default '#6366f1',
  created_by  text        not null,
  created_at  timestamptz default now()
);

-- Only signed-in users can read/write events
alter table events enable row level security;

drop policy if exists "shared calendar access" on events;

create policy "authenticated users only" on events
  for all
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Enable real-time updates
alter publication supabase_realtime add table events;
