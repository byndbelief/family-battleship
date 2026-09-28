-- 020: delete finished games, Gauntlets and rounds from your own list.
-- Applied with the Supabase connector (apply_migration '020_hide_finished'). Safe to run again.
--
-- Games are shared, so "delete" here is per player: the game leaves your Your games list and
-- stays in everyone else's. Nothing else changes: the results log (scoreboard, trophies) and
-- the Gauntlet titles on the rival cards keep counting it. Only finished games can go.
-- Deleting a Gauntlet takes all its finished rounds with it (and the Gauntlet itself once over).

create table if not exists public.hidden_games (
  player uuid not null references public.profiles (id) on delete cascade,
  game_id uuid not null,              -- a game of any kind, or a Gauntlet
  hidden_at timestamptz not null default now(),
  primary key (player, game_id)
);
alter table public.hidden_games enable row level security;
drop policy if exists "see what you deleted" on public.hidden_games;
create policy "see what you deleted" on public.hidden_games for select to authenticated using (player = auth.uid());
revoke insert, update, delete, truncate on public.hidden_games from anon, authenticated;

-- Every finished game of p_player's, of every kind (optionally only one Gauntlet's rounds).
create or replace function public._finished_games(p_player uuid, p_gauntlet uuid default null) returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from games where status = 'over' and p_player = any (players) and (p_gauntlet is null or gauntlet_id = p_gauntlet)
  union all select id from golf_games where status = 'over' and p_player = any (players) and (p_gauntlet is null or gauntlet_id = p_gauntlet)
  union all select id from duel_games where status = 'over' and p_player = any (players) and (p_gauntlet is null or gauntlet_id = p_gauntlet)
  union all select id from card_games where status = 'over' and p_player = any (players) and (p_gauntlet is null or gauntlet_id = p_gauntlet)
$$;

-- One finished game, or a Gauntlet with its finished rounds. Returns how many went.
create or replace function public.hide_finished(p_game uuid) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); gt gauntlets; n int;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into gt from gauntlets where id = p_game and me = any (players);
  if found then
    insert into hidden_games (player, game_id) select me, x from _finished_games(me, p_game) x on conflict do nothing;
    get diagnostics n = row_count;
    if gt.status = 'over' then insert into hidden_games (player, game_id) values (me, p_game) on conflict do nothing; end if;
    return n;
  end if;
  if not exists (select 1 from _finished_games(me) x where x = p_game) then
    raise exception 'Only finished games can be deleted';
  end if;
  insert into hidden_games (player, game_id) values (me, p_game) on conflict do nothing;
  return 1;
end $$;

-- Every finished game and finished Gauntlet of yours at once.
create or replace function public.hide_all_finished() returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int;
begin
  if me is null then raise exception 'Sign in first'; end if;
  insert into hidden_games (player, game_id) select me, x from _finished_games(me) x on conflict do nothing;
  get diagnostics n = row_count;
  insert into hidden_games (player, game_id) select me, id from gauntlets where status = 'over' and me = any (players) on conflict do nothing;
  return n;
end $$;

revoke execute on function public._finished_games(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.hide_finished(uuid), public.hide_all_finished() from public, anon;
grant execute on function public.hide_finished(uuid), public.hide_all_finished() to authenticated;
