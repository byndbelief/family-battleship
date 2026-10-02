-- 082 · solo_submit's score cap was 1,000,000, written when a Squirrel Chaos run was the only solo game. A
-- Chaos Run with per-organ lives (and combos through four stages) now passes it, and the save failed with
-- "Bad score". The cap (the function's check and the table's) is now the int range's practical ceiling.
-- Patched in place; safe to re-run.
alter table public.solo_scores drop constraint if exists solo_scores_score_check;
alter table public.solo_scores add constraint solo_scores_score_check check (score >= 0 and score <= 2000000000);
do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'solo_submit';
  if src is null then raise exception 'solo_submit missing'; end if;
  if position('p_score not between 0 and 1000000 ' in src) > 0 then
    src := replace(src, 'p_score not between 0 and 1000000 ', 'p_score not between 0 and 2000000000 ');
    execute src;
  end if;
end $$;
