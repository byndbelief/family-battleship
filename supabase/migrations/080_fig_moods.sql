-- 🟢 ONE FIG, MOODS THAT MOVE WITH THE GAME (CHAOS.md § Fig). Nobody picks a companion any more: Fig
-- goes with everyone, and its personality is a property of the game's curve, the same rule here and in
-- web/chaos.js (moodOf): a golden cut, a golden beat or a Fibonacci beat → Golden Fig (phi); a mirror or
-- a balance → Mirror Fig (kit); entering the window or crossing a phase → Boxy Fig (bit); a peak or a
-- big beat → Wild Fig (fig). A mood holds 3 moves, then Fig settles: calm below r = 3.57, wild above.
-- The mood bends the curve's edges (079's table, now keyed by mood), doubles its pillar's events in the
-- rating for whoever meets them, and colours the glitches. Safe to re-run.
alter table public.chaos_curve add column if not exists mood text not null default 'calm';
alter table public.chaos_curve add column if not exists mood_left int not null default 0;
create or replace function public._chaos_mood(p_game uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select mood from chaos_curve where game_id = p_game), 'calm')
$$;
create or replace function public._chaos_mirror(p_game uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(cardinality(hist) >= 2 and abs(hist[cardinality(hist)] - (1 - hist[cardinality(hist) - 1])) < _chaos_edge(mood, 'mirror'), false)
  from chaos_curve where game_id = p_game;
$$;
create or replace function public._chaos_golden(p_game uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(abs(x - 0.6180339887) < _chaos_edge(mood, 'golden'), false) from chaos_curve where game_id = p_game;
$$;
create or replace function public._chaos_mark(p_player uuid, p_kind text, p_game uuid, p_event text, p_times int default 1) returns void
language plpgsql security definer set search_path = public as $$
declare pts int;
begin
  if p_player is null or p_times < 1 or _chaos_weight(p_event) = 0 then return; end if;
  if exists (select 1 from bots where profile_id = p_player) then return; end if;   -- robots don't rate
  if p_event = 'bond' then   -- a solo run's tally hands its bonus in as points (the run knows Fig's mood beat by beat)
    insert into chaos_ledger (player, kind, game_id, event, pts) values (p_player, p_kind, p_game, 'bond', least(p_times, 400)); return;
  end if;
  pts := _chaos_weight(p_event) * least(p_times, 200);
  insert into chaos_ledger (player, kind, game_id, event, pts) values (p_player, p_kind, p_game, p_event, pts);
  if p_game is not null and p_event = any (_chaos_boosts(_chaos_mood(p_game))) then   -- 🧭 Fig's mood: the same again
    insert into chaos_ledger (player, kind, game_id, event, pts) values (p_player, p_kind, p_game, 'bond', pts);
  end if;
end $$;
create or replace function public._chaos_curve(p_kind text, p_game uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare c chaos_curve; ps uuid[]; gid uuid; n0 int := 0; nr float8; nx float8; other uuid; phase text; win boolean; win0 boolean; calm boolean;
        mover uuid; mname text; m0 text; nm text; nleft int; heldb boolean := false; nn int; peakb boolean; crossed boolean;
begin
  select * into c from chaos_curve where game_id = p_game for update;
  if not found then
    case p_kind
      when 'battleship' then select players, gauntlet_id into ps, gid from games where id = p_game;
      when 'golf' then select players, gauntlet_id into ps, gid from golf_games where id = p_game;
      when 'duel' then select players, gauntlet_id into ps, gid from duel_games where id = p_game;
      when 'cards' then select players, gauntlet_id into ps, gid from card_games where id = p_game;
      else null;
    end case;
    if ps is null then return false; end if;
    -- 🌀 Route to Chaos (062): each round starts further along the curve.
    if gid is not null then select greatest(0, (round - 1) * 6) into n0 from gauntlets where id = gid; end if;
    calm := p_kind in ('golf', 'cards', 'duel');   -- 🧘 the calm category: the curve holds for the first moves
    insert into chaos_curve (game_id, kind, players, x, n, r, hold) values (p_game, p_kind, ps, 0.05 + random() * 0.9, coalesce(n0, 0), least(4.0, 2.9 + 0.04 * coalesce(n0, 0)), case when calm then 8 else 0 end)
      on conflict (game_id) do nothing;
    select * into c from chaos_curve where game_id = p_game for update;
    if c.hold > 0 then
      foreach other in array c.players loop perform _chaos_event(other, null, 'twist', p_kind, p_game, '🧘', 'CALM WITHIN THE CHAOS: r holds for ' || c.hold || ' moves and nothing twists. Take your time.'); end loop;
    end if;
  end if;
  m0 := coalesce(c.mood, 'calm'); mover := _chaos_mover();
  if c.hold > 0 then   -- 🧘 held: x walks, r stays, no twist
    heldb := true; nn := c.n; nr := c.r;
  else
    nn := c.n + 1; nr := least(4.0, 2.9 + 0.04 * nn);
  end if;
  nx := nr * c.x * (1 - c.x);
  if nx <= 1e-9 or nx >= 1 - 1e-9 then nx := 0.5 + (random() - 0.5) * 1e-3; end if;   -- stuck on 0 or 1: a butterfly flaps
  win0 := c.n between _chaos_edge(m0, 'win_lo')::int and _chaos_edge(m0, 'win_hi')::int;   -- 🔁 the period-3 window, at the mood's length
  win := nn between _chaos_edge(m0, 'win_lo')::int and _chaos_edge(m0, 'win_hi')::int;
  peakb := nx > _chaos_edge(m0, 'peak') and not win and not heldb;
  crossed := not heldb and ((c.r < 3.0 and nr >= 3.0) or (c.r < 3.449 and nr >= 3.449) or (c.r < 3.544 and nr >= 3.544) or (c.r < 3.5699 and nr >= 3.5699) or (c.r < 4 and nr >= 4));
  -- 🟢 Fig's mood after this move (the same rule as chaos.js moodOf)
  nm := case when abs(nx - 0.6180339887) < _chaos_edge(m0, 'golden') or nx > 0.97 or (not heldb and nn = any (array[1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144])) then 'phi'
             when (nn > 1 and abs(nx - (1 - c.x)) < _chaos_edge(m0, 'mirror')) or abs(nx - (1 - 1 / nr)) < _chaos_edge(m0, 'balance') then 'kit'
             when (win and not win0) or crossed then 'bit'
             when peakb or (nx > 0.93 and not win and not heldb) then 'fig' else null end;
  if nm is not null then nleft := 3;
  elsif c.mood_left > 0 then nleft := c.mood_left - 1; nm := case when nleft = 0 then (case when nr >= 3.5699 then 'fig' else 'calm' end) else m0 end;
  else nleft := 0; nm := case when nr >= 3.5699 and m0 = 'calm' then 'fig' else m0 end; end if;
  update chaos_curve set n = nn, r = nr, x = nx, hold = case when heldb then c.hold - 1 else 0 end, mood = nm, mood_left = nleft, updated_at = now(),
    hist = (hist || nx::real)[greatest(1, cardinality(hist) + 2 - 48):]
    where game_id = p_game;
  if heldb then
    if nx > 0.7 then   -- ⚡ a glitch: the chaos leaks through the calm, in Fig's mood of the moment
      select username into mname from profiles where id = mover;
      foreach other in array c.players loop perform _chaos_event(other, mover, 'glitch:' || m0, p_kind, p_game, '⚡', 'GLITCH: ' || coalesce(mname || '''s move let ', 'the ') || case m0 when 'fig' then 'Wild Fig' when 'kit' then 'Mirror Fig' when 'bit' then 'Boxy Fig' when 'phi' then 'Golden Fig' else 'Fig' end || ' leak through the calm for a moment. Nothing changed. Probably.'); end loop;
    end if;
    if c.hold = 1 then
      foreach other in array c.players loop perform _chaos_event(other, null, 'twist', p_kind, p_game, '😎', 'Here comes that chaos curve again: from the next move r climbs and peaks twist.'); end loop;
    end if;
    return false;
  end if;
  phase := case when nr >= 4 and c.r < 4 then 'r = 4: the top of the curve. Full chaos.'
                when win and not win0 then '🔁 THE WINDOW: inside the chaos, a rhythm of 3. No twists here; things come in threes.'
                when c.r < 3.5699 and nr >= 3.5699 then 'CHAOS. The curve has no rhythm left: anything can happen now.'
                when c.r < 3.544 and nr >= 3.544 then 'Split again: 8, 16, 32… the rhythm is falling apart.'
                when c.r < 3.449 and nr >= 3.449 then 'The curve split again: a rhythm of 4. Period doubling has begun.'
                when c.r < 3.0 and nr >= 3.0 then 'The chaos curve split in two: twists now come every other move. x → r·x·(1−x)' end;
  if phase is not null then
    foreach other in array c.players loop perform _chaos_event(other, null, 'twist', p_kind, p_game, '🌀', phase); end loop;
  end if;
  return peakb;
end $$;
revoke execute on function public._chaos_curve(text, uuid), public._chaos_mood(uuid) from public, anon, authenticated;
create or replace function public._chaos_mark_move(p_player uuid, p_kind text, p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c chaos_curve; rp float8; win boolean; th float8; m text;
begin
  select * into c from chaos_curve where game_id = p_game;
  if not found or c.n < 1 then return; end if;
  m := coalesce(c.mood, 'calm');
  rp := least(4.0, 2.9 + 0.04 * (c.n - 1));
  win := c.n between _chaos_edge(m, 'win_lo')::int and _chaos_edge(m, 'win_hi')::int;
  if win then perform _chaos_mark(p_player, p_kind, p_game, 'window'); end if;
  if c.x > _chaos_edge(m, 'peak') and not win then perform _chaos_mark(p_player, p_kind, p_game, 'peak'); end if;
  if c.x > 0.97 then perform _chaos_mark(p_player, p_kind, p_game, 'gold'); end if;
  if c.x < 0.25 then perform _chaos_mark(p_player, p_kind, p_game, 'gift'); end if;
  if _chaos_mirror(p_game) then perform _chaos_mark(p_player, p_kind, p_game, 'mirror'); end if;
  if abs(c.x - (1 - 1 / c.r)) < _chaos_edge(m, 'balance') then perform _chaos_mark(p_player, p_kind, p_game, 'balance'); end if;
  if _chaos_fib(p_game) then perform _chaos_mark(p_player, p_kind, p_game, 'fib'); end if;
  if _chaos_golden(p_game) then perform _chaos_mark(p_player, p_kind, p_game, 'golden'); end if;
  foreach th in array array[3.0, 3.449, 3.544, 3.5699] loop
    if rp < th and c.r >= th then perform _chaos_mark(p_player, p_kind, p_game, 'phase'); end if;
  end loop;
  if rp < 4 and c.r >= 4 then perform _chaos_mark(p_player, p_kind, p_game, 'r4'); end if;
end $$;
do $$ declare d text; begin   -- Fibonacci luck follows the game's mood now
  d := pg_get_functiondef('public._chaos_after_move(text,uuid,uuid,uuid[],double precision,double precision,text)'::regprocedure);
  if position('_chaos_companion(p_mover)' in d) > 0 then execute replace(d, '_chaos_edge(_chaos_companion(p_mover), ''fib_luck'')', '_chaos_edge(_chaos_mood(p_game), ''fib_luck'')'); end if;
  d := pg_get_functiondef('public.card_play(uuid,text,text,uuid,boolean)'::regprocedure);
  if position('_chaos_companion(auth.uid())' in d) > 0 then execute replace(d, '_chaos_edge(_chaos_companion(auth.uid()), ''fib_luck'')', '_chaos_edge(_chaos_mood(p_game), ''fib_luck'')'); end if;
end $$;
