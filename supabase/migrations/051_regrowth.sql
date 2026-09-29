-- 051: The hills grow back, and quakes build more mountain. Hilltop only ever lost ground (every
--   shell digs, and shells land round the tanks), so long duels ended on a bare floor by the tanks.
--   🌱 Regrowth: after a move, half the time, one swell rises by one of the last 6 craters dug (give or
--      take 35 px): [x, dh, 60-90, 6, 1], about two craters' worth of ground (a heave with a 5th number
--      1, which the page grows gently instead of shaking; the engine treats it as any heave). Simulated
--      over 80-move duels, the ground by the tanks now holds near 117 px (it fell to 23 before).
--   ⛰️ Orogeny (050) now thrusts up 2-3 mountains a quake, 80-150 px tall (was 1-2, 60-120).
-- Applied with the Supabase connector (apply_migration '051_regrowth'). Safe to run again.

create or replace function public._duel_regrow(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g duel_games; w int; d jsonb; rs int; dh int; x int;
begin
  select * into g from duel_games where id = p_game for update;
  if not found or g.status <> 'playing' then return; end if;
  w := coalesce(g.world, 800);
  -- One of the last 6 craters that dug (plain, bunker buster, meteor).
  select c into d from (select c, ord from jsonb_array_elements(g.craters) with ordinality e(c, ord)
    where jsonb_array_length(c) = 3 or (jsonb_array_length(c) >= 4 and c->>3 in ('4', '5')) order by ord desc limit 6) z order by random() limit 1;
  if d is null then return; end if;
  rs := 60 + floor(random() * 31)::int;
  dh := greatest(4, round(2 * 784 * (0.8 + random() * 0.4) / rs)::int);
  x := greatest(40, least(w - 40, round((d->>0)::numeric)::int + floor(random() * 71)::int - 35));
  update duel_games set craters = craters || jsonb_build_array(jsonb_build_array(x, dh, rs, 6, 1)), updated_at = now() where id = p_game;
end $$;
revoke execute on function public._duel_regrow(uuid) from public, anon, authenticated;

-- 049's after-move chaos, with the regrowth at the end.
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
  if p_kind = 'duel' and random() < 0.5 then perform _duel_regrow(p_game); end if;     -- 🌱 (051)
end $$;

-- 050's mountains: more of them, taller. Patched in place, once.
do $$
declare d text;
begin
  d := pg_get_functiondef('public._chaos_twist_duel(uuid)'::regprocedure);
  if position('80 + floor(random() * 71)' in d) = 0 then
    if position('for i in 1 .. 1 + floor(random() * 2)::int loop' || chr(10) || '      mx := case when cardinality(zone)' in d) = 0
       or position('jsonb_build_array(mx, 60 + floor(random() * 61)::int, 55 + floor(random() * 46)::int, 6)' in d) = 0 then
      raise exception '051: _chaos_twist_duel is not the shape this patch expects';
    end if;
    d := replace(d, 'for i in 1 .. 1 + floor(random() * 2)::int loop' || chr(10) || '      mx := case when cardinality(zone)',
                    'for i in 1 .. 2 + floor(random() * 2)::int loop' || chr(10) || '      mx := case when cardinality(zone)');
    d := replace(d, 'jsonb_build_array(mx, 60 + floor(random() * 61)::int, 55 + floor(random() * 46)::int, 6)',
                    'jsonb_build_array(mx, 80 + floor(random() * 71)::int, 55 + floor(random() * 46)::int, 6)');
    execute d;
  end if;
end $$;
