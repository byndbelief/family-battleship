-- The robot opponent: admiral_bot.
--
-- 1. In Supabase > Authentication > Users > Add user, create
--      admiral_bot@<your domain>   (any long random password, Auto Confirm ticked)
--    Nobody ever signs in as it.
-- 2. Paste this whole file into Supabase > SQL Editor and run it once.
--    (Either order works: the robot is registered whenever that user shows up.)
--
-- The robot plays inside the database, the moment its turn comes up. It uses the
-- exact same fire / cheat / call-cheater functions as everyone else, by briefly
-- acting as the robot player, so it follows every rule the kids do.

create table if not exists public.bots (
  profile_id uuid primary key references public.profiles (id) on delete cascade
);
alter table public.bots enable row level security;
drop policy if exists "everyone can see who the robots are" on public.bots;
create policy "everyone can see who the robots are" on public.bots for select to authenticated using (true);
revoke insert, update, delete, truncate on public.bots from anon, authenticated;

create or replace function public._register_bot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.username = 'admiral_bot' then insert into bots values (new.id) on conflict do nothing; end if;
  return new;
end $$;
drop trigger if exists on_profile_bot on public.profiles;
create trigger on_profile_bot after insert on public.profiles for each row execute function public._register_bot();
insert into public.bots select id from public.profiles where username = 'admiral_bot' on conflict do nothing;

-- ---------------------------------------------------------------- helpers

create or replace function public._random_fleet(m smallint) returns jsonb
language plpgsql volatile set search_path = public as $$
declare
  n int := mode_n(m);
  lens int[] := mode_ships(m);
  used int[];
  fleet jsonb;
  c int; h boolean; cells int[]; placed boolean;
begin
  loop
    used := '{}'; fleet := '[]';
    for i in 1 .. cardinality(lens) loop
      placed := false;
      for t in 1 .. 200 loop
        h := random() < 0.5;
        c := case when h then floor(random() * n)::int * n + floor(random() * (n - lens[i] + 1))::int
                  else floor(random() * (n - lens[i] + 1))::int * n + floor(random() * n)::int end;
        cells := ship_cells(m, c, h, lens[i]);
        if not (cells && used) then
          used := used || cells;
          fleet := fleet || jsonb_build_array(jsonb_build_object('c', c, 'h', h));
          placed := true; exit;
        end if;
      end loop;
      exit when not placed;
    end loop;
    if jsonb_array_length(fleet) = cardinality(lens) then return fleet; end if;
  end loop;
end $$;

create or replace function public._add_pick(picks int[], c int, fired int[], k int) returns int[]
language sql immutable as $$
  select case when c is null or c = any (fired) or c = any (picks) or cardinality(picks) >= k then picks else picks || c end
$$;

-- One step from `cur` in direction `d` on an n-wide board, or null at the edge.
create or replace function public._step(cur int, d int, n int) returns int
language sql immutable as $$
  select case when cur + d < 0 or cur + d >= n * n or (abs(d) = 1 and (cur + d) / n <> cur / n) then null else cur + d end
$$;

-- Where the robot fires: squares it peeked at, then along a line of hits, then
-- around any hit, then a checkerboard hunt. It only uses what the board shows.
create or replace function public._bot_pick(p_game uuid, p_bot uuid, p_target uuid, k int, m smallint) returns int[]
language plpgsql volatile set search_path = public as $$
declare
  n int := mode_n(m);
  fired int[]; sunk int[]; live int[]; peeked int[];
  picks int[] := '{}';
  a int; b int; d int; cur int; nxt int; c int;
begin
  select coalesce(array_agg(cell::int), '{}') into fired from shots where game_id = p_game and target = p_target;
  select coalesce(array_agg(x::int), '{}') into sunk from shots s, unnest(s.sunk_cells) x where s.game_id = p_game and s.target = p_target;
  select coalesce(array_agg(cell::int), '{}') into live from shots where game_id = p_game and target = p_target and hit and not (cell::int = any (sunk));
  select coalesce(array_agg(distinct x::int), '{}') into peeked
    from cheats ch, jsonb_array_elements_text(ch.detail -> 'ships') x
    where ch.game_id = p_game and ch.player_id = p_bot and ch.kind = 'peek' and ch.detail ->> 'target' = p_target::text;

  foreach c in array peeked loop picks := _add_pick(picks, c, fired, k); end loop;

  foreach a in array live loop
    foreach b in array live loop
      d := b - a;
      if d = 1 or d = n then
        cur := b; loop nxt := _step(cur, d, n); exit when nxt is null or not (nxt = any (live)); cur := nxt; end loop;
        picks := _add_pick(picks, nxt, fired, k);
        cur := a; loop nxt := _step(cur, -d, n); exit when nxt is null or not (nxt = any (live)); cur := nxt; end loop;
        picks := _add_pick(picks, nxt, fired, k);
      end if;
    end loop;
  end loop;

  foreach a in array live loop
    foreach d in array array[n, -n, 1, -1] loop picks := _add_pick(picks, _step(a, d, n), fired, k); end loop;
  end loop;

  foreach c in array array(select x from generate_series(0, n * n - 1) x where ((x / n) + (x % n)) % 2 = 0 order by random()) loop
    exit when cardinality(picks) >= k; picks := _add_pick(picks, c, fired, k);
  end loop;
  foreach c in array array(select x from generate_series(0, n * n - 1) x order by random()) loop
    exit when cardinality(picks) >= k; picks := _add_pick(picks, c, fired, k);
  end loop;
  return picks;
end $$;

-- ---------------------------------------------------------------- the robot's turn

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

-- ---------------------------------------------------------------- existing functions, now robot-aware

create or replace function public.create_game(opponents text[], p_mode int, p_spt int) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  ids uuid[];
  gid uuid;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if p_mode not in (0, 1) or p_spt not in (1, 3) then raise exception 'Unknown game settings'; end if;
  select array_agg(id order by array_position(opponents, username)) into ids
    from profiles where username = any (opponents) and id <> me;
  if ids is null or cardinality(ids) <> cardinality(opponents) or cardinality(ids) not between 1 and 2 then
    raise exception 'Pick one or two other players';
  end if;
  insert into games (created_by, players, mode, spt)
    values (me, me || ids, p_mode, p_spt) returning id into gid;
  -- The robot's ships go straight in.
  insert into fleets (game_id, player_id, ships)
    select gid, b.profile_id, _random_fleet(p_mode::smallint) from bots b where b.profile_id = any (ids);
  return gid;
end $$;

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
  insert into fleets (game_id, player_id, ships) values (p_game, me, clean);
  if (select count(*) from fleets where game_id = p_game) = cardinality(g.players) then
    update games set status = 'playing', updated_at = now() where id = p_game;
    perform _bot_maybe_play(p_game);
  else
    update games set updated_at = now() where id = p_game;
  end if;
end $$;

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
begin
  select * into g from games where id = p_game for update;
  if not found or me is null or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This game isn''t being played right now'; end if;
  if g.players[g.turn + 1] <> me then raise exception 'It''s not your turn'; end if;
  if p_target = me or not (p_target = any (g.players)) or p_target = any (g.eliminated) then
    raise exception 'Pick an opponent who is still in the game';
  end if;

  n := mode_n(g.mode);
  lens := mode_ships(g.mode);
  select coalesce(array_agg(s.cell::int), '{}') into shot from shots s where s.game_id = p_game and s.target = p_target;
  select coalesce((select shot_mod from player_mods where game_id = p_game and player_id = me), 0) into mod;
  need := least(greatest(1, g.spt + mod), n * n - cardinality(shot));
  if p_cells is null or cardinality(p_cells) <> need
     or (select count(distinct x) from unnest(p_cells) x) <> need then
    raise exception 'Pick % square(s)', need;
  end if;
  if exists (select 1 from unnest(p_cells) x where x is null or x < 0 or x >= n * n or x = any (shot)) then
    raise exception 'Pick squares nobody has fired at yet';
  end if;
  update player_mods set shot_mod = 0 where game_id = p_game and player_id = me;

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

  if cardinality(alive) = 1 then
    update games set status = 'over', winner = alive[1], move = g.move, eliminated = g.eliminated, updated_at = now()
      where id = p_game;
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
    -- If the robot is up next, it plays right now.
    perform _bot_maybe_play(p_game);
  end if;

  return jsonb_build_object('hits', hits, 'sank', sank,
                            'eliminated', p_target = any (g.eliminated),
                            'over', cardinality(alive) = 1);
end $$;

revoke execute on function public._bot_maybe_play(uuid), public._bot_pick(uuid, uuid, uuid, int, smallint),
  public._random_fleet(smallint) from public, anon, authenticated;
