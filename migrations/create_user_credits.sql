-- Track pay-per-use credits for image background removal
create table if not exists public.user_credits (
  user_id uuid primary key references public.users_app(id) on delete cascade,
  balance_milli integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users_app(id) on delete cascade,
  delta_milli integer not null,
  reason text not null,
  job_id uuid,
  created_at timestamptz not null default now()
);

alter table public.user_credits enable row level security;
alter table public.user_credit_transactions enable row level security;


