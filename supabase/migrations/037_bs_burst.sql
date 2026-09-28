-- 037: Live Battleship fires in bursts: 3 shots, then the guns reload. The server allows a shot
-- when you've fired fewer than 3 in the last 2.3 s (the page counts to 2.4 s, so it never gets
-- ahead of this). A burst can be as quick as you tap (a square can only be shot once anyway).
-- Was: one shot every 0.8 s.
-- Robots are unchanged (one shot every 1.2 s each, fire_live_bot).
-- Applied with the Supabase connector (apply_migration '037_bs_burst'). Safe to run again.

create or replace function public.fire_live(p_game uuid, p_target uuid, p_cell int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g games; r jsonb;
begin
  select * into g from games where id = p_game for update;
  if not found or me is null or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This game isn''t being played right now'; end if;
  if me = any (g.eliminated) then raise exception 'Your fleet is sunk'; end if;
  if not _bs_live(g) then raise exception 'The live battle is over: back to taking turns'; end if;
  if (select count(*) from shots where game_id = p_game and shooter = me and created_at > now() - interval '2.3 seconds') >= 3 then
    raise exception 'Still reloading';
  end if;
  perform set_config('bs.live', '1', true);
  r := fire(p_game, p_target, array[p_cell]);
  perform set_config('bs.live', '', true);
  return r;
end $$;
