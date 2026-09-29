-- 042: More chaos in Hilltop, and chaos twists a little more often everywhere (12.5% → 16% a move).
--   ☄️ Meteor shower: 3-6 meteors anywhere on the field, saved as [x, depth, r, 5] (the page digs
--      the crater where each strikes the surface); a tank within 34 px of one takes up to 30.
--   🌋 Earthquake: 5-9 heaves and dips, [x, dh, r, 6] (the ground rises dh px at x, easing out
--      over ±r; a dip if dh < 0); every tank still in takes 3-6.
--   🔀 Shuffle: every tank still in is airlifted to a random spot in its own stretch of the field.
--   Hurricane and field repairs stay. Chaos never knocks a tank out (it leaves at least 1 HP):
--   only a shot ends a duel. The page animates the new meteors and quakes (twistFx in duel.js).
-- Applied with the Supabase connector (apply_migration '042_more_chaos_hilltop'). Safe to run again.

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
  if random() < 0.16 then perform _chaos_twist(p_kind, p_game); end if;
end $$;

-- The Hilltop part of the twists, on its own (005's _chaos_twist calls it for duels).
create or replace function public._chaos_twist_duel(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  dg duel_games; r float8 := random();
  p uuid; other uuid; w int; n int; k int; i int; j int; mx int; d int; zone int[];
  nhp int[]; nx int[]; add jsonb := '[]'; hit text[] := '{}';
begin
  select * into dg from duel_games where id = p_game for update;
  if not found or dg.status <> 'playing' then return; end if;
  p := dg.players[dg.turn + 1]; w := coalesce(dg.world, 800); n := cardinality(dg.players);
  nhp := dg.hp; nx := dg.tank_x;
  if r < 0.22 then
    k := 3 + floor(random() * 4)::int;
    for i in 1 .. k loop
      mx := 40 + floor(random() * (w - 80))::int;
      add := add || jsonb_build_array(jsonb_build_array(mx, 2, 22 + floor(random() * 10)::int, 5));
      for j in 1 .. n loop
        d := abs(nx[j] - mx);
        if nhp[j] > 1 and d < 34 then nhp[j] := greatest(1, nhp[j] - round(30 - d * 0.6)::int); end if;
      end loop;
    end loop;
    for j in 1 .. n loop if nhp[j] < dg.hp[j] then hit := hit || format('%s −%s', _uname(dg.players[j]), dg.hp[j] - nhp[j]); end if; end loop;
    update duel_games set craters = craters || add, hp = nhp, updated_at = now() where id = p_game;
    foreach other in array dg.players loop
      perform _chaos_event(other, null, 'twist', 'duel', p_game, '☄️', format('Chaos twist: METEOR SHOWER! %s meteors hit the battlefield%s.', k,
        case when cardinality(hit) > 0 then ': ' || array_to_string(hit, ', ') else '' end));
    end loop;
  elsif r < 0.42 then
    k := 5 + floor(random() * 5)::int;
    for i in 1 .. k loop
      d := (case when random() < 0.5 then -1 else 1 end) * (10 + floor(random() * 26)::int);
      add := add || jsonb_build_array(jsonb_build_array(40 + floor(random() * (w - 80))::int, d, 40 + floor(random() * 60)::int, 6));
    end loop;
    for j in 1 .. n loop if nhp[j] > 1 then nhp[j] := greatest(1, nhp[j] - (3 + floor(random() * 4)::int)); end if; end loop;
    update duel_games set craters = craters || add, hp = nhp, updated_at = now() where id = p_game;
    foreach other in array dg.players loop
      perform _chaos_event(other, null, 'twist', 'duel', p_game, '🌋', 'Chaos twist: EARTHQUAKE! The hills heaved and every tank took a rattle.');
    end loop;
  elsif r < 0.58 then
    for j in 1 .. n loop
      if nhp[j] > 0 then zone := _duel_zone(n, j, w); nx[j] := zone[1] + floor(random() * (zone[2] - zone[1]))::int; end if;
    end loop;
    update duel_games set tank_x = nx, turn_x = nx, updated_at = now() where id = p_game;
    foreach other in array dg.players loop
      perform _chaos_event(other, null, 'twist', 'duel', p_game, '🔀', 'Chaos twist: SHUFFLE! Every tank just got airlifted to a new spot.');
    end loop;
  elsif r < 0.8 then
    update duel_games set gust = move, updated_at = now() where id = p_game;
    perform _chaos_event(p, null, 'twist', 'duel', p_game, '🌪️', 'Chaos twist: HURRICANE! Triple wind on your next shot.');
  else
    update duel_games set hp[dg.turn + 1] = least(100, hp[dg.turn + 1] + 15), updated_at = now() where id = p_game;
    perform _chaos_event(p, null, 'twist', 'duel', p_game, '🔧', 'Chaos twist: FIELD REPAIRS! +15 HP for your tank.');
  end if;
end $$;
revoke execute on function public._chaos_twist_duel(uuid) from public, anon, authenticated;

-- 005's _chaos_twist hands duels to _chaos_twist_duel. Patched in place, once.
do $$
declare d text; a int; b int;
begin
  d := pg_get_functiondef('public._chaos_twist(text,uuid)'::regprocedure);
  if position('_chaos_twist_duel' in d) = 0 then
    a := position('    select * into dg from duel_games where id = p_game;' in d);
    b := position('  end if;' || chr(10) || 'end' in d);
    if a = 0 or b = 0 then raise exception '042: _chaos_twist is not the shape this patch expects'; end if;
    execute substr(d, 1, a - 1) || '    perform _chaos_twist_duel(p_game);' || chr(10) || substr(d, b);
  end if;
end $$;
