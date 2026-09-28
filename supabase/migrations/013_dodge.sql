-- 013: dodge while the other player aims (Hilltop Duel).
-- Applied with the Supabase connector (apply_migration '013_dodge'). Safe to run again.
--
-- During the other player's turn you may shift your tank up to 20 px (from where it stood when
-- their turn began), on your side of the hill, as often as you like until they fire. Each shot
-- also records where its target stood as the shooter saw it (target_x), so every device replays
-- it identically even if a dodge landed a moment too late.

alter table public.duel_games add column if not exists turn_x int[] default '{90,710}';
alter table public.duel_games alter column turn_x set default '{90,710}';
update public.duel_games set turn_x = tank_x where turn_x is null;
alter table public.duel_shots add column if not exists target_x int;

-- 008's turn clock, now also remembering where the tanks stood when each duel turn began.
create or replace function public._turn_moved() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'golf_games' then
    if new.t is distinct from old.t then new.turn_at := now(); end if;
  elsif tg_table_name = 'games' then
    if new.move is distinct from old.move or new.turn is distinct from old.turn or new.status is distinct from old.status then new.turn_at := now(); end if;
  else
    if new.move is distinct from old.move then new.turn_at := now(); new.turn_x := new.tank_x; end if;
  end if;
  return new;
end $$;

-- 011's shot trigger, now also recording the target's position (as the shooter saw it).
create or replace function public._duel_shot_from() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.from_x is null then
    select tank_x[array_position(players, new.shooter)] into new.from_x from duel_games where id = new.game_id;
  end if;
  if new.target_x is null then
    new.target_x := nullif(current_setting('duel.target_x', true), '')::int;
    if new.target_x is null then
      select tank_x[3 - array_position(players, new.shooter)] into new.target_x from duel_games where id = new.game_id;
    end if;
  end if;
  return new;
end $$;

create or replace function public.duel_dodge(p_game uuid, p_move int, p_x int) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g duel_games; i int; lo int; hi int;
begin
  select * into g from duel_games where id = p_game for update;
  if not found or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This duel is over'; end if;
  if g.move <> p_move then raise exception 'Too late: they already fired'; end if;
  if g.players[g.turn + 1] = me then raise exception 'It''s your turn: drive with Move'; end if;
  i := array_position(g.players, me);
  lo := case when i = 1 then 30 else 470 end; hi := case when i = 1 then 330 else 770 end;
  if p_x < lo or p_x > hi then raise exception 'Stay on your side of the hill'; end if;
  if abs(p_x - coalesce(g.turn_x[i], g.tank_x[i])) > 20 then raise exception 'Out of dodge fuel: 20 per turn'; end if;
  update duel_games set tank_x[i] = p_x, updated_at = now() where id = p_game;
end $$;

drop function if exists public.duel_fire(uuid, int, int, jsonb, int[], int);
create or replace function public.duel_fire(p_game uuid, p_angle int, p_power int, p_crater jsonb, p_hp int[], p_x int default null, p_target_x int default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_x is not null then perform _duel_move(p_game, auth.uid(), p_x); end if;
  perform set_config('duel.target_x', coalesce(p_target_x::text, ''), true);
  perform _duel_fire(p_game, auth.uid(), p_angle, p_power, p_crater, p_hp);
  perform set_config('duel.target_x', '', true);
end $$;

revoke execute on function public.duel_fire(uuid, int, int, jsonb, int[], int, int), public.duel_dodge(uuid, int, int) from public, anon;
grant execute on function public.duel_fire(uuid, int, int, jsonb, int[], int, int), public.duel_dodge(uuid, int, int) to authenticated;
revoke execute on function public._turn_moved(), public._duel_shot_from() from public, anon, authenticated;
