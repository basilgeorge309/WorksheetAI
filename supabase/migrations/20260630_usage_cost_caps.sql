-- Scribbl — tiered dollar-cost usage caps.
-- Adds a per-user-per-month cumulative spend counter (in cents) used to enforce the
-- Pro/Max dollar caps. The Free tier stays capped by worksheet COUNT (worksheets_used).
--
--   Free tier: capped by worksheet COUNT      (worksheets_used >= 3)
--   Pro tier:  capped by SPEND  cost_cents <= 1000  ($10.00 / month)
--   Max tier:  capped by SPEND  cost_cents <= 5000  ($50.00 / month)
--
-- Run on dev AND prod. Safe to re-run (IF NOT EXISTS).

alter table public.usage
  add column if not exists cost_cents integer not null default 0;

comment on column public.usage.cost_cents is
  'Cumulative image-generation spend in cents for this user''s month. Pro cap=1000, Max cap=5000. Free tier ignores this (count-capped).';
