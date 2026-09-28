-- 023: Hilltop Duel for 3 or 4 players. Free-for-all, last tank standing.
-- Applied with the Supabase connector (apply_migration '023_duel_multi'). Safe to run again.
--
-- Everything is sized by the number of players (n); a two-player duel plays exactly as before.
--   * hp, tank_x and turn_x hold one value per player. Tanks start spread along the ridge
--     (_duel_start_x) and each drives within its own stretch (_duel_zone).
--   * With 3+ players the angle is absolute, 5-175: past 90 fires to the left (the middle tanks
--     have enemies on both sides). Two players keep 5-85, facing each other.
--   * A shot can hurt anyone. The turn passes to the next tank still standing; the last one wins
--     (everyone knocked out at once: the shooter takes it).
--   * duel_shots.xs records where every tank stood when the shot was fired, so every device
--     replays it the same (from_x/target_x still do that for two players).
--   * Live battle needs only the tanks still standing to be here. The chaos clock's 24 h Gauntlet
--     forfeit knocks the staller out instead of handing "the other player" the win.
--   * Curses, repairs and the chaos clock change one tank's HP in place: the old two-value
--     rewrites would have dropped players 3 and 4.
--   * duel_create takes a list of opponents, and the Gauntlet deals duels for any group size.

alter table public.duel_shots add column if not exists xs int[];
alter table public.duel_games drop constraint if exists duel_games_players_check;
alter table public.duel_games add constraint duel_games_players_check check (cardinality(players) between 2 and 4);

-- Where n tanks start, and how far each may drive (its own stretch of the ridge).
create or replace function public._duel_start_x(n int) returns int[]
language sql immutable as $$
  select case n when 3 then array[90, 400, 710] when 4 then array[90, 300, 500, 710] else array[90, 710] end
$$;
create or replace function public._duel_zone(n int, i int) returns int[]
language sql immutable as $$
  select case when n <= 2 then (case when i = 1 then array[30, 330] else array[470, 770] end)
    else array[case when i = 1 then 30 else ((_duel_start_x(n))[i - 1] + (_duel_start_x(n))[i]) / 2 + 50 end,
               case when i = n then 770 else ((_duel_start_x(n))[i] + (_duel_start_x(n))[i + 1]) / 2 - 50 end] end
$$;
-- The next tank still standing after seat t (0-based), given the HP after a shot.
create or replace function public._duel_next(hp int[], t int) returns int
language sql immutable as $$
  select coalesce((select (t + k) % cardinality(hp) from generate_series(1, cardinality(hp)) k
                   where hp[((t + k) % cardinality(hp)) + 1] > 0 order by k limit 1), t)
$$;
-- A new duel's row for these players (the Gauntlet and duel_create both use it).
create or replace function public._duel_new(p_by uuid, p_players uuid[], p_bot_level int, p_gauntlet uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare gid uuid; n int := cardinality(p_players);
begin
  insert into duel_games (created_by, players, seed, bot_level, gauntlet_id, hp, tank_x, turn_x)
    values (p_by, p_players, 1 + floor(random() * 65534)::int, p_bot_level, p_gauntlet,
            array_fill(100, array[n]), _duel_start_x(n), _duel_start_x(n))
    returning id into gid;
  return gid;
end $$;

-- 1 to 3 opponents, seated in the order picked.
create or replace function public.duel_create(p_opponents text[], p_bot_level int default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); others uuid[];
begin
  if me is null then raise exception 'Sign in first'; end if;
  others := array(select p.id from (select distinct on (u) u, k from unnest(p_opponents) with ordinality o(u, k) order by u, k) o
                  join profiles p on p.username = o.u where p.id <> me order by o.k);
  if cardinality(others) < 1 or cardinality(others) > 3 then raise exception 'Pick 1 to 3 others to duel'; end if;
  return _duel_new(me, array[me] || others,
    case when exists (select 1 from bots where profile_id = any (others)) then least(2, greatest(0, coalesce(p_bot_level, 1))) end, null);
end $$;

-- Driving on your turn: 40 px of fuel, within your stretch.
create or replace function public._duel_move(p_game uuid, who uuid, p_x int) returns void
language plpgsql security definer set search_path = public as $$
declare g duel_games; i int; z int[];
begin
  select * into g from duel_games where id = p_game for update;
  if not found or g.status <> 'playing' then raise exception 'This duel is over'; end if;
  if g.players[g.turn + 1] <> who then raise exception 'It''s not your turn'; end if;
  i := g.turn + 1; z := _duel_zone(cardinality(g.players), i);
  if p_x < z[1] or p_x > z[2] then raise exception 'Stay on your side of the hill'; end if;
  if abs(p_x - g.tank_x[i]) > 40 then raise exception 'Out of fuel: 40 per turn'; end if;
  update duel_games set tank_x[i] = p_x where id = p_game;
end $$;

-- Dodging while someone else aims (20 px from where their turn began), or driving freely live.
create or replace function public.duel_dodge(p_game uuid, p_move int, p_x int) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g duel_games; i int; z int[];
begin
  select * into g from duel_games where id = p_game for update;
  if not found or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This duel is over'; end if;
  i := array_position(g.players, me); z := _duel_zone(cardinality(g.players), i);
  if g.hp[i] <= 0 then raise exception 'Your tank is out'; end if;
  if p_x < z[1] or p_x > z[2] then raise exception 'Stay on your side of the hill'; end if;
  if _duel_live(g) then
    update duel_games set tank_x[i] = p_x, turn_x[i] = p_x, updated_at = now() where id = p_game;
    return;
  end if;
  if g.move <> p_move then raise exception 'Too late: they already fired'; end if;
  if g.players[g.turn + 1] = me then raise exception 'It''s your turn: drive with Move'; end if;
  if abs(p_x - coalesce(g.turn_x[i], g.tank_x[i])) > 20 then raise exception 'Out of dodge fuel: 20 per turn'; end if;
  update duel_games set tank_x[i] = p_x, updated_at = now() where id = p_game;
end $$;

-- Where the shot came from and where everyone stood, for replays.
create or replace function public._duel_shot_from() returns trigger
language plpgsql security definer set search_path = public as $$
declare g duel_games; pos int[];
begin
  select * into g from duel_games where id = new.game_id;
  if new.from_x is null then new.from_x := g.tank_x[array_position(g.players, new.shooter)]; end if;
  if new.target_x is null and cardinality(g.players) = 2 then
    new.target_x := nullif(current_setting('duel.target_x', true), '')::int;
    if new.target_x is null then new.target_x := g.tank_x[3 - array_position(g.players, new.shooter)]; end if;
  end if;
  if new.xs is null then
    pos := coalesce(nullif(current_setting('duel.xs', true), '')::int[], g.tank_x);
    pos[array_position(g.players, new.shooter)] := new.from_x;
    new.xs := pos;
  end if;
  if new.wind_move is null then
    new.wind_move := nullif(current_setting('duel.wind_move', true), '')::int;
    if nullif(current_setting('duel.wind_x', true), '') is not null then new.wind_x := current_setting('duel.wind_x', true)::int; end if;
  end if;
  return new;
end $$;

-- A shot: the shooter's page flew it and worked out the craters and everyone's HP; this checks
-- they fit the weapon and nobody gained HP, records it, and passes the turn to the next tank standing.
create or replace function public._duel_fire(p_game uuid, who uuid, p_angle int, p_power int, p_crater jsonb, p_hp int[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  g duel_games; n int; me_i int;
  foe int; dmg int; victims uuid[]; ko boolean; alive int[];
  wpn text; add_c jsonb; c jsonb; maxr int;
begin
  select * into g from duel_games where id = p_game for update;
  if not found then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This duel is over'; end if;
  if g.players[g.turn + 1] <> who then raise exception 'It''s not your turn'; end if;
  n := cardinality(g.players); me_i := array_position(g.players, who);
  if g.hp[me_i] <= 0 then raise exception 'Your tank is out'; end if;
  if p_angle not between 5 and (case when n = 2 then 85 else 175 end) or p_power not between 20 and 100 then raise exception 'Bad shot'; end if;
  if p_hp is null or cardinality(p_hp) <> n or exists (select 1 from generate_subscripts(p_hp, 1) k where p_hp[k] is null or p_hp[k] not between 0 and g.hp[k]) then
    raise exception 'Bad damage';
  end if;
  wpn := g.armed ->> who::text;
  if p_crater is null then add_c := '[]';
  elsif jsonb_typeof(p_crater) <> 'array' or jsonb_array_length(p_crater) = 0 then raise exception 'Bad crater';
  elsif jsonb_typeof(p_crater -> 0) = 'array' then add_c := p_crater;
  else add_c := jsonb_build_array(p_crater);
  end if;
  if jsonb_array_length(add_c) > (case when wpn = 'cluster' then 3 else 1 end) then raise exception 'Bad crater'; end if;
  maxr := case wpn when 'cluster' then 18 when 'homing' then 22 when 'railgun' then 12 when 'dirt' then 34
                   else (case when who = any (g.bertha) then 44 else 28 end) end;
  for c in select value from jsonb_array_elements(add_c) loop
    if jsonb_typeof(c) <> 'array' or jsonb_array_length(c) not in (3, 4) or (c ->> 2)::int not between 1 and maxr then raise exception 'Bad crater'; end if;
    if (jsonb_array_length(c) = 4) <> (wpn is not distinct from 'dirt') or (jsonb_array_length(c) = 4 and (c ->> 3)::int <> 1) then raise exception 'Bad crater'; end if;
  end loop;
  -- Who got hurt: with two players always "the other one", as before; with more, everyone else hit.
  if n = 2 then
    foe := case when me_i = 1 then 2 else 1 end;
    victims := array[g.players[foe]]; dmg := g.hp[foe] - p_hp[foe]; ko := p_hp[foe] = 0;
  else
    victims := array(select g.players[k] from generate_subscripts(p_hp, 1) k where k <> me_i and p_hp[k] < g.hp[k]);
    dmg := coalesce((select max(g.hp[k] - p_hp[k]) from generate_subscripts(p_hp, 1) k where k <> me_i), 0);
    ko := exists (select 1 from generate_subscripts(p_hp, 1) k where k <> me_i and p_hp[k] = 0 and g.hp[k] > 0);
  end if;
  alive := array(select k from generate_subscripts(p_hp, 1) k where p_hp[k] > 0 order by k);
  g.move := g.move + 1;
  insert into duel_shots (game_id, move, shooter, angle, power, crater, hp_after, wind_x, weapon)
    values (p_game, g.move, who, p_angle, p_power, p_crater, p_hp, case when g.gust = g.move - 1 then 3 else 1 end, wpn);
  update duel_games set
    move = g.move, hp = p_hp,
    turn = case when n = 2 then 1 - g.turn else _duel_next(p_hp, g.turn) end,
    craters = craters || add_c,
    status = case when cardinality(alive) <= 1 then 'over' else 'playing' end,
    winner = case when cardinality(alive) = 1 then g.players[alive[1]] when cardinality(alive) = 0 then who end,
    bertha = array_remove(bertha, who),
    shields = case when n = 2 then array_remove(shields, g.players[foe])
                   else array(select s from unnest(shields) s where not (s = any (victims))) end,
    armed = armed - who::text,
    gust = case when gust = g.move - 1 then -1 else gust end,
    updated_at = now()
  where id = p_game;
  perform _chaos_after_move('duel', p_game, who, victims,
    case when ko then 1.0 when dmg >= 20 then 0.5 when dmg > 0 then 0.2 else 0 end,
    case when ko then 0.7 when dmg >= 30 then 0.4 else 0 end,
    case when ko then 'knockout shot' else 'direct hit' end);
end $$;

-- The shot RPCs gain p_xs: where the shooter's page saw every tank when it fired.
drop function if exists public.duel_fire(uuid, int, int, jsonb, int[], int, int);
create or replace function public.duel_fire(p_game uuid, p_angle int, p_power int, p_crater jsonb, p_hp int[], p_x int default null, p_target_x int default null, p_xs int[] default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_x is not null then perform _duel_move(p_game, auth.uid(), p_x); end if;
  perform set_config('duel.target_x', coalesce(p_target_x::text, ''), true);
  perform set_config('duel.xs', coalesce(p_xs::text, ''), true);
  perform _duel_fire(p_game, auth.uid(), p_angle, p_power, p_crater, p_hp);
  perform set_config('duel.target_x', '', true);
  perform set_config('duel.xs', '', true);
end $$;

drop function if exists public.duel_fire_bot(uuid, int, int, jsonb, int[], int);
create or replace function public.duel_fire_bot(p_game uuid, p_angle int, p_power int, p_crater jsonb, p_hp int[], p_x int default null, p_xs int[] default null) returns void
language plpgsql security definer set search_path = public as $$
declare g duel_games;
begin
  select * into g from duel_games where id = p_game;
  if not found or auth.uid() is null or not (auth.uid() = any (g.players)) then raise exception 'Game not found'; end if;
  if not exists (select 1 from bots where profile_id = g.players[g.turn + 1]) then raise exception 'It''s not the robot''s turn'; end if;
  if p_x is not null then perform _duel_move(p_game, g.players[g.turn + 1], p_x); end if;
  perform set_config('duel.xs', coalesce(p_xs::text, ''), true);
  perform _duel_fire(p_game, g.players[g.turn + 1], p_angle, p_power, p_crater, p_hp);
  perform set_config('duel.xs', '', true);
end $$;

-- Live: everyone still standing has the duel open (the robot counts when "live vs robot" is on).
create or replace function public._duel_live(g duel_games) returns boolean
language sql stable security definer set search_path = public as $$
  select g.status = 'playing'
     and not exists (
       select 1 from unnest(g.players) with ordinality u(p, k)
       where g.hp[k] > 0
         and not (g.live_bot and exists (select 1 from bots where profile_id = p))
         and not exists (select 1 from duel_here h where h.game_id = g.id and h.player = p and h.seen_at > now() - interval '8 seconds'));
$$;

drop function if exists public.duel_fire_live(uuid, int, int, jsonb, int[], int, int, int, int);
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
  if exists (select 1 from duel_shots where game_id = p_game and shooter = me and created_at > now() - interval '2.5 seconds') then
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

drop function if exists public.duel_fire_live_bot(uuid, int, int, jsonb, int[], int, int, int, int);
create or replace function public.duel_fire_live_bot(p_game uuid, p_angle int, p_power int, p_crater jsonb, p_dmg int[], p_x int, p_target_x int, p_wind_move int, p_wind_x int default 1, p_xs int[] default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g duel_games; bot uuid; orig text;
begin
  select * into g from duel_games where id = p_game;
  if not found or me is null or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  select p into bot from unnest(g.players) p where exists (select 1 from bots where profile_id = p) limit 1;
  if bot is null then raise exception 'There''s no robot in this duel'; end if;
  orig := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claim.sub', bot::text, true);
  perform duel_fire_live(p_game, p_angle, p_power, p_crater, p_dmg, p_x, p_target_x, p_wind_move, p_wind_x, p_xs);
  perform set_config('request.jwt.claim.sub', coalesce(orig, ''), true);
end $$;

-- Out of the fight (the 24 h Gauntlet forfeit): the tank drops to 0 and play goes on without it.
create or replace function public._duel_knockout(p_game uuid, who uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g duel_games; i int; nhp int[]; alive int[];
begin
  select * into g from duel_games where id = p_game for update;
  if not found or g.status <> 'playing' then return; end if;
  i := array_position(g.players, who); nhp := g.hp; nhp[i] := 0;
  alive := array(select k from generate_subscripts(nhp, 1) k where nhp[k] > 0 order by k);
  update duel_games set hp = nhp, turn = _duel_next(nhp, g.turn), updated_at = now(),
    status = case when cardinality(alive) <= 1 then 'over' else 'playing' end,
    winner = case when cardinality(alive) = 1 then g.players[alive[1]] end
  where id = p_game;
end $$;

-- 005's curse, rusting one tank in place.
create or replace function public._chaos_curse(p_caster uuid, p_victim uuid, p_skip uuid, p_why text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  pick record;
  r float8;
  label text;
  effect text;
  gt int;
begin
  select * into pick from (
    select 'battleship' as kind, id, id = p_skip as same from games where status = 'playing' and p_victim = any (players) and not (p_victim = any (eliminated))
    union all
    select 'golf', id, id = p_skip from golf_games where status = 'playing' and p_victim = any (players) and cardinality(players) > 1
    union all
    select 'duel', id, id = p_skip from duel_games where status = 'playing' and p_victim = any (players) and hp[array_position(players, p_victim)] > 0
  ) x order by same, random() limit 1;
  if not found then return false; end if;

  if pick.kind = 'battleship' then
    insert into player_mods (game_id, player_id, shot_mod) values (pick.id, p_victim, -1)
      on conflict (game_id, player_id) do update set shot_mod = player_mods.shot_mod - 1;
    label := 'Battleship'; effect := 'one shot fewer on your next turn';
  elsif pick.kind = 'golf' then
    if exists (select 1 from golf_attacks where game_id = pick.id and target = p_victim and used_t is null) then
      update golf_players set penalty = penalty + 1 where game_id = pick.id and player = p_victim;
      label := 'Putt Post'; effect := '+1 stroke on your next hole';
    else
      r := random(); select t into gt from golf_games where id = pick.id;
      insert into golf_attacks (game_id, attacker, target, type, planted_t) values (pick.id, p_caster, p_victim, 1 + floor(r * 5)::int, gt);
      label := 'Putt Post'; effect := 'a surprise sneak attack on your next hole';
    end if;
  else
    update duel_games set hp[array_position(players, p_victim)] = greatest(1, hp[array_position(players, p_victim)] - 10),
      updated_at = now() where id = pick.id;
    label := 'Hilltop Duel'; effect := 'your tank rusted for −10 HP';
  end if;

  perform _chaos_event(p_victim, p_caster, 'curse', pick.kind, pick.id, '🌀',
    format('CURSED! %s''s %s hexed your %s: %s.', _uname(p_caster), p_why, label, effect));
  perform _chaos_event(p_caster, p_caster, 'curse', pick.kind, pick.id, '🌀',
    format('Your %s cursed %s''s %s: %s.', p_why, _uname(p_victim), label, effect));
  return true;
end $$;
-- 005's twists: the meteor shower tells everyone, and repairs fix one tank in place.
create or replace function public._chaos_twist(p_kind text, p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r float8 := random();
  p uuid; other uuid;
  g games; gg golf_games; dg duel_games;
  h1 int; s1 int; s2 int;
begin
  if p_kind = 'battleship' then
    select * into g from games where id = p_game;
    if g.status <> 'playing' then return; end if;
    p := g.players[g.turn + 1];
    if r < 0.4 then
      insert into player_mods (game_id, player_id, shot_mod) values (p_game, p, 2)
        on conflict (game_id, player_id) do update set shot_mod = player_mods.shot_mod + 2;
      perform _chaos_event(p, null, 'twist', 'battleship', p_game, '🔥', 'Chaos twist: FRENZY! You fire two extra shots this turn.');
    elsif r < 0.7 then
      insert into player_mods (game_id, player_id, shot_mod) values (p_game, p, -1)
        on conflict (game_id, player_id) do update set shot_mod = player_mods.shot_mod - 1;
      perform _chaos_event(p, null, 'twist', 'battleship', p_game, '🧊', 'Chaos twist: JAMMED! One shot fewer this turn.');
    else
      perform _chaos_drop(p, 'battleship', p_game, 'A chaos crate washed ashore and');
    end if;

  elsif p_kind = 'golf' then
    select * into gg from golf_games where id = p_game;
    if gg.status <> 'playing' then return; end if;
    p := gg.players[gg.t % cardinality(gg.players) + 1];
    if r < 0.45 and not exists (select 1 from golf_attacks where game_id = p_game and target = p and used_t is null) then
      insert into golf_attacks (game_id, attacker, target, type, planted_t) values (p_game, null, p, 1 + floor(random() * 5)::int, gg.t);
      perform _chaos_event(p, null, 'twist', 'golf', p_game, '🌪️', 'Chaos twist: the course itself is out to get you this hole.');
    elsif r < 0.75 and cardinality(gg.players) > 1 then
      -- Scoreboard glitch: swap your score with someone else's on a hole you've both played.
      select tu.hole, tu.written + tu.fine, o.written + o.fine, o.player into h1, s1, s2, other
        from golf_turns tu join golf_turns o on o.game_id = tu.game_id and o.hole = tu.hole and o.player <> tu.player
        where tu.game_id = p_game and tu.player = p and not tu.skipped and not o.skipped and tu.written + tu.fine <> o.written + o.fine
        order by random() limit 1;
      if h1 is not null then
        update golf_turns set written = s2 - fine where game_id = p_game and player = p and hole = h1;
        update golf_turns set written = s1 - fine where game_id = p_game and player = other and hole = h1;
        perform _chaos_event(p, null, 'twist', 'golf', p_game, '📟', format('Chaos twist: SCOREBOARD GLITCH! Your hole %s score swapped with %s''s (%s ↔ %s).', h1 + 1, _uname(other), s1, s2));
        perform _chaos_event(other, null, 'twist', 'golf', p_game, '📟', format('Chaos twist: SCOREBOARD GLITCH! Your hole %s score swapped with %s''s (%s ↔ %s).', h1 + 1, _uname(p), s2, s1));
      else
        perform _chaos_drop(p, 'golf', p_game, 'A chaos crate rolled onto the green and');
      end if;
    else
      perform _chaos_drop(p, 'golf', p_game, 'A chaos crate rolled onto the green and');
    end if;

  else
    select * into dg from duel_games where id = p_game;
    if dg.status <> 'playing' then return; end if;
    p := dg.players[dg.turn + 1];
    if r < 0.35 then
      update duel_games set craters = craters
        || jsonb_build_array(jsonb_build_array(150 + floor(random() * 200)::int, 250 + floor(random() * 120)::int, 22),
                             jsonb_build_array(450 + floor(random() * 200)::int, 250 + floor(random() * 120)::int, 22)),
        updated_at = now() where id = p_game;
      foreach other in array dg.players loop
        perform _chaos_event(other, null, 'twist', 'duel', p_game, '☄️', 'Chaos twist: METEOR SHOWER! The hills just got rearranged.');
      end loop;
    elsif r < 0.7 then
      update duel_games set gust = move, updated_at = now() where id = p_game;
      perform _chaos_event(p, null, 'twist', 'duel', p_game, '🌪️', 'Chaos twist: HURRICANE! Triple wind on your next shot.');
    else
      update duel_games set hp[dg.turn + 1] = least(100, hp[dg.turn + 1] + 15), updated_at = now() where id = p_game;
      perform _chaos_event(p, null, 'twist', 'duel', p_game, '🔧', 'Chaos twist: FIELD REPAIRS! +15 HP for your tank.');
    end if;
  end if;
end $$;
-- 018's clock hit, rusting one tank in place.
create or replace function public._clock_hit(p_kind text, p_game uuid, p_who uuid, p_level int, p_why text) returns text
language plpgsql security definer set search_path = public as $$
declare effect text; gt int;
begin
  if p_kind = 'battleship' then
    insert into player_mods (game_id, player_id, shot_mod) values (p_game, p_who, -p_level)
      on conflict (game_id, player_id) do update set shot_mod = player_mods.shot_mod - p_level;
    effect := case when p_level = 1 then 'one shot fewer this turn' else 'two shots fewer this turn' end;
    update games set updated_at = now() where id = p_game;
  elsif p_kind = 'golf' then
    update golf_players set penalty = penalty + p_level where game_id = p_game and player = p_who;
    effect := format('+%s stroke%s on the card', p_level, case when p_level = 1 then '' else 's' end);
    update golf_games set updated_at = now() where id = p_game;
  elsif p_kind = 'cards' then
    perform _card_give(p_game, p_who, 2 * p_level);
    perform _card_recount(p_game);
    effect := format('%s extra cards in your hand', 2 * p_level);
    update card_games set updated_at = now() where id = p_game;
  else
    if p_level = 1 then
      update duel_games set gust = move, updated_at = now() where id = p_game;
      effect := 'a hurricane whips up for this shot';
    else
      update duel_games set hp[array_position(players, p_who)] = greatest(1, hp[array_position(players, p_who)] - 15),
        gust = move, updated_at = now() where id = p_game;
      effect := 'your tank rusts for −15 HP and a hurricane whips up';
    end if;
  end if;
  return effect;
end $$;
-- 018's chaos clock: a 24 h Gauntlet forfeit knocks a staller out of a 3-4 player duel.
create or replace function public.chaos_clock() returns int
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); x record; c record; tier int; hrs float8; effect text; applied int := 0; p uuid; others uuid[]; msg text;
  g games; cg card_games;
begin
  if me is null then return 0; end if;
  for x in
    select 'battleship' k, id, players from games where status = 'playing' and me = any (players)
    union all select 'golf', id, players from golf_games where status = 'playing' and me = any (players) and cardinality(players) > 1
    union all select 'duel', id, players from duel_games where status = 'playing' and me = any (players)
    union all select 'cards', id, players from card_games where status = 'playing' and me = any (players)
  loop
    select * into c from _clock_turn(x.k, x.id);
    if c.who is null or exists (select 1 from bots where profile_id = c.who) then continue; end if;
    hrs := extract(epoch from now() - c.turn_at) / 3600;
    for tier in 1..3 loop
      exit when hrs < (array[2, 8, 24])[tier];
      if tier = 3 and c.gauntlet is null then exit; end if;
      insert into clock_marks (kind, game_id, turn_key, tier, player) values (x.k, x.id, c.turn_key, tier, c.who) on conflict do nothing;
      if not found then continue; end if;
      applied := applied + 1;
      others := array_remove(x.players, c.who);
      if tier < 3 then
        effect := _clock_hit(x.k, x.id, c.who, tier, 'chaos clock');
        perform _chaos_event(c.who, null, 'curse', x.k, x.id, '⏰', format('The chaos clock struck (%s hours waiting): %s.', (array[2, 8])[tier], effect));
        foreach p in array others loop
          perform _chaos_event(p, null, 'twist', x.k, x.id, '⏰', format('The chaos clock struck %s for stalling: %s.', _uname(c.who), effect));
        end loop;
      else
        -- 24 hours on a Gauntlet round: the slow player forfeits it.
        if x.k = 'golf' then
          perform _golf_submit(x.id, c.who, '[]'::jsonb, 8, 0, false);
        elsif x.k = 'duel' and cardinality(x.players) = 2 then
          update duel_games set status = 'over', winner = others[1], updated_at = now() where id = x.id;
        elsif x.k = 'duel' then
          perform _duel_knockout(x.id, c.who);
        elsif x.k = 'cards' then
          select * into cg from card_games where id = x.id for update;
          update card_games set status = 'over', updated_at = now(),
            winner = (select q from unnest(cg.players) with ordinality u(q, k) where q <> c.who order by cg.counts[k], random() limit 1)
          where id = x.id;
        else
          select * into g from games where id = x.id for update;
          g.eliminated := array_append(g.eliminated, c.who);
          if cardinality(array(select q from unnest(g.players) q where not (q = any (g.eliminated)))) <= 1 then
            update games set eliminated = g.eliminated, status = 'over', updated_at = now(),
              winner = (select q from unnest(g.players) q where not (q = any (g.eliminated)) limit 1) where id = x.id;
          else
            -- Out of the battle; the turn passes to the next player still afloat.
            update games set eliminated = g.eliminated, updated_at = now(),
              turn = (g.turn + (select min(i) from generate_series(1, cardinality(g.players)) i
                                where not (g.players[((g.turn + i) % cardinality(g.players)) + 1] = any (g.eliminated)))) % cardinality(g.players)
            where id = x.id;
          end if;
        end if;
        msg := case when x.k = 'golf' then format('%s waited 24 hours: picked up with 8 strokes on the Gauntlet hole.', _uname(c.who))
                    else format('%s waited 24 hours and forfeits the Gauntlet round.', _uname(c.who)) end;
        foreach p in array x.players loop perform _chaos_event(p, null, 'gauntlet', x.k, x.id, '⏰', msg); end loop;
      end if;
    end loop;
  end loop;
  return applied;
end $$;
-- 018's Gauntlet dealer: duels for any group size.
create or replace function public._gauntlet_next(p_gauntlet uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  gt gauntlets;
  n int; rnd int; kinds text[]; k text; rot uuid[]; child uuid; has_bot boolean; p uuid;
begin
  select * into gt from gauntlets where id = p_gauntlet for update;
  n := cardinality(gt.players);
  rnd := gt.round + 1;
  kinds := array['golf', 'cards', 'duel'] || case when n <= 3 then array['battleship'] else '{}'::text[] end;
  if cardinality(kinds) > 1 then kinds := array_remove(kinds, gt.current_kind); end if;
  k := kinds[1 + floor(random() * cardinality(kinds))::int];
  rot := gt.players[((rnd - 1) % n) + 1 : n] || gt.players[1 : ((rnd - 1) % n)];
  has_bot := exists (select 1 from bots where profile_id = any (gt.players));
  if k = 'battleship' then
    insert into games (created_by, players, mode, spt, gauntlet_id) values (gt.created_by, rot, 0, 3, p_gauntlet) returning id into child;
    insert into fleets (game_id, player_id, ships) select child, b.profile_id, _random_fleet(0::smallint) from bots b where b.profile_id = any (rot);
  elsif k = 'golf' then
    insert into golf_games (created_by, players, start, count, seed, bot_level, gauntlet_id)
      values (gt.created_by, rot, floor(random() * 18)::int, 1, 1 + floor(random() * 65534)::int, case when has_bot then 1 end, p_gauntlet)
      returning id into child;
    insert into golf_players (game_id, player) select child, x from unnest(rot) x;
  elsif k = 'cards' then
    insert into card_games (created_by, players, bot_level, gauntlet_id) values (gt.created_by, rot, case when has_bot then 1 end, p_gauntlet)
      returning id into child;
    perform _card_setup(child);
  else
    child := _duel_new(gt.created_by, rot, case when has_bot then 1 end, p_gauntlet);
  end if;
  update gauntlets set round = rnd, current_kind = k, current_game = child, updated_at = now() where id = p_gauntlet;
  foreach p in array gt.players loop
    perform _chaos_event(p, null, 'gauntlet', k, child, '🏆', format('Gauntlet round %s of %s: %s!', rnd, gt.rounds, _kind_label(k)));
  end loop;
end $$;
-- 009's results log: a direct hit (25+) on anyone counts.
create or replace function public._log_result(p_kind text, p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  pl uuid[]; win uuid[] := '{}'; gid uuid; st jsonb := '{}'; p uuid; best int;
  g games; gg golf_games; dg duel_games; gt gauntlets;
begin
  if exists (select 1 from results where kind = p_kind and game_id = p_game) then return; end if;
  if p_kind = 'battleship' then
    select * into g from games where id = p_game and status = 'over'; if not found then return; end if;
    pl := g.players; gid := g.gauntlet_id; if g.winner is not null then win := array[g.winner]; end if;
    foreach p in array pl loop
      st := st || jsonb_build_object(p::text, jsonb_build_object(
        'shots', (select count(*) from shots where game_id = p_game and shooter = p),
        'hits', (select count(*) from shots where game_id = p_game and shooter = p and hit),
        'sunk', (select count(distinct (target, sunk_ship)) from shots where game_id = p_game and shooter = p and sunk_ship is not null),
        'cheats', (select count(*) from cheats where game_id = p_game and player_id = p),
        'busted', (select count(*) from accusations where game_id = p_game and accused = p and busted),
        'catches', (select count(*) from accusations where game_id = p_game and accuser = p and busted),
        'away', greatest(0, (select count(distinct move) from cheats where game_id = p_game and player_id = p)
                          - (select count(*) from accusations where game_id = p_game and accused = p and busted))));
    end loop;
  elsif p_kind = 'golf' then
    select * into gg from golf_games where id = p_game and status = 'over'; if not found then return; end if;
    pl := gg.players; gid := gg.gauntlet_id;
    select min(s) into best from (select sum(written + fine) s from golf_turns where game_id = p_game and not skipped group by player) x;
    win := array(select player from golf_turns where game_id = p_game and not skipped group by player having sum(written + fine) = best);
    foreach p in array pl loop
      st := st || jsonb_build_object(p::text, jsonb_build_object(
        'holes', (select count(*) from golf_turns where game_id = p_game and player = p and not skipped),
        'strokes', (select coalesce(sum(written + fine), 0) from golf_turns where game_id = p_game and player = p and not skipped),
        'par', (select coalesce(sum(_golf_par(hole)), 0) from golf_turns where game_id = p_game and player = p and not skipped),
        'hio', (select count(*) from golf_turns where game_id = p_game and player = p and not skipped and actual = 1),
        'under', (select count(*) from golf_turns where game_id = p_game and player = p and not skipped and written + fine < _golf_par(hole)),
        'away', (select coalesce(away, 0) from golf_players where game_id = p_game and player = p),
        'busted', (select coalesce(busted, 0) from golf_players where game_id = p_game and player = p),
        'catches', (select coalesce(catches, 0) from golf_players where game_id = p_game and player = p)));
    end loop;
  elsif p_kind = 'duel' then
    select * into dg from duel_games where id = p_game and status = 'over'; if not found then return; end if;
    pl := dg.players; gid := dg.gauntlet_id; if dg.winner is not null then win := array[dg.winner]; end if;
    foreach p in array pl loop
      st := st || jsonb_build_object(p::text, jsonb_build_object(
        'shots', (select count(*) from duel_shots where game_id = p_game and shooter = p),
        'ko', (dg.winner = p and 0 = any (dg.hp)),
        'direct', (select count(*) from (
            select shooter, hp_after, lag(hp_after, 1, array_fill(100, array[cardinality(dg.players)])) over (order by move) prev from duel_shots where game_id = p_game) x
          where shooter = p and exists (select 1 from generate_subscripts(hp_after, 1) k where prev[k] - hp_after[k] >= 25))));
    end loop;
  else
    select * into gt from gauntlets where id = p_game and status = 'over'; if not found then return; end if;
    pl := gt.players;
    win := array(select gt.players[i] from generate_subscripts(gt.players, 1) i where gt.scores[i] = (select max(x) from unnest(gt.scores) x) and gt.scores[i] > 0);
    foreach p in array pl loop
      st := st || jsonb_build_object(p::text, jsonb_build_object('rounds', gt.scores[array_position(gt.players, p)]));
    end loop;
  end if;
  insert into results (kind, game_id, players, winners, gauntlet_id, stats) values (p_kind, p_game, pl, win, gid, st)
    on conflict (kind, game_id) do nothing;
end $$;

revoke execute on function public._duel_new(uuid, uuid[], int, uuid), public._duel_knockout(uuid, uuid), public._duel_move(uuid, uuid, int),
  public._duel_fire(uuid, uuid, int, int, jsonb, int[]), public._duel_shot_from(), public._duel_live(duel_games) from public, anon, authenticated;
revoke execute on function public.duel_create(text[], int), public.duel_fire(uuid, int, int, jsonb, int[], int, int, int[]),
  public.duel_fire_bot(uuid, int, int, jsonb, int[], int, int[]), public.duel_fire_live(uuid, int, int, jsonb, int[], int, int, int, int, int[]),
  public.duel_fire_live_bot(uuid, int, int, jsonb, int[], int, int, int, int, int[]), public.duel_dodge(uuid, int, int) from public, anon;
grant execute on function public.duel_create(text[], int), public.duel_fire(uuid, int, int, jsonb, int[], int, int, int[]),
  public.duel_fire_bot(uuid, int, int, jsonb, int[], int, int[]), public.duel_fire_live(uuid, int, int, jsonb, int[], int, int, int, int, int[]),
  public.duel_fire_live_bot(uuid, int, int, jsonb, int[], int, int, int, int, int[]), public.duel_dodge(uuid, int, int) to authenticated;
