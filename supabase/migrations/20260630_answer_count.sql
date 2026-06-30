-- Scribbl — store how many answers were generated per worksheet (for the
-- celebration subtitle "{N} questions answered, {style}-style").
-- Run in the Supabase SQL editor. Safe to re-run.

alter table public.worksheets
  add column if not exists answer_count int;
