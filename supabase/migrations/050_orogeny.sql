-- 050: Orogeny. A Hilltop earthquake (042) still heaves and dips the hills, and now also thrusts up
--   1-2 mountains: heaves [x, 60-120, 55-100, 6], each between two neighbouring tanks still in (give
--   or take 40 px), so a new range stands in the line of fire. A tank on the slope rides up with it.
--   The page grinds them up over the shaking (twistFx in duel.js). Patched in place, once.
-- Applied with the Supabase connector (apply_migration '050_orogeny'). Safe to run again.

do $$
declare d text;
begin
  d := pg_get_functiondef('public._chaos_twist_duel(uuid)'::regprocedure);
  if position('orogeny' in d) = 0 then
    if position('    for j in 1 .. n loop if nhp[j] > 1 then nhp[j] := greatest(1, nhp[j] - (3 + floor(random() * 4)::int)); end if; end loop;' in d) = 0
       or position('Chaos twist: EARTHQUAKE! The hills heaved and every tank took a rattle.' in d) = 0 then
      raise exception '050: _chaos_twist_duel is not the shape this patch expects';
    end if;
    d := replace(d, '    for j in 1 .. n loop if nhp[j] > 1 then nhp[j] := greatest(1, nhp[j] - (3 + floor(random() * 4)::int)); end if; end loop;',
$x$    -- ⛰️ orogeny (050): 1-2 mountains thrust up between neighbouring tanks still in
    zone := array(select nx[q] from generate_series(1, n) q where nhp[q] > 0 order by nx[q]);
    for i in 1 .. 1 + floor(random() * 2)::int loop
      mx := case when cardinality(zone) >= 2
                 then (select (zone[q] + zone[q + 1]) / 2 from generate_series(1, cardinality(zone) - 1) q order by random() limit 1)
                 else 60 + floor(random() * (w - 120))::int end;
      mx := greatest(60, least(w - 60, mx + floor(random() * 81)::int - 40));
      add := add || jsonb_build_array(jsonb_build_array(mx, 60 + floor(random() * 61)::int, 55 + floor(random() * 46)::int, 6));
    end loop;
    for j in 1 .. n loop if nhp[j] > 1 then nhp[j] := greatest(1, nhp[j] - (3 + floor(random() * 4)::int)); end if; end loop;$x$);
    d := replace(d, 'Chaos twist: EARTHQUAKE! The hills heaved and every tank took a rattle.',
                    'Chaos twist: EARTHQUAKE! The ground heaved, every tank took a rattle, and new MOUNTAINS rose ⛰️');
    execute d;
  end if;
end $$;
