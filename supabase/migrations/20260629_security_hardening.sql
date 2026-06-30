-- Scribbl — security hardening (Session 10)
-- Run in the Supabase SQL editor. Idempotent where possible.

-- ===========================================================================
-- #6 / usage hardening: usage is now written ONLY by the edge function (service
-- role). Remove the client write policies so a user can't reset their own
-- worksheets_used to dodge the monthly limit. KEEP the SELECT policy so the app
-- can still display "X of 3 remaining".
-- ===========================================================================
drop policy if exists "Users can update own usage" on public.usage;
drop policy if exists "Users can upsert own usage" on public.usage;
-- (SELECT policy "Users can read own usage" is intentionally retained.)

-- The service role bypasses RLS, so the edge function can still upsert usage.

-- ===========================================================================
-- #3 Storage policies for the (private) `worksheets` bucket. The pulled schema
-- had none — (re)create them. Drop-then-create makes this safe to re-run.
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('worksheets', 'worksheets', false)
on conflict (id) do nothing;

-- Authenticated users may upload ONLY under uploads/{their uid}/...
drop policy if exists "worksheets_upload_own_folder" on storage.objects;
create policy "worksheets_upload_own_folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'worksheets'
    and (storage.foldername(name))[1] = 'uploads'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Authenticated users may read their own uploads, plus outputs/ (gated by the
-- unguessable worksheet UUID; client reads outputs via short-lived signed URLs).
drop policy if exists "worksheets_read_own" on storage.objects;
create policy "worksheets_read_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'worksheets'
    and (
      ((storage.foldername(name))[1] = 'uploads' and (storage.foldername(name))[2] = auth.uid()::text)
      or (storage.foldername(name))[1] = 'outputs'
    )
  );

-- NOTE: the edge function uses the service role (bypasses RLS) to read uploads/
-- and write outputs/, so no service-role storage policy is required.
-- FUTURE: tighten outputs to outputs/{user_id}/{worksheet_id}.pdf to remove the
-- security-by-obscurity reliance on the UUID.
