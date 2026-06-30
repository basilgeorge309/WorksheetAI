-- Scribbl — store the Expo push token on the user's profile.
-- Run in the Supabase SQL editor. Safe to re-run.

alter table public.profiles
  add column if not exists push_token text;
