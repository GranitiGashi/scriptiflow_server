create table if not exists public.support_reads (
  user_id uuid not null references public.users_app(id) on delete cascade,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, ticket_id)
);

alter table public.support_reads enable row level security;

drop policy if exists "users manage own read receipts" on public.support_reads;
create policy "users manage own read receipts" on public.support_reads
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists idx_support_reads_user on public.support_reads(user_id);
create index if not exists idx_support_reads_ticket on public.support_reads(ticket_id);


