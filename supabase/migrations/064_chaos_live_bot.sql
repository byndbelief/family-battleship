-- 064: Live sticks for the whole Route to Chaos. Each round is a fresh game, and a fresh game's
--   live_bot (017) was off, so a Chaos of people and robots fell back to taking turns every round
--   until someone tapped the 🤖 switch again. Now the Chaos itself carries the setting
--   (gauntlets.live_bot): every round's game starts with it, the switch on any round's page sets it
--   for the rest of the Chaos, and it starts on whenever two or more people play robots, so the
--   round goes live by itself once the people are all on the page (the robots always count as here).
--   One person against robots still starts turn by turn, as before. Chaos Cards never needed it.
-- Applied with the Supabase connector (apply_migration '064_chaos_live_bot'). Safe to run again.

alter table public.gauntlets add column if not exists live_bot boolean not null default false;

-- People plus robots: live by default.
create or replace function public._gauntlet_live_default(p_players uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from bots where profile_id = any (p_players))
     and (select count(*) from unnest(p_players) p where not exists (select 1 from bots where profile_id = p)) >= 2;
$$;
revoke execute on function public._gauntlet_live_default(uuid[]) from public, anon, authenticated;

-- gauntlet_create: the new Chaos starts with the default.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.gauntlet_create(text[], integer)'::regprocedure);
  if position('insert into gauntlets (created_by, players, rounds, scores, live_bot)' in d) > 0 then return; end if;
  if position('insert into gauntlets (created_by, players, rounds, scores) values (me, me || ids, p_rounds, array_fill(0, array[cardinality(ids) + 1]))' in d) = 0 then
    raise exception '064: gauntlet_create is not the shape this patch expects';
  end if;
  d := replace(d, 'insert into gauntlets (created_by, players, rounds, scores) values (me, me || ids, p_rounds, array_fill(0, array[cardinality(ids) + 1]))',
                  'insert into gauntlets (created_by, players, rounds, scores, live_bot) values (me, me || ids, p_rounds, array_fill(0, array[cardinality(ids) + 1]), _gauntlet_live_default(me || ids))');
  execute d;
end $$;

-- _gauntlet_next: the round's game starts with the Chaos's setting.
do $$
declare d text;
begin
  d := pg_get_functiondef('public._gauntlet_next(uuid)'::regprocedure);
  if position('-- live sticks (064)' in d) > 0 then return; end if;
  if position('  update gauntlets set round = rnd, current_kind = k, current_game = child, updated_at = now() where id = p_gauntlet;' in d) = 0 then
    raise exception '064: _gauntlet_next is not the shape this patch expects';
  end if;
  d := replace(d, '  update gauntlets set round = rnd, current_kind = k, current_game = child, updated_at = now() where id = p_gauntlet;',
    '  if has_bot and gt.live_bot then   -- live sticks (064)
    case k when ''battleship'' then update games set live_bot = true where id = child;
           when ''golf'' then update golf_games set live_bot = true where id = child;
           when ''duel'' then update duel_games set live_bot = true where id = child;
           else null; end case;
  end if;
  update gauntlets set round = rnd, current_kind = k, current_game = child, updated_at = now() where id = p_gauntlet;');
  execute d;
end $$;

-- The 🤖 switch on a Chaos round sets it for the rest of the Chaos too.
create or replace function public.set_live_bot(p_kind text, p_game uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); ps uuid[]; gid uuid;
begin
  if p_kind = 'duel' then select players, gauntlet_id into ps, gid from duel_games where id = p_game;
  elsif p_kind = 'battleship' then select players, gauntlet_id into ps, gid from games where id = p_game;
  elsif p_kind = 'golf' then select players, gauntlet_id into ps, gid from golf_games where id = p_game;
  else raise exception 'Unknown game'; end if;
  if ps is null or not (me = any (ps)) then raise exception 'Game not found'; end if;
  if not exists (select 1 from bots where profile_id = any (ps)) then raise exception 'There''s no robot in this game'; end if;
  if p_kind = 'duel' then update duel_games set live_bot = p_on, updated_at = now() where id = p_game;
  elsif p_kind = 'battleship' then update games set live_bot = p_on, updated_at = now() where id = p_game;
  else update golf_games set live_bot = p_on, updated_at = now() where id = p_game; end if;
  if gid is not null then update gauntlets set live_bot = p_on where id = gid; end if;   -- for the rest of the Chaos (064)
end $$;

-- Chaos already running: switch on where the default says so, this round included.
update gauntlets set live_bot = true where status = 'playing' and not live_bot and _gauntlet_live_default(players);
update games g set live_bot = true from gauntlets gt where gt.current_game = g.id and gt.status = 'playing' and gt.live_bot and g.status <> 'over' and not g.live_bot;
update golf_games g set live_bot = true from gauntlets gt where gt.current_game = g.id and gt.status = 'playing' and gt.live_bot and g.status <> 'over' and not g.live_bot;
update duel_games g set live_bot = true from gauntlets gt where gt.current_game = g.id and gt.status = 'playing' and gt.live_bot and g.status <> 'over' and not g.live_bot;
