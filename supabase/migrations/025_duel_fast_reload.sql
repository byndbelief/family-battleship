-- 025: faster reloads in a live Hilltop Duel. The page reloads your cannon in 1.5 s (was 3 s) and the
-- robot's in 2.3 / 1.6 / 1.3 s by level (was 4.5 / 3.2 / 2.6); the server now allows a shot every
-- 1.2 s (was 2.5), just under the fastest of those.
-- Applied with the Supabase connector (apply_migration '025_duel_fast_reload'). Safe to run again.

create or replace function public.duel_fire_live(p_game uuid, p_angle int, p_power int, p_crater jsonb, p_dmg int[], p_x int, p_target_x int, p_wind_move int, p_wind_x int default 1, p_xs int[] default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g duel_games; i int; z int[]; hp int[]; n int;
begin
  select * into g from duel_games where id = p_game for update;
  if not found or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This duel is over'; end if;
  if not _duel_live(g) then raise exception 'The live battle is over: back to taking turns'; end if;
  n := cardinality(g.players); i := array_position(g.players, me);
  if g.hp[i] <= 0 then raise exception 'Your tank is out'; end if;
  if exists (select 1 from duel_shots where game_id = p_game and shooter = me and created_at > now() - interval '1.2 seconds') then
    raise exception 'Still reloading';
  end if;
  if p_dmg is null or cardinality(p_dmg) <> n or exists (select 1 from unnest(p_dmg) d where d is null or d not between 0 and 60) then raise exception 'Bad damage'; end if;
  if p_wind_move is null or p_wind_move not between g.move - 50 and g.move or coalesce(p_wind_x, 1) not in (1, 3) then raise exception 'Bad shot'; end if;
  z := _duel_zone(n, i);
  if p_x is not null then
    if p_x < z[1] or p_x > z[2] then raise exception 'Stay on your side of the hill'; end if;
    update duel_games set tank_x[i] = p_x, turn_x[i] = p_x where id = p_game;
  end if;
  hp := array(select greatest(0, g.hp[k] - p_dmg[k]) from generate_subscripts(g.hp, 1) k order by k);
  -- Hand the shooter the turn for a moment so the ordinary shot does the rest (crater, winner,
  -- loot, chaos) and passes the turn on as usual.
  update duel_games set turn = i - 1 where id = p_game;
  perform set_config('duel.target_x', coalesce(p_target_x::text, ''), true);
  perform set_config('duel.xs', coalesce(p_xs::text, ''), true);
  perform set_config('duel.wind_move', p_wind_move::text, true);
  perform set_config('duel.wind_x', coalesce(p_wind_x, 1)::text, true);
  perform _duel_fire(p_game, me, p_angle, p_power, p_crater, hp);
  perform set_config('duel.target_x', '', true);
  perform set_config('duel.xs', '', true);
  perform set_config('duel.wind_move', '', true);
  perform set_config('duel.wind_x', '', true);
end $$;
