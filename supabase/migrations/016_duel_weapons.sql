-- 016: new Hilltop Duel weapons.
-- Applied with the Supabase connector (apply_migration '016_duel_weapons'). Safe to run again.
--
-- Four special shells join Big Bertha as loot. Load one from your backpack (on your turn, or any
-- time in a live battle) and your next shot fires it:
--   🎆 cluster  bursts at the top of its arc into three bomblets (up to 3 craters, r 18)
--   🚀 homing   steers toward the enemy tank on the way down (crater r 22)
--   ⚡ railgun  a straight beam through hills; a direct hit only (crater r 12)
--   🪨 dirt     piles up a hill where it lands instead of a hole (mound [x, y, r, 1], r 34)
-- The page flies them (duel-engine.js); the server checks the craters fit the weapon, records the
-- weapon on the shot (duel_shots.weapon) so every device replays it, and unloads it.
-- One special shell at a time (Big Bertha included). Everyone gets a starter crate of all four.

alter table public.loot drop constraint if exists loot_item_check;
alter table public.loot add constraint loot_item_check check (item in
  ('sonar', 'salvo', 'golden_tee', 'magnet', 'shield', 'bertha', 'scroll', 'cluster', 'homing', 'railgun', 'dirt'));
alter table public.duel_games add column if not exists armed jsonb not null default '{}';   -- player id -> weapon loaded
alter table public.duel_shots add column if not exists weapon text;

create or replace function public._item_label(item text) returns text
language sql immutable as $$
  select case item
    when 'sonar' then '⚓ Sonar Ping' when 'salvo' then '⚓ Double Salvo'
    when 'golden_tee' then '⛳ Golden Tee' when 'magnet' then '⛳ Magnet Cup'
    when 'shield' then '💥 Shield' when 'bertha' then '💥 Big Bertha'
    when 'cluster' then '🎆 Cluster Bomb' when 'homing' then '🚀 Homing Missile'
    when 'railgun' then '⚡ Railgun' when 'dirt' then '🪨 Dirt Bomb'
    else '🌀 Curse Scroll' end
$$;

-- Drops a random item into a backpack (robots don't collect loot). About a third are duel weapons now.
create or replace function public._chaos_drop(p_player uuid, p_kind text, p_game uuid, p_why text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r float8 := random();
  item text := case when r < 0.10 then 'sonar' when r < 0.20 then 'salvo' when r < 0.30 then 'golden_tee'
                    when r < 0.40 then 'magnet' when r < 0.50 then 'shield' when r < 0.59 then 'bertha'
                    when r < 0.67 then 'cluster' when r < 0.75 then 'homing' when r < 0.83 then 'railgun'
                    when r < 0.91 then 'dirt' else 'scroll' end;
begin
  if _is_bot(p_player) then return; end if;
  insert into loot (player, item, from_kind) values (p_player, item, p_kind);
  perform _chaos_event(p_player, null, 'loot', p_kind, p_game, '🎒', format('Loot! %s dropped %s into your backpack.', upper(left(p_why, 1)) || substr(p_why, 2), _item_label(item)));
end $$;

-- 005's use_loot, plus loading the new shells, and loading Bertha any time in a live battle.
create or replace function public.use_loot(p_loot bigint, p_game uuid, p_target uuid, p_cell int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  l loot;
  g games; gg golf_games; dg duel_games;
  n int; area int[] := '{}'; spotted int[]; r int; c int;
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

  elsif l.item in ('shield', 'bertha', 'cluster', 'homing', 'railgun', 'dirt') then
    select * into dg from duel_games where id = p_game for update;
    if not found or not (me = any (dg.players)) or dg.status <> 'playing' then raise exception 'Use it in a live duel'; end if;
    if l.item = 'shield' then
      update duel_games set shields = array_append(array_remove(shields, me), me), updated_at = now() where id = p_game;
    else
      if dg.players[dg.turn + 1] <> me and not _duel_live(dg) then raise exception 'Load it on your own turn'; end if;
      if me = any (dg.bertha) or dg.armed ? me::text then raise exception 'You already have a special shell loaded'; end if;
      if l.item = 'bertha' then
        update duel_games set bertha = array_append(bertha, me), updated_at = now() where id = p_game;
      else
        update duel_games set armed = armed || jsonb_build_object(me::text, l.item), updated_at = now() where id = p_game;
      end if;
    end if;
    update loot set used_at = now(), used_kind = 'duel', used_game = p_game where id = p_loot;

  else   -- curse scroll: hex any other player, in a random live game of theirs
    if p_target is null or p_target = me or not exists (select 1 from profiles where id = p_target) then raise exception 'Pick someone to curse'; end if;
    if not _chaos_curse(me, p_target, null, 'curse scroll') then raise exception '%s isn''t in any live games to curse', _uname(p_target); end if;
    update loot set used_at = now(), used_kind = 'scroll' where id = p_loot;
  end if;
  return res;
end $$;

-- 005's shot, now firing whatever special shell is loaded. p_crater is one crater [x, y, r],
-- a list of them (cluster bomb), a mound [x, y, r, 1] (dirt bomb), or null (flew off the map).
create or replace function public._duel_fire(p_game uuid, who uuid, p_angle int, p_power int, p_crater jsonb, p_hp int[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  g duel_games;
  foe int; dmg int;
  wpn text; add_c jsonb; c jsonb; maxr int;
begin
  select * into g from duel_games where id = p_game for update;
  if not found then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This duel is over'; end if;
  if g.players[g.turn + 1] <> who then raise exception 'It''s not your turn'; end if;
  if p_angle not between 5 and 85 or p_power not between 20 and 100 then raise exception 'Bad shot'; end if;
  if p_hp is null or cardinality(p_hp) <> 2 or p_hp[1] not between 0 and g.hp[1] or p_hp[2] not between 0 and g.hp[2] then
    raise exception 'Bad damage';
  end if;
  wpn := g.armed ->> who::text;
  if p_crater is null then add_c := '[]';
  elsif jsonb_typeof(p_crater) <> 'array' or jsonb_array_length(p_crater) = 0 then raise exception 'Bad crater';
  elsif jsonb_typeof(p_crater -> 0) = 'array' then add_c := p_crater;
  else add_c := jsonb_build_array(p_crater);
  end if;
  if jsonb_array_length(add_c) > (case when wpn = 'cluster' then 3 else 1 end) then raise exception 'Bad crater'; end if;
  maxr := case wpn when 'cluster' then 18 when 'homing' then 22 when 'railgun' then 12 when 'dirt' then 34
                   else (case when who = any (g.bertha) then 44 else 28 end) end;
  for c in select value from jsonb_array_elements(add_c) loop
    if jsonb_typeof(c) <> 'array' or jsonb_array_length(c) not in (3, 4) or (c ->> 2)::int not between 1 and maxr then raise exception 'Bad crater'; end if;
    if (jsonb_array_length(c) = 4) <> (wpn is not distinct from 'dirt') or (jsonb_array_length(c) = 4 and (c ->> 3)::int <> 1) then raise exception 'Bad crater'; end if;
  end loop;
  foe := case when g.players[1] = who then 2 else 1 end;
  dmg := g.hp[foe] - p_hp[foe];
  g.move := g.move + 1;
  insert into duel_shots (game_id, move, shooter, angle, power, crater, hp_after, wind_x, weapon)
    values (p_game, g.move, who, p_angle, p_power, p_crater, p_hp, case when g.gust = g.move - 1 then 3 else 1 end, wpn);
  update duel_games set
    move = g.move, hp = p_hp, turn = 1 - g.turn,
    craters = craters || add_c,
    status = case when p_hp[1] = 0 or p_hp[2] = 0 then 'over' else 'playing' end,
    winner = case when p_hp[1] = 0 and p_hp[2] > 0 then g.players[2]
                  when p_hp[2] = 0 and p_hp[1] > 0 then g.players[1]
                  when p_hp[1] = 0 and p_hp[2] = 0 then who end,
    bertha = array_remove(bertha, who), shields = array_remove(shields, g.players[foe]),
    armed = armed - who::text,
    gust = case when gust = g.move - 1 then -1 else gust end,
    updated_at = now()
  where id = p_game;
  perform _chaos_after_move('duel', p_game, who, array[g.players[foe]],
    case when p_hp[foe] = 0 then 1.0 when dmg >= 20 then 0.5 when dmg > 0 then 0.2 else 0 end,
    case when p_hp[foe] = 0 then 0.7 when dmg >= 30 then 0.4 else 0 end,
    case when p_hp[foe] = 0 then 'knockout shot' else 'direct hit' end);
end $$;

-- A starter crate: one of each new shell for every player (once).
insert into loot (player, item, from_kind)
  select p.id, w.item, 'crate'
  from profiles p cross join (values ('cluster'), ('homing'), ('railgun'), ('dirt')) w(item)
  where not exists (select 1 from bots b where b.profile_id = p.id)
    and not exists (select 1 from loot l where l.player = p.id and l.from_kind = 'crate');
insert into chaos_events (player, actor, kind, game_kind, icon, message)
  select p.id, null, 'loot', 'duel', '📦', 'Weapons crate! A 🎆 Cluster Bomb, 🚀 Homing Missile, ⚡ Railgun and 🪨 Dirt Bomb just landed in your backpack for Hilltop Duel.'
  from profiles p
  where not exists (select 1 from bots b where b.profile_id = p.id)
    and not exists (select 1 from chaos_events e where e.player = p.id and e.icon = '📦' and e.message like 'Weapons crate!%');
