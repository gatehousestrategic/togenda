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

-- Allow anyone with the anon key to read/write (shared calendar)
alter table events enable row level security;

create policy "shared calendar access" on events
  for all
  to anon
  using (true)
  with check (true);

-- Enable real-time updates
alter publication supabase_realtime add table events;
