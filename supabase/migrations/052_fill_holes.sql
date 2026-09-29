-- 052: Holes fill in; peaks stay in reach. With 051 the regrowth swelled the ground beside a crater
--   (building new bumps) and quakes stacked mountains ever higher.
--   🌱 Regrowth now fills: [x, 40, 45-75, 6, 1] sits right on a recent crater (± 8 px), and the engine
--      (applyCrater, fill = 1) raises only the ground below the line between the hole's rims (and a
--      little over it, so a dug-out stretch builds back), never a hilltop. 80% of moves (was 50%).
--   ⛰️ Quakes raise 1-2 mountains, 50-90 px (was 2-3, 80-150), and every heave now eases off above a
--      ceiling 15 px over the tallest hill a field starts with (the engine again).
--   Simulated over 80-move duels: holes 60% shallower than with 051, the ground by the tanks holds
--   near 120 px (fields start at 142), and the highest peak stays about where fields start (~280).
-- Applied with the Supabase connector (apply_migration '052_fill_holes'). Safe to run again.

create or replace function public._duel_regrow(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g duel_games; w int; d jsonb; x int;
begin
  select * into g from duel_games where id = p_game for update;
  if not found or g.status <> 'playing' then return; end if;
  w := coalesce(g.world, 800);
  -- One of the last 6 craters that dug (plain, bunker buster, meteor).
  select c into d from (select c, ord from jsonb_array_elements(g.craters) with ordinality e(c, ord)
    where jsonb_array_length(c) = 3 or (jsonb_array_length(c) >= 4 and c->>3 in ('4', '5')) order by ord desc limit 6) z order by random() limit 1;
  if d is null then return; end if;
  x := greatest(40, least(w - 40, round((d->>0)::numeric)::int + floor(random() * 17)::int - 8));
  update duel_games set craters = craters || jsonb_build_array(jsonb_build_array(x, 40, 45 + floor(random() * 31)::int, 6, 1)), updated_at = now() where id = p_game;
end $$;
revoke execute on function public._duel_regrow(uuid) from public, anon, authenticated;

-- 051's after-move chaos, with the regrowth on 80% of moves.
create or replace function public._chaos_after_move(p_kind text, p_game uuid, p_mover uuid, p_others uuid[], p_loot double precision, p_curse double precision, p_why text)
returns void language plpgsql security definer set search_path = public as $$
declare
  victim uuid;
  l float8 := least(2.0, p_loot * 1.8);
begin
  if l > 0 and random() < l then perform _chaos_drop(p_mover, p_kind, p_game, p_why);
  elsif random() < 0.06 then perform _chaos_drop(p_mover, p_kind, p_game, 'a lucky find');
  end if;
  if l > 1 and random() < l - 1 then perform _chaos_drop(p_mover, p_kind, p_game, p_why); end if;
  if p_curse > 0 and random() < p_curse and cardinality(p_others) > 0 then
    victim := p_others[1 + floor(random() * cardinality(p_others))::int];
    perform _chaos_curse(p_mover, victim, p_game, lower(p_why));
  end if;
  if random() < 0.33 then perform _chaos_twist(p_kind, p_game); end if;
  if p_kind = 'duel' and random() < 0.3 then perform _duel_sun_fire(p_game); end if;   -- ☀️🔫 (049)
  if p_kind = 'duel' and random() < 0.8 then perform _duel_regrow(p_game); end if;     -- 🌱 (051, 052)
end $$;

-- 051's mountains: back to 1-2 a quake, 50-90 px. Patched in place, once.
do $$
declare d text;
begin
  d := pg_get_functiondef('public._chaos_twist_duel(uuid)'::regprocedure);
  if position('50 + floor(random() * 41)' in d) = 0 then
    if position('for i in 1 .. 2 + floor(random() * 2)::int loop' || chr(10) || '      mx := case when cardinality(zone)' in d) = 0
       or position('jsonb_build_array(mx, 80 + floor(random() * 71)::int, 55 + floor(random() * 46)::int, 6)' in d) = 0 then
      raise exception '052: _chaos_twist_duel is not the shape this patch expects';
    end if;
    d := replace(d, 'for i in 1 .. 2 + floor(random() * 2)::int loop' || chr(10) || '      mx := case when cardinality(zone)',
                    'for i in 1 .. 1 + floor(random() * 2)::int loop' || chr(10) || '      mx := case when cardinality(zone)');
    d := replace(d, 'jsonb_build_array(mx, 80 + floor(random() * 71)::int, 55 + floor(random() * 46)::int, 6)',
                    'jsonb_build_array(mx, 50 + floor(random() * 41)::int, 55 + floor(random() * 46)::int, 6)');
    execute d;
  end if;
end $$;
