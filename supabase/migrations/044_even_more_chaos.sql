-- 044: More chaos twists, and more often (16% → 25% of moves).
--   Hilltop: 🌙 low gravity (the next shot floats: gravity ×0.55) and 🎁 supply drop (every person
--     in the duel gets a Hilltop item). Low gravity rides on the shot's wind multiplier: wind_x is
--     1 or 3 (hurricane) plus 10 when low (11, 13), so shots, replays, the live channel and the
--     robot carry it with nothing new (gravOf/windFor in duel-engine.js); duel_games.lowgrav is the
--     move it applies to, like gust.
--   Putt Post: 🌫️ fog (only a clearing round the ball shows) and 🌊 flood (a new pond, placed so
--     the cup can still be reached), both golf_games.twists kinds (043).
--   Battleship: a crate now half the time drops for everyone (🎁 supply drop).
-- Applied with the Supabase connector (apply_migration '044_even_more_chaos'). Safe to run again.

alter table public.duel_games add column if not exists lowgrav int not null default -1;

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
  if random() < 0.25 then perform _chaos_twist(p_kind, p_game); end if;
end $$;

-- 042's Hilltop twists, with low gravity and a supply drop.
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
  if r < 0.17 then
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
  elsif r < 0.32 then
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
  elsif r < 0.44 then
    for j in 1 .. n loop
      if nhp[j] > 0 then zone := _duel_zone(n, j, w); nx[j] := zone[1] + floor(random() * (zone[2] - zone[1]))::int; end if;
    end loop;
    update duel_games set tank_x = nx, turn_x = nx, updated_at = now() where id = p_game;
    foreach other in array dg.players loop
      perform _chaos_event(other, null, 'twist', 'duel', p_game, '🔀', 'Chaos twist: SHUFFLE! Every tank just got airlifted to a new spot.');
    end loop;
  elsif r < 0.58 then
    update duel_games set lowgrav = move, updated_at = now() where id = p_game;
    foreach other in array dg.players loop
      perform _chaos_event(other, null, 'twist', 'duel', p_game, '🌙', 'Chaos twist: LOW GRAVITY! The next shot floats way further.');
    end loop;
  elsif r < 0.7 then
    foreach other in array dg.players loop
      if not _is_bot(other) then perform _chaos_drop(other, 'duel', p_game, 'A supply drop parachuted in and'); end if;
    end loop;
  elsif r < 0.85 then
    update duel_games set gust = move, updated_at = now() where id = p_game;
    perform _chaos_event(p, null, 'twist', 'duel', p_game, '🌪️', 'Chaos twist: HURRICANE! Triple wind on your next shot.');
  else
    update duel_games set hp[dg.turn + 1] = least(100, hp[dg.turn + 1] + 15), updated_at = now() where id = p_game;
    perform _chaos_event(p, null, 'twist', 'duel', p_game, '🔧', 'Chaos twist: FIELD REPAIRS! +15 HP for your tank.');
  end if;
end $$;

-- 043's Putt Post twists, with fog and flood.
create or replace function public._chaos_twist_golf(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  gg golf_games; r float8 := random();
  p uuid; other uuid; n int; ft int; hole int; kind text; msg text; icon text;
  h1 int; s1 int; s2 int;
begin
  select * into gg from golf_games where id = p_game for update;
  if not found or gg.status <> 'playing' then return; end if;
  n := cardinality(gg.players);
  p := gg.players[gg.t % n + 1];
  ft := case when _golf_live(gg) then (gg.t / n + 1) * n else gg.t end;   -- live: from the next hole on
  hole := gg.start + ft / n;
  if r < 0.2 and not exists (select 1 from golf_attacks where game_id = p_game and target = p and used_t is null) then
    insert into golf_attacks (game_id, attacker, target, type, planted_t) values (p_game, null, p, 1 + floor(random() * 5)::int, gg.t);
    perform _chaos_event(p, null, 'twist', 'golf', p_game, '🌪️', 'Chaos twist: the course itself is out to get you this hole.');
  elsif r < 0.74 and hole < gg.start + gg.count and jsonb_array_length(coalesce(gg.twists -> hole::text, '[]')) < 3 then
    kind := case when r < 0.35 then 'cup' when r < 0.5 then 'gopher' when r < 0.62 then 'fog' else 'flood' end;
    update golf_games set twists = jsonb_set(twists, array[hole::text],
        coalesce(twists -> hole::text, '[]') || jsonb_build_array(jsonb_build_object('k', kind, 's', 1 + floor(random() * 2000000000)::bigint, 't', ft))),
      updated_at = now() where id = p_game;
    icon := case kind when 'cup' then '🚩' when 'gopher' then '🐹' when 'fog' then '🌫️' else '🌊' end;
    msg := case kind when 'cup' then format('Chaos twist: the cup on hole %s just moved!', hole + 1)
                     when 'gopher' then format('Chaos twist: gophers dug up hole %s! Two holes connect underground.', hole + 1)
                     when 'fog' then format('Chaos twist: FOG rolled over hole %s. You''ll only see round your ball.', hole + 1)
                     else format('Chaos twist: a FLOOD left a new pond on hole %s.', hole + 1) end;
    foreach other in array gg.players loop
      if not _is_bot(other) then perform _chaos_event(other, null, 'twist', 'golf', p_game, icon, msg); end if;
    end loop;
  elsif r < 0.86 and n > 1 then
    -- Scoreboard glitch (005): swap your score with someone else's on a hole you've both played.
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
end $$;

-- Patches in place, once each: _duel_fire saves low gravity with the shot and uses it up like a
-- hurricane; the live save accepts it; a Battleship crate is a supply drop for everyone half the time.
do $$
declare d text;
begin
  d := pg_get_functiondef('public._duel_fire(uuid,uuid,integer,integer,jsonb,integer[])'::regprocedure);
  if position('lowgrav' in d) = 0 then
    d := replace(d, 'case when g.gust = g.move - 1 then 3 else 1 end, wpn);',
                    '(case when g.gust = g.move - 1 then 3 else 1 end) + (case when g.lowgrav = g.move - 1 then 10 else 0 end), wpn);');
    d := replace(d, 'gust = case when gust = g.move - 1 then -1 else gust end,',
                    'gust = case when gust = g.move - 1 then -1 else gust end, lowgrav = case when lowgrav = g.move - 1 then -1 else lowgrav end,');
    if position('lowgrav = case' in d) = 0 or position('g.lowgrav = g.move - 1 then 10' in d) = 0 then raise exception '044: _duel_fire is not the shape this patch expects'; end if;
    execute d;
  end if;
end $$;
do $$
declare d text; f regprocedure;
begin
  select p.oid::regprocedure into f from pg_proc p where p.proname = 'duel_fire_live' and p.pronamespace = 'public'::regnamespace;
  d := pg_get_functiondef(f);
  if position('(1, 3, 11, 13)' in d) = 0 then
    if position('coalesce(p_wind_x, 1) not in (1, 3)' in d) = 0 then raise exception '044: duel_fire_live is not the shape this patch expects'; end if;
    execute replace(d, 'coalesce(p_wind_x, 1) not in (1, 3)', 'coalesce(p_wind_x, 1) not in (1, 3, 11, 13)');
  end if;
  d := pg_get_functiondef('public._chaos_twist(text,uuid)'::regprocedure);
  if position('supply drop' in d) = 0 then
    if position('perform _chaos_drop(p, ''battleship'', p_game, ''A chaos crate washed ashore and'');' in d) = 0 then raise exception '044: _chaos_twist is not the shape this patch expects'; end if;
    execute replace(d, 'perform _chaos_drop(p, ''battleship'', p_game, ''A chaos crate washed ashore and'');',
      'if random() < 0.5 then perform _chaos_drop(p, ''battleship'', p_game, ''A chaos crate washed ashore and'');
      else foreach other in array g.players loop if not _is_bot(other) then perform _chaos_drop(other, ''battleship'', p_game, ''A supply drop splashed down and''); end if; end loop;  -- supply drop (044)
      end if;');
  end if;
end $$;
