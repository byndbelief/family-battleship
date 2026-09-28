-- 036: Putt Post gets a bigger course for 4 or more players. golf_games.course is the size in
-- percent: 100 for 1-3 players, 120 for 4, 135 for 5, 150 for 6. Every hole is scaled up by it on
-- the page (ball and cup keep their size, putts go that much faster), so the page shows more
-- green, zoomed out. A trigger sets it from the players however the game is made (a new game or a
-- Gauntlet round). Games already under way keep 100, so their saved putts replay the same.
-- Applied with the Supabase connector (apply_migration '036_golf_course_size'). Safe to run again.

alter table public.golf_games add column if not exists course int not null default 100;
alter table public.golf_games drop constraint if exists golf_games_course_check;
alter table public.golf_games add constraint golf_games_course_check check (course between 100 and 200);

create or replace function public._golf_course_size() returns trigger
language plpgsql set search_path = public as $$
begin
  new.course := case when cardinality(new.players) >= 6 then 150 when cardinality(new.players) = 5 then 135
                     when cardinality(new.players) = 4 then 120 else 100 end;
  return new;
end $$;
drop trigger if exists golf_course_size on public.golf_games;
create trigger golf_course_size before insert on public.golf_games for each row execute function public._golf_course_size();
revoke execute on function public._golf_course_size() from public, anon, authenticated;
