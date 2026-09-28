-- 011: Hilltop Duel tanks can move.
-- Applied with the Supabase connector (apply_migration '011_tank_moves'). Safe to run again.
--
-- On your turn you may drive your tank up to 40 px before firing, staying on your own side of
-- the hill (left tank 30-330, right tank 470-770). duel_fire(…, p_x) moves then fires in one
-- step; leaving p_x out (older pages, the robot) fires from where the tank already is.
-- Each shot records where it was fired from, so every device replays it from the right spot.

alter table public.duel_games add column if not exists tank_x int[] not null default '{90,710}';
alter table public.duel_shots add column if not exists from_x int;

-- A shot remembers where its tank stood when it was fired.
create or replace function public._duel_shot_from() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.from_x is null then
    select tank_x[array_position(players, new.shooter)] into new.from_x from duel_games where id = new.game_id;
  end if;
  return new;
end $$;
drop trigger if exists shot_from on public.duel_shots;
create trigger shot_from before insert on public.duel_shots for each row execute function public._duel_shot_from();

create or replace function public._duel_move(p_game uuid, who uuid, p_x int) returns void
language plpgsql security definer set search_path = public as $$
declare g duel_games; i int; lo int; hi int;
begin
  select * into g from duel_games where id = p_game for update;
  if not found or g.status <> 'playing' then raise exception 'This duel is over'; end if;
  if g.players[g.turn + 1] <> who then raise exception 'It''s not your turn'; end if;
  i := g.turn + 1;
  lo := case when i = 1 then 30 else 470 end; hi := case when i = 1 then 330 else 770 end;
  if p_x < lo or p_x > hi then raise exception 'Stay on your side of the hill'; end if;
  if abs(p_x - g.tank_x[i]) > 40 then raise exception 'Out of fuel: 40 per turn'; end if;
  update duel_games set tank_x[i] = p_x where id = p_game;
end $$;

drop function if exists public.duel_fire(uuid, int, int, jsonb, int[]);
create or replace function public.duel_fire(p_game uuid, p_angle int, p_power int, p_crater jsonb, p_hp int[], p_x int default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_x is not null then perform _duel_move(p_game, auth.uid(), p_x); end if;
  perform _duel_fire(p_game, auth.uid(), p_angle, p_power, p_crater, p_hp);
end $$;

drop function if exists public.duel_fire_bot(uuid, int, int, jsonb, int[]);
create or replace function public.duel_fire_bot(p_game uuid, p_angle int, p_power int, p_crater jsonb, p_hp int[], p_x int default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  g duel_games;
begin
  select * into g from duel_games where id = p_game;
  if not found or auth.uid() is null or not (auth.uid() = any (g.players)) then raise exception 'Game not found'; end if;
  if not exists (select 1 from bots where profile_id = g.players[g.turn + 1]) then raise exception 'It''s not the robot''s turn'; end if;
  if p_x is not null then perform _duel_move(p_game, g.players[g.turn + 1], p_x); end if;
  perform _duel_fire(p_game, g.players[g.turn + 1], p_angle, p_power, p_crater, p_hp);
end $$;

revoke execute on function public._duel_move(uuid, uuid, int), public._duel_shot_from() from public, anon, authenticated;
revoke execute on function public.duel_fire(uuid, int, int, jsonb, int[], int), public.duel_fire_bot(uuid, int, int, jsonb, int[], int) from public, anon;
grant execute on function public.duel_fire(uuid, int, int, jsonb, int[], int), public.duel_fire_bot(uuid, int, int, jsonb, int[], int) to authenticated;
