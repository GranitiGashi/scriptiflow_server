-- Ad campaigns core table (inspired by digital_ads)
create table if not exists public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users_app(id) on delete cascade,
  facebook_page_id text,
  stripe_customer_id text,
  start_time timestamptz,
  end_time timestamptz,
  commission_percent numeric default 0,
  retry_count integer default 0,
  ad_account_id text,
  call_to_action_link text,
  body text,
  title text,
  name text,
  status text not null default 'CREATED',
  facebook_campaign_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ad_campaigns_user_id on public.ad_campaigns(user_id);

alter table public.ad_campaigns enable row level security;
drop policy if exists "User can CRUD own campaigns" on public.ad_campaigns;
create policy "User can CRUD own campaigns" on public.ad_campaigns
  using (user_id = auth.uid()) with check (user_id = auth.uid());


