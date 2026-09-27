-- Cheating, done properly: the server runs every cheat, keeps it secret from
-- the other players, and settles accusations.
--
-- Paste this whole file into Supabase > SQL Editor and run it once, after schema.sql.
--
-- Each player gets 2 cheats per game:
--   peek   - spy on a 3x3 patch of an opponent's waters
--   extra  - one extra shot this turn
--   move   - one of your ships that hasn't been hit slips away to a new spot
-- After any turn, another player may call cheater (once per turn):
--   right  -> the cheater's next turn is skipped
--   wrong  -> the accuser fires one shot fewer next turn

-- Public: whose next turn gets skipped (everyone sees the penalty).
alter table public.games add column if not exists skip_next uuid[] not null default '{}';

-- Private: each player's shot adjustment for their next turn (+1 extra shot cheat, -1 false accusation).
create table public.player_mods (
  game_id uuid not null references public.games (id) on delete cascade,
  player_id uuid not null references public.profiles (id),
  shot_mod int not null default 0,
  primary key (game_id, player_id)
);

create table public.cheats (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  player_id uuid not null references public.profiles (id),
  move int not null,                         -- the move the cheat was part of
  kind text not null check (kind in ('peek', 'extra', 'move')),
  detail jsonb,
  created_at timestamptz not null default now()
);
create index cheats_game on public.cheats (game_id, move);

create table public.accusations (
  game_id uuid not null references public.games (id) on delete cascade,
  move int not null,
  accuser uuid not null references public.profiles (id),
  accused uuid not null references public.profiles (id),
  busted boolean not null,
  kinds text[] not null default '{}',        -- what they were caught doing
  created_at timestamptz not null default now(),
  primary key (game_id, move)
);

alter table public.player_mods enable row level security;
alter table public.cheats enable row level security;
alter table public.accusations enable row level security;

create policy "see your own shot adjustments" on public.player_mods
  for select to authenticated using (player_id = auth.uid());

create policy "see your own cheats, or all of them once the game is over" on public.cheats
  for select to authenticated using (
    player_id = auth.uid()
    or exists (select 1 from public.games g where g.id = game_id and g.status = 'over' and auth.uid() = any (g.players))
  );

create policy "see accusations in games you're in" on public.accusations
  for select to authenticated using (
    exists (select 1 from public.games g where g.id = game_id and auth.uid() = any (g.players))
  );

revoke insert, update, delete, truncate on public.player_mods, public.cheats, public.accusations from anon, authenticated;

alter publication supabase_realtime add table public.accusations;

-- ---------------------------------------------------------------- helpers

-- Loads the game for update and checks it's the caller's turn in a live game.
create or replace function public._lock_my_turn(p_game uuid) returns public.games
language plpgsql security definer set search_path = public as $$
declare
  g games;
begin
  select * into g from games where id = p_game for update;
  if not found or auth.uid() is null or not (auth.uid() = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This game isn''t being played right now'; end if;
  if g.players[g.turn + 1] <> auth.uid() then raise exception 'You can only cheat on your own turn'; end if;
  return g;
end $$;

create or replace function public._cheats_left(p_game uuid, p_player uuid) returns int
language sql stable security definer set search_path = public as $$
  select 2 - count(*)::int from cheats where game_id = p_game and player_id = p_player
$$;

create or replace function public._fleet_cells(m smallint, ships jsonb) returns int[]
language plpgsql immutable as $$
declare
  lens int[] := mode_ships(m);
  out int[] := '{}';
begin
  for i in 1 .. cardinality(lens) loop
    out := out || ship_cells(m, (ships -> (i - 1) ->> 'c')::int, (ships -> (i - 1) ->> 'h')::boolean, lens[i]);
  end loop;
  return out;
end $$;

-- ---------------------------------------------------------------- the cheats

create or replace function public.cheat_peek(p_game uuid, p_target uuid, p_center int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  g games := _lock_my_turn(p_game);
  n int := mode_n(g.mode);
  area int[] := '{}';
  spotted int[];
  r int; c int;
begin
  if _cheats_left(p_game, me) <= 0 then raise exception 'You''re out of cheats this game'; end if;
  if p_target = me or not (p_target = any (g.players)) or p_target = any (g.eliminated) then
    raise exception 'Peek at an opponent who is still in the game';
  end if;
  if p_center is null or p_center < 0 or p_center >= n * n then raise exception 'Pick a square to peek at'; end if;
  for dr in -1 .. 1 loop
    for dc in -1 .. 1 loop
      r := p_center / n + dr; c := p_center % n + dc;
      if r between 0 and n - 1 and c between 0 and n - 1 then area := area || (r * n + c); end if;
    end loop;
  end loop;
  select _fleet_cells(g.mode, fl.ships) into spotted from fleets fl where fl.game_id = p_game and fl.player_id = p_target;
  spotted := array(select x from unnest(area) x where x = any (spotted));
  insert into cheats (game_id, player_id, move, kind, detail)
    values (p_game, me, g.move + 1, 'peek', jsonb_build_object('target', p_target, 'area', area, 'ships', spotted));
  return jsonb_build_object('area', area, 'ships', spotted);
end $$;

create or replace function public.cheat_extra_shot(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  g games := _lock_my_turn(p_game);
begin
  if _cheats_left(p_game, me) <= 0 then raise exception 'You''re out of cheats this game'; end if;
  if exists (select 1 from cheats where game_id = p_game and player_id = me and move = g.move + 1 and kind = 'extra') then
    raise exception 'You already sneaked an extra shot this turn';
  end if;
  insert into cheats (game_id, player_id, move, kind) values (p_game, me, g.move + 1, 'extra');
  insert into player_mods (game_id, player_id, shot_mod) values (p_game, me, 1)
    on conflict (game_id, player_id) do update set shot_mod = player_mods.shot_mod + 1;
end $$;

create or replace function public.cheat_move_ship(p_game uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  g games := _lock_my_turn(p_game);
  n int := mode_n(g.mode);
  lens int[] := mode_ships(g.mode);
  f jsonb;
  shot_at_me int[];
  candidates int[] := '{}';
  pick int;
  others int[];
  c int; h boolean; cells int[];
begin
  if _cheats_left(p_game, me) <= 0 then raise exception 'You''re out of cheats this game'; end if;
  select ships into f from fleets where game_id = p_game and player_id = me;
  select coalesce(array_agg(cell::int), '{}') into shot_at_me from shots where game_id = p_game and target = me;
  for i in 1 .. cardinality(lens) loop
    if not (ship_cells(g.mode, (f -> (i - 1) ->> 'c')::int, (f -> (i - 1) ->> 'h')::boolean, lens[i]) && shot_at_me) then
      candidates := candidates || i;
    end if;
  end loop;
  if cardinality(candidates) = 0 then raise exception 'Every one of your ships has been hit. Nothing left to sneak away'; end if;
  pick := candidates[1 + floor(random() * cardinality(candidates))::int];
  others := '{}';
  for i in 1 .. cardinality(lens) loop
    if i <> pick then others := others || ship_cells(g.mode, (f -> (i - 1) ->> 'c')::int, (f -> (i - 1) ->> 'h')::boolean, lens[i]); end if;
  end loop;
  for t in 1 .. 400 loop
    h := random() < 0.5;
    c := case when h then floor(random() * n)::int * n + floor(random() * (n - lens[pick] + 1))::int
              else floor(random() * (n - lens[pick] + 1))::int * n + floor(random() * n)::int end;
    cells := ship_cells(g.mode, c, h, lens[pick]);
    if not (cells && others) and not (cells && shot_at_me) then
      f := jsonb_set(f, array[(pick - 1)::text], jsonb_build_object('c', c, 'h', h));
      update fleets set ships = f where game_id = p_game and player_id = me;
      insert into cheats (game_id, player_id, move, kind, detail)
        values (p_game, me, g.move + 1, 'move', jsonb_build_object('ship', pick - 1));
      return jsonb_build_object('ship', pick - 1);
    end if;
  end loop;
  raise exception 'No safe water to sneak that ship into';
end $$;

-- ---------------------------------------------------------------- calling it

create or replace function public.call_cheater(p_game uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  g games;
  shooter uuid;
  caught text[];
begin
  select * into g from games where id = p_game for update;
  if not found or me is null or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' or g.move = 0 then raise exception 'There''s no turn to call right now'; end if;
  select s.shooter into shooter from shots s where s.game_id = p_game and s.move = g.move limit 1;
  if shooter is null then raise exception 'There''s no turn to call right now'; end if;
  if shooter = me then raise exception 'You can''t call cheater on yourself'; end if;
  if exists (select 1 from accusations where game_id = p_game and move = g.move) then
    raise exception 'Somebody already called that turn';
  end if;
  caught := array(select distinct kind from cheats where game_id = p_game and player_id = shooter and move = g.move);
  insert into accusations (game_id, move, accuser, accused, busted, kinds)
    values (p_game, g.move, me, shooter, cardinality(caught) > 0, caught);
  if cardinality(caught) > 0 then
    if not (shooter = any (g.skip_next)) then
      update games set skip_next = skip_next || shooter, updated_at = now() where id = p_game;
    end if;
  else
    insert into player_mods (game_id, player_id, shot_mod) values (p_game, me, -1)
      on conflict (game_id, player_id) do update set shot_mod = player_mods.shot_mod - 1;
    update games set updated_at = now() where id = p_game;
  end if;
  return jsonb_build_object('busted', cardinality(caught) > 0, 'kinds', caught);
end $$;

-- ---------------------------------------------------------------- fire, now with shot adjustments and skipped turns

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
    -- Next player still afloat; a busted cheater loses the turn they'd have had.
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
  end if;

  return jsonb_build_object('hits', hits, 'sank', sank,
                            'eliminated', p_target = any (g.eliminated),
                            'over', cardinality(alive) = 1);
end $$;

revoke execute on function public.cheat_peek(uuid, uuid, int), public.cheat_extra_shot(uuid), public.cheat_move_ship(uuid),
  public.call_cheater(uuid), public._lock_my_turn(uuid), public._cheats_left(uuid, uuid) from public, anon;
grant execute on function public.cheat_peek(uuid, uuid, int), public.cheat_extra_shot(uuid), public.cheat_move_ship(uuid),
  public.call_cheater(uuid) to authenticated;
