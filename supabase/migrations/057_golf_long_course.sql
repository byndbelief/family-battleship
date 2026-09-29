-- 057: Putt Post's long course. On a course of 160 and up (055) putts now keep a 1-player course's
--   power (golf-engine.js: POWER), so a bigger course takes more putts, and the more players, the
--   bigger it is: golf_games.course 200 for 1-2 players, 250 for 3, 300 for 4, 350 for 5, 400 for 6
--   (055 had 170-240, and scaled the putts up with it). Par grows with it:
--   _golf_par(hole, course) is the base par plus (par * (course - 100) * 110 + 30000) / 60000 in
--   integers (parOf in golf-engine.js), e.g. a par 3 is 4 at 200-300 and 5 at 400. You pick up at
--   par + 5 there, so a hole may now take up to 20 strokes (24 putts) on the card. No game had been
--   made on a 055 course, so nothing saved changes; older courses (100-150) keep their par and play.
-- Applied with the Supabase connector (apply_migration '057_golf_long_course'). Safe to run again.

alter table public.golf_games drop constraint if exists golf_games_course_check;
alter table public.golf_games add constraint golf_games_course_check check (course between 100 and 400);

create or replace function public._golf_course_size() returns trigger
language plpgsql set search_path = public as $$
begin
  new.course := case when cardinality(new.players) >= 6 then 400 when cardinality(new.players) = 5 then 350
                     when cardinality(new.players) = 4 then 300 when cardinality(new.players) = 3 then 250 else 200 end;
  return new;
end $$;
revoke execute on function public._golf_course_size() from public, anon, authenticated;

create or replace function public._golf_par(hole integer, course integer) returns integer
language sql immutable as $$
  select case when coalesce(course, 100) < 160 then _golf_par(hole)
              else _golf_par(hole) + (_golf_par(hole) * (course - 100) * 110 + 30000) / 60000 end
$$;

do $$
declare d text;
begin
  d := pg_get_functiondef('public._golf_submit(uuid,uuid,jsonb,integer,integer,boolean)'::regprocedure);
  if position('_golf_par(cur_hole, g.course)' in d) = 0 then
    if position('p_actual not between 1 and 12' in d) = 0 or position('jsonb_array_length(p_strokes) > 16' in d) = 0
       or position('_golf_par(cur_hole)' in d) = 0 or position('sum(_golf_par(tu.hole))' in d) = 0 then
      raise exception '057: _golf_submit is not the shape this patch expects';
    end if;
    d := replace(d, 'p_actual not between 1 and 12', 'p_actual not between 1 and 20');
    d := replace(d, 'jsonb_array_length(p_strokes) > 16', 'jsonb_array_length(p_strokes) > 24');
    d := replace(d, '_golf_par(cur_hole)', '_golf_par(cur_hole, g.course)');
    d := replace(d, 'sum(_golf_par(tu.hole))', 'sum(_golf_par(tu.hole, g.course))');
    execute d;
  end if;
  d := pg_get_functiondef('public._log_result(text,uuid)'::regprocedure);
  if position('_golf_par(hole, gg.course)' in d) = 0 then
    if position('_golf_par(hole)' in d) = 0 then raise exception '057: _log_result is not the shape this patch expects'; end if;
    execute replace(d, '_golf_par(hole)', '_golf_par(hole, gg.course)');
  end if;
end $$;
