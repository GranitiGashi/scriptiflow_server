-- image_processing_jobs: queue of background removal and compositing tasks
create table if not exists image_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  listing_id text null,
  original_url text not null,
  provider text not null default 'clipdrop',
  options jsonb null,
  status text not null default 'queued', -- queued | processing | success | failed
  result_url text null,
  error text null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- dealer_assets: dealer logos and templates per user
create table if not exists dealer_assets (
  user_id uuid primary key,
  dealer_logo_url text null,
  branded_template_url text null,
  logo_last_checked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- simple RLS placeholders (customize as needed in production)
alter table image_processing_jobs enable row level security;
alter table dealer_assets enable row level security;

