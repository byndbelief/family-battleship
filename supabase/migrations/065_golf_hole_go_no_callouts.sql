-- 065: Putt Post live races start every hole together, and nobody calls cheater any more.
--   * golf_games.hole_go: when a live hole is done (the last player's turn on it lands), the next
--     hole goes 6 s later, the same moment for everyone. live_go (045) answers with it, so the page's
--     3-2-1-GO counts down to it; putts (and the robots' holes) wait for it. Before, the last one to
--     finish teed off at once and the others (robots included) as soon as their page noticed.
--   * The robot no longer calls cheater (golf_submit_bot_turn): the pages dropped the "Did X cheat?"
--     step and the robot's CHEATER DETECTED box. golf_call stays callable, nothing calls it.
--   * A Chaos that rolls over into the next one (the _gauntlet_round_over trigger) keeps its
--     live-vs-robot setting (064's gauntlets.live_bot) instead of starting off again.
-- Applied with the Supabase connector (apply_migration '065_golf_hole_go_no_callouts'). Safe to run again.

alter table public.golf_games add column if not exists hole_go timestamptz;

do $$
declare d text;
begin
  d := pg_get_functiondef('public._golf_submit(uuid, uuid, jsonb, integer, integer, boolean)'::regprocedure);
  if position('hole_go' in d) > 0 then return; end if;
  if position('    update golf_games set t = g.t, updated_at = now() where id = p_game;' in d) = 0 then
    raise exception '065: _golf_submit is not the shape this patch expects';
  end if;
  d := replace(d, '    update golf_games set t = g.t, updated_at = now() where id = p_game;',
    '    -- Live: the hole is done, the next one goes in 4 s for everyone (065).
    update golf_games set t = g.t, updated_at = now(), hole_go = case when live and g.t / n > tt / n then now() + interval ''6 seconds'' else hole_go end where id = p_game;');
  execute d;
end $$;

create or replace function public.live_go(p_kind text, p_game uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s timestamptz; hg timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_kind = 'duel' then
    select max(since) into s from duel_here where game_id = p_game and seen_at > now() - interval '8 seconds';
  else
    select max(since) into s from live_here where kind = p_kind and game_id = p_game and seen_at > now() - interval '8 seconds';
  end if;
  if p_kind = 'golf' then select hole_go into hg from golf_games where id = p_game; end if;   -- the next hole's start (065)
  return jsonb_build_object('go', (extract(epoch from greatest(coalesce(s, now()) + interval '5 seconds', coalesce(hg, '-infinity'))) * 1000)::bigint,
                            'now', (extract(epoch from clock_timestamp()) * 1000)::bigint);
end $$;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.golf_submit_bot_turn(uuid, jsonb, integer, integer, boolean)'::regprocedure);
  if position('-- no call-outs (065)' in d) > 0 then return; end if;
  if position('  if g.t > 0 and not exists (select 1 from golf_accusations where game_id = p_game and t = g.t - 1) then' in d) = 0 then
    raise exception '065: golf_submit_bot_turn is not the shape this patch expects';
  end if;
  d := replace(d, '  if g.t > 0 and not exists (select 1 from golf_accusations where game_id = p_game and t = g.t - 1) then',
                  '  if false and g.t > 0 and not exists (select 1 from golf_accusations where game_id = p_game and t = g.t - 1) then   -- no call-outs (065)');
  execute d;
end $$;

do $$
declare d text;
begin
  d := pg_get_functiondef('public._gauntlet_round_over()'::regprocedure);
  if position('insert into gauntlets (created_by, players, rounds, scores, live_bot)' in d) > 0 then return; end if;
  -- Whitespace-tolerant: an earlier in-place patch re-indented this function on production.
  if d !~ 'insert into gauntlets \(created_by, players, rounds, scores\)\s+values \(gt\.created_by, gt\.players, gt\.rounds, array_fill\(0, array\[cardinality\(gt\.players\)\]\)\)' then
    raise exception '065: _gauntlet_round_over is not the shape this patch expects';
  end if;
  d := regexp_replace(d, 'insert into gauntlets \(created_by, players, rounds, scores\)(\s+)values \(gt\.created_by, gt\.players, gt\.rounds, array_fill\(0, array\[cardinality\(gt\.players\)\]\)\)',
    'insert into gauntlets (created_by, players, rounds, scores, live_bot)\1values (gt.created_by, gt.players, gt.rounds, array_fill(0, array[cardinality(gt.players)]), gt.live_bot)');
  execute d;
end $$;
