-- 017: live battles against the robot.
-- Applied with the Supabase connector (apply_migration '017_robot_live'). Safe to run again.
--
-- A game with the robot in it can be switched to live (live_bot, set_live_bot()): then it counts
-- as live while every person in it has the page open (the robot is always "here"). The robot acts
-- in real time through the pages watching it:
--   Hilltop Duel  duel_fire_live_bot   fires as the robot through duel_fire_live (same 2.5 s reload
--                                        floor; the page waits longer at Rookie and Pro)
--   Battleship    fire_live_bot        the server picks its target and square (_bot_pick) and fires
--                                        at most every 2.4 s, however many pages ask
--   Putt Post     golf_submit_live_bot the robot's hole on the current row, once
-- In a live Battleship game the robot no longer also takes turn-based turns after each shot.

alter table public.duel_games add column if not exists live_bot boolean not null default false;
alter table public.games add column if not exists live_bot boolean not null default false;
alter table public.golf_games add column if not exists live_bot boolean not null default false;

-- "Everyone's here": every player is on the page, except a robot when live_bot is on.
create or replace function public._duel_live(g duel_games) returns boolean
language sql stable security definer set search_path = public as $$
  select g.status = 'playing'
     and not exists (
       select 1 from unnest(g.players) p
       where not (g.live_bot and exists (select 1 from bots where profile_id = p))
         and not exists (select 1 from duel_here h where h.game_id = g.id and h.player = p and h.seen_at > now() - interval '8 seconds'));
$$;

create or replace function public._bs_live(g games) returns boolean
language sql stable security definer set search_path = public as $$
  select g.status = 'playing'
     and not exists (
       select 1 from unnest(g.players) p
       where not (p = any (g.eliminated))
         and not (g.live_bot and exists (select 1 from bots where profile_id = p))
         and not exists (select 1 from live_here h where h.kind = 'battleship' and h.game_id = g.id and h.player = p and h.seen_at > now() - interval '8 seconds'));
$$;

create or replace function public._golf_live(g golf_games) returns boolean
language sql stable security definer set search_path = public as $$
  select g.status = 'playing' and cardinality(g.players) > 1
     and not exists (
       select 1 from unnest(g.players) p
       where not (g.live_bot and exists (select 1 from bots where profile_id = p))
         and not exists (select 1 from live_here h where h.kind = 'golf' and h.game_id = g.id and h.player = p and h.seen_at > now() - interval '8 seconds'));
$$;

-- Switch live-vs-robot on or off (anyone in the game; only for games with the robot in them).
create or replace function public.set_live_bot(p_kind text, p_game uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); ps uuid[];
begin
  if p_kind = 'duel' then select players into ps from duel_games where id = p_game;
  elsif p_kind = 'battleship' then select players into ps from games where id = p_game;
  elsif p_kind = 'golf' then select players into ps from golf_games where id = p_game;
  else raise exception 'Unknown game'; end if;
  if ps is null or not (me = any (ps)) then raise exception 'Game not found'; end if;
  if not exists (select 1 from bots where profile_id = any (ps)) then raise exception 'There''s no robot in this game'; end if;
  if p_kind = 'duel' then update duel_games set live_bot = p_on, updated_at = now() where id = p_game;
  elsif p_kind = 'battleship' then update games set live_bot = p_on, updated_at = now() where id = p_game;
  else update golf_games set live_bot = p_on, updated_at = now() where id = p_game; end if;
end $$;

-- The robot's live duel shot (worked out on the page, like its turn-based ones).
create or replace function public.duel_fire_live_bot(p_game uuid, p_angle int, p_power int, p_crater jsonb, p_dmg int[], p_x int, p_target_x int, p_wind_move int, p_wind_x int default 1) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g duel_games; bot uuid; orig text;
begin
  select * into g from duel_games where id = p_game;
  if not found or me is null or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  select p into bot from unnest(g.players) p where exists (select 1 from bots where profile_id = p) limit 1;
  if bot is null then raise exception 'There''s no robot in this duel'; end if;
  orig := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claim.sub', bot::text, true);
  perform duel_fire_live(p_game, p_angle, p_power, p_crater, p_dmg, p_x, p_target_x, p_wind_move, p_wind_x);
  perform set_config('request.jwt.claim.sub', coalesce(orig, ''), true);
end $$;

-- The robot's live Battleship shot: its target and square are picked here. Returns null when its
-- guns are still reloading (several pages may be asking).
create or replace function public.fire_live_bot(p_game uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g games; bot uuid; tgt uuid; cell int; orig text; r jsonb;
begin
  select * into g from games where id = p_game for update;
  if not found or me is null or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if not _bs_live(g) then return null; end if;
  select p into bot from unnest(g.players) p where exists (select 1 from bots where profile_id = p) and not (p = any (g.eliminated)) limit 1;
  if bot is null then return null; end if;
  if exists (select 1 from shots where game_id = p_game and shooter = bot and created_at > now() - interval '2.4 seconds') then return null; end if;
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

-- The robot's hole in a live Putt Post race (played out on the page).
create or replace function public.golf_submit_live_bot(p_game uuid, p_strokes jsonb, p_actual int, p_holed boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g golf_games; bot uuid; r jsonb;
begin
  select * into g from golf_games where id = p_game for update;
  if not found or auth.uid() is null or not (auth.uid() = any (g.players)) then raise exception 'Game not found'; end if;
  if not _golf_live(g) then raise exception 'The live race is over: back to taking turns'; end if;
  select p into bot from unnest(g.players) p where exists (select 1 from bots where profile_id = p) limit 1;
  if bot is null then raise exception 'There''s no robot in this game'; end if;
  perform set_config('golf.live', '1', true);
  r := _golf_submit(p_game, bot, p_strokes, p_actual, 0, p_holed);
  perform set_config('golf.live', '', true);
  return r;
end $$;

-- 015's fire, where a live battle no longer also hands the robot a turn after each shot.
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

revoke execute on function public.set_live_bot(text, uuid, boolean), public.duel_fire_live_bot(uuid, int, int, jsonb, int[], int, int, int, int),
  public.fire_live_bot(uuid), public.golf_submit_live_bot(uuid, jsonb, int, boolean) from public, anon;
grant execute on function public.set_live_bot(text, uuid, boolean), public.duel_fire_live_bot(uuid, int, int, jsonb, int[], int, int, int, int),
  public.fire_live_bot(uuid), public.golf_submit_live_bot(uuid, jsonb, int, boolean) to authenticated;
