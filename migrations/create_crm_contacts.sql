-- CRM Contacts schema with soft delete and indices

-- create table if not exists public.crm_contacts (
--   id uuid primary key default gen_random_uuid(),
--   user_id uuid not null references public.users_app(id) on delete cascade,
--   first_name text,
--   last_name text,
--   email text,
--   phone text,
--   chat_link text,
--   car_link text,
--   source text,
--   created_at timestamptz not null default now(),
--   updated_at timestamptz not null default now(),
--   deleted_at timestamptz
-- );

-- create index if not exists idx_crm_contacts_user on public.crm_contacts(user_id, created_at desc);
-- create index if not exists idx_crm_contacts_user_email on public.crm_contacts(user_id, email);
-- create index if not exists idx_crm_contacts_user_phone on public.crm_contacts(user_id, phone);
-- create index if not exists idx_crm_contacts_user_deleted on public.crm_contacts(user_id, deleted_at);

-- alter table public.crm_contacts enable row level security;
-- drop policy if exists "Users manage own crm contacts" on public.crm_contacts;
-- create policy "Users manage own crm contacts" on public.crm_contacts for all using (user_id = auth.uid());


