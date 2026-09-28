-- 014: live battle (Hilltop Duel).
-- Applied with the Supabase connector (apply_migration '014_live_battle'). Safe to run again.
--
-- While both players have the duel open, it stops taking turns: either of you can fire whenever
-- your cannon has reloaded, and drive anywhere on your own side of the hill. When one of you
-- leaves, it goes back to taking turns (the player shot at last goes first).
-- Each open duel page checks in with duel_here() every few seconds; "both here" means both
-- checked in within the last 8 seconds. Never against the robot.
-- Live shots send damage as amounts (p_dmg), not end totals, so two shells landing at nearly the
-- same moment both count. Each shot also records the move its wind was read at (wind_move),
-- since another shot may land in between.

create table if not exists public.duel_here (
  game_id uuid not null references public.duel_games (id) on delete cascade,
  player uuid not null references public.profiles (id),
  seen_at timestamptz not null default now(),
  primary key (game_id, player)
);
alter table public.duel_here enable row level security;   -- no policies: only the functions below touch it

alter table public.duel_shots add column if not exists wind_move int;

create or replace function public._duel_live(g duel_games) returns boolean
language sql stable security definer set search_path = public as $$
  select g.status = 'playing'
     and not exists (select 1 from bots where profile_id = any (g.players))
     and (select count(*) from duel_here h where h.game_id = g.id and h.player = any (g.players) and h.seen_at > now() - interval '8 seconds') = 2;
$$;

-- Check in (p_on) or leave (not p_on). Returns whether the duel is live right now.
create or replace function public.duel_here(p_game uuid, p_on boolean default true) returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g duel_games;
begin
  select * into g from duel_games where id = p_game;
  if not found or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if p_on then
    insert into duel_here (game_id, player, seen_at) values (p_game, me, now())
      on conflict (game_id, player) do update set seen_at = now();
  else
    delete from duel_here where game_id = p_game and player = me;
  end if;
  return _duel_live(g);
end $$;

-- 013's shot trigger, now also recording the move a live shot read its wind at.
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
  if new.wind_move is null then
    new.wind_move := nullif(current_setting('duel.wind_move', true), '')::int;
    if nullif(current_setting('duel.wind_x', true), '') is not null then new.wind_x := current_setting('duel.wind_x', true)::int; end if;
  end if;
  return new;
end $$;

-- 013's dodge, plus: while live, drive anywhere on your side, whoever's "turn" it is. A live drive
-- also resets the dodge start (turn_x), so fuel is fresh when the duel goes back to taking turns.
create or replace function public.duel_dodge(p_game uuid, p_move int, p_x int) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g duel_games; i int; lo int; hi int;
begin
  select * into g from duel_games where id = p_game for update;
  if not found or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This duel is over'; end if;
  i := array_position(g.players, me);
  lo := case when i = 1 then 30 else 470 end; hi := case when i = 1 then 330 else 770 end;
  if p_x < lo or p_x > hi then raise exception 'Stay on your side of the hill'; end if;
  if _duel_live(g) then
    update duel_games set tank_x[i] = p_x, turn_x[i] = p_x, updated_at = now() where id = p_game;
    return;
  end if;
  if g.move <> p_move then raise exception 'Too late: they already fired'; end if;
  if g.players[g.turn + 1] = me then raise exception 'It''s your turn: drive with Move'; end if;
  if abs(p_x - coalesce(g.turn_x[i], g.tank_x[i])) > 20 then raise exception 'Out of dodge fuel: 20 per turn'; end if;
  update duel_games set tank_x[i] = p_x, updated_at = now() where id = p_game;
end $$;

-- A live shot: no turns, a 2.5 s reload (the page waits 3), damage as amounts off current health.
create or replace function public.duel_fire_live(p_game uuid, p_angle int, p_power int, p_crater jsonb, p_dmg int[], p_x int, p_target_x int, p_wind_move int, p_wind_x int default 1) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g duel_games; i int; lo int; hi int; hp int[];
begin
  select * into g from duel_games where id = p_game for update;
  if not found or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This duel is over'; end if;
  if not _duel_live(g) then raise exception 'The live battle is over: back to taking turns'; end if;
  if exists (select 1 from duel_shots where game_id = p_game and shooter = me and created_at > now() - interval '2.5 seconds') then
    raise exception 'Still reloading';
  end if;
  if p_dmg is null or cardinality(p_dmg) <> 2 or p_dmg[1] not between 0 and 60 or p_dmg[2] not between 0 and 60 then raise exception 'Bad damage'; end if;
  if p_wind_move is null or p_wind_move not between g.move - 50 and g.move or coalesce(p_wind_x, 1) not in (1, 3) then raise exception 'Bad shot'; end if;
  i := array_position(g.players, me);
  lo := case when i = 1 then 30 else 470 end; hi := case when i = 1 then 330 else 770 end;
  if p_x is not null then
    if p_x < lo or p_x > hi then raise exception 'Stay on your side of the hill'; end if;
    update duel_games set tank_x[i] = p_x, turn_x[i] = p_x where id = p_game;
  end if;
  hp := array[greatest(0, g.hp[1] - p_dmg[1]), greatest(0, g.hp[2] - p_dmg[2])];
  -- Hand the shooter the turn for a moment so the ordinary shot does the rest (crater, winner,
  -- loot, chaos) and passes the turn on as usual.
  update duel_games set turn = i - 1 where id = p_game;
  perform set_config('duel.target_x', coalesce(p_target_x::text, ''), true);
  perform set_config('duel.wind_move', p_wind_move::text, true);
  perform set_config('duel.wind_x', coalesce(p_wind_x, 1)::text, true);
  perform _duel_fire(p_game, me, p_angle, p_power, p_crater, hp);
  perform set_config('duel.target_x', '', true);
  perform set_config('duel.wind_move', '', true);
  perform set_config('duel.wind_x', '', true);
end $$;

revoke execute on function public._duel_live(duel_games) from public, anon, authenticated;
revoke execute on function public.duel_here(uuid, boolean), public.duel_dodge(uuid, int, int), public.duel_fire_live(uuid, int, int, jsonb, int[], int, int, int, int) from public, anon;
grant execute on function public.duel_here(uuid, boolean), public.duel_dodge(uuid, int, int), public.duel_fire_live(uuid, int, int, jsonb, int[], int, int, int, int) to authenticated;
revoke execute on function public._duel_shot_from() from public, anon, authenticated;
