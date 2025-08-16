# scriptiflow_server

## Environment variables

Add to your `.env`:

- SUPABASE_URL
- SUPABASE_KEY
- JWT_SECRET
- STRIPE_SECRET_KEY
- FACEBOOK_APP_ID
- FACEBOOK_APP_SECRET
- BASE_DOMAIN
- FRONTEND_URL
- OPENAI_API_KEY

## New Ads endpoints

- GET `/api/ads/ad-accounts` — list available ad accounts for the connected Facebook user
- POST `/api/ads/recommendation` — returns AI-recommended plan for a car listing
- POST `/api/ads/campaign` — creates campaign/ad set/ad in the selected ad account; optionally charges a one-time fee via Stripe
- GET `/api/ads/insights` — fetch insights for campaign/adset/ad by `entity_id`

## Database additions

Create `user_social_tokens` to store long-lived user tokens for Ads API:

```sql
create table if not exists public.user_social_tokens (
  user_id uuid not null references public.users_app(id) on delete cascade,
  provider text not null,
  token_type text not null,
  access_token text not null,
  expires_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider, token_type)
);
```