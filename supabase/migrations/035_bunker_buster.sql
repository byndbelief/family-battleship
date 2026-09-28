-- 035: Terrain blocks shots in and out of tunnels, and the 🔻 Bunker Buster.
--   The blocking is all on the page (the shooter's page flies the shell and works out the damage,
--   as always): a hollow is air a shell can fly through, so a tank in a tunnel shoots out of its
--   mouth or into its own roof, and a blast with solid hill between it and a tank in a tunnel does
--   nothing to it.
--   🔻 Bunker Buster (loot): flies like a shell, bores up to 80 px down where it lands and goes off
--   at the end, or as soon as it breaks into a tunnel. It saves a shaft [x, y, r, 4]: dug from the
--   surface down through its blast. The server accepts that shape only from a loaded Bunker Buster.
--   Everyone gets one to try; it's in the loot drops.
-- Applied with the Supabase connector (apply_migration '035_bunker_buster'). Safe to run again.

alter table public.loot drop constraint if exists loot_item_check;
alter table public.loot add constraint loot_item_check check (item in
  ('sonar', 'salvo', 'golden_tee', 'magnet', 'shield', 'bertha', 'scroll', 'cluster', 'homing', 'railgun', 'dirt',
   'xray', 'paint', 'trash', 'gift', 'foxhole', 'buster'));

create or replace function public._item_label(item text) returns text
language sql immutable as $$
  select case item
    when 'sonar' then '⚓ Sonar Ping' when 'salvo' then '⚓ Double Salvo'
    when 'golden_tee' then '⛳ Golden Tee' when 'magnet' then '⛳ Magnet Cup'
    when 'shield' then '💥 Shield' when 'bertha' then '💥 Big Bertha'
    when 'cluster' then '🎆 Cluster Bomb' when 'homing' then '🚀 Homing Missile'
    when 'railgun' then '⚡ Railgun' when 'dirt' then '🪨 Dirt Bomb' when 'foxhole' then '🕳️ Foxhole' when 'buster' then '🔻 Bunker Buster'
    when 'xray' then '👀 X-Ray Specs' when 'paint' then '🎨 Paint Bomb'
    when 'trash' then '🗑️ Trash Chute' when 'gift' then '🎁 Gift Box'
    else '🌀 Curse Scroll' end
$$;

-- 029's drop table, with the Bunker Buster.
create or replace function public._chaos_drop(p_player uuid, p_kind text, p_game uuid, p_why text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r float8 := random();
  item text := case when p_kind = 'cards' then (array['xray', 'paint', 'trash', 'gift'])[1 + floor(random() * 4)::int]
                    when r < 0.08 then 'sonar' when r < 0.16 then 'salvo' when r < 0.24 then 'golden_tee'
                    when r < 0.32 then 'magnet' when r < 0.39 then 'shield' when r < 0.46 then 'bertha'
                    when r < 0.53 then 'cluster' when r < 0.60 then 'homing' when r < 0.67 then 'railgun'
                    when r < 0.72 then 'dirt' when r < 0.77 then 'foxhole' when r < 0.82 then 'buster' when r < 0.86 then 'xray' when r < 0.89 then 'paint'
                    when r < 0.92 then 'trash' when r < 0.96 then 'gift' else 'scroll' end;
begin
  if _is_bot(p_player) then return; end if;
  insert into loot (player, item, from_kind) values (p_player, item, p_kind);
  perform _chaos_event(p_player, null, 'loot', p_kind, p_game, '🎒', format('Loot! %s dropped %s into your backpack.', upper(left(p_why, 1)) || substr(p_why, 2), _item_label(item)));
end $$;

-- 023's shot check and 029's use_loot, patched in place: a Bunker Buster's shaft (r up to 26,
-- 4th element 4) is accepted when one is loaded, and it loads like the other special shells.
do $$
declare d text;
begin
  d := pg_get_functiondef('public._duel_fire(uuid,uuid,integer,integer,jsonb,integer[])'::regprocedure);
  if position('''buster''' in d) = 0 then
    d := replace(d, 'when ''dirt'' then 34', 'when ''dirt'' then 34 when ''buster'' then 26');
    d := replace(d, 'if (jsonb_array_length(c) = 4) <> (wpn is not distinct from ''dirt'') or (jsonb_array_length(c) = 4 and (c ->> 3)::int <> 1) then',
                    'if (jsonb_array_length(c) = 4) <> coalesce(wpn in (''dirt'', ''buster''), false) or (jsonb_array_length(c) = 4 and (c ->> 3)::int <> (case wpn when ''buster'' then 4 else 1 end)) then');
    execute d;
  end if;
  -- (A first draft of this patch left "no special shell" as NULL there, which let a plain shell
  -- save a mound; mend it if it's in.)
  d := pg_get_functiondef('public._duel_fire(uuid,uuid,integer,integer,jsonb,integer[])'::regprocedure);
  if position('<> (wpn in (''dirt'', ''buster''))' in d) > 0 then
    execute replace(d, '<> (wpn in (''dirt'', ''buster''))', '<> coalesce(wpn in (''dirt'', ''buster''), false)');
  end if;
  d := pg_get_functiondef('public.use_loot(bigint,uuid,uuid,integer)'::regprocedure);
  if position('''buster''' in d) = 0 then
    execute replace(d, '''dirt'', ''foxhole'')', '''dirt'', ''foxhole'', ''buster'')');
  end if;
end $$;

-- One to try, for everyone (once).
insert into loot (player, item, from_kind)
  select p.id, 'buster', 'bustercrate'
  from profiles p
  where not exists (select 1 from bots b where b.profile_id = p.id)
    and not exists (select 1 from loot l where l.player = p.id and l.from_kind = 'bustercrate');
insert into chaos_events (player, actor, kind, game_kind, icon, message)
  select p.id, null, 'loot', 'duel', '🔻', 'New in Hilltop Duel: a 🔻 Bunker Buster. It drills down where it lands and goes off underground: the answer to someone hiding in a tunnel. Hills now block blasts, so a tank dug in under one is safe from everything else.'
  from profiles p
  where not exists (select 1 from bots b where b.profile_id = p.id)
    and not exists (select 1 from chaos_events e where e.player = p.id and e.icon = '🔻' and e.message like 'New in Hilltop Duel: a 🔻 Bunker Buster%');
