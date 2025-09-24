-- Calendar Events schema

-- create table if not exists public.calendar_events (
--   id uuid primary key default gen_random_uuid(),
--   user_id uuid not null references public.users_app(id) on delete cascade,
--   google_event_id text,
--   calendar_id text,
--   title text not null,
--   description text,
--   location text,
--   start_time timestamptz not null,
--   end_time timestamptz not null,
--   car_mobile_de_id text,
--   contact_id uuid references public.crm_contacts(id) on delete set null,
--   created_at timestamptz not null default now(),
--   updated_at timestamptz not null default now(),
--   deleted_at timestamptz
-- );

-- create index if not exists idx_calendar_events_user_time on public.calendar_events(user_id, start_time);
-- create unique index if not exists idx_calendar_events_user_google on public.calendar_events(user_id, google_event_id);
-- alter table public.calendar_events enable row level security;
-- drop policy if exists "Users manage own calendar" on public.calendar_events;
-- create policy "Users manage own calendar" on public.calendar_events for all using (user_id = auth.uid());


