-- 038: 🚁 Drone Strike for Hilltop Duel (loot).
--   Load it and, instead of an angle and a power, pick a spot along the map: a drone flies in from
--   your side and drops a bomb straight down there (the wind drifts it). All on the page, as with
--   every shell: the spot is saved as the shot's angle and power (droneAim/droneX in
--   duel-engine.js), so shots, replays and the live channel need nothing new. Its crater is a plain
--   [x, y, 26]. Everyone gets one to try; it's in the loot drops.
-- Applied with the Supabase connector (apply_migration '038_drone_strike'). Safe to run again.

alter table public.loot drop constraint if exists loot_item_check;
alter table public.loot add constraint loot_item_check check (item in
  ('sonar', 'salvo', 'golden_tee', 'magnet', 'shield', 'bertha', 'scroll', 'cluster', 'homing', 'railgun', 'dirt',
   'xray', 'paint', 'trash', 'gift', 'foxhole', 'buster', 'drone'));

create or replace function public._item_label(item text) returns text
language sql immutable as $$
  select case item
    when 'sonar' then '⚓ Sonar Ping' when 'salvo' then '⚓ Double Salvo'
    when 'golden_tee' then '⛳ Golden Tee' when 'magnet' then '⛳ Magnet Cup'
    when 'shield' then '💥 Shield' when 'bertha' then '💥 Big Bertha'
    when 'cluster' then '🎆 Cluster Bomb' when 'homing' then '🚀 Homing Missile'
    when 'railgun' then '⚡ Railgun' when 'dirt' then '🪨 Dirt Bomb' when 'foxhole' then '🕳️ Foxhole' when 'buster' then '🔻 Bunker Buster'
    when 'drone' then '🚁 Drone Strike'
    when 'xray' then '👀 X-Ray Specs' when 'paint' then '🎨 Paint Bomb'
    when 'trash' then '🗑️ Trash Chute' when 'gift' then '🎁 Gift Box'
    else '🌀 Curse Scroll' end
$$;

-- 035's drop table, with the Drone Strike (taken from the tail: X-Ray to the Curse Scroll).
create or replace function public._chaos_drop(p_player uuid, p_kind text, p_game uuid, p_why text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r float8 := random();
  item text := case when p_kind = 'cards' then (array['xray', 'paint', 'trash', 'gift'])[1 + floor(random() * 4)::int]
                    when r < 0.08 then 'sonar' when r < 0.16 then 'salvo' when r < 0.24 then 'golden_tee'
                    when r < 0.32 then 'magnet' when r < 0.39 then 'shield' when r < 0.46 then 'bertha'
                    when r < 0.53 then 'cluster' when r < 0.60 then 'homing' when r < 0.67 then 'railgun'
                    when r < 0.72 then 'dirt' when r < 0.77 then 'foxhole' when r < 0.82 then 'buster' when r < 0.86 then 'drone'
                    when r < 0.89 then 'xray' when r < 0.91 then 'paint'
                    when r < 0.94 then 'trash' when r < 0.97 then 'gift' else 'scroll' end;
begin
  if _is_bot(p_player) then return; end if;
  insert into loot (player, item, from_kind) values (p_player, item, p_kind);
  perform _chaos_event(p_player, null, 'loot', p_kind, p_game, '🎒', format('Loot! %s dropped %s into your backpack.', upper(left(p_why, 1)) || substr(p_why, 2), _item_label(item)));
end $$;

-- 035's shot check and use_loot, patched in place: a drone's crater is at most 26 across, and it
-- loads like the other special shells.
do $$
declare d text;
begin
  d := pg_get_functiondef('public._duel_fire(uuid,uuid,integer,integer,jsonb,integer[])'::regprocedure);
  if position('''drone''' in d) = 0 then
    execute replace(d, 'when ''buster'' then 26', 'when ''buster'' then 26 when ''drone'' then 26');
  end if;
  d := pg_get_functiondef('public.use_loot(bigint,uuid,uuid,integer)'::regprocedure);
  if position('''drone''' in d) = 0 then
    execute replace(d, '''foxhole'', ''buster'')', '''foxhole'', ''buster'', ''drone'')');
  end if;
end $$;

-- One to try, for everyone (once).
insert into loot (player, item, from_kind)
  select p.id, 'drone', 'dronecrate'
  from profiles p
  where not exists (select 1 from bots b where b.profile_id = p.id)
    and not exists (select 1 from loot l where l.player = p.id and l.from_kind = 'dronecrate');
insert into chaos_events (player, actor, kind, game_kind, icon, message)
  select p.id, null, 'loot', 'duel', '🚁', 'New in Hilltop Duel: a 🚁 Drone Strike. Load it, tap a spot on the battlefield, and a drone flies over and drops a bomb straight down on it. The wind still drifts the bomb.'
  from profiles p
  where not exists (select 1 from bots b where b.profile_id = p.id)
    and not exists (select 1 from chaos_events e where e.player = p.id and e.icon = '🚁' and e.message like 'New in Hilltop Duel: a 🚁 Drone Strike%');
