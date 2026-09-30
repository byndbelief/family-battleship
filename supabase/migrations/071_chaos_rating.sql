-- 071: 🌀 The chaos rating: keeping score is also about how you play the curve, in every game. Each
--   time a player's move (or a solo game's beat) meets one of the box's events, it goes in the
--   chaos_ledger with the event's weight; a player's rating is the sum, and their rank a phase of the
--   curve (Calm → Rhythm ×2 → Rhythm ×4 → Cascade → Chaos → Strange Attractor).
--   * Multiplayer: _chaos_mark_move reads the curve after a move and marks what it met (peak, gold,
--     gift, mirror, balance, window, fib, golden, phases crossed, r = 4). Wired into _chaos_after_move
--     (Battleship, Putt Post, Hilltop) and card_play (Chaos Cards).
--   * Solo: solo_submit takes p_events (the game's tally of the same events) and marks them.
--   * chaos_ratings() is the family board; chaos_rating_of(player) one player's rating and rank.
-- Applied with the Supabase connector (apply_migration '071_chaos_rating'). Safe to run again.

create table if not exists public.chaos_ledger (
  id bigint generated always as identity primary key,
  player uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  game_id uuid,
  event text not null,
  pts int not null,
  created_at timestamptz not null default now()
);
create index if not exists chaos_ledger_player on public.chaos_ledger (player, created_at desc);
alter table public.chaos_ledger enable row level security;
drop policy if exists "everyone's chaos ledger" on public.chaos_ledger;
create policy "everyone's chaos ledger" on public.chaos_ledger for select to authenticated using (true);
grant select on public.chaos_ledger to authenticated;

-- The weights: what each event of the box is worth.
create or replace function public._chaos_weight(p_event text) returns int
language sql immutable as $$
  select case p_event when 'peak' then 1 when 'gift' then 1 when 'fib' then 2 when 'phase' then 2 when 'big' then 3
                      when 'window' then 4 when 'balance' then 5 when 'mirror' then 8 when 'golden' then 8
                      when 'gold' then 10 when 'r4' then 10 else 0 end
$$;
create or replace function public._chaos_rank(p_rating int) returns text
language sql immutable as $$
  select case when p_rating >= 1280 then 'Strange Attractor' when p_rating >= 640 then 'Chaos' when p_rating >= 320 then 'Cascade'
              when p_rating >= 160 then 'Rhythm ×4' when p_rating >= 60 then 'Rhythm ×2' else 'Calm' end
$$;
create or replace function public._chaos_next_rank(p_rating int) returns int
language sql immutable as $$
  select case when p_rating >= 1280 then null when p_rating >= 640 then 1280 when p_rating >= 320 then 640
              when p_rating >= 160 then 320 when p_rating >= 60 then 160 else 60 end
$$;

create or replace function public._chaos_mark(p_player uuid, p_kind text, p_game uuid, p_event text, p_times int default 1) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_player is null or p_times < 1 or _chaos_weight(p_event) = 0 then return; end if;
  if exists (select 1 from bots where profile_id = p_player) then return; end if;   -- robots don't rate
  insert into chaos_ledger (player, kind, game_id, event, pts) values (p_player, p_kind, p_game, p_event, _chaos_weight(p_event) * least(p_times, 200));
end $$;

-- After a move: what did the curve's beat meet? (The same nine events as web/chaos.js.)
create or replace function public._chaos_mark_move(p_player uuid, p_kind text, p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c chaos_curve; rp float8; win boolean; th float8;
begin
  select * into c from chaos_curve where game_id = p_game;
  if not found or c.n < 1 then return; end if;
  rp := least(4.0, 2.9 + 0.04 * (c.n - 1));
  win := c.n between 24 and 26;
  if win then perform _chaos_mark(p_player, p_kind, p_game, 'window'); end if;
  if c.x > 0.75 and not win then perform _chaos_mark(p_player, p_kind, p_game, 'peak'); end if;
  if c.x > 0.97 then perform _chaos_mark(p_player, p_kind, p_game, 'gold'); end if;
  if c.x < 0.25 then perform _chaos_mark(p_player, p_kind, p_game, 'gift'); end if;
  if _chaos_mirror(p_game) then perform _chaos_mark(p_player, p_kind, p_game, 'mirror'); end if;
  if abs(c.x - (1 - 1 / c.r)) < 0.01 then perform _chaos_mark(p_player, p_kind, p_game, 'balance'); end if;
  if _chaos_fib(p_game) then perform _chaos_mark(p_player, p_kind, p_game, 'fib'); end if;
  if _chaos_golden(p_game) then perform _chaos_mark(p_player, p_kind, p_game, 'golden'); end if;
  foreach th in array array[3.0, 3.449, 3.544, 3.5699] loop
    if rp < th and c.r >= th then perform _chaos_mark(p_player, p_kind, p_game, 'phase'); end if;
  end loop;
  if rp < 4 and c.r >= 4 then perform _chaos_mark(p_player, p_kind, p_game, 'r4'); end if;
end $$;
revoke execute on function public._chaos_mark(uuid, text, uuid, text, int), public._chaos_mark_move(uuid, text, uuid) from public, anon, authenticated;

do $$
declare d text;
begin
  d := pg_get_functiondef('public._chaos_after_move(text, uuid, uuid, uuid[], double precision, double precision, text)'::regprocedure);
  if position('_chaos_mark_move' in d) > 0 then return; end if;
  if position('perform _chaos_drop(p_mover, p_kind, p_game, '' a Fibonacci move: luck runs higher''); end if;' in d) = 0 then
    raise exception '071: _chaos_after_move is not the shape this patch expects';
  end if;
  d := replace(d, 'perform _chaos_drop(p_mover, p_kind, p_game, '' a Fibonacci move: luck runs higher''); end if;',
    'perform _chaos_drop(p_mover, p_kind, p_game, '' a Fibonacci move: luck runs higher''); end if;
  perform _chaos_mark_move(p_mover, p_kind, p_game);   -- 🌀 the chaos rating (071)');
  execute d;
end $$;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.card_play(uuid, text, text, uuid, boolean)'::regprocedure);
  if position('_chaos_mark_move' in d) > 0 then return; end if;
  if position('perform _chaos_drop(auth.uid(), ''cards'', p_game, '' a Fibonacci play: luck runs higher''); end if;' in d) = 0 then
    raise exception '071: card_play is not the shape this patch expects';
  end if;
  d := replace(d, 'perform _chaos_drop(auth.uid(), ''cards'', p_game, '' a Fibonacci play: luck runs higher''); end if;',
    'perform _chaos_drop(auth.uid(), ''cards'', p_game, '' a Fibonacci play: luck runs higher''); end if;
    perform _chaos_mark_move(auth.uid(), ''cards'', p_game);   -- 🌀 the chaos rating (071)');
  execute d;
end $$;

-- One player's rating; the family board.
create or replace function public.chaos_rating_of(p_player uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (select coalesce(sum(pts), 0)::int rating from chaos_ledger where player = p_player)
  select jsonb_build_object('rating', rating, 'rank', _chaos_rank(rating), 'next', _chaos_next_rank(rating),
    'counts', (select coalesce(jsonb_object_agg(event, n), '{}') from (select event, sum(pts) / _chaos_weight(event) n from chaos_ledger where player = p_player group by event) e))
  from s;
$$;
create or replace function public.chaos_ratings() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('player', p.id, 'name', p.username, 'rating', r.rating, 'rank', _chaos_rank(r.rating), 'next', _chaos_next_rank(r.rating),
           'counts', (select coalesce(jsonb_object_agg(event, n), '{}') from (select event, sum(pts) / _chaos_weight(event) n from chaos_ledger where player = p.id group by event) e),
           'week', (select coalesce(sum(pts), 0) from chaos_ledger where player = p.id and created_at > now() - interval '7 days'))
         order by r.rating desc, p.username), '[]')
  from profiles p join lateral (select coalesce(sum(pts), 0)::int rating from chaos_ledger where player = p.id) r on true
  where not exists (select 1 from bots b where b.profile_id = p.id);
$$;
revoke execute on function public.chaos_rating_of(uuid), public.chaos_ratings() from public, anon;
grant execute on function public.chaos_rating_of(uuid), public.chaos_ratings() to authenticated;

-- Solo games hand in their tally of the box's events with the score.
drop function if exists public.solo_submit(text, int, int);
create or replace function public.solo_submit(p_game text, p_score int, p_level int, p_events jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); prev int; top jsonb; k text; v int; before int;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if p_game is null or p_game not in ('squirrel', 'fractal') then raise exception 'Unknown game'; end if;
  if p_score is null or p_score not between 0 and 1000000 or p_level is null or p_level not between 1 and 99 then raise exception 'Bad score'; end if;
  if exists (select 1 from solo_scores where player = me and game = p_game and created_at > now() - interval '20 seconds') then
    raise exception 'One run at a time';
  end if;
  select max(score) into prev from solo_scores where player = me and game = p_game;
  insert into solo_scores (player, game, score, level) values (me, p_game, p_score, p_level);
  select coalesce(sum(pts), 0) into before from chaos_ledger where player = me;
  if jsonb_typeof(p_events) = 'object' then   -- 🌀 the chaos rating (071): each event so many times
    for k, v in select key, least(200, greatest(0, coalesce((value #>> '{}')::int, 0))) from jsonb_each(p_events) where value #>> '{}' ~ '^\d+$' loop
      perform _chaos_mark(me, p_game, null, k, v);
    end loop;
  end if;
  select coalesce(jsonb_agg(x order by (x ->> 'score')::int desc), '[]') into top from (
    select jsonb_build_object('player', player, 'name', _uname(player), 'score', score, 'level', level) x
    from (select distinct on (player) player, score, level from solo_scores where game = p_game order by player, score desc) b
    order by score desc limit 5) t;
  return jsonb_build_object('best', greatest(coalesce(prev, 0), p_score), 'record', p_score > coalesce(prev, -1), 'top', top,
    'chaos', chaos_rating_of(me) || jsonb_build_object('gained', (select coalesce(sum(pts), 0) from chaos_ledger where player = me) - before));
end $$;
revoke execute on function public.solo_submit(text, int, int, jsonb) from public, anon;
grant execute on function public.solo_submit(text, int, int, jsonb) to authenticated;
