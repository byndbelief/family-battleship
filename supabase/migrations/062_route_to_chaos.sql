-- 062: The Gauntlet becomes the Route to Chaos (the pages call it that now: "Start Chaos 🌀").
--   The name is the logistic map's route to chaos, and now the rounds walk it: a round's game starts
--   its chaos curve (058) 6 moves further along per round, so round 1 starts calm (r 2.90), round 2 at
--   r 3.14 (a rhythm of 2), round 3 at 3.38, round 4 at 3.62 (chaos) and round 5 on at full chaos.
--   The server's own messages say Chaos instead of Gauntlet. Tables and functions keep their names.
-- Applied with the Supabase connector (apply_migration '062_route_to_chaos'). Safe to run again.

create or replace function public._chaos_curve(p_kind text, p_game uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare c chaos_curve; ps uuid[]; gid uuid; n0 int := 0; nr float8; nx float8; other uuid; phase text;
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
    insert into chaos_curve (game_id, kind, players, x, n, r) values (p_game, p_kind, ps, 0.05 + random() * 0.9, coalesce(n0, 0), least(4.0, 2.9 + 0.04 * coalesce(n0, 0)))
      on conflict (game_id) do nothing;
    select * into c from chaos_curve where game_id = p_game for update;
  end if;
  nr := least(4.0, 2.9 + 0.04 * (c.n + 1));
  nx := nr * c.x * (1 - c.x);
  if nx <= 1e-9 or nx >= 1 - 1e-9 then nx := 0.5 + (random() - 0.5) * 1e-3; end if;   -- stuck on 0 or 1: a butterfly flaps
  update chaos_curve set n = c.n + 1, r = nr, x = nx, updated_at = now(),
    hist = (hist || nx::real)[greatest(1, cardinality(hist) + 2 - 48):]
    where game_id = p_game;
  phase := case when c.r < 3.5699 and nr >= 3.5699 then 'CHAOS. The curve has no rhythm left: anything can happen now.'
                when c.r < 3.544 and nr >= 3.544 then 'Split again: 8, 16, 32… the rhythm is falling apart.'
                when c.r < 3.449 and nr >= 3.449 then 'The curve split again: a rhythm of 4. Period doubling has begun.'
                when c.r < 3.0 and nr >= 3.0 then 'The chaos curve split in two: twists now come every other move. x → r·x·(1−x)' end;
  if phase is not null then
    foreach other in array c.players loop perform _chaos_event(other, null, 'twist', p_kind, p_game, '🌀', phase); end loop;
  end if;
  return nx > 0.75;
end $$;
revoke execute on function public._chaos_curve(text, uuid) from public, anon, authenticated;

do $$
declare d text; f text;
begin
  foreach f in array array['public.gauntlet_delete(uuid)', 'public._gauntlet_round_over()', 'public._gauntlet_next(uuid)', 'public.chaos_clock()'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('Gauntlet' in regexp_replace(d, '--[^\n]*', '', 'g')) > 0 then
      d := replace(d, '''Only the player who started the Gauntlet can call it off''', '''Only the player who started this Chaos can call it off''');
      d := replace(d, '''The Gauntlet is over! Champion: %s with %s point%s. The next one starts now.''', '''The Route to Chaos is over! Champion: %s with %s point%s. The next one starts now.''');
      d := replace(d, '''Gauntlet round %s of %s: %s!''', '''🌀 Route to Chaos, round %s of %s: %s!''');
      d := replace(d, 'on the Gauntlet hole.', 'on the Chaos hole.');
      d := replace(d, 'forfeits the Gauntlet round.', 'forfeits the Chaos round.');
      execute d;
    end if;
  end loop;
end $$;
