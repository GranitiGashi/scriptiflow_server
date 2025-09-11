create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users_app(id) on delete cascade,
  subject text not null,
  message text not null,
  status text not null default 'open', -- open | in_progress | closed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_support_tickets_user_id on public.support_tickets(user_id);

alter table public.support_tickets enable row level security;

drop policy if exists "Users can manage their own tickets" on public.support_tickets;
create policy "Users can manage their own tickets" on public.support_tickets
  for all using (user_id = auth.uid());

-- Enable realtime for this table (if not already enabled at project level)
-- This is a no-op if realtime is already configured
-- NOTE: Requires supabase_realtime extension set up
-- comment on table public.support_tickets is 'realtime';


