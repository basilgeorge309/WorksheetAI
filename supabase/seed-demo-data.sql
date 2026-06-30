-- Scribbl — App Store screenshot demo data.
-- Run manually in the Supabase SQL editor. REVIEW before running: this DELETES
-- your existing worksheets for the chosen account and resets this month's usage.
--
-- 1) Put YOUR signed-in app account email in the line marked below.
-- 2) Run the whole block.

do $$
declare
  uid uuid;
begin
  -- >>> EDIT THIS: the email of the account you're logged into in the app <<<
  select id into uid from auth.users where email = 'REPLACE_WITH_YOUR_EMAIL@example.com';

  if uid is null then
    raise exception 'No auth user found for that email — fix the email above.';
  end if;

  -- 1. Clean slate: remove this account's existing worksheets.
  delete from public.worksheets where user_id = uid;

  -- 2. Reset usage to 0 used this month -> UI shows "3 of 3 remaining".
  insert into public.usage (user_id, month, worksheets_used)
  values (uid, to_char(now(), 'YYYY-MM'), 0)
  on conflict (user_id, month) do update set worksheets_used = 0;

  -- 3. Three completed demo worksheets, spread over the last few days, with
  --    style/difficulty variety. (output_path left null — History only needs the
  --    filename + "Done" badge; tapping a row would just show "preview unavailable".)
  insert into public.worksheets
    (user_id, status, subject, handwriting_style, difficulty, storage_path, answer_count, created_at)
  values
    (uid, 'complete', 'math',     'neat',    'perfect',   'uploads/' || uid || '/algebra-practice.pdf',  12, now() - interval '1 day'),
    (uid, 'complete', 'science',  'average', 'realistic', 'uploads/' || uid || '/biology-chapter-4.pdf', 18, now() - interval '3 days'),
    (uid, 'complete', 'language', 'messy',   'student',   'uploads/' || uid || '/spanish-vocab.pdf',      9, now() - interval '5 days');
end $$;

-- Verify:
-- select status, storage_path, handwriting_style, difficulty, created_at
-- from public.worksheets
-- where user_id = (select id from auth.users where email = 'REPLACE_WITH_YOUR_EMAIL@example.com')
-- order by created_at desc;
