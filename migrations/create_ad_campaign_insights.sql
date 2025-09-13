-- Store insights per campaign
create table if not exists public.ad_campaign_insights (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  fetched_at timestamptz not null default now(),
  payload jsonb not null
);

create index if not exists idx_ad_campaign_insights_campaign on public.ad_campaign_insights(campaign_id);

alter table public.ad_campaign_insights enable row level security;
drop policy if exists "User can view own insights" on public.ad_campaign_insights;
create policy "User can view own insights" on public.ad_campaign_insights
  for select using (exists (select 1 from public.ad_campaigns c where c.id = campaign_id and c.user_id = auth.uid()));


