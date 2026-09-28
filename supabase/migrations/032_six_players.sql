-- 032: Hilltop Duel and Putt Post take up to 6 players (5 others).
--   Hilltop: 5 tanks on a 1400-wide battlefield, 6 on 1600 (031's zoom-out, carried on), spread
--   evenly along the ridge. Two to four tanks stand exactly where they did.
--   Putt Post: nothing on the course depends on the count; it's just the cap.
-- Battleship (3), Chaos Cards (4) and the Gauntlet (4) are unchanged.
-- Applied with the Supabase connector (apply_migration '032_six_players'). Safe to run again.

alter table public.duel_games drop constraint if exists duel_games_players_check;
alter table public.duel_games add constraint duel_games_players_check check (cardinality(players) between 2 and 6);

create or replace function public._duel_world(n int) returns int
language sql immutable as $$ select case n when 3 then 1000 when 4 then 1200 when 5 then 1400 when 6 then 1600 else 800 end $$;
create or replace function public._duel_start_x(n int, w int) returns int[]
language sql immutable as $$
  select case when n = 3 then array[90, w / 2, w - 90]
              when n = 4 then array[90, round(w * 0.375)::int, round(w * 0.625)::int, w - 90]
              when n > 4 then array(select round(90 + k * (w - 180)::numeric / (n - 1))::int from generate_series(0, n - 1) k order by k)
              else array[90, w - 90] end
$$;

-- 023's duel_create: 1 to 5 others.
create or replace function public.duel_create(p_opponents text[], p_bot_level int default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); others uuid[];
begin
  if me is null then raise exception 'Sign in first'; end if;
  others := array(select p.id from (select distinct on (u) u, k from unnest(p_opponents) with ordinality o(u, k) order by u, k) o
                  join profiles p on p.username = o.u where p.id <> me order by o.k);
  if cardinality(others) < 1 or cardinality(others) > 5 then raise exception 'Pick 1 to 5 others to duel'; end if;
  return _duel_new(me, array[me] || others,
    case when exists (select 1 from bots where profile_id = any (others)) then least(2, greatest(0, coalesce(p_bot_level, 1))) end, null);
end $$;

-- 004's golf_create: up to 5 others.
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
  if cardinality(coalesce(opponents, '{}')) > 5 then raise exception 'Up to five other players'; end if;
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
