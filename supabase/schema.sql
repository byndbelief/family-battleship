-- Family Battleship database.
-- Paste this whole file into Supabase > SQL Editor and run it once.
--
-- Players never write to the tables directly. Every change goes through the
-- functions at the bottom (create_game, set_fleet, fire), which run on the
-- server, check whose turn it is, and are the only code that can read an
-- opponent's ships. Row-level security keeps each fleet visible only to its
-- owner until the game is over.

-- ---------------------------------------------------------------- players

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null
);

-- A player's username is the part of their login email before the @.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, lower(split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Players created before this file ran.
insert into public.profiles (id, username)
select id, lower(split_part(email, '@', 1)) from auth.users
on conflict do nothing;

-- ---------------------------------------------------------------- games

create table public.games (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id),
  players uuid[] not null,                 -- turn order
  mode smallint not null check (mode in (0, 1)),   -- 0 = 8x8, 1 = 10x10
  spt smallint not null check (spt in (1, 3)),     -- shots per turn
  status text not null default 'setup' check (status in ('setup', 'playing', 'over')),
  turn smallint not null default 0,        -- index into players
  move int not null default 0,
  eliminated uuid[] not null default '{}',
  winner uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fleets (
  game_id uuid not null references public.games (id) on delete cascade,
  player_id uuid not null references public.profiles (id),
  ships jsonb not null,                    -- [{"c": start cell, "h": horizontal}], in ship order
  primary key (game_id, player_id)
);

create table public.shots (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  move int not null,
  shooter uuid not null references public.profiles (id),
  target uuid not null references public.profiles (id),
  cell smallint not null,
  hit boolean not null,
  sunk_ship smallint,                      -- set on the shot that sinks a ship
  sunk_cells smallint[],                   -- that ship's cells, revealed once it's sunk
  created_at timestamptz not null default now(),
  unique (game_id, target, cell)
);
create index shots_game on public.shots (game_id, move);

create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- access rules

alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.fleets enable row level security;
alter table public.shots enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "players can see each other" on public.profiles
  for select to authenticated using (true);

create policy "see games you're in" on public.games
  for select to authenticated using (auth.uid() = any (players));

create policy "see your own fleet, or every fleet once the game is over" on public.fleets
  for select to authenticated using (
    player_id = auth.uid()
    or exists (select 1 from public.games g
               where g.id = game_id and g.status = 'over' and auth.uid() = any (g.players))
  );

create policy "see shots in games you're in" on public.shots
  for select to authenticated using (
    exists (select 1 from public.games g where g.id = game_id and auth.uid() = any (g.players))
  );

create policy "manage your own alert subscriptions" on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Only the functions below change games, fleets and shots.
revoke insert, update, delete, truncate on public.profiles, public.games, public.fleets, public.shots from anon, authenticated;
revoke all on public.push_subscriptions from anon;

-- Live updates for open pages.
alter publication supabase_realtime add table public.games, public.shots;

-- ---------------------------------------------------------------- board helpers

create or replace function public.mode_n(m smallint) returns int
language sql immutable as $$ select case m when 0 then 8 else 10 end $$;

create or replace function public.mode_ships(m smallint) returns int[]
language sql immutable as $$ select case m when 0 then array[4, 3, 3, 2] else array[5, 4, 3, 3, 2] end $$;

create or replace function public.ship_cells(m smallint, c int, h boolean, len int) returns int[]
language sql immutable as $$
  select array(select c + k * (case when h then 1 else public.mode_n(m) end) from generate_series(0, len - 1) k)
$$;

-- ---------------------------------------------------------------- moves

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
  cell int;
  ship_i int;
  scells int[];
  all_cells int[] := '{}';
  hits int := 0;
  sank jsonb := '[]';
  alive uuid[];
  nxt int;
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
  need := least(g.spt, n * n - cardinality(shot));
  if p_cells is null or cardinality(p_cells) <> need
     or (select count(distinct x) from unnest(p_cells) x) <> need then
    raise exception 'Pick % square(s)', need;
  end if;
  if exists (select 1 from unnest(p_cells) x where x is null or x < 0 or x >= n * n or x = any (shot)) then
    raise exception 'Pick squares nobody has fired at yet';
  end if;

  select ships into f from fleets where game_id = p_game and player_id = p_target;
  for i in 1 .. cardinality(lens) loop
    all_cells := all_cells || ship_cells(g.mode, (f -> (i - 1) ->> 'c')::int, (f -> (i - 1) ->> 'h')::boolean, lens[i]);
  end loop;

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
    nxt := g.turn;
    loop
      nxt := (nxt + 1) % cardinality(g.players);
      exit when not (g.players[nxt + 1] = any (g.eliminated));
    end loop;
    update games set turn = nxt, move = g.move, eliminated = g.eliminated, updated_at = now() where id = p_game;
  end if;

  return jsonb_build_object('hits', hits, 'sank', sank,
                            'eliminated', p_target = any (g.eliminated),
                            'over', cardinality(alive) = 1);
end $$;

-- Delete a game you started (for clearing out finished or abandoned games).
create or replace function public.delete_game(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from games where id = p_game and created_by = auth.uid();
  if not found then raise exception 'Only the player who started a game can delete it'; end if;
end $$;

revoke execute on function public.create_game(text[], int, int), public.set_fleet(uuid, jsonb),
  public.fire(uuid, uuid, int[]), public.delete_game(uuid) from public, anon;
grant execute on function public.create_game(text[], int, int), public.set_fleet(uuid, jsonb),
  public.fire(uuid, uuid, int[]), public.delete_game(uuid) to authenticated;
