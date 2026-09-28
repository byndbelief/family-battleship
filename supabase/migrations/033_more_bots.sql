-- 033: More robots. bot1-bot4 (made by hand in Supabase Auth) join admiral_bot as robot players,
-- and a game can now hold several robots at once.
--   Turns already worked for any robot whose turn it is. The live modes picked "the" robot (the
--   first one), so a second robot sat idle, and in a live Putt Post race the rest would wait on
--   it forever. Now:
--   * Battleship: fire_live_bot fires for every robot still afloat whose guns have reloaded.
--   * Hilltop and Putt Post: the page plays each robot, and the save says which (p_bot).
-- Applied with the Supabase connector (apply_migration '033_more_bots'). Safe to run again.

insert into public.bots (profile_id)
  select id from public.profiles where username in ('bot1', 'bot2', 'bot3', 'bot4')
  on conflict do nothing;

-- A robot of this game (the one asked for, or else the first).
create or replace function public._game_bot(p_players uuid[], p_bot uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select p from unnest(p_players) with ordinality u(p, k)
  where exists (select 1 from bots where profile_id = p) and (p_bot is null or p = p_bot)
  order by k limit 1
$$;

-- 023's live robot duel shot, for a named robot.
drop function if exists public.duel_fire_live_bot(uuid, int, int, jsonb, int[], int, int, int, int, int[]);
create or replace function public.duel_fire_live_bot(p_game uuid, p_angle int, p_power int, p_crater jsonb, p_dmg int[], p_x int, p_target_x int, p_wind_move int, p_wind_x int default 1, p_xs int[] default null, p_bot uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g duel_games; bot uuid; orig text;
begin
  select * into g from duel_games where id = p_game;
  if not found or me is null or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  bot := _game_bot(g.players, p_bot);
  if bot is null then raise exception 'There''s no such robot in this duel'; end if;
  orig := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claim.sub', bot::text, true);
  perform duel_fire_live(p_game, p_angle, p_power, p_crater, p_dmg, p_x, p_target_x, p_wind_move, p_wind_x, p_xs);
  perform set_config('request.jwt.claim.sub', coalesce(orig, ''), true);
end $$;

-- 017's live robot hole in Putt Post, for a named robot.
drop function if exists public.golf_submit_live_bot(uuid, jsonb, int, boolean);
create or replace function public.golf_submit_live_bot(p_game uuid, p_strokes jsonb, p_actual int, p_holed boolean, p_bot uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g golf_games; bot uuid; r jsonb;
begin
  select * into g from golf_games where id = p_game for update;
  if not found or auth.uid() is null or not (auth.uid() = any (g.players)) then raise exception 'Game not found'; end if;
  if not _golf_live(g) then raise exception 'The live race is over: back to taking turns'; end if;
  bot := _game_bot(g.players, p_bot);
  if bot is null then raise exception 'There''s no such robot in this game'; end if;
  perform set_config('golf.live', '1', true);
  r := _golf_submit(p_game, bot, p_strokes, p_actual, 0, p_holed);
  perform set_config('golf.live', '', true);
  return r;
end $$;

-- 028's live robot Battleship shot, now for every robot afloat whose guns have reloaded.
create or replace function public.fire_live_bot(p_game uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g games; bot uuid; tgt uuid; cell int; orig text; r jsonb; out jsonb;
begin
  select * into g from games where id = p_game for update;
  if not found or me is null or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if not _bs_live(g) then return null; end if;
  orig := current_setting('request.jwt.claim.sub', true);
  for bot in select p from unnest(g.players) p
             where exists (select 1 from bots where profile_id = p)
               and not exists (select 1 from shots where game_id = p_game and shooter = p and created_at > now() - interval '1.2 seconds')
  loop
  select * into g from games where id = p_game;
  exit when g.status <> 'playing' or not _bs_live(g);
  continue when bot = any (g.eliminated);
  if g.mode = 2 then
    cell := (_bot_pick_shared(p_game, bot, 1))[1];
    continue when cell is null;
    begin   -- one robot's failed shot (a square just taken) doesn't undo the others'
      perform set_config('request.jwt.claim.sub', bot::text, true);
      r := fire_live(p_game, null, cell);
      out := r || jsonb_build_object('cell', cell);
    exception when others then null;
    end;
    perform set_config('request.jwt.claim.sub', coalesce(orig, ''), true);
    continue;
  end if;
  -- Whoever it has wounded most, otherwise anyone still afloat.
  select t into tgt from unnest(g.players) t
    where t <> bot and not (t = any (g.eliminated))
    order by (select count(*) from shots s where s.game_id = p_game and s.target = t and s.hit
                and not exists (select 1 from shots s2 where s2.game_id = p_game and s2.target = t and s.cell = any (s2.sunk_cells))) desc, random()
    limit 1;
  continue when tgt is null;
  cell := (_bot_pick(p_game, bot, tgt, 1, g.mode))[1];
  continue when cell is null;
  begin
    perform set_config('request.jwt.claim.sub', bot::text, true);
    r := fire_live(p_game, tgt, cell);
    out := r || jsonb_build_object('target', tgt, 'cell', cell);
  exception when others then null;
  end;
  perform set_config('request.jwt.claim.sub', coalesce(orig, ''), true);
  end loop;
  return out;   -- the last shot fired (null if every robot was still reloading)
end $$;

revoke execute on function public._game_bot(uuid[], uuid) from public, anon, authenticated;
revoke execute on function public.duel_fire_live_bot(uuid, int, int, jsonb, int[], int, int, int, int, int[], uuid),
  public.golf_submit_live_bot(uuid, jsonb, int, boolean, uuid) from public, anon;
grant execute on function public.duel_fire_live_bot(uuid, int, int, jsonb, int[], int, int, int, int, int[], uuid),
  public.golf_submit_live_bot(uuid, jsonb, int, boolean, uuid) to authenticated;

-- A fix found on the way: fire() and _golf_submit() read "is this a live shot?" as
-- nullif(current_setting(...), '') = '1', which is NULL, not false, on a database connection that
-- never ran a live shot. "if not live" then skipped the robot's turn in Battleship (so a game could
-- sit on the robot's turn) and a turn-order check in Putt Post. Patched in place: unset means false.
do $$
declare f text; d text; setting text;
begin
  foreach f in array array['public.fire(uuid,uuid,integer[])', 'public._golf_submit(uuid,uuid,jsonb,integer,integer,boolean)'] loop
    d := pg_get_functiondef(f::regprocedure);
    setting := case when f like 'public.fire%' then 'bs.live' else 'golf.live' end;
    if position('coalesce(nullif(current_setting(''' || setting in d) = 0 then
      execute replace(d, 'nullif(current_setting(''' || setting || ''', true), '''') = ''1''',
                         'coalesce(nullif(current_setting(''' || setting || ''', true), '''') = ''1'', false)');
    end if;
  end loop;
end $$;
