-- 022: who has placed their fleet, for everyone to see.
-- Applied with the Supabase connector (apply_migration '022_fleet_ready'). Safe to run again.
-- Fleets stay secret until the game ends (you can only read your own), so the Battleship ready
-- check had no way to tell who else was set. games.ready lists them, kept by a trigger on every
-- fleet placed (people through place_fleet, robots at creation), and the games update it makes
-- reaches every page over realtime.

alter table public.games add column if not exists ready uuid[] not null default '{}';

create or replace function public._fleet_ready() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update games set ready = array_append(array_remove(ready, new.player_id), new.player_id), updated_at = now() where id = new.game_id;
  return new;
end $$;
revoke execute on function public._fleet_ready() from public, anon, authenticated;
drop trigger if exists fleet_ready on public.fleets;
create trigger fleet_ready after insert on public.fleets for each row execute function public._fleet_ready();

-- Games already in progress.
update games g set ready = array(select f.player_id from fleets f where f.game_id = g.id order by f.player_id)
  where g.ready = '{}' and exists (select 1 from fleets f where f.game_id = g.id);
