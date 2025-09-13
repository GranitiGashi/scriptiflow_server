-- Ads linked to ad_campaigns
create table if not exists public.ad_campaign_ads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  lifetime_budget_cents integer not null,
  publisher_platforms text[] not null default '{}',
  facebook_positions text[] default '{}',
  instagram_positions text[] default '{}',
  locations jsonb default '[]', -- [{latitude, longitude, radius}]
  facebook_ad_set_id text,
  facebook_ad_id text,
  template_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ad_campaign_ads_campaign on public.ad_campaign_ads(campaign_id);

alter table public.ad_campaign_ads enable row level security;
drop policy if exists "User can CRUD own campaign ads" on public.ad_campaign_ads;
create policy "User can CRUD own campaign ads" on public.ad_campaign_ads
  using (exists (select 1 from public.ad_campaigns c where c.id = campaign_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.ad_campaigns c where c.id = campaign_id and c.user_id = auth.uid()));


