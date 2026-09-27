-- 🌀 Chaos: loot, cross-game curses, chaos twists and the Gauntlet.
--
-- Paste this whole file into Supabase > SQL Editor and run it once, after 001-004.
--
-- Everything random happens here on the server, so nobody can fake a drop or a curse:
--   * Good plays in any game can drop LOOT into your (secret) backpack. Spend it in any game.
--   * Big moments CURSE a random opponent in a random other game they're playing.
--   * About 1 turn in 8 gets a CHAOS TWIST.
--   * The GAUNTLET is a match that hops between games, one round at a time.
-- Every surprise is written to chaos_events so the pages can announce it.

-- ================================================================= events and backpacks

create table public.chaos_events (
  id bigint generated always as identity primary key,
  player uuid not null references public.profiles (id) on delete cascade,   -- who it's news for
  actor uuid references public.profiles (id),                               -- who caused it (null = pure chaos)
  kind text not null,                                                       -- loot | curse | twist | gauntlet
  game_kind text,                                                           -- battleship | golf | duel | gauntlet
  game_id uuid,
  icon text not null default '🌀',
  message text not null,
  seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index chaos_events_player on public.chaos_events (player, created_at desc);

create table public.loot (
  id bigint generated always as identity primary key,
  player uuid not null references public.profiles (id) on delete cascade,
  item text not null check (item in ('sonar', 'salvo', 'golden_tee', 'magnet', 'shield', 'bertha', 'scroll')),
  from_kind text,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_kind text,
  used_game uuid,
  detail jsonb
);
create index loot_player on public.loot (player, used_at);

alter table public.chaos_events enable row level security;
alter table public.loot enable row level security;
create policy "your chaos news" on public.chaos_events for select to authenticated using (player = auth.uid());
create policy "your backpack" on public.loot for select to authenticated using (player = auth.uid());
revoke insert, update, delete, truncate on public.chaos_events, public.loot from anon, authenticated;
alter publication supabase_realtime add table public.chaos_events;

-- Chaos can plant golf attacks too (attacker = null), and items leave marks on turns and duels.
alter table public.golf_attacks alter column attacker drop not null;
alter table public.golf_turns add column if not exists boost smallint not null default 0;   -- 1 = Magnet Cup
alter table public.duel_games add column if not exists shields uuid[] not null default '{}';
alter table public.duel_games add column if not exists bertha uuid[] not null default '{}';
alter table public.duel_games add column if not exists gust int not null default -1;       -- the move with a hurricane
alter table public.duel_shots add column if not exists wind_x smallint not null default 1;  -- 3 during a hurricane

create or replace function public._uname(p uuid) returns text
language sql stable security definer set search_path = public as $$ select coalesce((select username from profiles where id = p), 'Chaos') $$;
create or replace function public._is_bot(p uuid) returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from bots where profile_id = p) $$;

create or replace function public._chaos_event(p_player uuid, p_actor uuid, p_kind text, p_game_kind text, p_game uuid, p_icon text, p_message text)
returns void language sql security definer set search_path = public as $$
  insert into chaos_events (player, actor, kind, game_kind, game_id, icon, message)
  select p_player, p_actor, p_kind, p_game_kind, p_game, p_icon, p_message where not _is_bot(p_player)
$$;

create or replace function public._item_label(item text) returns text
language sql immutable as $$
  select case item
    when 'sonar' then '⚓ Sonar Ping' when 'salvo' then '⚓ Double Salvo'
    when 'golden_tee' then '⛳ Golden Tee' when 'magnet' then '⛳ Magnet Cup'
    when 'shield' then '💥 Shield' when 'bertha' then '💥 Big Bertha'
    else '🌀 Curse Scroll' end
$$;

-- Drops a random item into a backpack (robots don't collect loot).
create or replace function public._chaos_drop(p_player uuid, p_kind text, p_game uuid, p_why text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r float8 := random();
  item text := case when r < 0.15 then 'sonar' when r < 0.3 then 'salvo' when r < 0.45 then 'golden_tee'
                    when r < 0.6 then 'magnet' when r < 0.75 then 'shield' when r < 0.9 then 'bertha' else 'scroll' end;
begin
  if _is_bot(p_player) then return; end if;
  insert into loot (player, item, from_kind) values (p_player, item, p_kind);
  perform _chaos_event(p_player, null, 'loot', p_kind, p_game, '🎒', format('Loot! %s dropped %s into your backpack.', upper(left(p_why, 1)) || substr(p_why, 2), _item_label(item)));
end $$;

-- ================================================================= curses

-- Hexes `victim` in one of their live games, preferring a different game from `p_skip`.
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
    select 'duel', id, id = p_skip from duel_games where status = 'playing' and p_victim = any (players)
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
    update duel_games set hp = case when players[1] = p_victim then array[greatest(1, hp[1] - 10), hp[2]] else array[hp[1], greatest(1, hp[2] - 10)] end,
      updated_at = now() where id = pick.id;
    label := 'Hilltop Duel'; effect := 'your tank rusted for −10 HP';
  end if;

  perform _chaos_event(p_victim, p_caster, 'curse', pick.kind, pick.id, '🌀',
    format('CURSED! %s''s %s hexed your %s: %s.', _uname(p_caster), p_why, label, effect));
  perform _chaos_event(p_caster, p_caster, 'curse', pick.kind, pick.id, '🌀',
    format('Your %s cursed %s''s %s: %s.', p_why, _uname(p_victim), label, effect));
  return true;
end $$;

-- ================================================================= twists (for whoever's turn is next)

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
    p := dg.players[dg.turn + 1]; other := dg.players[2 - dg.turn];
    if r < 0.35 then
      update duel_games set craters = craters
        || jsonb_build_array(jsonb_build_array(150 + floor(random() * 200)::int, 250 + floor(random() * 120)::int, 22),
                             jsonb_build_array(450 + floor(random() * 200)::int, 250 + floor(random() * 120)::int, 22)),
        updated_at = now() where id = p_game;
      perform _chaos_event(p, null, 'twist', 'duel', p_game, '☄️', 'Chaos twist: METEOR SHOWER! The hills just got rearranged.');
      perform _chaos_event(other, null, 'twist', 'duel', p_game, '☄️', 'Chaos twist: METEOR SHOWER! The hills just got rearranged.');
    elsif r < 0.7 then
      update duel_games set gust = move, updated_at = now() where id = p_game;
      perform _chaos_event(p, null, 'twist', 'duel', p_game, '🌪️', 'Chaos twist: HURRICANE! Triple wind on your next shot.');
    else
      update duel_games set hp = case when dg.turn = 0 then array[least(100, hp[1] + 15), hp[2]] else array[hp[1], least(100, hp[2] + 15)] end,
        updated_at = now() where id = p_game;
      perform _chaos_event(p, null, 'twist', 'duel', p_game, '🔧', 'Chaos twist: FIELD REPAIRS! +15 HP for your tank.');
    end if;
  end if;
end $$;

-- Called after every move: loot for good plays, curses for big ones, and a twist now and then.
create or replace function public._chaos_after_move(p_kind text, p_game uuid, p_mover uuid, p_others uuid[], p_loot float8, p_curse float8, p_why text)
returns void language plpgsql security definer set search_path = public as $$
declare
  victim uuid;
begin
  if p_loot > 0 and random() < p_loot then perform _chaos_drop(p_mover, p_kind, p_game, p_why); end if;
  if p_loot > 1 and random() < p_loot - 1 then perform _chaos_drop(p_mover, p_kind, p_game, p_why); end if;
  if p_curse > 0 and random() < p_curse and cardinality(p_others) > 0 then
    victim := p_others[1 + floor(random() * cardinality(p_others))::int];
    perform _chaos_curse(p_mover, victim, p_game, lower(p_why));
  end if;
  if random() < 0.125 then perform _chaos_twist(p_kind, p_game); end if;
end $$;

-- ================================================================= using loot

create or replace function public.use_loot(p_loot bigint, p_game uuid, p_target uuid, p_cell int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  l loot;
  g games; gg golf_games; dg duel_games;
  n int; area int[] := '{}'; spotted int[]; r int; c int;
  res jsonb := '{}';
begin
  select * into l from loot where id = p_loot and player = me and used_at is null for update;
  if not found then raise exception 'That item isn''t in your backpack'; end if;

  if l.item in ('sonar', 'salvo') then
    select * into g from games where id = p_game for update;
    if not found or not (me = any (g.players)) or g.status <> 'playing' or g.players[g.turn + 1] <> me then raise exception 'Use it on your Battleship turn'; end if;
    if l.item = 'salvo' then
      insert into player_mods (game_id, player_id, shot_mod) values (p_game, me, 2)
        on conflict (game_id, player_id) do update set shot_mod = player_mods.shot_mod + 2;
    else
      if p_target = me or not (p_target = any (g.players)) or p_target = any (g.eliminated) then raise exception 'Ping an opponent who is still afloat'; end if;
      n := mode_n(g.mode);
      if p_cell is null or p_cell < 0 or p_cell >= n * n then raise exception 'Pick a square to ping'; end if;
      for dr in -1 .. 1 loop for dc in -1 .. 1 loop
        r := p_cell / n + dr; c := p_cell % n + dc;
        if r between 0 and n - 1 and c between 0 and n - 1 then area := area || (r * n + c); end if;
      end loop; end loop;
      select _fleet_cells(g.mode, fl.ships) into spotted from fleets fl where fl.game_id = p_game and fl.player_id = p_target;
      spotted := array(select x from unnest(area) x where x = any (spotted));
      res := jsonb_build_object('target', p_target, 'area', area, 'ships', spotted);
    end if;
    update loot set used_at = now(), used_kind = 'battleship', used_game = p_game, detail = res where id = p_loot;

  elsif l.item in ('golden_tee', 'magnet') then
    select * into gg from golf_games where id = p_game for update;
    if not found or not (me = any (gg.players)) or gg.status <> 'playing' or gg.players[gg.t % cardinality(gg.players) + 1] <> me then raise exception 'Use it on your own hole'; end if;
    res := jsonb_build_object('t', gg.t);
    update loot set used_at = now(), used_kind = 'golf', used_game = p_game, detail = res where id = p_loot;

  elsif l.item in ('shield', 'bertha') then
    select * into dg from duel_games where id = p_game for update;
    if not found or not (me = any (dg.players)) or dg.status <> 'playing' then raise exception 'Use it in a live duel'; end if;
    if l.item = 'bertha' then
      if dg.players[dg.turn + 1] <> me then raise exception 'Load Big Bertha on your own turn'; end if;
      update duel_games set bertha = array_append(array_remove(bertha, me), me), updated_at = now() where id = p_game;
    else
      update duel_games set shields = array_append(array_remove(shields, me), me), updated_at = now() where id = p_game;
    end if;
    update loot set used_at = now(), used_kind = 'duel', used_game = p_game where id = p_loot;

  else   -- curse scroll: hex any other player, in a random live game of theirs
    if p_target is null or p_target = me or not exists (select 1 from profiles where id = p_target) then raise exception 'Pick someone to curse'; end if;
    if not _chaos_curse(me, p_target, null, 'curse scroll') then raise exception '%s isn''t in any live games to curse', _uname(p_target); end if;
    update loot set used_at = now(), used_kind = 'scroll' where id = p_loot;
  end if;
  return res;
end $$;

create or replace function public.chaos_seen(p_ids bigint[]) returns void
language sql security definer set search_path = public as $$
  update chaos_events set seen_at = now() where id = any (p_ids) and player = auth.uid() and seen_at is null
$$;

-- ================================================================= the move functions, now chaotic

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
    -- If the robot is up next, it plays right now.
    perform _bot_maybe_play(p_game);
  end if;

  return jsonb_build_object('hits', hits, 'sank', sank,
                            'eliminated', p_target = any (g.eliminated),
                            'over', cardinality(alive) = 1);
end $$;


create or replace function public._golf_submit(p_game uuid, who uuid, p_strokes jsonb, p_actual int, p_cheats int, p_holed boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g golf_games;
  n int; cur_hole int; prev_t int; prev_player uuid;
  pen int; written int; earned int := 0;
  atk golf_attacks;
  total int; best_to_par int;
  par int; boost int := 0;
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

  if exists (select 1 from loot where used_kind = 'golf' and used_game = p_game and player = who and item = 'magnet' and (detail ->> 't')::int = g.t) then boost := 1; end if;
  insert into golf_turns (game_id, t, player, hole, strokes, actual, written, attack, attacker, boost)
    values (p_game, g.t, who, cur_hole, p_strokes, p_actual, written, coalesce(atk.type, 0), atk.attacker, boost);
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
  par := _golf_par(cur_hole);
  perform _chaos_after_move('golf', p_game, who, array_remove(g.players, who),
    case when p_holed and p_actual = 1 then 1.9 when p_holed and p_actual < par then 0.6 when p_holed and p_actual = par then 0.15 else 0 end,
    case when p_holed and p_actual = 1 then 0.8 when p_holed and p_actual <= par - 2 then 0.6 else 0 end,
    case when p_actual = 1 then 'hole in one' when p_actual <= par - 2 then 'eagle' when p_actual < par then 'birdie' else 'par' end);
  return jsonb_build_object('written', written, 'earned', earned, 'penalty', coalesce(pen, 0));
end $$;


create or replace function public._duel_fire(p_game uuid, who uuid, p_angle int, p_power int, p_crater jsonb, p_hp int[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  g duel_games;
  foe int; dmg int;
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
  if p_crater is not null and (p_crater ->> 2)::int > (case when who = any (g.bertha) then 44 else 28 end) then raise exception 'Bad crater'; end if;
  foe := case when g.players[1] = who then 2 else 1 end;
  dmg := g.hp[foe] - p_hp[foe];
  g.move := g.move + 1;
  insert into duel_shots (game_id, move, shooter, angle, power, crater, hp_after, wind_x)
    values (p_game, g.move, who, p_angle, p_power, p_crater, p_hp, case when g.gust = g.move - 1 then 3 else 1 end);
  update duel_games set
    move = g.move, hp = p_hp, turn = 1 - g.turn,
    craters = case when p_crater is null then craters else craters || jsonb_build_array(p_crater) end,
    status = case when p_hp[1] = 0 or p_hp[2] = 0 then 'over' else 'playing' end,
    winner = case when p_hp[1] = 0 and p_hp[2] > 0 then g.players[2]
                  when p_hp[2] = 0 and p_hp[1] > 0 then g.players[1]
                  when p_hp[1] = 0 and p_hp[2] = 0 then who end,
    bertha = array_remove(bertha, who), shields = array_remove(shields, g.players[foe]),
    gust = case when gust = g.move - 1 then -1 else gust end,
    updated_at = now()
  where id = p_game;
  perform _chaos_after_move('duel', p_game, who, array[g.players[foe]],
    case when p_hp[foe] = 0 then 1.0 when dmg >= 20 then 0.5 when dmg > 0 then 0.2 else 0 end,
    case when p_hp[foe] = 0 then 0.7 when dmg >= 30 then 0.4 else 0 end,
    case when p_hp[foe] = 0 then 'knockout shot' else 'direct hit' end);
end $$;


-- ================================================================= the Gauntlet

create table public.gauntlets (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id),
  players uuid[] not null,
  rounds smallint not null check (rounds between 1 and 9),
  round smallint not null default 0,
  scores int[] not null,
  status text not null default 'playing' check (status in ('playing', 'over')),
  current_kind text,
  current_game uuid,
  history jsonb not null default '[]',            -- [{round, kind, game, winners}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.games add column if not exists gauntlet_id uuid references public.gauntlets (id) on delete set null;
alter table public.golf_games add column if not exists gauntlet_id uuid references public.gauntlets (id) on delete set null;
alter table public.duel_games add column if not exists gauntlet_id uuid references public.gauntlets (id) on delete set null;
alter table public.gauntlets enable row level security;
create policy "see gauntlets you're in" on public.gauntlets for select to authenticated using (auth.uid() = any (players));
revoke insert, update, delete, truncate on public.gauntlets from anon, authenticated;
alter publication supabase_realtime add table public.gauntlets;

create or replace function public._kind_label(k text) returns text
language sql immutable as $$ select case k when 'battleship' then '⚓ Battleship' when 'golf' then '⛳ Putt Post' else '💥 Hilltop Duel' end $$;

-- Starts the next round: a random game (not the same as last time when there's a choice).
create or replace function public._gauntlet_next(p_gauntlet uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  gt gauntlets;
  n int; rnd int; kinds text[]; k text; rot uuid[]; child uuid; has_bot boolean; p uuid;
begin
  select * into gt from gauntlets where id = p_gauntlet for update;
  n := cardinality(gt.players);
  rnd := gt.round + 1;
  kinds := array['golf'] || case when n = 2 then array['duel', 'battleship'] when n = 3 then array['battleship'] else '{}'::text[] end;
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
  else
    insert into duel_games (created_by, players, seed, bot_level, gauntlet_id)
      values (gt.created_by, rot, 1 + floor(random() * 65534)::int, case when has_bot then 1 end, p_gauntlet) returning id into child;
  end if;
  update gauntlets set round = rnd, current_kind = k, current_game = child, updated_at = now() where id = p_gauntlet;
  foreach p in array gt.players loop
    perform _chaos_event(p, null, 'gauntlet', k, child, '🏆', format('Gauntlet round %s of %s: %s!', rnd, gt.rounds, _kind_label(k)));
  end loop;
end $$;

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
  if ids is null or cardinality(ids) <> cardinality(opponents) or cardinality(ids) not between 1 and 3 then raise exception 'Pick one to three other players'; end if;
  insert into gauntlets (created_by, players, rounds, scores) values (me, me || ids, p_rounds, array_fill(0, array[cardinality(ids) + 1]))
    returning id into gid;
  perform _gauntlet_next(gid);
  return gid;
end $$;

-- When a Gauntlet game ends: points to the winner(s), then the next round or the final whistle.
create or replace function public._gauntlet_round_over() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  gt gauntlets;
  winners uuid[];
  best int; champ int; p uuid; msg text;
begin
  if new.gauntlet_id is null or new.status <> 'over' or old.status = 'over' then return new; end if;
  select * into gt from gauntlets where id = new.gauntlet_id for update;
  if not found or gt.status <> 'playing' or gt.current_game <> new.id then return new; end if;
  if tg_argv[0] = 'golf' then
    select min(s) into best from (select sum(written + fine) s from golf_turns where game_id = new.id and not skipped group by player) x;
    winners := array(select player from golf_turns where game_id = new.id and not skipped group by player having sum(written + fine) = best);
  else
    winners := array[new.winner];
  end if;
  update gauntlets set
    scores = array(select scores[i] + case when players[i] = any (winners) then 1 else 0 end from generate_subscripts(players, 1) i order by i),
    history = history || jsonb_build_array(jsonb_build_object('round', round, 'kind', current_kind, 'game', current_game, 'winners', to_jsonb(winners))),
    updated_at = now()
  where id = gt.id
  returning * into gt;
  if gt.round >= gt.rounds then
    select max(x) into champ from unnest(gt.scores) x;
    msg := format('The Gauntlet is over! Champion: %s with %s point%s.',
      (select string_agg(_uname(gt.players[i]), ' & ') from generate_subscripts(gt.players, 1) i where gt.scores[i] = champ), champ, case when champ = 1 then '' else 's' end);
    update gauntlets set status = 'over', updated_at = now() where id = gt.id;
    foreach p in array gt.players loop perform _chaos_event(p, null, 'gauntlet', 'gauntlet', gt.id, '🏆', msg); end loop;
  else
    foreach p in array gt.players loop
      perform _chaos_event(p, null, 'gauntlet', 'gauntlet', gt.id, '🏁',
        format('Round %s goes to %s.', gt.round, (select string_agg(_uname(w), ' & ') from unnest(winners) w)));
    end loop;
    perform _gauntlet_next(gt.id);
  end if;
  return new;
end $$;

create trigger gauntlet_battleship after update on public.games for each row execute function public._gauntlet_round_over('battleship');
create trigger gauntlet_golf after update on public.golf_games for each row execute function public._gauntlet_round_over('golf');
create trigger gauntlet_duel after update on public.duel_games for each row execute function public._gauntlet_round_over('duel');

-- ================================================================= permissions

revoke execute on function public._chaos_event(uuid, uuid, text, text, uuid, text, text), public._chaos_drop(uuid, text, uuid, text),
  public._chaos_curse(uuid, uuid, uuid, text), public._chaos_twist(text, uuid),
  public._chaos_after_move(text, uuid, uuid, uuid[], float8, float8, text), public._gauntlet_next(uuid) from public, anon, authenticated;
revoke execute on function public.use_loot(bigint, uuid, uuid, int), public.chaos_seen(bigint[]), public.gauntlet_create(text[], int) from public, anon;
grant execute on function public.use_loot(bigint, uuid, uuid, int), public.chaos_seen(bigint[]), public.gauntlet_create(text[], int) to authenticated;
