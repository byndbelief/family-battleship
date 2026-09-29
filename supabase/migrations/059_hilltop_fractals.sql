-- 059: Hilltop fractals.
--   ❄️ Fractal Shell (loot): at the top of its arc it forks in two, and each branch forks again every
--      24 ticks, three times: up to 8 bomblets, craters [x, y, 11] (simulateWeapon in duel-engine.js),
--      22 - distance damage each, 60 a tank at most, like every shell. Everyone gets one to try.
--   Fractal hills: duel_games.terrain 1 builds the ground by midpoint displacement (fractalLine) on two
--      slow swells, and quake mountains get crag-lines; new games only (games made before keep 0).
-- Applied with the Supabase connector (apply_migration '059_hilltop_fractals'). Safe to run again.

alter table public.duel_games add column if not exists terrain smallint not null default 0;
alter table public.duel_games alter column terrain set default 1;

alter table public.loot drop constraint if exists loot_item_check;
alter table public.loot add constraint loot_item_check check (item in
  ('sonar', 'salvo', 'golden_tee', 'magnet', 'shield', 'bertha', 'scroll', 'cluster', 'homing', 'railgun', 'dirt',
   'xray', 'paint', 'trash', 'gift', 'foxhole', 'buster', 'drone', 'atk_ice', 'atk_wind', 'atk_cup', 'atk_bumpers',
   'atk_butter', 'chip', 'fractal'));

do $$
declare d text;
begin
  d := pg_get_functiondef('public._item_label(text)'::regprocedure);
  if position('fractal' in d) = 0 then
    if position('when ''drone'' then ''🚁 Drone Strike''' in d) = 0 then raise exception '059: _item_label is not the shape this patch expects'; end if;
    execute replace(d, 'when ''drone'' then ''🚁 Drone Strike''', 'when ''drone'' then ''🚁 Drone Strike'' when ''fractal'' then ''❄️ Fractal Shell''');
  end if;
  d := pg_get_functiondef('public._chaos_drop(uuid,text,uuid,text)'::regprocedure);
  if position('fractal' in d) = 0 then
    if position('''buster'', ''drone'']' in d) = 0 then raise exception '059: _chaos_drop is not the shape this patch expects'; end if;
    execute replace(d, '''buster'', ''drone'']', '''buster'', ''drone'', ''fractal'']');
  end if;
  d := pg_get_functiondef('public._duel_fire(uuid,uuid,integer,integer,jsonb,integer[])'::regprocedure);
  if position('fractal' in d) = 0 then
    if position('case when wpn = ''cluster'' then 3 else 1 end' in d) = 0 or position('when ''drone'' then 26' in d) = 0 then raise exception '059: _duel_fire is not the shape this patch expects'; end if;
    d := replace(d, 'case when wpn = ''cluster'' then 3 else 1 end', 'case when wpn = ''cluster'' then 3 when wpn = ''fractal'' then 8 else 1 end');
    d := replace(d, 'when ''drone'' then 26', 'when ''drone'' then 26 when ''fractal'' then 11');
    execute d;
  end if;
  d := pg_get_functiondef('public.use_loot(bigint,uuid,uuid,integer)'::regprocedure);
  if position('fractal' in d) = 0 then
    if position('''foxhole'', ''buster'', ''drone'')' in d) = 0 then raise exception '059: use_loot is not the shape this patch expects'; end if;
    execute replace(d, '''foxhole'', ''buster'', ''drone'')', '''foxhole'', ''buster'', ''drone'', ''fractal'')');
  end if;
end $$;

-- One to try, for everyone (once).
insert into loot (player, item, from_kind)
  select p.id, 'fractal', 'fractalcrate'
  from profiles p
  where not exists (select 1 from bots b where b.profile_id = p.id)
    and not exists (select 1 from loot l where l.player = p.id and l.from_kind = 'fractalcrate');
insert into chaos_events (player, actor, kind, game_kind, icon, message)
  select p.id, null, 'loot', 'duel', '❄️', 'New in Hilltop: a ❄️ Fractal Shell. At the top of its arc it forks in two, then every branch forks again, three times over: 8 bomblets spraying out like a tree. New duels are fought on fractal hills, rugged at every scale.'
  from profiles p
  where not exists (select 1 from bots b where b.profile_id = p.id)
    and not exists (select 1 from chaos_events e where e.player = p.id and e.icon = '❄️' and e.message like 'New in Hilltop: a ❄️ Fractal Shell%');
