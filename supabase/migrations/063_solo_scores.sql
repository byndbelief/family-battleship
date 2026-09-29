-- 063: Solo games, starting with 🐿️ Squirrel Chaos (squirrel.html): a run is played on the page and
--   its score saved here. solo_submit(game, score, level) keeps every run, answers with your best
--   and the family's top five (best run each). Scores are sanity-checked, not proven: it's a family
--   game room. Everyone signed in can see everyone's scores.
-- Applied with the Supabase connector (apply_migration '063_solo_scores'). Safe to run again.

create table if not exists public.solo_scores (
  id bigint generated always as identity primary key,
  player uuid not null references public.profiles(id) on delete cascade,
  game text not null check (game in ('squirrel')),
  score int not null check (score between 0 and 1000000),
  level int not null default 1 check (level between 1 and 99),
  created_at timestamptz not null default now()
);
create index if not exists solo_scores_game on public.solo_scores (game, score desc);
alter table public.solo_scores enable row level security;
drop policy if exists "everyone's solo scores" on public.solo_scores;
create policy "everyone's solo scores" on public.solo_scores for select to authenticated using (true);
grant select on public.solo_scores to authenticated;

create or replace function public.solo_submit(p_game text, p_score int, p_level int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); prev int; top jsonb;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if p_game is distinct from 'squirrel' then raise exception 'Unknown game'; end if;
  if p_score is null or p_score not between 0 and 1000000 or p_level is null or p_level not between 1 and 99 then raise exception 'Bad score'; end if;
  if exists (select 1 from solo_scores where player = me and game = p_game and created_at > now() - interval '20 seconds') then
    raise exception 'One run at a time';
  end if;
  select max(score) into prev from solo_scores where player = me and game = p_game;
  insert into solo_scores (player, game, score, level) values (me, p_game, p_score, p_level);
  select coalesce(jsonb_agg(x order by (x ->> 'score')::int desc), '[]') into top from (
    select jsonb_build_object('player', player, 'name', _uname(player), 'score', score, 'level', level) x
    from (select distinct on (player) player, score, level from solo_scores where game = p_game order by player, score desc) b
    order by score desc limit 5) t;
  return jsonb_build_object('best', greatest(coalesce(prev, 0), p_score), 'record', p_score > coalesce(prev, -1), 'top', top);
end $$;
revoke execute on function public.solo_submit(text, int, int) from public, anon;
grant execute on function public.solo_submit(text, int, int) to authenticated;
