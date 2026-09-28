-- 031: Hilltop Duel zooms out for more players. Each duel has its own battlefield width
-- (duel_games.world): 800 for two tanks, 1000 for three, 1200 for four. The height grows with it
-- (440 × world / 800), so the page shows more hill and more sky with the same screen, and the
-- tanks look smaller: zoomed out. Full power still carries a shell ~1200 across, end to end.
-- Duels already under way keep 800. Starting spots and each tank's stretch scale with the width
-- (the same numbers as before at 800).
-- Applied with the Supabase connector (apply_migration '031_duel_world'). Safe to run again.

alter table public.duel_games add column if not exists world int not null default 800;
alter table public.duel_games drop constraint if exists duel_games_world_check;
alter table public.duel_games add constraint duel_games_world_check check (world between 800 and 1600);

create or replace function public._duel_world(n int) returns int
language sql immutable as $$ select case n when 3 then 1000 when 4 then 1200 else 800 end $$;
create or replace function public._duel_start_x(n int, w int) returns int[]
language sql immutable as $$
  select case n when 3 then array[90, w / 2, w - 90] when 4 then array[90, round(w * 0.375)::int, round(w * 0.625)::int, w - 90]
                else array[90, w - 90] end
$$;
create or replace function public._duel_zone(n int, i int, w int) returns int[]
language sql immutable as $$
  select case when n <= 2 then (case when i = 1 then array[30, w / 2 - 70] else array[w / 2 + 70, w - 30] end)
    else array[case when i = 1 then 30 else ((_duel_start_x(n, w))[i - 1] + (_duel_start_x(n, w))[i]) / 2 + 50 end,
               case when i = n then w - 30 else ((_duel_start_x(n, w))[i] + (_duel_start_x(n, w))[i + 1]) / 2 - 50 end] end
$$;
-- 023's one-width versions stay for anything still calling them (they mean 800).
create or replace function public._duel_start_x(n int) returns int[]
language sql immutable as $$ select _duel_start_x(n, 800) $$;
create or replace function public._duel_zone(n int, i int) returns int[]
language sql immutable as $$ select _duel_zone(n, i, 800) $$;

-- 023's new duel, sized for its players.
create or replace function public._duel_new(p_by uuid, p_players uuid[], p_bot_level int, p_gauntlet uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare gid uuid; n int := cardinality(p_players); w int := _duel_world(cardinality(p_players));
begin
  insert into duel_games (created_by, players, seed, bot_level, gauntlet_id, hp, tank_x, turn_x, world)
    values (p_by, p_players, 1 + floor(random() * 65534)::int, p_bot_level, p_gauntlet,
            array_fill(100, array[n]), _duel_start_x(n, w), _duel_start_x(n, w), w)
    returning id into gid;
  return gid;
end $$;

-- 029's drive, 029's dodge and 025's live shot: each tank's stretch in this duel's width.
create or replace function public._duel_move(p_game uuid, who uuid, p_x int, p_dig boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare g duel_games; i int; z int[]; cut jsonb;
begin
  select * into g from duel_games where id = p_game for update;
  if not found or g.status <> 'playing' then raise exception 'This duel is over'; end if;
  if g.players[g.turn + 1] <> who then raise exception 'It''s not your turn'; end if;
  i := g.turn + 1; z := _duel_zone(cardinality(g.players), i, g.world);
  if p_x < z[1] or p_x > z[2] then raise exception 'Stay on your side of the hill'; end if;
  if abs(p_x - g.tank_x[i]) > 40 then raise exception 'Out of fuel: 40 per turn'; end if;
  cut := case when p_dig then _duel_cut(g.tank_x[i], p_x) end;
  update duel_games set tank_x[i] = p_x,
    craters = case when cut is null then craters else craters || jsonb_build_array(cut) end where id = p_game;
end $$;

create or replace function public.duel_dodge(p_game uuid, p_move int, p_x int, p_dig boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g duel_games; i int; z int[]; cut jsonb;
begin
  select * into g from duel_games where id = p_game for update;
  if not found or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This duel is over'; end if;
  i := array_position(g.players, me); z := _duel_zone(cardinality(g.players), i, g.world);
  if g.hp[i] <= 0 then raise exception 'Your tank is out'; end if;
  if p_x < z[1] or p_x > z[2] then raise exception 'Stay on your side of the hill'; end if;
  if _duel_live(g) then
    cut := case when p_dig then _duel_cut(g.tank_x[i], p_x) end;
    update duel_games set tank_x[i] = p_x, turn_x[i] = p_x, updated_at = now(),
      craters = case when cut is null then craters else craters || jsonb_build_array(cut) end where id = p_game;
    return;
  end if;
  if g.move <> p_move then raise exception 'Too late: they already fired'; end if;
  if g.players[g.turn + 1] = me then raise exception 'It''s your turn: drive with Move'; end if;
  if abs(p_x - coalesce(g.turn_x[i], g.tank_x[i])) > 20 then raise exception 'Out of dodge fuel: 20 per turn'; end if;
  update duel_games set tank_x[i] = p_x, updated_at = now() where id = p_game;
end $$;

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
  z := _duel_zone(n, i, g.world);
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

revoke execute on function public._duel_world(int), public._duel_start_x(int, int), public._duel_zone(int, int, int) from public, anon, authenticated;
