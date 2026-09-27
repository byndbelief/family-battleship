-- Putt Post (mini golf) and Hilltop Duel (artillery), live with logins.
--
-- Paste this whole file into Supabase > SQL Editor and run it once, after 001-003.
--
-- Both games run their physics in the players' browsers (it's the same code on
-- every phone, so a putt or a shell replays identically everywhere). The server
-- keeps the record: whose turn it is, every putt and shot, scores, the secret
-- cheats, sneak attacks, accusations, and personal bests. The robot (admiral_bot)
-- plays golf and artillery too; its moves are worked out on the device of the
-- player who went before it and saved here.

-- ================================================================= Putt Post

create table public.golf_games (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id),
  players uuid[] not null,                      -- tee-off order, 1 to 4 players
  start smallint not null check (start between 0 and 17),
  count smallint not null check (count between 1 and 18),
  seed int not null default 0,                  -- random obstacles (0 = none)
  bot_level smallint check (bot_level between 0 and 2),
  t int not null default 0,                     -- turn index: hole = start + t / n, player = t % n
  status text not null default 'playing' check (status in ('playing', 'over')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.golf_turns (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.golf_games (id) on delete cascade,
  t int not null,
  player uuid not null references public.profiles (id),
  hole smallint not null,
  strokes jsonb not null default '[]',          -- [[x, y, vx, vy], ...] for the replay
  actual smallint,                              -- strokes really taken (null when skipped)
  written smallint,                             -- what went on the card
  fine smallint not null default 0,             -- added when busted
  attack smallint not null default 0,           -- sneak attack in effect (0 = none)
  attacker uuid references public.profiles (id),
  skipped boolean not null default false,
  created_at timestamptz not null default now(),
  unique (game_id, t)
);

create table public.golf_players (
  game_id uuid not null references public.golf_games (id) on delete cascade,
  player uuid not null references public.profiles (id),
  tokens smallint not null default 1,           -- sneak attacks in hand
  away smallint not null default 0,             -- cheats that got away
  busted smallint not null default 0,
  catches smallint not null default 0,
  penalty smallint not null default 0,          -- owed on their next hole (false accusation)
  primary key (game_id, player)
);

create table public.golf_secrets (                -- what each turn secretly did
  game_id uuid not null references public.golf_games (id) on delete cascade,
  t int not null,
  player uuid not null references public.profiles (id),
  cheats smallint not null default 0,           -- 1 foot wedge, 2 mulligan, 4 pencil whip
  primary key (game_id, t)
);

create table public.golf_attacks (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.golf_games (id) on delete cascade,
  attacker uuid not null references public.profiles (id),
  target uuid not null references public.profiles (id),
  type smallint not null check (type between 1 and 5),
  planted_t int not null,
  used_t int
);

create table public.golf_accusations (
  game_id uuid not null references public.golf_games (id) on delete cascade,
  t int not null,                               -- the turn being judged
  accuser uuid not null references public.profiles (id),
  accused uuid not null references public.profiles (id),
  busted boolean not null,
  cheats smallint not null default 0,
  created_at timestamptz not null default now(),
  primary key (game_id, t)
);

create table public.golf_best (
  player uuid not null references public.profiles (id) on delete cascade,
  start smallint not null,
  count smallint not null,
  best smallint not null,                       -- strokes to par
  updated_at timestamptz not null default now(),
  primary key (player, start, count)
);

alter table public.golf_games enable row level security;
alter table public.golf_turns enable row level security;
alter table public.golf_players enable row level security;
alter table public.golf_secrets enable row level security;
alter table public.golf_attacks enable row level security;
alter table public.golf_accusations enable row level security;
alter table public.golf_best enable row level security;

create or replace function public._in_golf(p_game uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from golf_games where id = p_game and auth.uid() = any (players))
$$;

create policy "see golf games you're in" on public.golf_games for select to authenticated using (auth.uid() = any (players));
create policy "see turns in your golf games" on public.golf_turns for select to authenticated using (_in_golf(game_id));
create policy "see players in your golf games" on public.golf_players for select to authenticated using (_in_golf(game_id));
create policy "see your own secrets, or all once it's over" on public.golf_secrets for select to authenticated using (
  player = auth.uid() or exists (select 1 from golf_games g where g.id = game_id and g.status = 'over' and auth.uid() = any (g.players)));
create policy "see attacks you planted, or ones already sprung" on public.golf_attacks for select to authenticated using (
  _in_golf(game_id) and (attacker = auth.uid() or used_t is not null));
create policy "see accusations in your golf games" on public.golf_accusations for select to authenticated using (_in_golf(game_id));
create policy "see personal bests" on public.golf_best for select to authenticated using (true);

revoke insert, update, delete, truncate on public.golf_games, public.golf_turns, public.golf_players, public.golf_secrets,
  public.golf_attacks, public.golf_accusations, public.golf_best from anon, authenticated;

alter publication supabase_realtime add table public.golf_games, public.golf_turns, public.golf_accusations;

-- Par for each of the 18 holes, in order.
create or replace function public._golf_par(hole int) returns int
language sql immutable as $$
  select (array[2,3,3,3,3,3,4,3,4,3,4,3,4,3,3,3,3,4])[hole + 1]
$$;

create or replace function public.golf_create(opponents text[], p_start int, p_count int, p_random boolean, p_bot_level int)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  ids uuid[] := '{}';
  gid uuid;
  has_bot boolean;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if p_start not between 0 and 17 or p_count not between 1 and 18 or p_start + p_count > 18 then raise exception 'Unknown course'; end if;
  if cardinality(coalesce(opponents, '{}')) > 3 then raise exception 'Up to three other players'; end if;
  if cardinality(coalesce(opponents, '{}')) > 0 then
    select array_agg(id order by array_position(opponents, username)) into ids
      from profiles where username = any (opponents) and id <> me;
    if ids is null or cardinality(ids) <> cardinality(opponents) then raise exception 'Pick different players'; end if;
  end if;
  has_bot := exists (select 1 from bots where profile_id = any (ids));
  insert into golf_games (created_by, players, start, count, seed, bot_level)
    values (me, me || ids, p_start, p_count,
            case when p_random then 1 + floor(random() * 65534)::int else 0 end,
            case when has_bot then least(2, greatest(0, coalesce(p_bot_level, 1))) end)
    returning id into gid;
  insert into golf_players (game_id, player) select gid, p from unnest(me || ids) p;
  return gid;
end $$;

-- Records a finished hole for `who` (the current player) and moves play on.
create or replace function public._golf_submit(p_game uuid, who uuid, p_strokes jsonb, p_actual int, p_cheats int, p_holed boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g golf_games;
  n int; cur_hole int; prev_t int; prev_player uuid;
  pen int; written int; earned int := 0;
  atk golf_attacks;
  total int; best_to_par int;
begin
  select * into g from golf_games where id = p_game for update;
  if not found then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This round is over'; end if;
  n := cardinality(g.players);
  if g.players[g.t % n + 1] <> who then raise exception 'It''s not your turn'; end if;
  if p_actual is null or p_actual not between 1 and 12 then raise exception 'Bad stroke count'; end if;
  if p_cheats is null or p_cheats not between 0 and 7 then raise exception 'Bad turn'; end if;
  if jsonb_typeof(p_strokes) is distinct from 'array' or jsonb_array_length(p_strokes) > 16 then raise exception 'Bad putts'; end if;
  cur_hole := g.start + g.t / n;

  -- A cheat on the previous turn that nobody called got away with it.
  prev_t := g.t - 1;
  if prev_t >= 0 then
    select player into prev_player from golf_turns where game_id = p_game and t = prev_t and not skipped;
    if prev_player is not null and prev_player <> who
       and exists (select 1 from golf_secrets where game_id = p_game and t = prev_t and cheats > 0)
       and not exists (select 1 from golf_accusations where game_id = p_game and t = prev_t) then
      update golf_players set away = away + 1 where game_id = p_game and player = prev_player;
    end if;
  end if;

  select penalty into pen from golf_players where game_id = p_game and player = who;
  written := greatest(1, p_actual - case when p_cheats & 4 = 4 then 1 else 0 end) + coalesce(pen, 0);
  if p_holed and p_actual = 1 then earned := 2; elsif p_holed and p_actual < _golf_par(cur_hole) then earned := 1; end if;
  update golf_players set penalty = 0, tokens = least(9, tokens + earned) where game_id = p_game and player = who;

  select * into atk from golf_attacks where game_id = p_game and target = who and used_t is null order by id limit 1;
  if found then update golf_attacks set used_t = g.t where id = atk.id; end if;

  insert into golf_turns (game_id, t, player, hole, strokes, actual, written, attack, attacker)
    values (p_game, g.t, who, cur_hole, p_strokes, p_actual, written, coalesce(atk.type, 0), atk.attacker);
  insert into golf_secrets (game_id, t, player, cheats) values (p_game, g.t, who, p_cheats);

  g.t := g.t + 1;
  if g.t >= g.count * n then
    update golf_games set t = g.t, status = 'over', updated_at = now() where id = p_game;
    if n = 1 then   -- a solo round that played every hole can set a personal best
      if not exists (select 1 from golf_turns where game_id = p_game and skipped) then
        select sum(tu.written + tu.fine) - sum(_golf_par(tu.hole)) into best_to_par from golf_turns tu where tu.game_id = p_game;
        insert into golf_best (player, start, count, best) values (who, g.start, g.count, best_to_par)
          on conflict (player, start, count) do update set best = least(golf_best.best, excluded.best), updated_at = now();
      end if;
    end if;
  else
    update golf_games set t = g.t, updated_at = now() where id = p_game;
  end if;
  return jsonb_build_object('written', written, 'earned', earned, 'penalty', coalesce(pen, 0));
end $$;

create or replace function public.golf_submit_turn(p_game uuid, p_strokes jsonb, p_actual int, p_cheats int, p_holed boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return _golf_submit(p_game, auth.uid(), p_strokes, p_actual, p_cheats, p_holed);
end $$;

-- The robot's hole, played out on a player's device. The server decides whether
-- the robot calls cheater on the turn before and whether it plants a sneak attack.
create or replace function public.golf_submit_bot_turn(p_game uuid, p_strokes jsonb, p_actual int, p_cheats int, p_holed boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g golf_games;
  n int; bot uuid; prev_player uuid; c int; hunch float8; fine_amt int;
  res jsonb; victim uuid;
begin
  select * into g from golf_games where id = p_game;
  if not found or auth.uid() is null or not (auth.uid() = any (g.players)) then raise exception 'Game not found'; end if;
  n := cardinality(g.players);
  bot := g.players[g.t % n + 1];
  if not exists (select 1 from bots where profile_id = bot) then raise exception 'It''s not the robot''s turn'; end if;

  -- Call cheater on the turn before?
  if g.t > 0 and not exists (select 1 from golf_accusations where game_id = p_game and t = g.t - 1) then
    select tu.player, coalesce(s.cheats, 0) into prev_player, c
      from golf_turns tu left join golf_secrets s on s.game_id = tu.game_id and s.t = tu.t
      where tu.game_id = p_game and tu.t = g.t - 1 and not tu.skipped;
    if prev_player is not null and prev_player <> bot then
      hunch := case when c & 4 = 4 then 0.6 when c & 1 = 1 then 0.55 when c > 0 then 0.4 else 0.1 end;
      if random() < hunch then
        insert into golf_accusations (game_id, t, accuser, accused, busted, cheats) values (p_game, g.t - 1, bot, prev_player, c > 0, c);
        if c > 0 then
          fine_amt := 2 + case when c & 4 = 4 then 1 else 0 end;
          update golf_turns set fine = golf_turns.fine + fine_amt where game_id = p_game and t = g.t - 1;
          update golf_players set busted = busted + 1 where game_id = p_game and player = prev_player;
          update golf_players set catches = catches + 1, tokens = least(9, tokens + 1) where game_id = p_game and player = bot;
        else
          update golf_players set penalty = penalty + 1 where game_id = p_game and player = bot;
        end if;
      end if;
    end if;
  end if;

  res := _golf_submit(p_game, bot, p_strokes, p_actual, p_cheats, p_holed);

  -- Plant a sneak attack on someone now and then.
  if random() < 0.5 and (select tokens from golf_players where game_id = p_game and player = bot) > 0 then
    select p into victim from unnest(g.players) p
      where p <> bot and not exists (select 1 from golf_attacks a where a.game_id = p_game and a.target = p and a.used_t is null)
      order by random() limit 1;
    if victim is not null then
      insert into golf_attacks (game_id, attacker, target, type, planted_t) values (p_game, bot, victim, 1 + floor(random() * 5)::int, g.t);
      update golf_players set tokens = tokens - 1 where game_id = p_game and player = bot;
    end if;
  end if;
  return res;
end $$;

-- The sneak attack waiting for you on this hole, if any (only on your own turn).
create or replace function public.golf_my_attack(p_game uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g golf_games; a golf_attacks;
begin
  select * into g from golf_games where id = p_game;
  if not found or g.status <> 'playing' or g.players[g.t % cardinality(g.players) + 1] <> auth.uid() then return null; end if;
  select * into a from golf_attacks where game_id = p_game and target = auth.uid() and used_t is null order by id limit 1;
  if not found then return null; end if;
  return jsonb_build_object('type', a.type, 'attacker', a.attacker);
end $$;

-- The sneak attack waiting for the robot, for whoever's device plays its hole.
create or replace function public.golf_bot_attack(p_game uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g golf_games; bot uuid; a golf_attacks;
begin
  select * into g from golf_games where id = p_game;
  if not found or g.status <> 'playing' or not (auth.uid() = any (g.players)) then return null; end if;
  bot := g.players[g.t % cardinality(g.players) + 1];
  if not exists (select 1 from bots where profile_id = bot) then return null; end if;
  select * into a from golf_attacks where game_id = p_game and target = bot and used_t is null order by id limit 1;
  if not found then return null; end if;
  return jsonb_build_object('type', a.type, 'attacker', a.attacker);
end $$;

-- After your hole: plant a sneak attack on another player's next hole.
create or replace function public.golf_plant(p_game uuid, p_target uuid, p_type int) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  g golf_games;
begin
  select * into g from golf_games where id = p_game for update;
  if not found or me is null or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This round is over'; end if;
  if not exists (select 1 from golf_turns where game_id = p_game and t = g.t - 1 and player = me) then
    raise exception 'Plant an attack right after your own hole';
  end if;
  if exists (select 1 from golf_attacks where game_id = p_game and attacker = me and planted_t = g.t - 1) then
    raise exception 'One attack per hole';
  end if;
  if p_type not between 1 and 5 or p_target = me or not (p_target = any (g.players)) then raise exception 'Pick another player and an attack'; end if;
  if exists (select 1 from golf_attacks where game_id = p_game and target = p_target and used_t is null) then
    raise exception 'They already have one waiting';
  end if;
  update golf_players set tokens = tokens - 1 where game_id = p_game and player = me and tokens > 0;
  if not found then raise exception 'No sneak attacks left. Birdie or better earns one'; end if;
  insert into golf_attacks (game_id, attacker, target, type, planted_t) values (p_game, me, p_target, p_type, g.t - 1);
end $$;

-- Before your hole: call cheater on the player who just went.
create or replace function public.golf_call(p_game uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  g golf_games; prev uuid; c int; fine_amt int;
begin
  select * into g from golf_games where id = p_game for update;
  if not found or me is null or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' or g.players[g.t % cardinality(g.players) + 1] <> me then raise exception 'You can only call it at the start of your own turn'; end if;
  select tu.player, coalesce(s.cheats, 0) into prev, c
    from golf_turns tu left join golf_secrets s on s.game_id = tu.game_id and s.t = tu.t
    where tu.game_id = p_game and tu.t = g.t - 1 and not tu.skipped;
  if prev is null or prev = me then raise exception 'There''s nobody to call'; end if;
  if exists (select 1 from golf_accusations where game_id = p_game and t = g.t - 1) then raise exception 'That turn has already been called'; end if;
  insert into golf_accusations (game_id, t, accuser, accused, busted, cheats) values (p_game, g.t - 1, me, prev, c > 0, c);
  if c > 0 then
    fine_amt := 2 + case when c & 4 = 4 then 1 else 0 end;
    update golf_turns set fine = golf_turns.fine + fine_amt where game_id = p_game and t = g.t - 1;
    update golf_players set busted = busted + 1 where game_id = p_game and player = prev;
    update golf_players set catches = catches + 1, tokens = least(9, tokens + 1) where game_id = p_game and player = me;
  else
    update golf_players set penalty = penalty + 1 where game_id = p_game and player = me;
  end if;
  update golf_games set updated_at = now() where id = p_game;
  return jsonb_build_object('busted', c > 0, 'cheats', c);
end $$;

-- Skip ahead to a later hole for everyone. Unplayed holes before it are marked skipped.
create or replace function public.golf_skip_to(p_game uuid, p_hole int) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  g golf_games; n int; cur int; new_t int;
begin
  select * into g from golf_games where id = p_game for update;
  if not found or me is null or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This round is over'; end if;
  n := cardinality(g.players);
  cur := g.start + g.t / n;
  if p_hole <= cur or p_hole >= g.start + g.count then raise exception 'Pick a later hole'; end if;
  new_t := (p_hole - g.start) * n;
  insert into golf_turns (game_id, t, player, hole, skipped)
    select p_game, x, g.players[x % n + 1], g.start + x / n, true from generate_series(g.t, new_t - 1) x;
  update golf_games set t = new_t, updated_at = now() where id = p_game;
end $$;

create or replace function public.golf_delete(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from golf_games where id = p_game and created_by = auth.uid();
  if not found then raise exception 'Only the player who started a game can delete it'; end if;
end $$;

-- ================================================================= Hilltop Duel

create table public.duel_games (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id),
  players uuid[] not null check (cardinality(players) = 2),
  seed int not null,                            -- the hills
  bot_level smallint check (bot_level between 0 and 2),
  turn smallint not null default 0,
  move int not null default 0,
  hp int[] not null default '{100,100}',
  craters jsonb not null default '[]',          -- [[x, y, r], ...]
  status text not null default 'playing' check (status in ('playing', 'over')),
  winner uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.duel_shots (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.duel_games (id) on delete cascade,
  move int not null,
  shooter uuid not null references public.profiles (id),
  angle smallint not null,
  power smallint not null,
  crater jsonb,                                 -- [x, y, r], or null for a shell that flew off
  hp_after int[] not null,
  created_at timestamptz not null default now(),
  unique (game_id, move)
);

alter table public.duel_games enable row level security;
alter table public.duel_shots enable row level security;
create policy "see duels you're in" on public.duel_games for select to authenticated using (auth.uid() = any (players));
create policy "see shots in your duels" on public.duel_shots for select to authenticated using (
  exists (select 1 from duel_games g where g.id = game_id and auth.uid() = any (g.players)));
revoke insert, update, delete, truncate on public.duel_games, public.duel_shots from anon, authenticated;
alter publication supabase_realtime add table public.duel_games, public.duel_shots;

create or replace function public.duel_create(p_opponent text, p_bot_level int) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  opp uuid;
  gid uuid;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select id into opp from profiles where username = p_opponent and id <> me;
  if opp is null then raise exception 'Pick someone to duel'; end if;
  insert into duel_games (created_by, players, seed, bot_level)
    values (me, array[me, opp], 1 + floor(random() * 65534)::int,
            case when exists (select 1 from bots where profile_id = opp) then least(2, greatest(0, coalesce(p_bot_level, 1))) end)
    returning id into gid;
  return gid;
end $$;

-- Records a shot. The browser simulated it (the same code everyone runs); the server
-- checks it's plausible and moves the game on.
create or replace function public._duel_fire(p_game uuid, who uuid, p_angle int, p_power int, p_crater jsonb, p_hp int[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  g duel_games;
begin
  select * into g from duel_games where id = p_game for update;
  if not found then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This duel is over'; end if;
  if g.players[g.turn + 1] <> who then raise exception 'It''s not your turn'; end if;
  if p_angle not between 5 and 85 or p_power not between 20 and 100 then raise exception 'Bad shot'; end if;
  if p_hp is null or cardinality(p_hp) <> 2 or p_hp[1] not between 0 and g.hp[1] or p_hp[2] not between 0 and g.hp[2] then
    raise exception 'Bad damage';
  end if;
  if p_crater is not null and (jsonb_typeof(p_crater) <> 'array' or jsonb_array_length(p_crater) <> 3) then raise exception 'Bad crater'; end if;
  g.move := g.move + 1;
  insert into duel_shots (game_id, move, shooter, angle, power, crater, hp_after)
    values (p_game, g.move, who, p_angle, p_power, p_crater, p_hp);
  update duel_games set
    move = g.move, hp = p_hp, turn = 1 - g.turn,
    craters = case when p_crater is null then craters else craters || jsonb_build_array(p_crater) end,
    status = case when p_hp[1] = 0 or p_hp[2] = 0 then 'over' else 'playing' end,
    winner = case when p_hp[1] = 0 and p_hp[2] > 0 then g.players[2]
                  when p_hp[2] = 0 and p_hp[1] > 0 then g.players[1]
                  when p_hp[1] = 0 and p_hp[2] = 0 then who end,
    updated_at = now()
  where id = p_game;
end $$;

create or replace function public.duel_fire(p_game uuid, p_angle int, p_power int, p_crater jsonb, p_hp int[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  perform _duel_fire(p_game, auth.uid(), p_angle, p_power, p_crater, p_hp);
end $$;

create or replace function public.duel_fire_bot(p_game uuid, p_angle int, p_power int, p_crater jsonb, p_hp int[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  g duel_games;
begin
  select * into g from duel_games where id = p_game;
  if not found or auth.uid() is null or not (auth.uid() = any (g.players)) then raise exception 'Game not found'; end if;
  if not exists (select 1 from bots where profile_id = g.players[g.turn + 1]) then raise exception 'It''s not the robot''s turn'; end if;
  perform _duel_fire(p_game, g.players[g.turn + 1], p_angle, p_power, p_crater, p_hp);
end $$;

create or replace function public.duel_delete(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from duel_games where id = p_game and created_by = auth.uid();
  if not found then raise exception 'Only the player who started a duel can delete it'; end if;
end $$;

-- ================================================================= permissions

revoke execute on function public._golf_submit(uuid, uuid, jsonb, int, int, boolean),
  public._duel_fire(uuid, uuid, int, int, jsonb, int[]) from public, anon, authenticated;
revoke execute on function public.golf_create(text[], int, int, boolean, int), public.golf_submit_turn(uuid, jsonb, int, int, boolean),
  public.golf_submit_bot_turn(uuid, jsonb, int, int, boolean), public.golf_my_attack(uuid), public.golf_bot_attack(uuid), public.golf_plant(uuid, uuid, int),
  public.golf_call(uuid), public.golf_skip_to(uuid, int), public.golf_delete(uuid),
  public.duel_create(text, int), public.duel_fire(uuid, int, int, jsonb, int[]), public.duel_fire_bot(uuid, int, int, jsonb, int[]),
  public.duel_delete(uuid) from public, anon;
grant execute on function public.golf_create(text[], int, int, boolean, int), public.golf_submit_turn(uuid, jsonb, int, int, boolean),
  public.golf_submit_bot_turn(uuid, jsonb, int, int, boolean), public.golf_my_attack(uuid), public.golf_bot_attack(uuid), public.golf_plant(uuid, uuid, int),
  public.golf_call(uuid), public.golf_skip_to(uuid, int), public.golf_delete(uuid),
  public.duel_create(text, int), public.duel_fire(uuid, int, int, jsonb, int[]), public.duel_fire_bot(uuid, int, int, jsonb, int[]),
  public.duel_delete(uuid) to authenticated;
