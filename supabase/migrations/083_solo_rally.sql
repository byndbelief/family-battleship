-- 083 · Rally is a solo game of its own (rally.html) as well as an organ of the run: solo_submit and the
-- solo_scores check accept 'rally'. Patched in place; safe to re-run.
alter table public.solo_scores drop constraint if exists solo_scores_game_check;
alter table public.solo_scores add constraint solo_scores_game_check check (game in ('squirrel', 'fractal', 'run', 'rally'));
do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'solo_submit';
  if src is null then raise exception 'solo_submit missing'; end if;
  if position('not in (''squirrel'', ''fractal'', ''run'')' in src) > 0 then
    src := replace(src, 'not in (''squirrel'', ''fractal'', ''run'')', 'not in (''squirrel'', ''fractal'', ''run'', ''rally'')');
    execute src;
  end if;
end $$;
