-- 055: Putt Post's big course. Every new game is played on a stage bigger than the screen: the page
--   opens each hole on the whole layout, then zooms down onto the tee (over the countdown in a live
--   race) and follows the ball at its normal size (the camera in golf.js). The more players, the
--   bigger the stage: golf_games.course 170 for 1-2 players, 185 for 3, 200 for 4, 220 for 5, 240
--   for 6 (was 100 / 120 / 135 / 150, zoomed out to fit). At 160 and up, par-4 holes are labyrinths
--   (mazeHole in golf-engine.js), more cells the bigger the course. Games already under way keep
--   their size and holes, so their saved putts replay the same.
-- Applied with the Supabase connector (apply_migration '055_golf_big_course'). Safe to run again.

alter table public.golf_games drop constraint if exists golf_games_course_check;
alter table public.golf_games add constraint golf_games_course_check check (course between 100 and 300);

create or replace function public._golf_course_size() returns trigger
language plpgsql set search_path = public as $$
begin
  new.course := case when cardinality(new.players) >= 6 then 240 when cardinality(new.players) = 5 then 220
                     when cardinality(new.players) = 4 then 200 when cardinality(new.players) = 3 then 185 else 170 end;
  return new;
end $$;
revoke execute on function public._golf_course_size() from public, anon, authenticated;
