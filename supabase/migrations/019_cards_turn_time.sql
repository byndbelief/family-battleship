-- 019: Chaos Cards live turns get 20 seconds instead of 10.
-- Applied with the Supabase connector (apply_migration '019_cards_turn_time'). Safe to run again.
-- The page's countdown (TURN_S in web/cards.js) must match: the server refuses a timeout
-- until 19.5 s have passed, so a page that runs out sooner just waits.

create or replace function public.card_timeout(p_game uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare g card_games; slow uuid;
begin
  select * into g from card_games where id = p_game for update;
  if not found or not (auth.uid() = any (g.players)) then raise exception 'Game not found'; end if;
  if not _card_live(g) or now() - g.turn_at < interval '19.5 seconds' then return false; end if;
  slow := g.players[g.turn + 1];
  if exists (select 1 from bots where profile_id = slow) then return false; end if;
  if not g.drew then perform _card_give(p_game, slow, 1); end if;
  perform _card_advance(p_game, 1, jsonb_build_object('player', slow, 'timeout', true, 'move', g.move + 1));
  return true;
end $$;
