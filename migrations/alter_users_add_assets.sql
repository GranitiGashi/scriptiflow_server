-- Add dealership asset columns directly on users_app
-- alter table if exists public.users_app
--   add column if not exists dealer_logo_url text,
--   add column if not exists branded_template_url text,
--   add column if not exists assets_updated_at timestamptz;

-- -- optional: index for quick lookup
-- create index if not exists idx_users_app_assets on public.users_app(id);


