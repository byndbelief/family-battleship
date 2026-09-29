-- 043: More chaos in Putt Post, and the ⛳ Chip Shot.
--   Twists (1 in 6 moves, from 042) now also:
--   🚩 move the cup on the next hole to be played, anywhere it can still be reached from the tee
--   🐹 dig a pair of gopher holes on it: in one, out of the other
--   Saved in golf_games.twists = { "<hole>": [{ k: 'cup' | 'gopher', s: seed, t: from turn }] }; the
--   page places them from the seed (holeWithTwists in golf-engine.js), so every device and every
--   replay gets the same hole. Turn by turn a twist starts at the next turn; live, at the next hole
--   (never under someone's ball). At most 3 on a hole. The sneak-attack and scoreboard twists stay.
--   ⛳ Chip Shot (loot): your next putt flies over walls, hedges, bumpers, water and sand, then lands
--   and rolls. The putt is saved with a 5th number (1). Usable on your hole, or any time live.
-- Applied with the Supabase connector (apply_migration '043_more_chaos_golf'). Safe to run again.

alter table public.golf_games add column if not exists twists jsonb not null default '{}';

create or replace function public._chaos_twist_golf(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  gg golf_games; r float8 := random();
  p uuid; other uuid; n int; ft int; hole int; kind text; msg text;
  h1 int; s1 int; s2 int;
begin
  select * into gg from golf_games where id = p_game for update;
  if not found or gg.status <> 'playing' then return; end if;
  n := cardinality(gg.players);
  p := gg.players[gg.t % n + 1];
  ft := case when _golf_live(gg) then (gg.t / n + 1) * n else gg.t end;   -- live: from the next hole on
  hole := gg.start + ft / n;
  if r < 0.25 and not exists (select 1 from golf_attacks where game_id = p_game and target = p and used_t is null) then
    insert into golf_attacks (game_id, attacker, target, type, planted_t) values (p_game, null, p, 1 + floor(random() * 5)::int, gg.t);
    perform _chaos_event(p, null, 'twist', 'golf', p_game, '🌪️', 'Chaos twist: the course itself is out to get you this hole.');
  elsif r < 0.65 and hole < gg.start + gg.count and jsonb_array_length(coalesce(gg.twists -> hole::text, '[]')) < 3 then
    kind := case when r < 0.45 then 'cup' else 'gopher' end;
    update golf_games set twists = jsonb_set(twists, array[hole::text],
        coalesce(twists -> hole::text, '[]') || jsonb_build_array(jsonb_build_object('k', kind, 's', 1 + floor(random() * 2000000000)::bigint, 't', ft))),
      updated_at = now() where id = p_game;
    msg := case kind when 'cup' then format('Chaos twist: the cup on hole %s just moved!', hole + 1)
                     else format('Chaos twist: gophers dug up hole %s! Two holes connect underground.', hole + 1) end;
    foreach other in array gg.players loop
      if not _is_bot(other) then perform _chaos_event(other, null, 'twist', 'golf', p_game, case kind when 'cup' then '🚩' else '🐹' end, msg); end if;
    end loop;
  elsif r < 0.82 and n > 1 then
    -- Scoreboard glitch (005): swap your score with someone else's on a hole you've both played.
    select tu.hole, tu.written + tu.fine, o.written + o.fine, o.player into h1, s1, s2, other
      from golf_turns tu join golf_turns o on o.game_id = tu.game_id and o.hole = tu.hole and o.player <> tu.player
      where tu.game_id = p_game and tu.player = p and not tu.skipped and not o.skipped and tu.written + tu.fine <> o.written + o.fine
      order by random() limit 1;
    if h1 is not null then
      update golf_turns set written = s2 - fine where game_id = p_game and player = p and hole = h1;
      update golf_turns set written = s1 - fine where game_id = p_game and player = other and hole = h1;
      perform _chaos_event(p, null, 'twist', 'golf', p_game, '📟', format('Chaos twist: SCOREBOARD GLITCH! Your hole %s score swapped with %s''s (%s ↔ %s).', h1 + 1, _uname(other), s1, s2));
      perform _chaos_event(other, null, 'twist', 'golf', p_game, '📟', format('Chaos twist: SCOREBOARD GLITCH! Your hole %s score swapped with %s''s (%s ↔ %s).', h1 + 1, _uname(p), s2, s1));
    else
      perform _chaos_drop(p, 'golf', p_game, 'A chaos crate rolled onto the green and');
    end if;
  else
    perform _chaos_drop(p, 'golf', p_game, 'A chaos crate rolled onto the green and');
  end if;
end $$;
revoke execute on function public._chaos_twist_golf(uuid) from public, anon, authenticated;

-- _chaos_twist hands Putt Post to _chaos_twist_golf. Patched in place, once.
do $$
declare d text; a int; b int;
begin
  d := pg_get_functiondef('public._chaos_twist(text,uuid)'::regprocedure);
  if position('_chaos_twist_golf' in d) = 0 then
    a := position('    select * into gg from golf_games where id = p_game;' in d);
    b := position('  else' || chr(10) || '    perform _chaos_twist_duel(p_game);' in d);
    if a = 0 or b = 0 then raise exception '043: _chaos_twist is not the shape this patch expects'; end if;
    execute substr(d, 1, a - 1) || '    perform _chaos_twist_golf(p_game);' || chr(10) || chr(10) || substr(d, b);
  end if;
end $$;

-- ⛳ Chip Shot: a loot item.
alter table public.loot drop constraint if exists loot_item_check;
alter table public.loot add constraint loot_item_check check (item in
  ('sonar', 'salvo', 'golden_tee', 'magnet', 'shield', 'bertha', 'scroll', 'cluster', 'homing', 'railgun', 'dirt',
   'xray', 'paint', 'trash', 'gift', 'foxhole', 'buster', 'drone',
   'atk_ice', 'atk_wind', 'atk_cup', 'atk_bumpers', 'atk_butter', 'chip'));

create or replace function public._item_label(item text) returns text
language sql immutable as $$
  select case item
    when 'sonar' then '⚓ Sonar Ping' when 'salvo' then '⚓ Double Salvo'
    when 'golden_tee' then '⛳ Golden Tee' when 'magnet' then '⛳ Magnet Cup' when 'chip' then '⛳ Chip Shot'
    when 'atk_ice' then '🧊 Ice Rink' when 'atk_wind' then '🌬️ Gusty Wind' when 'atk_cup' then '🕳️ Tiny Cup'
    when 'atk_bumpers' then '💥 Surprise Bumpers' when 'atk_butter' then '🧈 Butterfingers'
    when 'shield' then '💥 Shield' when 'bertha' then '💥 Big Bertha'
    when 'cluster' then '🎆 Cluster Bomb' when 'homing' then '🚀 Homing Missile'
    when 'railgun' then '⚡ Railgun' when 'dirt' then '🪨 Dirt Bomb' when 'foxhole' then '🕳️ Foxhole' when 'buster' then '🔻 Bunker Buster'
    when 'drone' then '🚁 Drone Strike'
    when 'xray' then '👀 X-Ray Specs' when 'paint' then '🎨 Paint Bomb'
    when 'trash' then '🗑️ Trash Chute' when 'gift' then '🎁 Gift Box'
    else '🌀 Curse Scroll' end
$$;

-- 041's drop table, with the Chip Shot among Putt Post's own items.
create or replace function public._chaos_drop(p_player uuid, p_kind text, p_game uuid, p_why text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r float8 := random();
  own text[] := case p_kind when 'duel' then array['shield', 'bertha', 'cluster', 'homing', 'railgun', 'dirt', 'foxhole', 'buster', 'drone']
                            when 'battleship' then array['sonar', 'salvo']
                            when 'golf' then array['golden_tee', 'magnet', 'chip', 'chip', 'atk_ice', 'atk_wind', 'atk_cup', 'atk_bumpers', 'atk_butter'] end;
  item text := case when p_kind = 'cards' then (array['xray', 'paint', 'trash', 'gift'])[1 + floor(random() * 4)::int]
                    when own is not null and random() < 0.7 then own[1 + floor(random() * cardinality(own))::int]
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

-- use_loot: the Chip Shot, on your own hole or any time live. Patched in place, once.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.use_loot(bigint,uuid,uuid,integer)'::regprocedure);
  if position('''chip''' in d) = 0 then
    execute replace(d, 'elsif l.item in (''golden_tee'', ''magnet'') then', $x$elsif l.item = 'chip' then
    select * into gg from golf_games where id = p_game for update;
    if not found or not (me = any (gg.players)) or gg.status <> 'playing' then raise exception 'Use it in a Putt Post game'; end if;
    if gg.players[gg.t % cardinality(gg.players) + 1] <> me and not _golf_live(gg) then raise exception 'Use it on your own hole'; end if;
    res := jsonb_build_object('t', gg.t);
    update loot set used_at = now(), used_kind = 'golf', used_game = p_game, detail = res where id = p_loot;

  elsif l.item in ('golden_tee', 'magnet') then$x$);
  end if;
end $$;

-- One Chip Shot each to try (once).
insert into loot (player, item, from_kind)
  select p.id, 'chip', 'chipcrate' from profiles p
  where not exists (select 1 from bots b where b.profile_id = p.id)
    and not exists (select 1 from loot l where l.player = p.id and l.from_kind = 'chipcrate');
