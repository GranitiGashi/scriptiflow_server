-- Contact Notes schema

-- create table if not exists public.contact_notes (
--   id uuid primary key default gen_random_uuid(),
--   user_id uuid not null references public.users_app(id) on delete cascade,
--   contact_id uuid not null references public.crm_contacts(id) on delete cascade,
--   body text not null,
--   created_at timestamptz not null default now()
-- );

-- create index if not exists idx_contact_notes_contact on public.contact_notes(contact_id, created_at desc);
-- alter table public.contact_notes enable row level security;
-- drop policy if exists "Users manage own contact notes" on public.contact_notes;
-- create policy "Users manage own contact notes" on public.contact_notes for all using (user_id = auth.uid());


