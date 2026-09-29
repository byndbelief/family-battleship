-- 047: Chaos about 1 move in 3 (25% → 33%), and more twists.
--   Hilltop: 🌀 tornado (the next shot's wind ×5 and never calm: wind_x 5, or 15 in low gravity;
--     windFor in duel-engine.js), 🌧️ healing rain (every tank still in +12 HP) and 🔄 HP swap (the
--     tank up next trades HP with a random rival). duel_games.tornado is the move it applies to.
--   Putt Post: 🌀 windmill, 🟤 mud and 🍃 gust, more golf_games.twists kinds (twistHole in golf-engine.js).
--   Battleship: 🌀 whirlpool (a rival's untouched ship is swept to a new spot, clear of every other
--     ship and every square already fired at) and 🌫️ fog (the results of the next shooter's last
--     6 shots are hidden from them until their turn ends: games.fog_player/fog_move/fog_shots).
-- Applied with the Supabase connector (apply_migration '047_chaos_extras'). Safe to run again.

alter table public.duel_games add column if not exists tornado int not null default -1;
alter table public.games add column if not exists fog_player uuid;
alter table public.games add column if not exists fog_move int not null default -1;
alter table public.games add column if not exists fog_shots bigint[] not null default '{}';

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
end $$;

-- 044's Hilltop twists, with the tornado, healing rain and HP swap.
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
  if r < 0.13 then
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
  elsif r < 0.25 then
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
  elsif r < 0.34 then
    for j in 1 .. n loop
      if nhp[j] > 0 then zone := _duel_zone(n, j, w); nx[j] := zone[1] + floor(random() * (zone[2] - zone[1]))::int; end if;
    end loop;
    update duel_games set tank_x = nx, turn_x = nx, updated_at = now() where id = p_game;
    foreach other in array dg.players loop
      perform _chaos_event(other, null, 'twist', 'duel', p_game, '🔀', 'Chaos twist: SHUFFLE! Every tank just got airlifted to a new spot.');
    end loop;
  elsif r < 0.44 then
    update duel_games set lowgrav = move, updated_at = now() where id = p_game;
    foreach other in array dg.players loop
      perform _chaos_event(other, null, 'twist', 'duel', p_game, '🌙', 'Chaos twist: LOW GRAVITY! The next shot floats way further.');
    end loop;
  elsif r < 0.52 then
    foreach other in array dg.players loop
      if not _is_bot(other) then perform _chaos_drop(other, 'duel', p_game, 'A supply drop parachuted in and'); end if;
    end loop;
  elsif r < 0.62 then
    update duel_games set gust = move, updated_at = now() where id = p_game;
    perform _chaos_event(p, null, 'twist', 'duel', p_game, '🌪️', 'Chaos twist: HURRICANE! Triple wind on your next shot.');
  elsif r < 0.72 then
    update duel_games set tornado = move, updated_at = now() where id = p_game;
    foreach other in array dg.players loop
      perform _chaos_event(other, null, 'twist', 'duel', p_game, '🌀', 'Chaos twist: TORNADO! The next shot gets flung hard sideways.');
    end loop;
  elsif r < 0.8 then
    for j in 1 .. n loop if nhp[j] > 0 then nhp[j] := least(100, nhp[j] + 12); end if; end loop;
    update duel_games set hp = nhp, updated_at = now() where id = p_game;
    foreach other in array dg.players loop
      perform _chaos_event(other, null, 'twist', 'duel', p_game, '🌧️', 'Chaos twist: HEALING RAIN! Every tank still in gets +12 HP.');
    end loop;
  elsif r < 0.9 and n > 1 then
    select j2 into k from generate_series(1, n) j2
      where j2 <> dg.turn + 1 and dg.hp[j2] > 0 and dg.hp[j2] <> dg.hp[dg.turn + 1] order by random() limit 1;
    if k is null or dg.hp[dg.turn + 1] <= 0 then
      update duel_games set hp[dg.turn + 1] = least(100, hp[dg.turn + 1] + 15), updated_at = now() where id = p_game;
      perform _chaos_event(p, null, 'twist', 'duel', p_game, '🔧', 'Chaos twist: FIELD REPAIRS! +15 HP for your tank.');
    else
      nhp[dg.turn + 1] := dg.hp[k]; nhp[k] := dg.hp[dg.turn + 1];
      update duel_games set hp = nhp, updated_at = now() where id = p_game;
      perform _chaos_event(p, null, 'twist', 'duel', p_game, '🔄', format('Chaos twist: HP SWAP! You traded health with %s (%s ↔ %s).', _uname(dg.players[k]), dg.hp[dg.turn + 1], dg.hp[k]));
      perform _chaos_event(dg.players[k], null, 'twist', 'duel', p_game, '🔄', format('Chaos twist: HP SWAP! You traded health with %s (%s ↔ %s).', _uname(p), dg.hp[k], dg.hp[dg.turn + 1]));
    end if;
  else
    update duel_games set hp[dg.turn + 1] = least(100, hp[dg.turn + 1] + 15), updated_at = now() where id = p_game;
    perform _chaos_event(p, null, 'twist', 'duel', p_game, '🔧', 'Chaos twist: FIELD REPAIRS! +15 HP for your tank.');
  end if;
end $$;

-- 044's Putt Post twists, with the windmill, mud and gust. The scoreboard glitch's updates now name
-- golf_turns.hole: since 043 added a `hole` variable they were ambiguous, and the error failed the putt.
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
  if r < 0.16 and not exists (select 1 from golf_attacks where game_id = p_game and target = p and used_t is null) then
    insert into golf_attacks (game_id, attacker, target, type, planted_t) values (p_game, null, p, 1 + floor(random() * 5)::int, gg.t);
    perform _chaos_event(p, null, 'twist', 'golf', p_game, '🌪️', 'Chaos twist: the course itself is out to get you this hole.');
  elsif r < 0.78 and hole < gg.start + gg.count and jsonb_array_length(coalesce(gg.twists -> hole::text, '[]')) < 3 then
    kind := case when r < 0.27 then 'cup' when r < 0.37 then 'gopher' when r < 0.45 then 'fog' when r < 0.53 then 'flood'
                 when r < 0.61 then 'windmill' when r < 0.7 then 'mud' else 'gust' end;
    update golf_games set twists = jsonb_set(twists, array[hole::text],
        coalesce(twists -> hole::text, '[]') || jsonb_build_array(jsonb_build_object('k', kind, 's', 1 + floor(random() * 2000000000)::bigint, 't', ft))),
      updated_at = now() where id = p_game;
    icon := case kind when 'cup' then '🚩' when 'gopher' then '🐹' when 'fog' then '🌫️' when 'flood' then '🌊'
                      when 'windmill' then '🌀' when 'mud' then '🟤' else '🍃' end;
    msg := case kind when 'cup' then format('Chaos twist: the cup on hole %s just moved!', hole + 1)
                     when 'gopher' then format('Chaos twist: gophers dug up hole %s! Two holes connect underground.', hole + 1)
                     when 'fog' then format('Chaos twist: FOG rolled over hole %s. You''ll only see round your ball.', hole + 1)
                     when 'flood' then format('Chaos twist: a FLOOD left a new pond on hole %s.', hole + 1)
                     when 'windmill' then format('Chaos twist: a WINDMILL sprang up on hole %s.', hole + 1)
                     when 'mud' then format('Chaos twist: MUD on hole %s! It swallows a ball''s speed.', hole + 1)
                     else format('Chaos twist: a GUST is blowing across hole %s. It nudges every ball.', hole + 1) end;
    foreach other in array gg.players loop
      if not _is_bot(other) then perform _chaos_event(other, null, 'twist', 'golf', p_game, icon, msg); end if;
    end loop;
  elsif r < 0.88 and n > 1 then
    -- Scoreboard glitch (005): swap your score with someone else's on a hole you've both played.
    select tu.hole, tu.written + tu.fine, o.written + o.fine, o.player into h1, s1, s2, other
      from golf_turns tu join golf_turns o on o.game_id = tu.game_id and o.hole = tu.hole and o.player <> tu.player
      where tu.game_id = p_game and tu.player = p and not tu.skipped and not o.skipped and tu.written + tu.fine <> o.written + o.fine
      order by random() limit 1;
    if h1 is not null then
      update golf_turns gt set written = s2 - gt.fine where gt.game_id = p_game and gt.player = p and gt.hole = h1;
      update golf_turns gt set written = s1 - gt.fine where gt.game_id = p_game and gt.player = other and gt.hole = h1;
      perform _chaos_event(p, null, 'twist', 'golf', p_game, '📟', format('Chaos twist: SCOREBOARD GLITCH! Your hole %s score swapped with %s''s (%s ↔ %s).', h1 + 1, _uname(other), s1, s2));
      perform _chaos_event(other, null, 'twist', 'golf', p_game, '📟', format('Chaos twist: SCOREBOARD GLITCH! Your hole %s score swapped with %s''s (%s ↔ %s).', h1 + 1, _uname(p), s2, s1));
    else
      perform _chaos_drop(p, 'golf', p_game, 'A chaos crate rolled onto the green and');
    end if;
  else
    perform _chaos_drop(p, 'golf', p_game, 'A chaos crate rolled onto the green and');
  end if;
end $$;

-- Battleship's own twists (the frenzy, jam and crate stay in _chaos_twist; 005/044).
-- Returns false when there was nothing to do, so the caller falls back to a crate.
create or replace function public._chaos_twist_bs(p_game uuid, p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  g games; p uuid; other uuid; victim uuid; f jsonb; lens int[]; nn int;
  k int; L int; c int; h boolean; cells int[]; blocked int[]; ids bigint[];
begin
  select * into g from games where id = p_game for update;
  if not found or g.status <> 'playing' then return false; end if;
  p := g.players[g.turn + 1];
  if p_kind = 'whirlpool' then
    lens := mode_ships(g.mode); nn := mode_n(g.mode);
    -- A rival's ship (someone other than the shooter up next) that nobody has hit yet.
    for victim, f, k in
      select fl.player_id, fl.ships, s.i - 1 from fleets fl, generate_series(1, cardinality(mode_ships(g.mode))) s(i)
      where fl.game_id = p_game and fl.player_id <> p and not (fl.player_id = any (g.eliminated))
        and not (ship_cells(g.mode, (fl.ships -> (s.i - 1) ->> 'c')::int, (fl.ships -> (s.i - 1) ->> 'h')::boolean, (mode_ships(g.mode))[s.i])
                 && coalesce((select array_agg(x.cell::int) from shots x where x.game_id = p_game and x.hit), '{}'))
      order by random()
    loop
      L := lens[k + 1];
      -- Clear of every other ship (theirs, and on the shared ocean everyone's) and every square fired at.
      blocked := coalesce((select array_agg(x.cell::int) from shots x where x.game_id = p_game and (x.target is null or x.target = victim)), '{}')
        || case when g.mode in (2, 3) then _ocean_taken(p_game, victim) else '{}' end;
      for t in 0 .. cardinality(lens) - 1 loop
        if t <> k then blocked := blocked || ship_cells(g.mode, (f -> t ->> 'c')::int, (f -> t ->> 'h')::boolean, lens[t + 1]); end if;
      end loop;
      for t in 1 .. 200 loop
        h := random() < 0.5;
        c := case when h then floor(random() * nn)::int * nn + floor(random() * (nn - L + 1))::int
                  else floor(random() * (nn - L + 1))::int * nn + floor(random() * nn)::int end;
        cells := ship_cells(g.mode, c, h, L);
        if not (cells && blocked) and c <> (f -> k ->> 'c')::int then
          update fleets set ships = jsonb_set(ships, array[k::text], jsonb_build_object('c', c, 'h', h)) where game_id = p_game and player_id = victim;
          update games set updated_at = now() where id = p_game;
          foreach other in array g.players loop
            if not _is_bot(other) then
              perform _chaos_event(other, null, 'twist', 'battleship', p_game, '🌀', case when other = victim
                then format('Chaos twist: WHIRLPOOL! It swept your %s-square ship to a new spot.', L)
                else format('Chaos twist: WHIRLPOOL! One of %s''s ships got swept somewhere else.', _uname(victim)) end);
            end if;
          end loop;
          return true;
        end if;
      end loop;
    end loop;
    return false;
  else   -- fog
    select array_agg(id) into ids from (select id from shots where game_id = p_game and shooter = p and sunk_ship is null order by id desc limit 6) x;
    if ids is null or _is_bot(p) then return false; end if;
    update games set fog_player = p, fog_move = g.move, fog_shots = ids, updated_at = now() where id = p_game;
    perform _chaos_event(p, null, 'twist', 'battleship', p_game, '🌫️', format('Chaos twist: FOG! You can''t see how your last %s shots went until your turn ends.', cardinality(ids)));
    return true;
  end if;
end $$;
revoke execute on function public._chaos_twist_bs(uuid, text) from public, anon, authenticated;

-- Patches in place, once each: _duel_fire saves the tornado with the shot and uses it up; the
-- live save accepts it; _chaos_twist hands Battleship's whirlpool and fog to _chaos_twist_bs.
do $$
declare d text; f regprocedure;
begin
  d := pg_get_functiondef('public._duel_fire(uuid,uuid,integer,integer,jsonb,integer[])'::regprocedure);
  if position('tornado' in d) = 0 then
    d := replace(d, '(case when g.gust = g.move - 1 then 3 else 1 end) + (case when g.lowgrav',
                    '(case when g.tornado = g.move - 1 then 5 when g.gust = g.move - 1 then 3 else 1 end) + (case when g.lowgrav');
    d := replace(d, 'lowgrav = case when lowgrav = g.move - 1 then -1 else lowgrav end,',
                    'lowgrav = case when lowgrav = g.move - 1 then -1 else lowgrav end, tornado = case when tornado = g.move - 1 then -1 else tornado end,');
    if position('tornado = case' in d) = 0 or position('g.tornado = g.move - 1 then 5' in d) = 0 then raise exception '047: _duel_fire is not the shape this patch expects'; end if;
    execute d;
  end if;
  select p.oid::regprocedure into f from pg_proc p where p.proname = 'duel_fire_live' and p.pronamespace = 'public'::regnamespace;
  d := pg_get_functiondef(f);
  if position('(1, 3, 5, 11, 13, 15)' in d) = 0 then
    if position('coalesce(p_wind_x, 1) not in (1, 3, 11, 13)' in d) = 0 then raise exception '047: duel_fire_live is not the shape this patch expects'; end if;
    execute replace(d, 'coalesce(p_wind_x, 1) not in (1, 3, 11, 13)', 'coalesce(p_wind_x, 1) not in (1, 3, 5, 11, 13, 15)');
  end if;
  d := pg_get_functiondef('public._chaos_twist(text,uuid)'::regprocedure);
  if position('_chaos_twist_bs' in d) = 0 then
    if position('    else' || chr(10) || '      if random() < 0.5 then perform _chaos_drop(p, ''battleship''' in d) = 0 then raise exception '047: _chaos_twist is not the shape this patch expects'; end if;
    d := replace(d, 'if r < 0.4 then' || chr(10) || '      insert into player_mods', 'if r < 0.3 then' || chr(10) || '      insert into player_mods');
    d := replace(d, 'elsif r < 0.7 then' || chr(10) || '      insert into player_mods', 'elsif r < 0.5 then' || chr(10) || '      insert into player_mods');
    d := replace(d, '    else' || chr(10) || '      if random() < 0.5 then perform _chaos_drop(p, ''battleship''',
      '    elsif r < 0.8 and _chaos_twist_bs(p_game, case when r < 0.65 then ''whirlpool'' else ''fog'' end) then null;  -- whirlpool, fog (047)' || chr(10)
      || '    else' || chr(10) || '      if random() < 0.5 then perform _chaos_drop(p, ''battleship''');
    if position('if r < 0.3 then' in d) = 0 or position('elsif r < 0.5 then' in d) = 0 then raise exception '047: _chaos_twist is not the shape this patch expects'; end if;
    execute d;
  end if;
end $$;
