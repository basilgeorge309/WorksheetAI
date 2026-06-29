-- WorksheetAI — core tables, RLS, and Storage policies.
-- Run in the Supabase SQL editor (or via `supabase db push`).

-- ---------------------------------------------------------------------------
-- worksheets
-- ---------------------------------------------------------------------------
create table if not exists public.worksheets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  output_path  text,
  status       text not null default 'pending'
                 check (status in ('pending', 'processing', 'complete', 'error')),
  style        text,
  difficulty   text,
  subject      text,
  error        text,
  created_at   timestamptz not null default now()
);

create index if not exists worksheets_user_created_idx
  on public.worksheets (user_id, created_at desc);

alter table public.worksheets enable row level security;

-- Users only ever see / touch their own rows. (The edge function uses the
-- service role, which bypasses RLS.)
create policy "worksheets_select_own" on public.worksheets
  for select using (auth.uid() = user_id);
create policy "worksheets_insert_own" on public.worksheets
  for insert with check (auth.uid() = user_id);
create policy "worksheets_update_own" on public.worksheets
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- usage  (free-tier counter, one row per user per month)
-- ---------------------------------------------------------------------------
create table if not exists public.usage (
  user_id         uuid not null references auth.users (id) on delete cascade,
  month           text not null,                  -- 'YYYY-MM'
  worksheets_used integer not null default 0,
  primary key (user_id, month)
);

alter table public.usage enable row level security;

create policy "usage_select_own" on public.usage
  for select using (auth.uid() = user_id);
create policy "usage_insert_own" on public.usage
  for insert with check (auth.uid() = user_id);
create policy "usage_update_own" on public.usage
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Storage bucket: worksheets (private)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('worksheets', 'worksheets', false)
on conflict (id) do nothing;

-- Authenticated users may upload only under uploads/{their uid}/...
create policy "worksheets_upload_own_folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'worksheets'
    and (storage.foldername(name))[1] = 'uploads'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Authenticated users may read their own uploads, plus outputs/ (gated by the
-- unguessable worksheet UUID in the path; access is via short-lived signed URLs).
create policy "worksheets_read_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'worksheets'
    and (
      ((storage.foldername(name))[1] = 'uploads' and (storage.foldername(name))[2] = auth.uid()::text)
      or (storage.foldername(name))[1] = 'outputs'
    )
  );

-- NOTE: the service role used by the edge function bypasses RLS entirely, so no
-- explicit service-role policy is required for it to read uploads/ and write outputs/.
