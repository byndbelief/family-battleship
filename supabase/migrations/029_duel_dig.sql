-- 029: Hilltop Duel digging.
--   ⛏️ Dig mode: the Move bar can dig instead of drive. Your tank keeps its level and ploughs
--      straight through any hill in the way, cutting the ground down to where it started. Same fuel.
--   🕳️ Foxhole (backpack): dig in where you stand. A pit drops your tank into the hill, and while
--      you stay in it blasts do 40% less to you (on top of a Shield). Drive out and it's just a hole.
-- Both are new kinds of terrain edit in duel_games.craters, beside [x, y, r] craters and
-- [x, y, r, 1] mounds. They're relative to the ground as it is at that point in the list, so the
-- server never needs to know how high the hills are and every page rebuilds the same ground:
--   [a, b, from, 2]    a cut: from x=a to x=b, the ground comes down to its height at x=from
--   [x, depth, r, 3]   a pit: within r of x, the ground comes down to depth below its height at x
-- duel_games.foxholes is { player id: the x they dug in at }; you're in it while your tank is there.
-- Applied with the Supabase connector (apply_migration '029_duel_dig'). Safe to run again.

alter table public.duel_games add column if not exists foxholes jsonb not null default '{}';
alter table public.loot drop constraint if exists loot_item_check;
alter table public.loot add constraint loot_item_check check (item in
  ('sonar', 'salvo', 'golden_tee', 'magnet', 'shield', 'bertha', 'scroll', 'cluster', 'homing', 'railgun', 'dirt',
   'xray', 'paint', 'trash', 'gift', 'foxhole'));

create or replace function public._item_label(item text) returns text
language sql immutable as $$
  select case item
    when 'sonar' then '⚓ Sonar Ping' when 'salvo' then '⚓ Double Salvo'
    when 'golden_tee' then '⛳ Golden Tee' when 'magnet' then '⛳ Magnet Cup'
    when 'shield' then '💥 Shield' when 'bertha' then '💥 Big Bertha'
    when 'cluster' then '🎆 Cluster Bomb' when 'homing' then '🚀 Homing Missile'
    when 'railgun' then '⚡ Railgun' when 'dirt' then '🪨 Dirt Bomb' when 'foxhole' then '🕳️ Foxhole'
    when 'xray' then '👀 X-Ray Specs' when 'paint' then '🎨 Paint Bomb'
    when 'trash' then '🗑️ Trash Chute' when 'gift' then '🎁 Gift Box'
    else '🌀 Curse Scroll' end
$$;

-- 024's drop table, with the Foxhole in the mix.
create or replace function public._chaos_drop(p_player uuid, p_kind text, p_game uuid, p_why text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r float8 := random();
  item text := case when p_kind = 'cards' then (array['xray', 'paint', 'trash', 'gift'])[1 + floor(random() * 4)::int]
                    when r < 0.08 then 'sonar' when r < 0.16 then 'salvo' when r < 0.24 then 'golden_tee'
                    when r < 0.32 then 'magnet' when r < 0.39 then 'shield' when r < 0.46 then 'bertha'
                    when r < 0.53 then 'cluster' when r < 0.60 then 'homing' when r < 0.67 then 'railgun'
                    when r < 0.73 then 'dirt' when r < 0.80 then 'foxhole' when r < 0.85 then 'xray' when r < 0.89 then 'paint'
                    when r < 0.92 then 'trash' when r < 0.96 then 'gift' else 'scroll' end;
begin
  if _is_bot(p_player) then return; end if;
  insert into loot (player, item, from_kind) values (p_player, item, p_kind);
  perform _chaos_event(p_player, null, 'loot', p_kind, p_game, '🎒', format('Loot! %s dropped %s into your backpack.', upper(left(p_why, 1)) || substr(p_why, 2), _item_label(item)));
end $$;

-- The cut a dig leaves, driving from x0 to x1 (null when the tank didn't move). It reaches 12 px
-- past where the tank stops, so the whole tank fits in the tunnel. The page makes the same one.
create or replace function public._duel_cut(x0 int, x1 int) returns jsonb
language sql immutable as $$
  select case when x1 is null or x0 is null or x1 = x0 then null
              when x1 > x0 then jsonb_build_array(x0, x1 + 12, x0, 2)
              else jsonb_build_array(x1 - 12, x0, x0, 2) end
$$;

-- 023's drive on your turn, now able to dig.
drop function if exists public._duel_move(uuid, uuid, int);
create or replace function public._duel_move(p_game uuid, who uuid, p_x int, p_dig boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare g duel_games; i int; z int[]; cut jsonb;
begin
  select * into g from duel_games where id = p_game for update;
  if not found or g.status <> 'playing' then raise exception 'This duel is over'; end if;
  if g.players[g.turn + 1] <> who then raise exception 'It''s not your turn'; end if;
  i := g.turn + 1; z := _duel_zone(cardinality(g.players), i);
  if p_x < z[1] or p_x > z[2] then raise exception 'Stay on your side of the hill'; end if;
  if abs(p_x - g.tank_x[i]) > 40 then raise exception 'Out of fuel: 40 per turn'; end if;
  cut := case when p_dig then _duel_cut(g.tank_x[i], p_x) end;
  update duel_games set tank_x[i] = p_x,
    craters = case when cut is null then craters else craters || jsonb_build_array(cut) end where id = p_game;
end $$;

-- 023's dodge / live drive; in a live battle it can dig too (off-turn dodges can't).
drop function if exists public.duel_dodge(uuid, int, int);
create or replace function public.duel_dodge(p_game uuid, p_move int, p_x int, p_dig boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g duel_games; i int; z int[]; cut jsonb;
begin
  select * into g from duel_games where id = p_game for update;
  if not found or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This duel is over'; end if;
  i := array_position(g.players, me); z := _duel_zone(cardinality(g.players), i);
  if g.hp[i] <= 0 then raise exception 'Your tank is out'; end if;
  if p_x < z[1] or p_x > z[2] then raise exception 'Stay on your side of the hill'; end if;
  if _duel_live(g) then
    cut := case when p_dig then _duel_cut(g.tank_x[i], p_x) end;
    update duel_games set tank_x[i] = p_x, turn_x[i] = p_x, updated_at = now(),
      craters = case when cut is null then craters else craters || jsonb_build_array(cut) end where id = p_game;
    return;
  end if;
  if g.move <> p_move then raise exception 'Too late: they already fired'; end if;
  if g.players[g.turn + 1] = me then raise exception 'It''s your turn: drive with Move'; end if;
  if abs(p_x - coalesce(g.turn_x[i], g.tank_x[i])) > 20 then raise exception 'Out of dodge fuel: 20 per turn'; end if;
  update duel_games set tank_x[i] = p_x, updated_at = now() where id = p_game;
end $$;

-- 023's shot, with p_dig: the drive that goes with it dug.
drop function if exists public.duel_fire(uuid, int, int, jsonb, int[], int, int, int[]);
create or replace function public.duel_fire(p_game uuid, p_angle int, p_power int, p_crater jsonb, p_hp int[], p_x int default null, p_target_x int default null, p_xs int[] default null, p_dig boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_x is not null then perform _duel_move(p_game, auth.uid(), p_x, coalesce(p_dig, false)); end if;
  perform set_config('duel.target_x', coalesce(p_target_x::text, ''), true);
  perform set_config('duel.xs', coalesce(p_xs::text, ''), true);
  perform _duel_fire(p_game, auth.uid(), p_angle, p_power, p_crater, p_hp);
  perform set_config('duel.target_x', '', true);
  perform set_config('duel.xs', '', true);
end $$;

-- 016's use_loot, plus the Foxhole: any time in a duel you're still standing in.
create or replace function public.use_loot(p_loot bigint, p_game uuid, p_target uuid, p_cell int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  l loot;
  g games; gg golf_games; dg duel_games;
  n int; area int[] := '{}'; spotted int[]; r int; c int; i int;
  res jsonb := '{}';
begin
  select * into l from loot where id = p_loot and player = me and used_at is null for update;
  if not found then raise exception 'That item isn''t in your backpack'; end if;

  if l.item in ('sonar', 'salvo') then
    select * into g from games where id = p_game for update;
    if not found or not (me = any (g.players)) or g.status <> 'playing' or g.players[g.turn + 1] <> me then raise exception 'Use it on your Battleship turn'; end if;
    if l.item = 'salvo' then
      insert into player_mods (game_id, player_id, shot_mod) values (p_game, me, 2)
        on conflict (game_id, player_id) do update set shot_mod = player_mods.shot_mod + 2;
    else
      if p_target = me or not (p_target = any (g.players)) or p_target = any (g.eliminated) then raise exception 'Ping an opponent who is still afloat'; end if;
      n := mode_n(g.mode);
      if p_cell is null or p_cell < 0 or p_cell >= n * n then raise exception 'Pick a square to ping'; end if;
      for dr in -1 .. 1 loop for dc in -1 .. 1 loop
        r := p_cell / n + dr; c := p_cell % n + dc;
        if r between 0 and n - 1 and c between 0 and n - 1 then area := area || (r * n + c); end if;
      end loop; end loop;
      select _fleet_cells(g.mode, fl.ships) into spotted from fleets fl where fl.game_id = p_game and fl.player_id = p_target;
      spotted := array(select x from unnest(area) x where x = any (spotted));
      res := jsonb_build_object('target', p_target, 'area', area, 'ships', spotted);
    end if;
    update loot set used_at = now(), used_kind = 'battleship', used_game = p_game, detail = res where id = p_loot;

  elsif l.item in ('golden_tee', 'magnet') then
    select * into gg from golf_games where id = p_game for update;
    if not found or not (me = any (gg.players)) or gg.status <> 'playing' or gg.players[gg.t % cardinality(gg.players) + 1] <> me then raise exception 'Use it on your own hole'; end if;
    res := jsonb_build_object('t', gg.t);
    update loot set used_at = now(), used_kind = 'golf', used_game = p_game, detail = res where id = p_loot;

  elsif l.item in ('shield', 'bertha', 'cluster', 'homing', 'railgun', 'dirt', 'foxhole') then
    select * into dg from duel_games where id = p_game for update;
    if not found or not (me = any (dg.players)) or dg.status <> 'playing' then raise exception 'Use it in a live duel'; end if;
    if l.item = 'shield' then
      update duel_games set shields = array_append(array_remove(shields, me), me), updated_at = now() where id = p_game;
    elsif l.item = 'foxhole' then
      i := array_position(dg.players, me);
      if dg.hp[i] <= 0 then raise exception 'Your tank is out'; end if;
      if (dg.foxholes ->> me::text)::int = dg.tank_x[i] then raise exception 'You''re already dug in right here'; end if;
      update duel_games set craters = craters || jsonb_build_array(jsonb_build_array(dg.tank_x[i], 16, 13, 3)),
        foxholes = foxholes || jsonb_build_object(me::text, dg.tank_x[i]), updated_at = now() where id = p_game;
      res := jsonb_build_object('x', dg.tank_x[i]);
    else
      if dg.players[dg.turn + 1] <> me and not _duel_live(dg) then raise exception 'Load it on your own turn'; end if;
      if me = any (dg.bertha) or dg.armed ? me::text then raise exception 'You already have a special shell loaded'; end if;
      if l.item = 'bertha' then
        update duel_games set bertha = array_append(bertha, me), updated_at = now() where id = p_game;
      else
        update duel_games set armed = armed || jsonb_build_object(me::text, l.item), updated_at = now() where id = p_game;
      end if;
    end if;
    update loot set used_at = now(), used_kind = 'duel', used_game = p_game, detail = res where id = p_loot;

  else   -- curse scroll: hex any other player, in a random live game of theirs
    if p_target is null or p_target = me or not exists (select 1 from profiles where id = p_target) then raise exception 'Pick someone to curse'; end if;
    if not _chaos_curse(me, p_target, null, 'curse scroll') then raise exception '%s isn''t in any live games to curse', _uname(p_target); end if;
    update loot set used_at = now(), used_kind = 'scroll' where id = p_loot;
  end if;
  return res;
end $$;

-- A shovel for everyone: one Foxhole each (once).
insert into loot (player, item, from_kind)
  select p.id, 'foxhole', 'foxcrate'
  from profiles p
  where not exists (select 1 from bots b where b.profile_id = p.id)
    and not exists (select 1 from loot l where l.player = p.id and l.from_kind = 'foxcrate');
insert into chaos_events (player, actor, kind, game_kind, icon, message)
  select p.id, null, 'loot', 'duel', '🕳️', 'New in Hilltop Duel: a 🕳️ Foxhole just landed in your backpack. Dig in and blasts do 40% less to you. And the Move bar can ⛏️ Dig now: plough straight through hills.'
  from profiles p
  where not exists (select 1 from bots b where b.profile_id = p.id)
    and not exists (select 1 from chaos_events e where e.player = p.id and e.icon = '🕳️' and e.message like 'New in Hilltop Duel: a 🕳️ Foxhole%');

revoke execute on function public._duel_cut(int, int), public._duel_move(uuid, uuid, int, boolean) from public, anon, authenticated;
revoke execute on function public.duel_fire(uuid, int, int, jsonb, int[], int, int, int[], boolean), public.duel_dodge(uuid, int, int, boolean) from public, anon;
grant execute on function public.duel_fire(uuid, int, int, jsonb, int[], int, int, int[], boolean), public.duel_dodge(uuid, int, int, boolean) to authenticated;
