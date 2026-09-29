-- 041: Putt Post sneak attacks are backpack loot, and one hits every other player.
--   Five loot items, one per attack: 🧊 atk_ice (Ice Rink), 🌬️ atk_wind (Gusty Wind),
--   🕳️ atk_cup (Tiny Cup), 💥 atk_bumpers (Surprise Bumpers), 🧈 atk_butter (Butterfingers).
--   Used from the backpack on your own hole (or any time in a live race), it plants that attack on
--   every other player who hasn't one waiting already: their next hole, or live, right away (040).
--   The per-game 🎯 tokens are gone as a thing you spend: anything that used to earn one (birdie or
--   better, catching a cheater, first in the cup live) now drops a random attack item into your
--   backpack instead, via a trigger on golf_players, so those paths need no edits. Robots keep
--   their tokens and plant as before (they don't use loot). Leftover tokens in games still being
--   played move into the backpack once. Attack items join Putt Post's own loot.
-- Applied with the Supabase connector (apply_migration '041_golf_attack_loot'). Safe to run again.

alter table public.loot drop constraint if exists loot_item_check;
alter table public.loot add constraint loot_item_check check (item in
  ('sonar', 'salvo', 'golden_tee', 'magnet', 'shield', 'bertha', 'scroll', 'cluster', 'homing', 'railgun', 'dirt',
   'xray', 'paint', 'trash', 'gift', 'foxhole', 'buster', 'drone',
   'atk_ice', 'atk_wind', 'atk_cup', 'atk_bumpers', 'atk_butter'));

create or replace function public._item_label(item text) returns text
language sql immutable as $$
  select case item
    when 'sonar' then '⚓ Sonar Ping' when 'salvo' then '⚓ Double Salvo'
    when 'golden_tee' then '⛳ Golden Tee' when 'magnet' then '⛳ Magnet Cup'
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

-- 039's drop table: Putt Post's own items now include the five attacks.
create or replace function public._chaos_drop(p_player uuid, p_kind text, p_game uuid, p_why text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r float8 := random();
  own text[] := case p_kind when 'duel' then array['shield', 'bertha', 'cluster', 'homing', 'railgun', 'dirt', 'foxhole', 'buster', 'drone']
                            when 'battleship' then array['sonar', 'salvo']
                            when 'golf' then array['golden_tee', 'magnet', 'atk_ice', 'atk_wind', 'atk_cup', 'atk_bumpers', 'atk_butter'] end;
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

-- One random attack item into a player's backpack.
create or replace function public._golf_attack_drop(p_player uuid, p_game uuid, p_why text) returns void
language plpgsql security definer set search_path = public as $$
declare item text := (array['atk_ice', 'atk_wind', 'atk_cup', 'atk_bumpers', 'atk_butter'])[1 + floor(random() * 5)::int];
begin
  insert into loot (player, item, from_kind) values (p_player, item, 'golf');
  perform _chaos_event(p_player, null, 'loot', 'golf', p_game, '🎒', format('Loot! %s dropped %s into your backpack.', p_why, _item_label(item)));
end $$;
revoke execute on function public._golf_attack_drop(uuid, uuid, text) from public, anon, authenticated;

-- Leftover tokens in games still being played: into the backpack, once (before the trigger exists).
do $$
declare r record; k int;
begin
  if not exists (select 1 from pg_trigger where tgname = 'golf_tokens_to_loot') then
    for r in select gp.game_id, gp.player, gp.tokens from golf_players gp join golf_games g on g.id = gp.game_id
             where g.status = 'playing' and gp.tokens > 0 and not _is_bot(gp.player) loop
      for k in 1 .. r.tokens loop perform _golf_attack_drop(r.player, r.game_id, 'A leftover sneak attack'); end loop;
    end loop;
    update golf_players gp set tokens = 0 where tokens > 0 and not _is_bot(player);
  end if;
end $$;

-- Every token a person earns becomes an attack item; people start a game with none (robots keep theirs).
create or replace function public._golf_tokens_to_loot() returns trigger
language plpgsql security definer set search_path = public as $$
declare k int;
begin
  if _is_bot(new.player) then return new; end if;
  if tg_op = 'INSERT' then new.tokens := 0; return new; end if;
  if new.tokens > old.tokens then
    for k in 1 .. new.tokens - old.tokens loop perform _golf_attack_drop(new.player, new.game_id, 'Great golf'); end loop;
    new.tokens := old.tokens;
  end if;
  return new;
end $$;
drop trigger if exists golf_tokens_to_loot on public.golf_players;
create trigger golf_tokens_to_loot before insert or update of tokens on public.golf_players
  for each row execute function public._golf_tokens_to_loot();

-- use_loot: an attack item hits every other player without one waiting. Patched in place, once.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.use_loot(bigint,uuid,uuid,integer)'::regprocedure);
  if position('atk_ice' in d) = 0 then
    execute replace(d, 'elsif l.item in (''golden_tee'', ''magnet'') then', $x$elsif l.item in ('atk_ice', 'atk_wind', 'atk_cup', 'atk_bumpers', 'atk_butter') then
    select * into gg from golf_games where id = p_game for update;
    if not found or not (me = any (gg.players)) or gg.status <> 'playing' then raise exception 'Use it in a Putt Post game'; end if;
    if gg.players[gg.t % cardinality(gg.players) + 1] <> me and not _golf_live(gg) then raise exception 'Use it on your own hole'; end if;
    r := array_position(array['atk_ice', 'atk_wind', 'atk_cup', 'atk_bumpers', 'atk_butter'], l.item);
    insert into golf_attacks (game_id, attacker, target, type, planted_t)
      select p_game, me, p, r, gg.t from unnest(gg.players) p
      where p <> me and not exists (select 1 from golf_attacks a where a.game_id = p_game and a.target = p and a.used_t is null);
    get diagnostics c = row_count;
    if c = 0 then raise exception 'Everyone already has a sneak attack waiting'; end if;
    if _golf_live(gg) then update golf_games set updated_at = now() where id = p_game; end if;
    res := jsonb_build_object('type', r, 'hit', c);
    update loot set used_at = now(), used_kind = 'golf', used_game = p_game, detail = res where id = p_loot;

  elsif l.item in ('golden_tee', 'magnet') then$x$);
  end if;
end $$;
