-- Blue Render — Arquiteto Estagiário (architecture/engineering chat assistant)
-- Adds: architect_chat_conversations, architect_chat_messages, and the
-- private Storage bucket "architect-chat-files" for attachments (photos,
-- audio, small text files).
--
-- Purely additive and idempotent (safe to re-run). Written ONLY by the
-- backend (service_role bypasses RLS) after it has verified the user's
-- Supabase access token — the browser never inserts, updates or deletes
-- these rows directly and never supplies user_id, credits or model/usage.
-- Credits are NOT stored here as a ledger: the wallet's credit_ledger
-- (20260920100000_credit_wallet.sql) is the source of truth; a message row
-- keeps only the movement ids and a summary. Files live in the private
-- Storage bucket; this table stores their object paths, never URLs.

create table if not exists public.architect_chat_conversations (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '' check (char_length(title) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_architect_chat_conversations_user_updated
  on public.architect_chat_conversations (user_id, updated_at desc)
  where deleted_at is null;

alter table public.architect_chat_conversations enable row level security;
revoke all on public.architect_chat_conversations from anon, authenticated;
grant select on public.architect_chat_conversations to authenticated;

drop policy if exists architect_chat_conversations_select_own on public.architect_chat_conversations;
create policy architect_chat_conversations_select_own
  on public.architect_chat_conversations for select
  using (user_id = auth.uid() and deleted_at is null);

create table if not exists public.architect_chat_messages (
  id uuid primary key,
  conversation_id uuid not null references public.architect_chat_conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '' check (char_length(content) <= 20000),
  -- Array of {kind, path, mime, originalFileName, transcript}. Never a URL.
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'completed' check (status in ('completed', 'failed')),
  error_code text,
  error_message text check (error_message is null or char_length(error_message) <= 500),
  credits_charged integer not null default 0 check (credits_charged >= 0),
  reservation_id uuid,
  capture_transaction_id uuid,
  refund_transaction_id uuid,
  model text,
  request_id text,
  usage jsonb,
  cost_usd numeric(12, 6),
  created_at timestamptz not null default now()
);

create index if not exists idx_architect_chat_messages_conversation_created
  on public.architect_chat_messages (conversation_id, created_at asc);
create index if not exists idx_architect_chat_messages_user
  on public.architect_chat_messages (user_id, created_at desc);

alter table public.architect_chat_messages enable row level security;
revoke all on public.architect_chat_messages from anon, authenticated;
grant select on public.architect_chat_messages to authenticated;

drop policy if exists architect_chat_messages_select_own on public.architect_chat_messages;
create policy architect_chat_messages_select_own
  on public.architect_chat_messages for select
  using (user_id = auth.uid());

-- Private Storage bucket for attachments. Objects live at
-- "<user_id>/<conversation_id>/<message_id>/<index>.<ext>". The backend
-- (service_role) is the only writer and hands the browser short-lived
-- signed URLs after an ownership check. The read policy below additionally
-- lets a signed-in user read only objects under their own <user_id>/ folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'architect-chat-files',
  'architect-chat-files',
  false,
  20971520,
  array['image/png', 'image/jpeg', 'image/webp', 'audio/webm', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/ogg', 'text/plain']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "architect_chat_files_storage_select_own" on storage.objects;
create policy "architect_chat_files_storage_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'architect-chat-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

notify pgrst, 'reload schema';
