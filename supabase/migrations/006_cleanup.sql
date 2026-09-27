-- 006: deleting a game cleans up after it.
-- Run once in Supabase > SQL Editor, after 005_chaos.sql. Safe to run again.
--
-- A Gauntlet whose current round is deleted can't go on, so it goes too (rounds already
-- finished stay as ordinary finished games). The chaos feed forgets news about a deleted game.

create or replace function public._game_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  delete from chaos_events where game_id = old.id;
  if old.gauntlet_id is not null then
    delete from gauntlets where id = old.gauntlet_id and current_game = old.id and status <> 'over' returning id into gid;
    if gid is not null then delete from chaos_events where game_id = gid; end if;
  end if;
  return old;
end $$;

drop trigger if exists game_deleted on public.games;
create trigger game_deleted after delete on public.games for each row execute function public._game_deleted();
drop trigger if exists game_deleted on public.golf_games;
create trigger game_deleted after delete on public.golf_games for each row execute function public._game_deleted();
drop trigger if exists game_deleted on public.duel_games;
create trigger game_deleted after delete on public.duel_games for each row execute function public._game_deleted();

-- The player who started a Gauntlet can call it off; its unfinished round goes with it.
create or replace function public.gauntlet_delete(p_gauntlet uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from gauntlets where id = p_gauntlet and created_by = auth.uid()) then
    raise exception 'Only the player who started the Gauntlet can call it off';
  end if;
  delete from games where gauntlet_id = p_gauntlet and status <> 'over';
  delete from golf_games where gauntlet_id = p_gauntlet and status <> 'over';
  delete from duel_games where gauntlet_id = p_gauntlet and status <> 'over';
  delete from chaos_events where game_id = p_gauntlet;
  delete from gauntlets where id = p_gauntlet;
end $$;
revoke execute on function public.gauntlet_delete(uuid) from public, anon;
grant execute on function public.gauntlet_delete(uuid) to authenticated;
revoke execute on function public._game_deleted() from public, anon, authenticated;

-- One-time tidy-up of anything already stranded by earlier deletes.
delete from gauntlets g
  where g.status <> 'over'
    and not exists (select 1 from games where id = g.current_game)
    and not exists (select 1 from golf_games where id = g.current_game)
    and not exists (select 1 from duel_games where id = g.current_game);
delete from chaos_events e
  where e.game_id is not null
    and not exists (select 1 from games where id = e.game_id)
    and not exists (select 1 from golf_games where id = e.game_id)
    and not exists (select 1 from duel_games where id = e.game_id)
    and not exists (select 1 from gauntlets where id = e.game_id);
