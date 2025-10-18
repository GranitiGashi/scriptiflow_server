-- Enable Supabase Realtime and admin RLS policies for support tables

-- Mark tables for realtime
comment on table public.support_tickets is 'realtime: true';
comment on table public.support_messages is 'realtime: true';

-- Allow admins to select all tickets/messages
-- Assumes users_app.role holds 'admin' for admins
do $$
begin
  -- Tickets: add admin select policy if not exists
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'support_tickets' and policyname = 'Admins can read all tickets'
  ) then
    execute $policy$
      create policy "Admins can read all tickets" 
      on public.support_tickets
      for select
      using (
        exists (
          select 1 from public.users_app u where u.id = auth.uid() and u.role = 'admin'
        )
      );
    $policy$;
  end if;

  -- Messages: add admin select policy if not exists
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'support_messages' and policyname = 'Admins can read all messages'
  ) then
    execute $policy$
      create policy "Admins can read all messages"
      on public.support_messages
      for select
      using (
        exists (
          select 1 from public.users_app u where u.id = auth.uid() and u.role = 'admin'
        )
      );
    $policy$;
  end if;
end$$;
