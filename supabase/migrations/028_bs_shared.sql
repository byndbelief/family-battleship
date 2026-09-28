-- 028: Battleship Shared Ocean (mode 2). Everyone's fleet hides on one 12x12 grid; you fire at the
-- ocean, not at a player, and a hit lands on whoever's ship is there.
--   * Ships: 4, 3, 3, 2 each, never overlapping anyone else's. Nobody sees where the others are, so
--     placing goes through the server: bs_shuffle() deals you a spot clear of the fleets already
--     placed, and set_fleet refuses a spot someone took meanwhile (it never says where).
--   * Firing: squares nobody has fired at, never your own ship. shots.target is the owner of the ship
--     hit, or null for a miss (the column is nullable now). A ship sinks when all its squares are hit;
--     a fleet with nothing left is out; the last fleet afloat wins.
--   * The robot hunts the whole ocean (_bot_pick_shared), in turns and live.
--   * No cheats or accusations on the shared ocean (a trigger refuses them), and the page hides Sonar.
-- Applied with the Supabase connector (apply_migration '028_bs_shared'). Safe to run again.

create or replace function public.mode_n(m smallint) returns int
language sql immutable as $$ select case m when 0 then 8 when 2 then 12 else 10 end $$;
create or replace function public.mode_ships(m smallint) returns int[]
language sql immutable as $$ select case m when 1 then array[5, 4, 3, 3, 2] else array[4, 3, 3, 2] end $$;
alter table public.games drop constraint if exists games_mode_check;
alter table public.games add constraint games_mode_check check (mode in (0, 1, 2));
alter table public.shots alter column target drop not null;
create unique index if not exists shots_ocean_cell on public.shots (game_id, cell) where target is null;

-- Every square of every fleet placed in a game, except one player's.
create or replace function public._ocean_taken(p_game uuid, p_except uuid) returns int[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(x), '{}') from fleets f, games g, unnest(_fleet_cells(g.mode, f.ships)) x
  where f.game_id = p_game and g.id = p_game and f.player_id is distinct from p_except
$$;
-- A random fleet clear of `taken`.
create or replace function public._random_fleet_avoid(m smallint, taken int[]) returns jsonb
language plpgsql volatile set search_path = public as $$
declare f jsonb;
begin
  for t in 1 .. 400 loop
    f := _random_fleet(m);
    if not (_fleet_cells(m, f) && taken) then return f; end if;
  end loop;
  raise exception 'The ocean is too crowded: try again';
end $$;
-- Placing on the shared ocean: a fresh spot for your fleet, clear of everyone already placed.
create or replace function public.bs_shuffle(p_game uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g games;
begin
  select * into g from games where id = p_game;
  if not found or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'setup' then raise exception 'The battle has started'; end if;
  return _random_fleet_avoid(g.mode, _ocean_taken(p_game, me));
end $$;

-- No cheating on the shared ocean.
create or replace function public._no_ocean_cheats() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from games where id = new.game_id and mode = 2) then raise exception 'No cheating on the shared ocean'; end if;
  return new;
end $$;
drop trigger if exists no_ocean_cheats on public.cheats;
create trigger no_ocean_cheats before insert on public.cheats for each row execute function public._no_ocean_cheats();
drop trigger if exists no_ocean_cheats on public.accusations;
create trigger no_ocean_cheats before insert on public.accusations for each row execute function public._no_ocean_cheats();

-- A shot on the shared ocean (fire() hands mode 2 games here).
create or replace function public._fire_ocean(p_game uuid, me uuid, p_cells int[], live boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g games; n int; lens int[]; need int; mod int; shot int[]; mine int[];
  fl record; owner uuid; ship_i int; scells int[]; cell int;
  hits int := 0; sank jsonb := '[]'; out_now uuid[] := '{}'; alive uuid[]; foes uuid[]; nxt int; skips uuid[];
begin
  select * into g from games where id = p_game for update;
  n := mode_n(g.mode); lens := mode_ships(g.mode);
  select coalesce(array_agg(s.cell::int), '{}') into shot from shots s where s.game_id = p_game;
  select coalesce((select shot_mod from player_mods where game_id = p_game and player_id = me), 0) into mod;
  need := case when live then 1 else least(greatest(1, g.spt + mod), n * n - cardinality(shot)) end;
  if p_cells is null or cardinality(p_cells) <> need or (select count(distinct x) from unnest(p_cells) x) <> need then
    raise exception 'Pick % square(s)', need;
  end if;
  if exists (select 1 from unnest(p_cells) x where x is null or x < 0 or x >= n * n or x = any (shot)) then
    raise exception 'Pick squares nobody has fired at yet';
  end if;
  select _fleet_cells(g.mode, ships) into mine from fleets where game_id = p_game and player_id = me;
  if p_cells && mine then raise exception 'That''s your own ship!'; end if;
  if not live then update player_mods set shot_mod = 0 where game_id = p_game and player_id = me; end if;

  g.move := g.move + 1;
  foreach cell in array p_cells loop
    owner := null; ship_i := null;
    for fl in select player_id, ships from fleets where game_id = p_game and player_id <> me loop
      for i in 1 .. cardinality(lens) loop
        scells := ship_cells(g.mode, (fl.ships -> (i - 1) ->> 'c')::int, (fl.ships -> (i - 1) ->> 'h')::boolean, lens[i]);
        if cell = any (scells) then owner := fl.player_id; ship_i := i; exit; end if;
      end loop;
      exit when owner is not null;
    end loop;
    shot := shot || cell;
    if owner is null then
      insert into shots (game_id, move, shooter, target, cell, hit) values (p_game, g.move, me, null, cell, false);
    elsif scells <@ shot then
      hits := hits + 1; sank := sank || jsonb_build_object('player', owner, 'ship', ship_i - 1);
      insert into shots (game_id, move, shooter, target, cell, hit, sunk_ship, sunk_cells)
        values (p_game, g.move, me, owner, cell, true, ship_i - 1, scells::smallint[]);
    else
      hits := hits + 1;
      insert into shots (game_id, move, shooter, target, cell, hit) values (p_game, g.move, me, owner, cell, true);
    end if;
  end loop;

  -- Anyone with no ship left afloat is out.
  for fl in select player_id, ships from fleets where game_id = p_game loop
    if not (fl.player_id = any (g.eliminated)) and _fleet_cells(g.mode, fl.ships) <@ shot then
      g.eliminated := g.eliminated || fl.player_id; out_now := out_now || fl.player_id;
    end if;
  end loop;
  alive := array(select p from unnest(g.players) p where not (p = any (g.eliminated)));
  foes := array(select p from unnest(g.players) p where p <> me and not (p = any (g.eliminated)));
  if cardinality(alive) <= 1 then
    update games set status = 'over', winner = coalesce(alive[1], me), move = g.move, eliminated = g.eliminated, updated_at = now() where id = p_game;
    perform _chaos_after_move('battleship', p_game, me, foes, 1.0, 0.8, 'final broadside');
  else
    skips := g.skip_next; nxt := g.turn;
    loop
      nxt := (nxt + 1) % cardinality(g.players);
      continue when g.players[nxt + 1] = any (g.eliminated);
      if g.players[nxt + 1] = any (skips) and g.players[nxt + 1] <> me then skips := array_remove(skips, g.players[nxt + 1]); continue; end if;
      exit;
    end loop;
    update games set turn = nxt, move = g.move, eliminated = g.eliminated, skip_next = skips, updated_at = now() where id = p_game;
    perform _chaos_after_move('battleship', p_game, me, foes,
      case when jsonb_array_length(sank) > 0 then 0.6 else least(0.5, hits * 0.12) end,
      case when cardinality(out_now) > 0 then 0.9 when jsonb_array_length(sank) > 0 then 0.5 else 0 end,
      case when jsonb_array_length(sank) > 0 then 'sinking a ship' else 'a direct hit' end);
    if not live then perform _bot_maybe_play(p_game); end if;
  end if;
  return jsonb_build_object('hits', hits, 'sank', sank, 'eliminated', to_jsonb(out_now), 'over', cardinality(alive) <= 1);
end $$;

-- The robot on the shared ocean: a heat map over every square it hasn't fired at and isn't its own,
-- built from the rivals' ships still afloat, with a strong pull toward hits that haven't sunk yet.
create or replace function public._bot_pick_shared(p_game uuid, p_bot uuid, k int) returns int[]
language plpgsql volatile security definer set search_path = public as $$
declare
  g games; n int; lens int[]; fired int[]; mine int[]; sunk int[]; live int[]; blocked int[];
  heat float8[]; picks int[] := '{}'; opp record; gone int[]; len int; c int; h boolean; cells int[]; w float8; sq int;
begin
  select * into g from games where id = p_game;
  n := mode_n(g.mode); lens := mode_ships(g.mode);
  select coalesce(array_agg(cell::int), '{}') into fired from shots where game_id = p_game;
  select coalesce(_fleet_cells(g.mode, ships), '{}') into mine from fleets where game_id = p_game and player_id = p_bot;
  select coalesce(array_agg(x::int), '{}') into sunk from shots s, unnest(s.sunk_cells) x where s.game_id = p_game;
  select coalesce(array_agg(cell::int), '{}') into live from shots where game_id = p_game and hit and target <> p_bot and not (cell::int = any (sunk));
  blocked := array(select f from unnest(fired) f where not (f = any (live))) || mine;
  heat := array_fill(0::float8, array[n * n]);
  for opp in select p from unnest(g.players) p where p <> p_bot and not (p = any (g.eliminated)) loop
    select coalesce(array_agg(distinct sunk_ship::int), '{}') into gone from shots where game_id = p_game and target = opp.p and sunk_ship is not null;
    for i in 1 .. cardinality(lens) loop
      continue when (i - 1) = any (gone);
      len := lens[i];
      for c in 0 .. n * n - 1 loop
        foreach h in array array[true, false] loop
          continue when (h and c % n + len > n) or (not h and c / n + len > n);
          cells := ship_cells(g.mode, c, h, len);
          continue when cells && blocked;
          w := 1 + 25 * cardinality(array(select y from unnest(cells) y where y = any (live)));
          foreach sq in array cells loop if not (sq = any (fired)) then heat[sq + 1] := heat[sq + 1] + w; end if; end loop;
        end loop;
      end loop;
    end loop;
  end loop;
  for c in select q - 1 from generate_subscripts(heat, 1) q where heat[q] > 0 order by heat[q] desc, random() loop
    exit when cardinality(picks) >= k;
    if not (c = any (picks)) and not (c = any (fired)) and not (c = any (mine)) then picks := picks || c; end if;
  end loop;
  foreach c in array array(select q from generate_series(0, n * n - 1) q order by random()) loop
    exit when cardinality(picks) >= k;
    if not (c = any (picks)) and not (c = any (fired)) and not (c = any (mine)) then picks := picks || c; end if;
  end loop;
  return picks;
end $$;

-- 003's create_game, with the shared ocean.
create or replace function public.create_game(opponents text[], p_mode int, p_spt int) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  ids uuid[];
  gid uuid;
  bot record;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if p_mode not in (0, 1, 2) or p_spt not in (1, 3) then raise exception 'Unknown game settings'; end if;
  select array_agg(id order by array_position(opponents, username)) into ids
    from profiles where username = any (opponents) and id <> me;
  if ids is null or cardinality(ids) <> cardinality(opponents) or cardinality(ids) not between 1 and 2 then
    raise exception 'Pick one or two other players';
  end if;
  insert into games (created_by, players, mode, spt)
    values (me, me || ids, p_mode, p_spt) returning id into gid;
  -- The robot's ships go straight in.
  if p_mode = 2 then   -- on the shared ocean each robot's fleet goes clear of the others
    for bot in select profile_id from bots where profile_id = any (ids) loop
      insert into fleets (game_id, player_id, ships) values (gid, bot.profile_id, _random_fleet_avoid(2::smallint, _ocean_taken(gid, null)));
    end loop;
  else
    insert into fleets (game_id, player_id, ships)
      select gid, b.profile_id, _random_fleet(p_mode::smallint) from bots b where b.profile_id = any (ids);
  end if;
  return gid;
end $$;
-- 003's set_fleet: on the shared ocean, not where someone else already is.
create or replace function public.set_fleet(p_game uuid, p_ships jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  g games;
  lens int[];
  n int;
  used int[] := '{}';
  cells int[];
  clean jsonb := '[]';
  s jsonb;
  c int;
  h boolean;
begin
  select * into g from games where id = p_game for update;
  if not found or me is null or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'setup' or exists (select 1 from fleets where game_id = p_game and player_id = me) then
    raise exception 'Your ships are already placed';
  end if;
  lens := mode_ships(g.mode);
  n := mode_n(g.mode);
  if jsonb_typeof(p_ships) is distinct from 'array' or jsonb_array_length(p_ships) <> cardinality(lens) then
    raise exception 'Wrong number of ships';
  end if;
  for i in 1 .. cardinality(lens) loop
    s := p_ships -> (i - 1);
    begin
      c := (s ->> 'c')::int;
      h := (s ->> 'h')::boolean;
    exception when others then raise exception 'Bad ship position';
    end;
    if c is null or h is null or c < 0 or c >= n * n then raise exception 'Bad ship position'; end if;
    if (h and c % n + lens[i] > n) or (not h and c / n + lens[i] > n) then raise exception 'A ship is off the board'; end if;
    cells := ship_cells(g.mode, c, h, lens[i]);
    if used && cells then raise exception 'Ships overlap'; end if;
    used := used || cells;
    clean := clean || jsonb_build_array(jsonb_build_object('c', c, 'h', h));
  end loop;
  if g.mode = 2 and used && _ocean_taken(p_game, me) then raise exception 'Someone else anchored there first: shuffle again'; end if;
  insert into fleets (game_id, player_id, ships) values (p_game, me, clean);
  if (select count(*) from fleets where game_id = p_game) = cardinality(g.players) then
    update games set status = 'playing', updated_at = now() where id = p_game;
    perform _bot_maybe_play(p_game);
  else
    update games set updated_at = now() where id = p_game;
  end if;
end $$;
-- 017's fire: the shared ocean has its own rules.
create or replace function public.fire(p_game uuid, p_target uuid, p_cells int[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  g games;
  f jsonb;
  lens int[];
  n int;
  shot int[];
  need int;
  mod int;
  cell int;
  ship_i int;
  scells int[];
  all_cells int[] := '{}';
  hits int := 0;
  sank jsonb := '[]';
  alive uuid[];
  nxt int;
  skips uuid[];
  foes uuid[];
  live boolean := nullif(current_setting('bs.live', true), '') = '1';
begin
  select * into g from games where id = p_game for update;
  if not found or me is null or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This game isn''t being played right now'; end if;
  if not live and g.players[g.turn + 1] <> me then raise exception 'It''s not your turn'; end if;
  if g.mode = 2 then
    if me = any (g.eliminated) then raise exception 'Your fleet is sunk'; end if;
    return _fire_ocean(p_game, me, p_cells, live);
  end if;
  if p_target = me or not (p_target = any (g.players)) or p_target = any (g.eliminated) then
    raise exception 'Pick an opponent who is still in the game';
  end if;

  n := mode_n(g.mode);
  lens := mode_ships(g.mode);
  select coalesce(array_agg(s.cell::int), '{}') into shot from shots s where s.game_id = p_game and s.target = p_target;
  select coalesce((select shot_mod from player_mods where game_id = p_game and player_id = me), 0) into mod;
  need := case when live then 1 else least(greatest(1, g.spt + mod), n * n - cardinality(shot)) end;
  if p_cells is null or cardinality(p_cells) <> need
     or (select count(distinct x) from unnest(p_cells) x) <> need then
    raise exception 'Pick % square(s)', need;
  end if;
  if exists (select 1 from unnest(p_cells) x where x is null or x < 0 or x >= n * n or x = any (shot)) then
    raise exception 'Pick squares nobody has fired at yet';
  end if;
  if not live then update player_mods set shot_mod = 0 where game_id = p_game and player_id = me; end if;

  select ships into f from fleets where game_id = p_game and player_id = p_target;
  all_cells := _fleet_cells(g.mode, f);

  g.move := g.move + 1;
  foreach cell in array p_cells loop
    ship_i := null;
    for i in 1 .. cardinality(lens) loop
      scells := ship_cells(g.mode, (f -> (i - 1) ->> 'c')::int, (f -> (i - 1) ->> 'h')::boolean, lens[i]);
      if cell = any (scells) then ship_i := i; exit; end if;
    end loop;
    shot := shot || cell;
    if ship_i is null then
      insert into shots (game_id, move, shooter, target, cell, hit) values (p_game, g.move, me, p_target, cell, false);
    elsif scells <@ shot then
      hits := hits + 1;
      sank := sank || to_jsonb(ship_i - 1);
      insert into shots (game_id, move, shooter, target, cell, hit, sunk_ship, sunk_cells)
        values (p_game, g.move, me, p_target, cell, true, ship_i - 1, scells::smallint[]);
    else
      hits := hits + 1;
      insert into shots (game_id, move, shooter, target, cell, hit) values (p_game, g.move, me, p_target, cell, true);
    end if;
  end loop;

  if all_cells <@ shot then
    g.eliminated := g.eliminated || p_target;
  end if;
  alive := array(select p from unnest(g.players) p where not (p = any (g.eliminated)));

  foes := array(select p from unnest(g.players) p where p <> me and not (p = any (g.eliminated)));
  if cardinality(alive) = 1 then
    update games set status = 'over', winner = alive[1], move = g.move, eliminated = g.eliminated, updated_at = now()
      where id = p_game;
    perform _chaos_after_move('battleship', p_game, me, foes, 1.0, 0.8, 'final broadside');
  else
    skips := g.skip_next;
    nxt := g.turn;
    loop
      nxt := (nxt + 1) % cardinality(g.players);
      continue when g.players[nxt + 1] = any (g.eliminated);
      if g.players[nxt + 1] = any (skips) and g.players[nxt + 1] <> me then
        skips := array_remove(skips, g.players[nxt + 1]);
        continue;
      end if;
      exit;
    end loop;
    update games set turn = nxt, move = g.move, eliminated = g.eliminated, skip_next = skips, updated_at = now()
      where id = p_game;
    perform _chaos_after_move('battleship', p_game, me, foes,
      case when jsonb_array_length(sank) > 0 then 0.6 else least(0.5, hits * 0.12) end,
      case when p_target = any (g.eliminated) then 0.9 when jsonb_array_length(sank) > 0 then 0.5 else 0 end,
      case when jsonb_array_length(sank) > 0 then 'sinking a ship' else 'a direct hit' end);
    -- If the robot is up next, it plays right now (not in a live battle: there it fires on its own).
    if not live then perform _bot_maybe_play(p_game); end if;
  end if;

  return jsonb_build_object('hits', hits, 'sank', sank,
                            'eliminated', p_target = any (g.eliminated),
                            'over', cardinality(alive) = 1);
end $$;
-- 003's robot turn: on the shared ocean it just fires (no cheats there).
create or replace function public._bot_maybe_play(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  g games;
  bot uuid;
  orig text;
  tgt uuid;
  n int;
  k int;
  mod int;
  shooter uuid;
  kinds text[];
  r float8;
  center int;
begin
  select * into g from games where id = p_game;
  if not found or g.status <> 'playing' then return; end if;
  bot := g.players[g.turn + 1];
  if not exists (select 1 from bots where profile_id = bot) then return; end if;
  n := mode_n(g.mode);

  -- Act as the robot for the rest of this turn.
  orig := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claim.sub', bot::text, true);
  begin
    if g.mode = 2 then
      select coalesce((select shot_mod from player_mods where game_id = p_game and player_id = bot), 0) into mod;
      k := least(greatest(1, g.spt + mod), n * n - (select count(*)::int from shots where game_id = p_game));
      perform fire(p_game, null, _bot_pick_shared(p_game, bot, k));
      perform set_config('request.jwt.claim.sub', coalesce(orig, ''), true);
      return;
    end if;
    -- Suspicious of the last player? An extra shot is easy to spot.
    select s.shooter into shooter from shots s where s.game_id = p_game and s.move = g.move limit 1;
    if shooter is not null and shooter <> bot
       and not exists (select 1 from accusations where game_id = p_game and move = g.move) then
      kinds := array(select distinct kind from cheats where game_id = p_game and player_id = shooter and move = g.move);
      if random() < (case when 'extra' = any (kinds) then 0.8 when cardinality(kinds) > 0 then 0.3 else 0.08 end) then
        perform call_cheater(p_game);
      end if;
    end if;

    -- Go after whoever it has wounded most, otherwise anyone still afloat.
    select t into tgt from unnest(g.players) t
      where t <> bot and not (t = any (g.eliminated))
      order by (select count(*) from shots s where s.game_id = p_game and s.target = t and s.hit
                  and not exists (select 1 from shots s2 where s2.game_id = p_game and s2.target = t and s.cell = any (s2.sunk_cells))) desc,
               random()
      limit 1;

    -- Cheat now and then.
    if _cheats_left(p_game, bot) > 0 and random() < 0.3 then
      r := random();
      if r < 0.4 then
        select x into center from generate_series(0, n * n - 1) x
          where not exists (select 1 from shots where game_id = p_game and target = tgt and cell = x) order by random() limit 1;
        perform cheat_peek(p_game, tgt, center);
      elsif r < 0.75 then
        perform cheat_extra_shot(p_game);
      else
        begin perform cheat_move_ship(p_game); exception when others then null; end;
      end if;
    end if;

    select coalesce((select shot_mod from player_mods where game_id = p_game and player_id = bot), 0) into mod;
    k := least(greatest(1, g.spt + mod), n * n - (select count(*)::int from shots where game_id = p_game and target = tgt));
    perform fire(p_game, tgt, _bot_pick(p_game, bot, tgt, k, g.mode));
  exception when others then
    perform set_config('request.jwt.claim.sub', coalesce(orig, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', coalesce(orig, ''), true);
end $$;
-- 026's live robot, on the shared ocean too.
create or replace function public.fire_live_bot(p_game uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g games; bot uuid; tgt uuid; cell int; orig text; r jsonb;
begin
  select * into g from games where id = p_game for update;
  if not found or me is null or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if not _bs_live(g) then return null; end if;
  select p into bot from unnest(g.players) p where exists (select 1 from bots where profile_id = p) and not (p = any (g.eliminated)) limit 1;
  if bot is null then return null; end if;
  if exists (select 1 from shots where game_id = p_game and shooter = bot and created_at > now() - interval '1.2 seconds') then return null; end if;
  if g.mode = 2 then
    cell := (_bot_pick_shared(p_game, bot, 1))[1];
    if cell is null then return null; end if;
    orig := current_setting('request.jwt.claim.sub', true);
    perform set_config('request.jwt.claim.sub', bot::text, true);
    r := fire_live(p_game, null, cell);
    perform set_config('request.jwt.claim.sub', coalesce(orig, ''), true);
    return r || jsonb_build_object('cell', cell);
  end if;
  -- Whoever it has wounded most, otherwise anyone still afloat.
  select t into tgt from unnest(g.players) t
    where t <> bot and not (t = any (g.eliminated))
    order by (select count(*) from shots s where s.game_id = p_game and s.target = t and s.hit
                and not exists (select 1 from shots s2 where s2.game_id = p_game and s2.target = t and s.cell = any (s2.sunk_cells))) desc, random()
    limit 1;
  if tgt is null then return null; end if;
  cell := (_bot_pick(p_game, bot, tgt, 1, g.mode))[1];
  if cell is null then return null; end if;
  orig := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claim.sub', bot::text, true);
  r := fire_live(p_game, tgt, cell);
  perform set_config('request.jwt.claim.sub', coalesce(orig, ''), true);
  return r || jsonb_build_object('target', tgt, 'cell', cell);
end $$;

revoke execute on function public._ocean_taken(uuid, uuid), public._random_fleet_avoid(smallint, int[]), public._no_ocean_cheats(),
  public._fire_ocean(uuid, uuid, int[], boolean), public._bot_pick_shared(uuid, uuid, int) from public, anon, authenticated;
revoke execute on function public.bs_shuffle(uuid) from public, anon;
grant execute on function public.bs_shuffle(uuid) to authenticated;
