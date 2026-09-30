-- 072: 🧬 Chaos Run (run.html): the solo run that morphs between the organs (shell.js). Its scores go
--   in solo_scores under 'run'; level is 1 + the morphs the run survived.
-- Applied with the Supabase connector (apply_migration '072_chaos_run'). Safe to run again.

alter table public.solo_scores drop constraint if exists solo_scores_game_check;
alter table public.solo_scores add constraint solo_scores_game_check check (game in ('squirrel', 'fractal', 'run'));

do $$
declare d text;
begin
  d := pg_get_functiondef('public.solo_submit(text, integer, integer, jsonb)'::regprocedure);
  if position('''run''' in d) > 0 then return; end if;
  if position('p_game not in (''squirrel'', ''fractal'')' in d) = 0 then raise exception '072: solo_submit is not the shape this patch expects'; end if;
  execute replace(d, 'p_game not in (''squirrel'', ''fractal'')', 'p_game not in (''squirrel'', ''fractal'', ''run'')');
end $$;
