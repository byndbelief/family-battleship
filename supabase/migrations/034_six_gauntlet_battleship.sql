-- 034: Gauntlets and Battleship for up to 6 players (5 others).
--   Gauntlet: each round is still a random game, but only one that seats everyone: Putt Post,
--   Hilltop and Battleship take 6, Chaos Cards 4. Never the same game twice in a row, as before.
--   Battleship: 1 to 5 opponents. The usual boards (one per opponent) need nothing else. The
--   shared ocean gets a bigger sea for 4 or more (mode 3, 16x16, same 4 ships each): six fleets
--   would fill half of a 12x12. Everything that meant "the shared ocean" (mode 2) now means 2 or 3.
-- Applied with the Supabase connector (apply_migration '034_six_gauntlet_battleship'). Safe to run again.

-- 007's gauntlet_create: 1 to 5 others.
create or replace function public.gauntlet_create(opponents text[], p_rounds int) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  ids uuid[];
  gid uuid;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if p_rounds not between 1 and 9 then raise exception 'Pick 1 to 9 rounds'; end if;
  select array_agg(id order by array_position(opponents, username)) into ids from profiles where username = any (opponents) and id <> me;
  if ids is null or cardinality(ids) <> cardinality(opponents) or cardinality(ids) not between 1 and 5 then raise exception 'Pick one to five other players'; end if;
  -- Already a Gauntlet running with exactly these players? That's the one.
  select id into gid from gauntlets
    where status = 'playing' and _group_key(players) = _group_key(me || ids)
    order by created_at desc limit 1;
  if gid is not null then return gid; end if;
  insert into gauntlets (created_by, players, rounds, scores) values (me, me || ids, p_rounds, array_fill(0, array[cardinality(ids) + 1]))
    returning id into gid;
  perform _gauntlet_next(gid);
  return gid;
end $$;

-- 023's next round: the game list depends on how many are playing.
create or replace function public._gauntlet_next(p_gauntlet uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  gt gauntlets;
  n int; rnd int; kinds text[]; k text; rot uuid[]; child uuid; has_bot boolean; p uuid;
begin
  select * into gt from gauntlets where id = p_gauntlet for update;
  n := cardinality(gt.players);
  rnd := gt.round + 1;
  -- Only games that seat everyone: Putt Post, Hilltop and Battleship take 6, Chaos Cards 4.
  kinds := array['golf', 'duel', 'battleship'] || case when n <= 4 then array['cards'] else '{}'::text[] end;
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

-- The bigger shared ocean.
create or replace function public.mode_n(m smallint) returns int
language sql immutable as $$ select case m when 0 then 8 when 2 then 12 when 3 then 16 else 10 end $$;
create or replace function public.mode_ships(m smallint) returns int[]
language sql immutable as $$ select case m when 1 then array[5, 4, 3, 3, 2] else array[4, 3, 3, 2] end $$;
alter table public.games drop constraint if exists games_mode_check;
alter table public.games add constraint games_mode_check check (mode in (0, 1, 2, 3));

-- 028's create_game: 1 to 5 opponents; the shared ocean grows for 4+.
create or replace function public.create_game(opponents text[], p_mode int, p_spt int) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  ids uuid[];
  gid uuid;
  bot record;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if p_mode not in (0, 1, 2, 3) or p_spt not in (1, 3) then raise exception 'Unknown game settings'; end if;
  select array_agg(id order by array_position(opponents, username)) into ids
    from profiles where username = any (opponents) and id <> me;
  if ids is null or cardinality(ids) <> cardinality(opponents) or cardinality(ids) not between 1 and 5 then
    raise exception 'Pick one to five other players';
  end if;
  -- Four or more on the shared ocean: the bigger sea.
  if p_mode = 2 and cardinality(ids) >= 3 then p_mode := 3; end if;
  insert into games (created_by, players, mode, spt)
    values (me, me || ids, p_mode, p_spt) returning id into gid;
  -- The robot's ships go straight in.
  if p_mode in (2, 3) then   -- on the shared ocean each robot's fleet goes clear of the others
    for bot in select profile_id from bots where profile_id = any (ids) loop
      insert into fleets (game_id, player_id, ships) values (gid, bot.profile_id, _random_fleet_avoid(p_mode::smallint, _ocean_taken(gid, null)));
    end loop;
  else
    insert into fleets (game_id, player_id, ships)
      select gid, b.profile_id, _random_fleet(p_mode::smallint) from bots b where b.profile_id = any (ids);
  end if;
  return gid;
end $$;

-- Robot turns one after another in a loop, not nested inside each other. Before, each robot shot
-- called the next robot's turn from inside itself, so with 5 robots finishing a game between them
-- (every person sunk) it nested 200+ deep: close to Postgres's stack limit. _bot_play_one is 028's
-- robot turn; _bot_maybe_play now plays robot turns until it's a person's (a nested call, from a
-- robot's own shot, just returns: the loop takes the next one).
create or replace function public._bot_play_one(p_game uuid) returns void
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
    if g.mode in (2, 3) then
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
create or replace function public._bot_maybe_play(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g games; guard int := 0;
begin
  if coalesce(current_setting('bs.botloop', true), '') = '1' then return; end if;
  perform set_config('bs.botloop', '1', true);
  loop
    select * into g from games where id = p_game;
    exit when not found or g.status <> 'playing' or not exists (select 1 from bots where profile_id = g.players[g.turn + 1]);
    guard := guard + 1;
    exit when guard > 1000;
    perform _bot_play_one(p_game);
  end loop;
  perform set_config('bs.botloop', '', true);
exception when others then
  perform set_config('bs.botloop', '', true);
  raise;
end $$;
revoke execute on function public._bot_play_one(uuid), public._bot_maybe_play(uuid) from public, anon, authenticated;

-- Everywhere else, "the shared ocean" (mode 2) becomes mode 2 or 3. Patched in place, once.
do $$
declare f text; d text;
begin
  foreach f in array array['public._no_ocean_cheats()', 'public.set_fleet(uuid,jsonb)', 'public.fire(uuid,uuid,integer[])',
                           'public.fire_live_bot(uuid)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('mode in (2, 3)' in d) = 0 then
      execute replace(replace(d, 'g.mode = 2', 'g.mode in (2, 3)'), 'and mode = 2)', 'and mode in (2, 3))');
    end if;
  end loop;
end $$;
