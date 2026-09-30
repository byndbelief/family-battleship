-- 067: 066's solo game is called Fractal Dash: its key is 'fractal' (page fractal.html), not 'fractle'.
-- Applied with the Supabase connector (apply_migration '067_fractal_dash_rename'). Safe to run again.

alter table public.solo_scores drop constraint if exists solo_scores_game_check;
update public.solo_scores set game = 'fractal' where game = 'fractle';
alter table public.solo_scores add constraint solo_scores_game_check check (game in ('squirrel', 'fractal'));

do $$
declare d text;
begin
  d := pg_get_functiondef('public.solo_submit(text, integer, integer)'::regprocedure);
  if position('''fractal''' in d) > 0 then return; end if;
  if position('p_game not in (''squirrel'', ''fractle'')' in d) = 0 then raise exception '067: solo_submit is not the shape this patch expects'; end if;
  execute replace(d, 'p_game not in (''squirrel'', ''fractle'')', 'p_game not in (''squirrel'', ''fractal'')');
end $$;
