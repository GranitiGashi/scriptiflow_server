-- Ensure support tables are included in the Supabase Realtime publication
-- and that updates can include full row data.

-- Recommended for UPDATE events (not strictly needed for INSERT-only listeners)
alter table if exists public.support_messages replica identity full;
alter table if exists public.support_tickets replica identity full;

do $$
begin
  -- Add messages table to publication if not present
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.support_messages';
  end if;

  -- Add tickets table to publication if not present
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_tickets'
  ) then
    execute 'alter publication supabase_realtime add table public.support_tickets';
  end if;
end$$;


