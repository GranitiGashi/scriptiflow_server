-- Extend existing mobile_de_* tables to support multiple providers (mobile.de, AutoScout24)

-- alter table if exists public.mobile_de_credentials
--   add column if not exists provider text default 'mobile_de',
--   add column if not exists client_id text,
--   add column if not exists client_secret_encrypted text,
--   add column if not exists access_token_encrypted text,
--   add column if not exists token_expires_at timestamptz;

-- create index if not exists idx_mobile_de_credentials_user_provider on public.mobile_de_credentials(user_id, provider);
-- drop index if exists idx_mobile_de_credentials_user; -- if a unique index on user_id exists
-- create unique index if not exists idx_mobile_de_credentials_user_provider_unique on public.mobile_de_credentials(user_id, provider);

-- alter table if exists public.mobile_de_listings
--   add column if not exists provider text default 'mobile_de',
--   add column if not exists listing_id text;

-- create index if not exists idx_mobile_de_listings_user_provider on public.mobile_de_listings(user_id, provider);
-- create index if not exists idx_mobile_de_listings_user_provider_first_seen on public.mobile_de_listings(user_id, provider, first_seen desc);


