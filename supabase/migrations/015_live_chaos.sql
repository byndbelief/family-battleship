-- 015: live chaos battles for Battleship and Putt Post (the duel got its own in 014).
-- Applied with the Supabase connector (apply_migration '015_live_chaos'). Safe to run again.
--
-- While everyone in a game has it open (each page checks in with live_here() every few seconds;
-- "here" = checked in within the last 8 seconds; never with the robot), turns stop:
--   Battleship: everyone still afloat fires one shot at a time at any rival, whenever their
--     guns have reloaded (1.5 s enforced; the page waits 2). Cheats work live too.
--   Putt Post: everyone plays the current hole at the same time, each into their own turn slot
--     on that hole; the hole moves on when all have finished. First in the cup earns a sneak
--     attack. No cheating while live (there's no turn order to call it on).
-- When someone leaves, it goes back to taking turns; slots already played are skipped.

create table if not exists public.live_here (
  kind text not null check (kind in ('battleship', 'golf')),
  game_id uuid not null,
  player uuid not null references public.profiles (id),
  seen_at timestamptz not null default now(),
  primary key (kind, game_id, player)
);
alter table public.live_here enable row level security;   -- no policies: only the functions below touch it

create or replace function public._bs_live(g games) returns boolean
language sql stable security definer set search_path = public as $$
  select g.status = 'playing'
     and not exists (select 1 from bots where profile_id = any (g.players))
     and not exists (
       select 1 from unnest(g.players) p
       where not (p = any (g.eliminated))
         and not exists (select 1 from live_here h where h.kind = 'battleship' and h.game_id = g.id and h.player = p and h.seen_at > now() - interval '8 seconds'));
$$;

create or replace function public._golf_live(g golf_games) returns boolean
language sql stable security definer set search_path = public as $$
  select g.status = 'playing' and cardinality(g.players) > 1
     and not exists (select 1 from bots where profile_id = any (g.players))
     and not exists (
       select 1 from unnest(g.players) p
       where not exists (select 1 from live_here h where h.kind = 'golf' and h.game_id = g.id and h.player = p and h.seen_at > now() - interval '8 seconds'));
$$;

-- Check in (p_on) or leave (not p_on). Returns whether the game is live right now.
create or replace function public.live_here(p_kind text, p_game uuid, p_on boolean default true) returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); b games; gg golf_games;
begin
  if p_kind = 'battleship' then
    select * into b from games where id = p_game;
    if not found or not (me = any (b.players)) then raise exception 'Game not found'; end if;
  elsif p_kind = 'golf' then
    select * into gg from golf_games where id = p_game;
    if not found or not (me = any (gg.players)) then raise exception 'Game not found'; end if;
  else
    raise exception 'Unknown game';
  end if;
  if p_on then
    insert into live_here (kind, game_id, player, seen_at) values (p_kind, p_game, me, now())
      on conflict (kind, game_id, player) do update set seen_at = now();
  else
    delete from live_here where kind = p_kind and game_id = p_game and player = me;
  end if;
  return case when p_kind = 'battleship' then _bs_live(b) else _golf_live(gg) end;
end $$;

-- Deleting a game clears its check-ins.
create or replace function public._live_here_gone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from live_here where game_id = old.id and kind = (case when tg_table_name = 'games' then 'battleship' else 'golf' end);
  return old;
end $$;
drop trigger if exists live_here_gone on public.games;
create trigger live_here_gone after delete on public.games for each row execute function public._live_here_gone();
drop trigger if exists live_here_gone on public.golf_games;
create trigger live_here_gone after delete on public.golf_games for each row execute function public._live_here_gone();

-- ---------------------------------------------------------------- Battleship
-- 005's fire, plus a live mode (set by fire_live): any time, one square, the extra-shot and
-- false-accusation modifiers left for when turns come back.
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
    -- If the robot is up next, it plays right now.
    perform _bot_maybe_play(p_game);
  end if;

  return jsonb_build_object('hits', hits, 'sank', sank,
                            'eliminated', p_target = any (g.eliminated),
                            'over', cardinality(alive) = 1);
end $$;

create or replace function public.fire_live(p_game uuid, p_target uuid, p_cell int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g games; r jsonb;
begin
  select * into g from games where id = p_game for update;
  if not found or me is null or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This game isn''t being played right now'; end if;
  if me = any (g.eliminated) then raise exception 'Your fleet is sunk'; end if;
  if not _bs_live(g) then raise exception 'The live battle is over: back to taking turns'; end if;
  if exists (select 1 from shots where game_id = p_game and shooter = me and created_at > now() - interval '1.5 seconds') then
    raise exception 'Still reloading';
  end if;
  perform set_config('bs.live', '1', true);
  r := fire(p_game, p_target, array[p_cell]);
  perform set_config('bs.live', '', true);
  return r;
end $$;

-- Cheats need your turn, or a live battle (where it's always your turn).
create or replace function public._lock_my_turn(p_game uuid) returns public.games
language plpgsql security definer set search_path = public as $$
declare
  g games;
begin
  select * into g from games where id = p_game for update;
  if not found or auth.uid() is null or not (auth.uid() = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This game isn''t being played right now'; end if;
  if g.players[g.turn + 1] <> auth.uid() and not _bs_live(g) then raise exception 'You can only cheat on your own turn'; end if;
  return g;
end $$;

-- ---------------------------------------------------------------- Putt Post
-- 005's turn submission, plus a live mode (set by golf_submit_live): you play your own slot on
-- the current hole, whenever you like.
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
  live boolean := nullif(current_setting('golf.live', true), '') = '1';
  tt int;   -- the turn slot being played: the next one in turn order, or (live) your own on this hole
begin
  select * into g from golf_games where id = p_game for update;
  if not found then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This round is over'; end if;
  n := cardinality(g.players);
  if live then
    tt := (g.t / n) * n + array_position(g.players, who) - 1;
    if exists (select 1 from golf_turns where game_id = p_game and t = tt) then raise exception 'You''ve finished this hole: wait for the others'; end if;
    if p_cheats <> 0 then raise exception 'No cheating in a live race: everyone''s watching!'; end if;
  else
    tt := g.t;
    if g.players[g.t % n + 1] <> who then raise exception 'It''s not your turn'; end if;
  end if;
  if p_actual is null or p_actual not between 1 and 12 then raise exception 'Bad stroke count'; end if;
  if p_cheats is null or p_cheats not between 0 and 7 then raise exception 'Bad turn'; end if;
  if jsonb_typeof(p_strokes) is distinct from 'array' or jsonb_array_length(p_strokes) > 16 then raise exception 'Bad putts'; end if;
  cur_hole := g.start + tt / n;

  -- A cheat on the previous turn that nobody called got away with it.
  prev_t := g.t - 1;
  if prev_t >= 0 and not live then
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
  -- Live race: first in the cup on a hole earns a sneak attack too.
  if live and p_holed and not exists (select 1 from golf_turns where game_id = p_game and hole = cur_hole and t / n = tt / n) then earned := earned + 1; end if;
  update golf_players set penalty = 0, tokens = least(9, tokens + earned) where game_id = p_game and player = who;

  select * into atk from golf_attacks where game_id = p_game and target = who and used_t is null order by id limit 1;
  if found then update golf_attacks set used_t = tt where id = atk.id; end if;

  if exists (select 1 from loot where used_kind = 'golf' and used_game = p_game and player = who and item = 'magnet' and (case when live then (detail ->> 't')::int / n = tt / n else (detail ->> 't')::int = tt end)) then boost := 1; end if;
  insert into golf_turns (game_id, t, player, hole, strokes, actual, written, attack, attacker, boost)
    values (p_game, tt, who, cur_hole, p_strokes, p_actual, written, coalesce(atk.type, 0), atk.attacker, boost);
  insert into golf_secrets (game_id, t, player, cheats) values (p_game, tt, who, p_cheats);

  -- On to the next slot nobody has played yet (live turns can fill them out of order).
  while exists (select 1 from golf_turns where game_id = p_game and t = g.t) loop g.t := g.t + 1; end loop;
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

create or replace function public.golf_submit_live(p_game uuid, p_strokes jsonb, p_actual int, p_cheats int, p_holed boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g golf_games; r jsonb;
begin
  select * into g from golf_games where id = p_game for update;
  if not found or auth.uid() is null or not (auth.uid() = any (g.players)) then raise exception 'Game not found'; end if;
  if not _golf_live(g) then raise exception 'The live race is over: back to taking turns'; end if;
  perform set_config('golf.live', '1', true);
  r := _golf_submit(p_game, auth.uid(), p_strokes, p_actual, p_cheats, p_holed);
  perform set_config('golf.live', '', true);
  return r;
end $$;

-- 004's planting, where "right after your own hole" also means a hole you just played live.
create or replace function public.golf_plant(p_game uuid, p_target uuid, p_type int) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  g golf_games; n int; mine int;
begin
  select * into g from golf_games where id = p_game for update;
  if not found or me is null or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This round is over'; end if;
  n := cardinality(g.players);
  select max(t) into mine from golf_turns where game_id = p_game and player = me;
  if mine is null or not (mine = g.t - 1 or (_golf_live(g) and mine / n >= g.t / n - 1)) then
    raise exception 'Plant an attack right after your own hole';
  end if;
  if exists (select 1 from golf_attacks where game_id = p_game and attacker = me and planted_t = mine) then
    raise exception 'One attack per hole';
  end if;
  if p_type not between 1 and 5 or p_target = me or not (p_target = any (g.players)) then raise exception 'Pick another player and an attack'; end if;
  if exists (select 1 from golf_attacks where game_id = p_game and target = p_target and used_t is null) then
    raise exception 'They already have one waiting';
  end if;
  update golf_players set tokens = tokens - 1 where game_id = p_game and player = me and tokens > 0;
  if not found then raise exception 'No sneak attacks left. Birdie or better earns one'; end if;
  insert into golf_attacks (game_id, attacker, target, type, planted_t) values (p_game, me, p_target, p_type, mine);
end $$;

-- 004's "is an attack waiting for me", which in a live race is any time you're still to play.
create or replace function public.golf_my_attack(p_game uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g golf_games; a golf_attacks;
begin
  select * into g from golf_games where id = p_game;
  if not found or g.status <> 'playing' or (g.players[g.t % cardinality(g.players) + 1] <> auth.uid() and not _golf_live(g)) then return null; end if;
  select * into a from golf_attacks where game_id = p_game and target = auth.uid() and used_t is null order by id limit 1;
  if not found then return null; end if;
  return jsonb_build_object('type', a.type, 'attacker', a.attacker);
end $$;

revoke execute on function public._bs_live(games), public._golf_live(golf_games), public._live_here_gone() from public, anon, authenticated;
revoke execute on function public._golf_submit(uuid, uuid, jsonb, int, int, boolean) from public, anon, authenticated;
revoke execute on function public.live_here(text, uuid, boolean), public.fire_live(uuid, uuid, int), public.golf_submit_live(uuid, jsonb, int, int, boolean) from public, anon;
grant execute on function public.live_here(text, uuid, boolean), public.fire_live(uuid, uuid, int), public.golf_submit_live(uuid, jsonb, int, int, boolean) to authenticated;
