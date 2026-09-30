-- 066: 🔺 Fractle Dash (fractle.html), the second solo game: its runs are saved in solo_scores (063)
--   under game 'fractle'. Same rules as Squirrel Chaos: every run kept, best per player, top five.
-- Applied with the Supabase connector (apply_migration '066_fractle_scores'). Safe to run again.

alter table public.solo_scores drop constraint if exists solo_scores_game_check;
alter table public.solo_scores add constraint solo_scores_game_check check (game in ('squirrel', 'fractle'));

create or replace function public.solo_submit(p_game text, p_score int, p_level int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); prev int; top jsonb;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if p_game is null or p_game not in ('squirrel', 'fractle') then raise exception 'Unknown game'; end if;
  if p_score is null or p_score not between 0 and 1000000 or p_level is null or p_level not between 1 and 99 then raise exception 'Bad score'; end if;
  if exists (select 1 from solo_scores where player = me and game = p_game and created_at > now() - interval '20 seconds') then
    raise exception 'One run at a time';
  end if;
  select max(score) into prev from solo_scores where player = me and game = p_game;
  insert into solo_scores (player, game, score, level) values (me, p_game, p_score, p_level);
  select coalesce(jsonb_agg(x order by (x ->> 'score')::int desc), '[]') into top from (
    select jsonb_build_object('player', player, 'name', _uname(player), 'score', score, 'level', level) x
    from (select distinct on (player) player, score, level from solo_scores where game = p_game order by player, score desc) b
    order by score desc limit 5) t;
  return jsonb_build_object('best', greatest(coalesce(prev, 0), p_score), 'record', p_score > coalesce(prev, -1), 'top', top);
end $$;
