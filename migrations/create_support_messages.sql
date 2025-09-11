create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  user_id uuid not null references public.users_app(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_support_messages_ticket_id on public.support_messages(ticket_id);
alter table public.support_messages enable row level security;
drop policy if exists "Users can view their ticket messages" on public.support_messages;
create policy "Users can view their ticket messages" on public.support_messages
  for select using (
    exists (
      select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = auth.uid()
    )
  );

-- Enable realtime for messages
-- comment on table public.support_messages is 'realtime';


