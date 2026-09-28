-- 024: Chaos Cards loot. Four backpack items, each used on your own turn without ending it:
--   👀 xray   X-Ray Specs:  see one opponent's hand (the cards come back to your page only)
--   🎨 paint  Paint Bomb:   set the colour in play to any colour
--   🗑️ trash  Trash Chute:  throw one card from your hand onto the discard pile
--   🎁 gift   Gift Box:     hand one of your cards to an opponent
-- Trash and Gift need at least 3 cards in your hand, so neither can take you out.
-- Card loot drops when you win (as before), now and then when you play an action or chaos card,
-- and in the usual chaos drops. Everyone gets a starter crate of all four.
-- Applied with the Supabase connector (apply_migration '024_card_loot'). Safe to run again.

alter table public.loot drop constraint if exists loot_item_check;
alter table public.loot add constraint loot_item_check check (item in
  ('sonar', 'salvo', 'golden_tee', 'magnet', 'shield', 'bertha', 'scroll', 'cluster', 'homing', 'railgun', 'dirt',
   'xray', 'paint', 'trash', 'gift'));

create or replace function public._item_label(item text) returns text
language sql immutable as $$
  select case item
    when 'sonar' then '⚓ Sonar Ping' when 'salvo' then '⚓ Double Salvo'
    when 'golden_tee' then '⛳ Golden Tee' when 'magnet' then '⛳ Magnet Cup'
    when 'shield' then '💥 Shield' when 'bertha' then '💥 Big Bertha'
    when 'cluster' then '🎆 Cluster Bomb' when 'homing' then '🚀 Homing Missile'
    when 'railgun' then '⚡ Railgun' when 'dirt' then '🪨 Dirt Bomb'
    when 'xray' then '👀 X-Ray Specs' when 'paint' then '🎨 Paint Bomb'
    when 'trash' then '🗑️ Trash Chute' when 'gift' then '🎁 Gift Box'
    else '🌀 Curse Scroll' end
$$;

-- 016's drop table, with card items in the mix (a card game's own drops are card items).
create or replace function public._chaos_drop(p_player uuid, p_kind text, p_game uuid, p_why text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r float8 := random();
  item text := case when p_kind = 'cards' then (array['xray', 'paint', 'trash', 'gift'])[1 + floor(random() * 4)::int]
                    when r < 0.08 then 'sonar' when r < 0.16 then 'salvo' when r < 0.24 then 'golden_tee'
                    when r < 0.32 then 'magnet' when r < 0.40 then 'shield' when r < 0.47 then 'bertha'
                    when r < 0.54 then 'cluster' when r < 0.61 then 'homing' when r < 0.68 then 'railgun'
                    when r < 0.75 then 'dirt' when r < 0.81 then 'xray' when r < 0.87 then 'paint'
                    when r < 0.91 then 'trash' when r < 0.95 then 'gift' else 'scroll' end;
begin
  if _is_bot(p_player) then return; end if;
  insert into loot (player, item, from_kind) values (p_player, item, p_kind);
  perform _chaos_event(p_player, null, 'loot', p_kind, p_game, '🎒', format('Loot! %s dropped %s into your backpack.', upper(left(p_why, 1)) || substr(p_why, 2), _item_label(item)));
end $$;

-- Playing an action or chaos card sometimes turns up loot (1 in 8).
create or replace function public.card_play(p_game uuid, p_card text, p_color text default null, p_target uuid default null, p_last boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  perform _card_play(p_game, auth.uid(), p_card, p_color, p_target, p_last);
  if (_card_wild(p_card) or substr(p_card, 2) in ('S', 'R', '+2')) and random() < 0.125
     and exists (select 1 from card_games where id = p_game and status = 'playing') then
    perform _chaos_drop(auth.uid(), 'cards', p_game, 'A chaos card fluttered loose and');
  end if;
end $$;

-- Use a card item. p_target: the opponent (xray, gift); p_card: the card (trash, gift); p_color: paint.
-- Returns { hand: [...] } for X-Ray Specs, {} otherwise.
create or replace function public.card_use_loot(p_loot bigint, p_game uuid, p_target uuid default null, p_card text default null, p_color text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); l loot; g card_games; hand text[]; res jsonb := '{}';
begin
  select * into l from loot where id = p_loot and player = me and used_at is null for update;
  if not found then raise exception 'That item isn''t in your backpack'; end if;
  if l.item not in ('xray', 'paint', 'trash', 'gift') then raise exception 'That item isn''t for Chaos Cards'; end if;
  select * into g from card_games where id = p_game for update;
  if not found or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' or g.players[g.turn + 1] <> me then raise exception 'Use it on your turn'; end if;
  select cards into hand from card_hands where game_id = p_game and player = me for update;
  if l.item in ('xray', 'gift') and (p_target is null or p_target = me or not (p_target = any (g.players))) then raise exception 'Pick an opponent'; end if;
  if l.item in ('trash', 'gift') then
    if cardinality(hand) < 3 then raise exception 'Not with 2 cards or fewer: that would be too easy'; end if;
    if p_card is null or not (p_card = any (hand)) then raise exception 'Pick a card from your hand'; end if;
  end if;
  if l.item = 'xray' then
    select jsonb_build_object('hand', to_jsonb(cards)) into res from card_hands where game_id = p_game and player = p_target;
  elsif l.item = 'paint' then
    if p_color is null or p_color not in ('R', 'G', 'B', 'Y') then raise exception 'Pick a colour'; end if;
    update card_games set color = p_color where id = p_game;
  elsif l.item = 'trash' then
    update card_hands set cards = _card_without(hand, p_card) where game_id = p_game and player = me;
    update card_piles set discard = discard || p_card where game_id = p_game;
  else
    update card_hands set cards = _card_without(hand, p_card) where game_id = p_game and player = me;
    update card_hands set cards = cards || p_card where game_id = p_game and player = p_target;
    -- Whoever gets a card is no longer on their last one.
    update card_games set exposed = case when exposed = p_target then null else exposed end,
      called = array_remove(called, p_target) where id = p_game;
  end if;
  perform _card_recount(p_game);
  -- Everyone sees what happened (never the cards themselves, except the paint colour).
  update card_games set updated_at = now(),
    last_play = jsonb_build_object('player', me, 'loot', l.item, 'target', p_target, 'color', case when l.item = 'paint' then p_color end, 'move', g.move, 'at', extract(epoch from now()))
    where id = p_game;
  update loot set used_at = now(), used_kind = 'cards', used_game = p_game where id = p_loot;
  return res;
end $$;
revoke execute on function public.card_use_loot(bigint, uuid, uuid, text, text) from public, anon;
grant execute on function public.card_use_loot(bigint, uuid, uuid, text, text) to authenticated;

-- A starter crate: one of each card item for every player (once).
insert into loot (player, item, from_kind)
  select p.id, w.item, 'cardcrate'
  from profiles p cross join (values ('xray'), ('paint'), ('trash'), ('gift')) w(item)
  where not exists (select 1 from bots b where b.profile_id = p.id)
    and not exists (select 1 from loot l where l.player = p.id and l.from_kind = 'cardcrate');
insert into chaos_events (player, actor, kind, game_kind, icon, message)
  select p.id, null, 'loot', 'cards', '🃏', 'Card crate! 👀 X-Ray Specs, 🎨 Paint Bomb, 🗑️ Trash Chute and 🎁 Gift Box just landed in your backpack for Chaos Cards.'
  from profiles p
  where not exists (select 1 from bots b where b.profile_id = p.id)
    and not exists (select 1 from chaos_events e where e.player = p.id and e.icon = '🃏' and e.message like 'Card crate!%');
