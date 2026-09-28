-- 008: clocks that push play along.
-- Applied with the Supabase connector (apply_migration '008_clocks'). Safe to run again.
--
-- Shot clock: while it's your turn and you're on the page, a short countdown runs in the
-- browser. If it hits zero the page calls shot_clock(), which hits you once for that turn:
--   Battleship one shot fewer · Hilltop Duel a hurricane for this shot · Putt Post +1 stroke next hole.
-- Chaos clock: a turn left waiting gets worse for the slow player. Any player's page calls
-- chaos_clock() now and then; it applies whatever is due, once per turn and tier:
--   2 h: a chaos hit · 8 h: a harder hit · 24 h: in a Gauntlet round, the slow player forfeits it.

-- When did the current turn start? Set whenever the turn moves on.
alter table public.games add column if not exists turn_at timestamptz not null default now();
alter table public.golf_games add column if not exists turn_at timestamptz not null default now();
alter table public.duel_games add column if not exists turn_at timestamptz not null default now();

create or replace function public._turn_moved() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'golf_games' then
    if new.t is distinct from old.t then new.turn_at := now(); end if;
  elsif tg_table_name = 'games' then
    if new.move is distinct from old.move or new.turn is distinct from old.turn or new.status is distinct from old.status then new.turn_at := now(); end if;
  else
    if new.move is distinct from old.move then new.turn_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists turn_moved on public.games;
create trigger turn_moved before update on public.games for each row execute function public._turn_moved();
drop trigger if exists turn_moved on public.golf_games;
create trigger turn_moved before update on public.golf_games for each row execute function public._turn_moved();
drop trigger if exists turn_moved on public.duel_games;
create trigger turn_moved before update on public.duel_games for each row execute function public._turn_moved();

-- Each clock penalty lands once per turn: (game, turn, tier). Tier 0 = shot clock, 1-3 = chaos clock.
create table if not exists public.clock_marks (
  kind text not null,
  game_id uuid not null,
  turn_key int not null,
  tier smallint not null,
  player uuid not null references public.profiles (id) on delete cascade,
  at timestamptz not null default now(),
  primary key (kind, game_id, turn_key, tier)
);
alter table public.clock_marks enable row level security;
revoke all on public.clock_marks from anon, authenticated;

-- Whose turn it is, and a number that changes every turn, for any game.
create or replace function public._clock_turn(p_kind text, p_game uuid, out who uuid, out turn_key int, out turn_at timestamptz, out gauntlet uuid, out n int)
language plpgsql stable security definer set search_path = public as $$
declare g games; gg golf_games; dg duel_games;
begin
  if p_kind = 'battleship' then
    select * into g from games where id = p_game and status = 'playing';
    if found then who := g.players[g.turn + 1]; turn_key := g.move * 10 + g.turn; turn_at := g.turn_at; gauntlet := g.gauntlet_id; n := cardinality(g.players); end if;
  elsif p_kind = 'golf' then
    select * into gg from golf_games where id = p_game and status = 'playing';
    if found then who := gg.players[gg.t % cardinality(gg.players) + 1]; turn_key := gg.t; turn_at := gg.turn_at; gauntlet := gg.gauntlet_id; n := cardinality(gg.players); end if;
  else
    select * into dg from duel_games where id = p_game and status = 'playing';
    if found then who := dg.players[dg.turn + 1]; turn_key := dg.move; turn_at := dg.turn_at; gauntlet := dg.gauntlet_id; n := 2; end if;
  end if;
end $$;

-- A clock hit on the slow player. Level 1 = shot clock / first chaos strike, 2 = harder.
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
  else
    if p_level = 1 then
      update duel_games set gust = move, updated_at = now() where id = p_game;
      effect := 'a hurricane whips up for this shot';
    else
      update duel_games set hp = case when players[1] = p_who then array[greatest(1, hp[1] - 15), hp[2]] else array[hp[1], greatest(1, hp[2] - 15)] end,
        gust = move, updated_at = now() where id = p_game;
      effect := 'your tank rusts for −15 HP and a hurricane whips up';
    end if;
  end if;
  return effect;
end $$;

-- The shot clock ran out on the caller's own turn.
create or replace function public.shot_clock(p_kind text, p_game uuid) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c record; effect text;
begin
  if p_kind not in ('battleship', 'golf', 'duel') then raise exception 'Unknown game'; end if;
  select * into c from _clock_turn(p_kind, p_game);
  if c.who is null or c.who <> me then return null; end if;
  if p_kind = 'golf' and c.n < 2 then return null; end if;   -- no clock on a solo round
  insert into clock_marks (kind, game_id, turn_key, tier, player) values (p_kind, p_game, c.turn_key, 0, me)
    on conflict do nothing;
  if not found then return null; end if;
  effect := _clock_hit(p_kind, p_game, me, 1, 'shot clock');
  perform _chaos_event(me, null, 'twist', p_kind, p_game, '⏱️', format('Too slow! The shot clock ran out: %s.', effect));
  return effect;
end $$;

-- The chaos clock: applies whatever is due on every game the caller is in.
create or replace function public.chaos_clock() returns int
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); x record; c record; tier int; hrs float8; effect text; applied int := 0; p uuid; others uuid[]; msg text;
  g games;
begin
  if me is null then return 0; end if;
  for x in
    select 'battleship' k, id, players from games where status = 'playing' and me = any (players)
    union all select 'golf', id, players from golf_games where status = 'playing' and me = any (players) and cardinality(players) > 1
    union all select 'duel', id, players from duel_games where status = 'playing' and me = any (players)
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
        elsif x.k = 'duel' then
          update duel_games set status = 'over', winner = others[1], updated_at = now() where id = x.id;
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

revoke execute on function public._turn_moved(), public._clock_turn(text, uuid), public._clock_hit(text, uuid, uuid, int, text) from public, anon, authenticated;
revoke execute on function public.shot_clock(text, uuid), public.chaos_clock() from public, anon;
grant execute on function public.shot_clock(text, uuid), public.chaos_clock() to authenticated;
