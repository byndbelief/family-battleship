-- 009: the family scoreboard.
-- Applied with the Supabase connector (apply_migration '009_scoreboard'). Safe to run again.
--
-- Every game and Gauntlet that finishes writes one row to `results`, with who played, who won
-- and a few per-player numbers taken at that moment. The log outlives the games (deleting a
-- game doesn't touch it), so the scoreboard is truly all-time. Players can't read the log
-- directly (it covers games they weren't in); family_stats() returns only the totals.

create table if not exists public.results (
  id bigserial primary key,
  kind text not null check (kind in ('battleship', 'golf', 'duel', 'gauntlet')),
  game_id uuid not null,
  finished_at timestamptz not null default now(),
  players uuid[] not null,
  winners uuid[] not null default '{}',
  gauntlet_id uuid,
  stats jsonb not null default '{}',   -- { "<player uuid>": { ...numbers } }
  unique (kind, game_id)
);
alter table public.results enable row level security;
revoke all on public.results from anon, authenticated;

-- Works out one finished game's result and logs it (once).
create or replace function public._log_result(p_kind text, p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  pl uuid[]; win uuid[] := '{}'; gid uuid; st jsonb := '{}'; p uuid; best int;
  g games; gg golf_games; dg duel_games; gt gauntlets;
begin
  if exists (select 1 from results where kind = p_kind and game_id = p_game) then return; end if;
  if p_kind = 'battleship' then
    select * into g from games where id = p_game and status = 'over'; if not found then return; end if;
    pl := g.players; gid := g.gauntlet_id; if g.winner is not null then win := array[g.winner]; end if;
    foreach p in array pl loop
      st := st || jsonb_build_object(p::text, jsonb_build_object(
        'shots', (select count(*) from shots where game_id = p_game and shooter = p),
        'hits', (select count(*) from shots where game_id = p_game and shooter = p and hit),
        'sunk', (select count(distinct (target, sunk_ship)) from shots where game_id = p_game and shooter = p and sunk_ship is not null),
        'cheats', (select count(*) from cheats where game_id = p_game and player_id = p),
        'busted', (select count(*) from accusations where game_id = p_game and accused = p and busted),
        'catches', (select count(*) from accusations where game_id = p_game and accuser = p and busted),
        'away', greatest(0, (select count(distinct move) from cheats where game_id = p_game and player_id = p)
                          - (select count(*) from accusations where game_id = p_game and accused = p and busted))));
    end loop;
  elsif p_kind = 'golf' then
    select * into gg from golf_games where id = p_game and status = 'over'; if not found then return; end if;
    pl := gg.players; gid := gg.gauntlet_id;
    select min(s) into best from (select sum(written + fine) s from golf_turns where game_id = p_game and not skipped group by player) x;
    win := array(select player from golf_turns where game_id = p_game and not skipped group by player having sum(written + fine) = best);
    foreach p in array pl loop
      st := st || jsonb_build_object(p::text, jsonb_build_object(
        'holes', (select count(*) from golf_turns where game_id = p_game and player = p and not skipped),
        'strokes', (select coalesce(sum(written + fine), 0) from golf_turns where game_id = p_game and player = p and not skipped),
        'par', (select coalesce(sum(_golf_par(hole)), 0) from golf_turns where game_id = p_game and player = p and not skipped),
        'hio', (select count(*) from golf_turns where game_id = p_game and player = p and not skipped and actual = 1),
        'under', (select count(*) from golf_turns where game_id = p_game and player = p and not skipped and written + fine < _golf_par(hole)),
        'away', (select coalesce(away, 0) from golf_players where game_id = p_game and player = p),
        'busted', (select coalesce(busted, 0) from golf_players where game_id = p_game and player = p),
        'catches', (select coalesce(catches, 0) from golf_players where game_id = p_game and player = p)));
    end loop;
  elsif p_kind = 'duel' then
    select * into dg from duel_games where id = p_game and status = 'over'; if not found then return; end if;
    pl := dg.players; gid := dg.gauntlet_id; if dg.winner is not null then win := array[dg.winner]; end if;
    foreach p in array pl loop
      st := st || jsonb_build_object(p::text, jsonb_build_object(
        'shots', (select count(*) from duel_shots where game_id = p_game and shooter = p),
        'ko', (dg.winner = p and 0 = any (dg.hp)),
        'direct', (select count(*) from (
            select shooter, hp_after, lag(hp_after, 1, array[100, 100]) over (order by move) prev from duel_shots where game_id = p_game) x
          where shooter = p and (prev[1] - hp_after[1] >= 25 or prev[2] - hp_after[2] >= 25))));
    end loop;
  else
    select * into gt from gauntlets where id = p_game and status = 'over'; if not found then return; end if;
    pl := gt.players;
    win := array(select gt.players[i] from generate_subscripts(gt.players, 1) i where gt.scores[i] = (select max(x) from unnest(gt.scores) x) and gt.scores[i] > 0);
    foreach p in array pl loop
      st := st || jsonb_build_object(p::text, jsonb_build_object('rounds', gt.scores[array_position(gt.players, p)]));
    end loop;
  end if;
  insert into results (kind, game_id, players, winners, gauntlet_id, stats) values (p_kind, p_game, pl, win, gid, st)
    on conflict (kind, game_id) do nothing;
end $$;

create or replace function public._result_on_finish() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'over' and old.status is distinct from 'over' then perform _log_result(tg_argv[0], new.id); end if;
  return new;
end $$;
drop trigger if exists log_result on public.games;
create trigger log_result after update on public.games for each row execute function public._result_on_finish('battleship');
drop trigger if exists log_result on public.golf_games;
create trigger log_result after update on public.golf_games for each row execute function public._result_on_finish('golf');
drop trigger if exists log_result on public.duel_games;
create trigger log_result after update on public.duel_games for each row execute function public._result_on_finish('duel');
drop trigger if exists log_result on public.gauntlets;
create trigger log_result after update on public.gauntlets for each row execute function public._result_on_finish('gauntlet');

-- Anything that finished before this existed.
do $$ declare r record; begin
  for r in select 'battleship' k, id from games where status = 'over'
    union all select 'golf', id from golf_games where status = 'over'
    union all select 'duel', id from duel_games where status = 'over'
    union all select 'gauntlet', id from gauntlets where status = 'over'
  loop perform _log_result(r.k, r.id); end loop;
end $$;

-- The scoreboard: totals per player, plus head-to-head records. Counts only games against
-- someone (a solo golf round has no winner), except golf feats like holes in one.
create or replace function public.family_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (select * from results),
  per as (
    select p.id, p.username, exists (select 1 from bots b where b.profile_id = p.id) as bot,
      (select count(*) from r where kind = 'gauntlet' and p.id = any (players)) gauntlets,
      (select count(*) from r where kind = 'gauntlet' and p.id = any (winners)) titles,
      (select coalesce(sum((stats -> p.id::text ->> 'rounds')::int), 0) from r where kind = 'gauntlet' and p.id = any (players)) rounds_won,
      (select count(*) from r where kind <> 'gauntlet' and p.id = any (players) and cardinality(players) > 1) played,
      (select count(*) from r where kind <> 'gauntlet' and p.id = any (winners) and cardinality(players) > 1) won,
      (select jsonb_object_agg(k, jsonb_build_object(
          'played', (select count(*) from r where kind = k and p.id = any (players) and cardinality(players) > 1),
          'won', (select count(*) from r where kind = k and p.id = any (winners) and cardinality(players) > 1)))
        from unnest(array['battleship', 'golf', 'duel']) k) by_kind,
      (select coalesce(sum((stats -> p.id::text ->> 'sunk')::int), 0) from r where kind = 'battleship') sunk,
      (select coalesce(sum((stats -> p.id::text ->> 'hits')::int), 0) from r where kind = 'battleship') hits,
      (select coalesce(sum((stats -> p.id::text ->> 'shots')::int), 0) from r where kind = 'battleship') bs_shots,
      (select coalesce(sum((stats -> p.id::text ->> 'hio')::int), 0) from r where kind = 'golf') hio,
      (select coalesce(sum((stats -> p.id::text ->> 'under')::int), 0) from r where kind = 'golf') under_par,
      (select coalesce(sum((stats -> p.id::text ->> 'holes')::int), 0) from r where kind = 'golf') holes,
      (select coalesce(sum((stats -> p.id::text ->> 'strokes')::int - (stats -> p.id::text ->> 'par')::int), 0) from r where kind = 'golf') to_par,
      (select count(*) from r where kind = 'duel' and (stats -> p.id::text ->> 'ko')::boolean) kos,
      (select coalesce(sum((stats -> p.id::text ->> 'direct')::int), 0) from r where kind = 'duel') direct_hits,
      (select coalesce(sum((stats -> p.id::text ->> 'away')::int), 0) from r where kind in ('battleship', 'golf')) sneaky,
      (select coalesce(sum((stats -> p.id::text ->> 'busted')::int), 0) from r where kind in ('battleship', 'golf')) busted,
      (select coalesce(sum((stats -> p.id::text ->> 'catches')::int), 0) from r where kind in ('battleship', 'golf')) catches,
      -- current win streak: wins in a row, most recent first, games against someone
      (select count(*) from (
          select p.id = any (winners) w, row_number() over (order by finished_at desc) n,
                 sum(case when p.id = any (winners) then 0 else 1 end) over (order by finished_at desc rows unbounded preceding) losses
          from r where kind <> 'gauntlet' and p.id = any (players) and cardinality(players) > 1) s where losses = 0) streak
    from profiles p
  )
  select jsonb_build_object(
    'since', (select min(finished_at) from results),
    'players', coalesce((select jsonb_agg(to_jsonb(per) order by titles desc, won desc, played) from per), '[]'),
    'h2h', coalesce((select jsonb_agg(jsonb_build_object('a', a.id, 'b', b.id,
        'a_wins', (select count(*) from r where kind <> 'gauntlet' and cardinality(players) = 2 and a.id = any (players) and b.id = any (players) and winners = array[a.id]),
        'b_wins', (select count(*) from r where kind <> 'gauntlet' and cardinality(players) = 2 and a.id = any (players) and b.id = any (players) and winners = array[b.id])))
      from profiles a join profiles b on a.id < b.id), '[]'));
$$;

revoke execute on function public._log_result(text, uuid), public._result_on_finish() from public, anon, authenticated;
revoke execute on function public.family_stats() from public, anon;
grant execute on function public.family_stats() to authenticated;
