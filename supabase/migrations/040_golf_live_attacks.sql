-- 040: Sneak attacks in a live Putt Post race land right away.
--   In a live race you can plant an attack any time, mid-hole too (one per hole, as before), and it
--   hits the target's hole the moment their page sees it (golf_games.updated_at is touched so every
--   page refreshes), from their next putt on. Their saved hole records which putt it started on
--   (golf_turns.attack_from) so the replay switches the hole there. A page that finishes its hole
--   without having seen the attack says so (p_attack_from = -1) and the attack waits for the next
--   hole, as it always did. Robots racing live get hit the same way (golf_bot_live_attack).
-- Applied with the Supabase connector (apply_migration '040_golf_live_attacks'). Safe to run again.

alter table public.golf_turns add column if not exists attack_from smallint not null default 0;

-- 015's golf_plant: live, any time (one per hole row, keyed to your slot on the hole everyone's on).
create or replace function public.golf_plant(p_game uuid, p_target uuid, p_type integer) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  g golf_games; n int; mine int; live boolean;
begin
  select * into g from golf_games where id = p_game for update;
  if not found or me is null or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This round is over'; end if;
  n := cardinality(g.players);
  live := _golf_live(g);
  if live then
    mine := (g.t / n) * n + array_position(g.players, me) - 1;
  else
    select max(t) into mine from golf_turns where game_id = p_game and player = me;
    if mine is null or mine <> g.t - 1 then raise exception 'Plant an attack right after your own hole'; end if;
  end if;
  if exists (select 1 from golf_attacks where game_id = p_game and attacker = me and planted_t = mine) then
    raise exception 'One attack per hole';
  end if;
  if p_type not between 1 and 5 or p_target = me or not (p_target = any (g.players)) then raise exception 'Pick another player and an attack'; end if;
  if exists (select 1 from golf_attacks where game_id = p_game and target = p_target and used_t is null) then
    raise exception 'They already have one waiting';
  end if;
  update golf_players set tokens = tokens - 1 where game_id = p_game and player = me and tokens > 0;
  if not found then raise exception 'No sneak attacks left. Birdie or better earns one'; end if;
  insert into golf_attacks (game_id, attacker, target, type, planted_t) values (p_game, me, p_target, p_type, mine);
  if live then update golf_games set updated_at = now() where id = p_game; end if;   -- every page looks again: the target's gets hit now
end $$;

-- _golf_submit takes the waiting attack for the hole being saved, unless the page says it never saw one.
do $$
declare d text;
begin
  d := pg_get_functiondef('public._golf_submit(uuid,uuid,jsonb,integer,integer,boolean)'::regprocedure);
  if position('golf.no_attack' in d) = 0 then
    execute replace(d, 'where game_id = p_game and target = who and used_t is null order by id limit 1;',
                       'where game_id = p_game and target = who and used_t is null and coalesce(current_setting(''golf.no_attack'', true), '''') <> ''1'' order by id limit 1;');
  end if;
end $$;

-- 015's live save, with where the attack started (-1: none seen, it waits for the next hole).
drop function if exists public.golf_submit_live(uuid, jsonb, int, int, boolean);
create or replace function public.golf_submit_live(p_game uuid, p_strokes jsonb, p_actual int, p_cheats int, p_holed boolean, p_attack_from int default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g golf_games; r jsonb;
begin
  select * into g from golf_games where id = p_game for update;
  if not found or auth.uid() is null or not (auth.uid() = any (g.players)) then raise exception 'Game not found'; end if;
  if not _golf_live(g) then raise exception 'The live race is over: back to taking turns'; end if;
  perform set_config('golf.live', '1', true);
  perform set_config('golf.no_attack', case when p_attack_from < 0 then '1' else '' end, true);
  r := _golf_submit(p_game, auth.uid(), p_strokes, p_actual, p_cheats, p_holed);
  perform set_config('golf.live', '', true); perform set_config('golf.no_attack', '', true);
  update golf_turns set attack_from = least(greatest(p_attack_from, 0), 16)
    where id = (select max(id) from golf_turns where game_id = p_game and player = auth.uid()) and attack <> 0;
  return r;
end $$;

-- 033's live robot hole, the same way.
drop function if exists public.golf_submit_live_bot(uuid, jsonb, int, boolean, uuid);
create or replace function public.golf_submit_live_bot(p_game uuid, p_strokes jsonb, p_actual int, p_holed boolean, p_bot uuid default null, p_attack_from int default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g golf_games; bot uuid; r jsonb;
begin
  select * into g from golf_games where id = p_game for update;
  if not found or auth.uid() is null or not (auth.uid() = any (g.players)) then raise exception 'Game not found'; end if;
  if not _golf_live(g) then raise exception 'The live race is over: back to taking turns'; end if;
  bot := _game_bot(g.players, p_bot);
  if bot is null then raise exception 'There''s no such robot in this game'; end if;
  perform set_config('golf.live', '1', true);
  perform set_config('golf.no_attack', case when p_attack_from < 0 then '1' else '' end, true);
  r := _golf_submit(p_game, bot, p_strokes, p_actual, 0, p_holed);
  perform set_config('golf.live', '', true); perform set_config('golf.no_attack', '', true);
  update golf_turns set attack_from = least(greatest(p_attack_from, 0), 16)
    where id = (select max(id) from golf_turns where game_id = p_game and player = bot) and attack <> 0;
  return r;
end $$;

-- A robot's waiting attack in a live race (the page playing the robot asks before each putt).
create or replace function public.golf_bot_live_attack(p_game uuid, p_bot uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g golf_games; a golf_attacks;
begin
  select * into g from golf_games where id = p_game;
  if not found or g.status <> 'playing' or not (auth.uid() = any (g.players)) or not _golf_live(g)
     or not (p_bot = any (g.players)) or not exists (select 1 from bots where profile_id = p_bot) then return null; end if;
  select * into a from golf_attacks where game_id = p_game and target = p_bot and used_t is null order by id limit 1;
  if not found then return null; end if;
  return jsonb_build_object('type', a.type, 'attacker', a.attacker);
end $$;

revoke execute on function public.golf_submit_live(uuid, jsonb, int, int, boolean, int),
  public.golf_submit_live_bot(uuid, jsonb, int, boolean, uuid, int), public.golf_bot_live_attack(uuid, uuid) from public, anon;
grant execute on function public.golf_submit_live(uuid, jsonb, int, int, boolean, int),
  public.golf_submit_live_bot(uuid, jsonb, int, boolean, uuid, int), public.golf_bot_live_attack(uuid, uuid) to authenticated;
