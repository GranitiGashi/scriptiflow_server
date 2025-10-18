-- Create table for queued social posts (Facebook/Instagram)
create table if not exists public.social_post_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users_app(id) on delete cascade,
  platform text not null check (platform in ('facebook','instagram')),
  mobile_ad_id text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','posting','success','failed')),
  attempts int not null default 0,
  error text null,
  result jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_social_post_jobs_user on public.social_post_jobs(user_id);
create index if not exists idx_social_post_jobs_status on public.social_post_jobs(status);
create index if not exists idx_social_post_jobs_created on public.social_post_jobs(created_at desc);

alter table public.social_post_jobs enable row level security;

-- Allow users to manage their own queued jobs via API; worker uses service role
drop policy if exists "Users can select own social jobs" on public.social_post_jobs;
create policy "Users can select own social jobs" on public.social_post_jobs
  for select using (user_id = auth.uid());

drop policy if exists "Users can insert own social jobs" on public.social_post_jobs;
create policy "Users can insert own social jobs" on public.social_post_jobs
  for insert with check (user_id = auth.uid());

-- Optional: users can read their own job errors/results
drop policy if exists "Users can update own social jobs (limited)" on public.social_post_jobs;
create policy "Users can update own social jobs (limited)" on public.social_post_jobs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());


