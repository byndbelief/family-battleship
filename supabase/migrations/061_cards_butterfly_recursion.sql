-- 061: Chaos Cards fractals: two new wilds (2 of each in the deck).
--   🦋 Butterfly (CF): it flutters on round the table from the next player, growing as it goes: they
--      draw 1, the one after 2, then 3 (everyone but you). Play goes on to the next player as usual.
--   🔁 Recursion (CR): plays the card under it again, for you: a Skip skips, a +2 gives 2, a Bomb bombs,
--      a Swap swaps (pick someone), and a Recursion under it replays whatever that one replayed, all
--      the way down. A plain number or Wild under it does nothing but change the colour.
--   card_games.top_as is the card the top one played as (a Recursion's), so it survives draws and passes.
-- Applied with the Supabase connector (apply_migration '061_cards_butterfly_recursion'). Safe to run again.

alter table public.card_games add column if not exists top_as text not null default '';

create or replace function public._card_wild(c text) returns boolean
language sql immutable as $$ select c in ('W', 'W4', 'CS', 'CT', 'CP', 'CB', 'CF', 'CR') $$;

create or replace function public._card_deck() returns text[]
language sql as $$
  select array_agg(c order by random()) from (
    select col || v as c from unnest(array['R', 'G', 'B', 'Y']) col,
      unnest(array['0', '1', '1', '2', '2', '3', '3', '4', '4', '5', '5', '6', '6', '7', '7', '8', '8', '9', '9', 'S', 'S', 'R', 'R', '+2', '+2']) v
    union all select unnest(array['W', 'W', 'W', 'W', 'W4', 'W4', 'W4', 'W4', 'CS', 'CS', 'CT', 'CT', 'CP', 'CP', 'CB', 'CB', 'CF', 'CF', 'CR', 'CR'])
  ) d
$$;

-- The card a top card counts as: a Recursion's is what it replayed (a Wild if there was nothing to replay).
create or replace function public._card_as(p_top text, p_as text) returns text
language sql immutable as $$ select case when p_top = 'CR' then coalesce(nullif(p_as, ''), 'W') else p_top end $$;

create or replace function public._card_play(p_game uuid, who uuid, p_card text, p_color text, p_target uuid, p_last boolean)
returns void language plpgsql security definer set search_path = public as $$
declare g card_games; hand text[]; n int; i int; nxt uuid; steps int := 1; tmp text[]; p uuid; left_ int; eff text; k int;
begin
  select * into g from card_games where id = p_game for update;
  if not found or not (who = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This game is over'; end if;
  if g.players[g.turn + 1] <> who then raise exception 'It''s not your turn'; end if;
  select cards into hand from card_hands where game_id = p_game and player = who for update;
  if not (p_card = any (hand)) then raise exception 'That card isn''t in your hand'; end if;
  if not _card_playable(p_card, g.color, g.top) then raise exception 'That card doesn''t match'; end if;
  if _card_wild(p_card) and (p_color is null or p_color not in ('R', 'G', 'B', 'Y')) then raise exception 'Pick a colour'; end if;
  -- 🔁 A Recursion does what the card under it did (061); everything else does what it says.
  eff := case when p_card = 'CR' then _card_as(g.top, g.top_as) else p_card end;
  if eff in ('CS', 'CT') and (p_target is null or p_target = who or not (p_target = any (g.players))) then raise exception 'Pick a player'; end if;
  n := cardinality(g.players); i := array_position(g.players, who) - 1;
  hand := _card_without(hand, p_card);
  update card_hands set cards = hand where game_id = p_game and player = who;
  update card_piles set discard = discard || g.top where game_id = p_game;
  update card_games set top = p_card, top_as = case when p_card = 'CR' then eff else '' end,
    color = case when _card_wild(p_card) then p_color else left(p_card, 1) end where id = p_game;
  nxt := g.players[_card_seat(i, 1, g.dir, n) + 1];
  if substr(eff, 2) = 'S' and not _card_wild(eff) then steps := 2;
  elsif substr(eff, 2) = 'R' and not _card_wild(eff) then
    if n = 2 then steps := 2; else update card_games set dir = -dir where id = p_game; g.dir := -g.dir; end if;
  elsif substr(eff, 2) = '+2' then perform _card_give(p_game, nxt, 2); steps := 2;
  elsif eff = 'W4' then perform _card_give(p_game, nxt, 4); steps := 2;
  elsif eff = 'CT' then perform _card_give(p_game, p_target, 3);
  elsif eff = 'CB' then
    foreach p in array g.players loop if p <> who then perform _card_give(p_game, p, 2); end if; end loop;
  elsif eff = 'CF' then   -- 🦋 +1, +2, +3 on round the table
    for k in 1 .. n - 1 loop perform _card_give(p_game, g.players[_card_seat(i, k, g.dir, n) + 1], k); end loop;
  elsif eff = 'CS' then
    select cards into tmp from card_hands where game_id = p_game and player = p_target;
    update card_hands set cards = hand where game_id = p_game and player = p_target;
    update card_hands set cards = tmp where game_id = p_game and player = who;
  elsif eff = 'CP' then
    -- Everyone hands their cards to the next player in the direction of play.
    create temp table if not exists _card_pass (player uuid, cards text[]) on commit drop;
    delete from _card_pass;
    insert into _card_pass select g.players[_card_seat(array_position(g.players, h.player) - 1, 1, g.dir, n) + 1], h.cards
      from card_hands h where h.game_id = p_game;
    update card_hands h set cards = x.cards from _card_pass x where h.game_id = p_game and h.player = x.player;
  end if;
  -- Last card: called with the play, or left open to be caught.
  select cardinality(cards) into left_ from card_hands where game_id = p_game and player = who;
  if left_ = 1 then
    if p_last then update card_games set called = array_append(array_remove(called, who), who), exposed = null where id = p_game;
    else update card_games set exposed = who, called = array_remove(called, who) where id = p_game; end if;
  else
    update card_games set called = array_remove(called, who), exposed = case when exposed = who then null else exposed end where id = p_game;
  end if;
  perform _card_advance(p_game, steps, jsonb_build_object('player', who, 'card', p_card, 'color', coalesce(p_color, left(p_card, 1)), 'target', p_target, 'move', g.move + 1)
    || case when p_card = 'CR' then jsonb_build_object('as', eff) else '{}'::jsonb end);
end $$;
revoke execute on function public._card_play(uuid, uuid, text, text, uuid, boolean) from public, anon, authenticated;

-- The robot picks someone when its Recursion replays a Swap or a Target.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.card_bot_play(uuid)'::regprocedure);
  if position('_card_as(' in d) = 0 then
    if position('tgt := case when pick in (''CS'', ''CT'') then lead end;' in d) = 0 then raise exception '061: card_bot_play is not the shape this patch expects'; end if;
    execute replace(d, 'tgt := case when pick in (''CS'', ''CT'') then lead end;',
      'tgt := case when pick in (''CS'', ''CT'') or (pick = ''CR'' and _card_as(g.top, g.top_as) in (''CS'', ''CT'')) then lead end;');
  end if;
end $$;

insert into chaos_events (player, actor, kind, game_kind, icon, message)
  select p.id, null, 'twist', 'cards', '🦋', 'New in Chaos Cards: 🦋 Butterfly (it flutters round the table, +1, +2, +3…) and 🔁 Recursion (it plays the card under it again, even another Recursion).'
  from profiles p
  where not exists (select 1 from bots b where b.profile_id = p.id)
    and not exists (select 1 from chaos_events e where e.player = p.id and e.icon = '🦋' and e.message like 'New in Chaos Cards: 🦋%');
