-- 010: each player's trophy case.
-- Applied with the Supabase connector (apply_migration '010_trophies'). Safe to run again.
--
-- player_trophies(player) reads the results log (009) and returns that player's Gauntlet titles
-- (the trophies on the shelf) and the numbers their badges are earned from. Like family_stats(),
-- it returns totals only, never the raw log.

create or replace function public.player_trophies(p_player uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (select id, username, exists (select 1 from bots where profile_id = id) as bot from profiles where id = p_player),
  r as (select * from results where p_player = any (players)),
  duo as (select * from r where kind <> 'gauntlet' and cardinality(players) > 1),
  streaks as (
    select w, sum(case when w then 0 else 1 end) over (order by finished_at, id rows unbounded preceding) grp
    from (select id, finished_at, p_player = any (winners) w from duo) s
  ),
  sumk as (
    select k, coalesce(sum((stats -> p_player::text ->> k)::int), 0) v
    from r, unnest(array['sunk', 'hits', 'shots', 'hio', 'under', 'holes', 'direct', 'away', 'busted', 'catches']) k
    where r.stats ? p_player::text and (r.stats -> p_player::text) ? k
    group by k
  )
  select case when not exists (select 1 from me) then null else jsonb_build_object(
    'id', (select id from me), 'username', (select username from me), 'bot', (select bot from me),
    -- the shelf: one trophy per Gauntlet title, newest first
    'titles', coalesce((select jsonb_agg(jsonb_build_object(
        'at', finished_at,
        'rounds', (select sum((stats -> x::text ->> 'rounds')::int) from unnest(players) x),
        'perfect', (select bool_and(x = p_player or coalesce((stats -> x::text ->> 'rounds')::int, 0) = 0) from unnest(players) x),
        'table', (select jsonb_agg(jsonb_build_object('id', x, 'name', (select username from profiles where id = x), 'score', coalesce((stats -> x::text ->> 'rounds')::int, 0))
                   order by coalesce((stats -> x::text ->> 'rounds')::int, 0) desc) from unnest(players) x)
      ) order by finished_at desc) from r where kind = 'gauntlet' and p_player = any (winners)), '[]'),
    'counts', coalesce((select jsonb_object_agg(k, v) from sumk), '{}') || jsonb_build_object(
      'played', (select count(*) from duo),
      'won', (select count(*) from duo where p_player = any (winners)),
      'battleship_won', (select count(*) from duo where kind = 'battleship' and p_player = any (winners)),
      'golf_won', (select count(*) from duo where kind = 'golf' and p_player = any (winners)),
      'duel_won', (select count(*) from duo where kind = 'duel' and p_player = any (winners)),
      'kos', (select count(*) from r where kind = 'duel' and (stats -> p_player::text ->> 'ko')::boolean),
      'gauntlets', (select count(*) from r where kind = 'gauntlet'),
      'titles', (select count(*) from r where kind = 'gauntlet' and p_player = any (winners)),
      'bot_wins', (select count(*) from duo where p_player = any (winners) and exists (select 1 from bots b where b.profile_id = any (players))),
      'beaten', (select count(distinct x) from duo, unnest(players) x
                 where p_player = any (winners) and x <> p_player and not (x = any (winners)) and not exists (select 1 from bots where profile_id = x)),
      'family', (select count(*) from profiles q where q.id <> p_player and not exists (select 1 from bots where profile_id = q.id)),
      'best_streak', (select coalesce(max(c), 0) from (select count(*) c from streaks where w group by grp) z),
      'streak', (select count(*) from (select sum(case when p_player = any (winners) then 0 else 1 end) over (order by finished_at desc, id desc rows unbounded preceding) l from duo) z where l = 0)
    )
  ) end;
$$;

revoke execute on function public.player_trophies(uuid) from public, anon;
grant execute on function public.player_trophies(uuid) to authenticated;
