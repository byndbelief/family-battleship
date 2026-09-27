-- 007: one Gauntlet per rival.
-- Run once in Supabase > SQL Editor, after 006_cleanup.sql. Safe to run again.
--
-- Each group of players has a single running Gauntlet. Starting one with the same people picks
-- the running one back up, and when a Gauntlet ends the next one starts on its own, same people,
-- same length. The rivalry just keeps going; nobody has to set up a new series.

-- The players of a group, in a fixed order, so {A,B} and {B,A} are the same rivalry.
create or replace function public._group_key(p uuid[]) returns uuid[]
language sql immutable as $$ select array_agg(x order by x) from unnest(p) x $$;

create or replace function public.gauntlet_create(opponents text[], p_rounds int) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  ids uuid[];
  gid uuid;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if p_rounds not between 1 and 9 then raise exception 'Pick 1 to 9 rounds'; end if;
  select array_agg(id order by array_position(opponents, username)) into ids from profiles where username = any (opponents) and id <> me;
  if ids is null or cardinality(ids) <> cardinality(opponents) or cardinality(ids) not between 1 and 3 then raise exception 'Pick one to three other players'; end if;
  -- Already a Gauntlet running with exactly these players? That's the one.
  select id into gid from gauntlets
    where status = 'playing' and _group_key(players) = _group_key(me || ids)
    order by created_at desc limit 1;
  if gid is not null then return gid; end if;
  insert into gauntlets (created_by, players, rounds, scores) values (me, me || ids, p_rounds, array_fill(0, array[cardinality(ids) + 1]))
    returning id into gid;
  perform _gauntlet_next(gid);
  return gid;
end $$;

-- When a Gauntlet game ends: points to the winner(s), then the next round, or the final whistle
-- and straight into the next Gauntlet.
create or replace function public._gauntlet_round_over() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  gt gauntlets;
  winners uuid[];
  best int; champ int; p uuid; msg text; nxt uuid;
begin
  if new.gauntlet_id is null or new.status <> 'over' or old.status = 'over' then return new; end if;
  select * into gt from gauntlets where id = new.gauntlet_id for update;
  if not found or gt.status <> 'playing' or gt.current_game <> new.id then return new; end if;
  if tg_argv[0] = 'golf' then
    select min(s) into best from (select sum(written + fine) s from golf_turns where game_id = new.id and not skipped group by player) x;
    winners := array(select player from golf_turns where game_id = new.id and not skipped group by player having sum(written + fine) = best);
  else
    winners := array[new.winner];
  end if;
  winners := array_remove(winners, null);
  update gauntlets set
    scores = array(select scores[i] + case when players[i] = any (winners) then 1 else 0 end from generate_subscripts(players, 1) i order by i),
    history = history || jsonb_build_array(jsonb_build_object('round', round, 'kind', current_kind, 'game', current_game, 'winners', to_jsonb(winners))),
    updated_at = now()
  where id = gt.id
  returning * into gt;
  if gt.round >= gt.rounds then
    select max(x) into champ from unnest(gt.scores) x;
    msg := format('The Gauntlet is over! Champion: %s with %s point%s. The next one starts now.',
      (select string_agg(_uname(gt.players[i]), ' & ') from generate_subscripts(gt.players, 1) i where gt.scores[i] = champ), champ, case when champ = 1 then '' else 's' end);
    update gauntlets set status = 'over', updated_at = now() where id = gt.id;
    foreach p in array gt.players loop perform _chaos_event(p, null, 'gauntlet', 'gauntlet', gt.id, '🏆', msg); end loop;
    -- The rivalry goes on: a fresh Gauntlet, same players, same length. (Groups that ended up
    -- with two running from before this rule just finish the extra one; only the last one
    -- standing rolls over.)
    if not exists (select 1 from gauntlets where status = 'playing' and _group_key(players) = _group_key(gt.players)) then
      insert into gauntlets (created_by, players, rounds, scores)
        values (gt.created_by, gt.players, gt.rounds, array_fill(0, array[cardinality(gt.players)]))
        returning id into nxt;
      perform _gauntlet_next(nxt);
    end if;
  else
    foreach p in array gt.players loop
      perform _chaos_event(p, null, 'gauntlet', 'gauntlet', gt.id, '🏁',
        case when cardinality(winners) = 0 then format('Round %s is a wash: nobody scores.', gt.round)
             else format('Round %s goes to %s.', gt.round, (select string_agg(_uname(w), ' & ') from unnest(winners) w)) end);
    end loop;
    perform _gauntlet_next(gt.id);
  end if;
  return new;
end $$;

revoke execute on function public._group_key(uuid[]) from public, anon;
grant execute on function public._group_key(uuid[]) to authenticated;
revoke execute on function public.gauntlet_create(text[], int) from public, anon;
grant execute on function public.gauntlet_create(text[], int) to authenticated;
