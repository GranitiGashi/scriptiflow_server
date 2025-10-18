-- Add attachments array to support_messages to store uploaded file metadata
alter table if exists public.support_messages
  add column if not exists attachments jsonb null;

-- Optional: index for faster lookups by ticket
create index if not exists idx_support_messages_ticket_created on public.support_messages(ticket_id, created_at);


