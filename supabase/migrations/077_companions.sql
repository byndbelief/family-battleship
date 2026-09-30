-- 🧭 COMPANIONS (CHAOS.md § The pals): each player picks who goes with them (design_votes, topic
-- 'resident', one row per player: their companion). Each companion favours one pillar of the box, and
-- doubles the chaos-rating points of that pillar's events for its player, as a 'bond' row in the ledger
-- (so the event counts stay true and the bonus shows on its own). Safe to re-run.
create or replace function public._chaos_companion(p_player uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select choice from design_votes where player = p_player and topic = 'resident'), 'fig')
$$;
create or replace function public._chaos_boosts(p_pal text) returns text[]
language sql immutable as $$
  select case p_pal when 'fig' then array['peak', 'big', 'gold', 'r4']          -- 🌀 chaos: the peaks
                    when 'kit' then array['mirror', 'balance']                   -- ✨ symmetry
                    when 'bit' then array['window', 'phase']                     -- 🔁 fractals: the splits, the window
                    when 'phi' then array['golden', 'fib']                       -- 🌻 geometry: φ and Fibonacci
                    else array[]::text[] end
$$;
create or replace function public._chaos_weight(p_event text) returns int
language sql immutable as $$
  select case p_event when 'peak' then 1 when 'gift' then 1 when 'fib' then 2 when 'phase' then 2 when 'big' then 3
                      when 'window' then 4 when 'balance' then 5 when 'mirror' then 8 when 'golden' then 8
                      when 'gold' then 10 when 'r4' then 10 when 'bond' then 1 else 0 end
$$;
create or replace function public._chaos_mark(p_player uuid, p_kind text, p_game uuid, p_event text, p_times int default 1) returns void
language plpgsql security definer set search_path = public as $$
declare pts int;
begin
  if p_player is null or p_times < 1 or _chaos_weight(p_event) = 0 or p_event = 'bond' then return; end if;
  if exists (select 1 from bots where profile_id = p_player) then return; end if;   -- robots don't rate
  pts := _chaos_weight(p_event) * least(p_times, 200);
  insert into chaos_ledger (player, kind, game_id, event, pts) values (p_player, p_kind, p_game, p_event, pts);
  if p_event = any (_chaos_boosts(_chaos_companion(p_player))) then   -- 🧭 the companion's pillar: the same again
    insert into chaos_ledger (player, kind, game_id, event, pts) values (p_player, p_kind, p_game, 'bond', pts);
  end if;
end $$;
revoke execute on function public._chaos_companion(uuid), public._chaos_boosts(text) from public, anon, authenticated;
