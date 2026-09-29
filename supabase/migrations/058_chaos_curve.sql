-- 058: The chaos curve. Chaos twists no longer come at a flat 33% a move: every game carries the
--   logistic map, x -> r*x*(1-x), and a move twists when x lands above 0.75. x starts anywhere
--   (0.05-0.95: two games never share a path), r starts at 2.9 and climbs 0.04 a move to 4:
--     r < 3        calm: x settles on one value below 0.75, no twists
--     3 - 3.449    x flips between two values: a twist every other move
--     3.449 - 3.544  a rhythm of 4, then 8, 16 ... (period doubling)
--     3.5699 on    chaos: no rhythm left; at r = 4 about a third of moves twist
--   The page's 🌀 meter (common.js) draws x's recent values over the bifurcation diagram.
--   Each doubling and the tip into chaos is news for everyone in the game.
--   Chaos Cards steps it every card; an action card's chaos drop (25% before) now fires with it.
-- Applied with the Supabase connector (apply_migration '058_chaos_curve'). Safe to run again.

create table if not exists public.chaos_curve (
  game_id uuid primary key,
  kind text not null,
  players uuid[] not null,
  n int not null default 0,
  r float8 not null default 2.9,
  x float8 not null,
  hist real[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.chaos_curve enable row level security;
drop policy if exists "your games' chaos curve" on public.chaos_curve;
create policy "your games' chaos curve" on public.chaos_curve for select to authenticated using (auth.uid() = any (players));
grant select on public.chaos_curve to authenticated;

-- One step of the curve for a game; true when this move twists.
create or replace function public._chaos_curve(p_kind text, p_game uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare c chaos_curve; ps uuid[]; nr float8; nx float8; other uuid; phase text;
begin
  select * into c from chaos_curve where game_id = p_game for update;
  if not found then
    ps := case p_kind when 'battleship' then (select players from games where id = p_game)
                      when 'golf' then (select players from golf_games where id = p_game)
                      when 'duel' then (select players from duel_games where id = p_game)
                      when 'cards' then (select players from card_games where id = p_game) end;
    if ps is null then return false; end if;
    insert into chaos_curve (game_id, kind, players, x) values (p_game, p_kind, ps, 0.05 + random() * 0.9)
      on conflict (game_id) do nothing;
    select * into c from chaos_curve where game_id = p_game for update;
  end if;
  nr := least(4.0, 2.9 + 0.04 * (c.n + 1));
  nx := nr * c.x * (1 - c.x);
  if nx <= 1e-9 or nx >= 1 - 1e-9 then nx := 0.5 + (random() - 0.5) * 1e-3; end if;   -- stuck on 0 or 1: a butterfly flaps
  update chaos_curve set n = c.n + 1, r = nr, x = nx, updated_at = now(),
    hist = (hist || nx::real)[greatest(1, cardinality(hist) + 2 - 48):]
    where game_id = p_game;
  phase := case when c.r < 3.5699 and nr >= 3.5699 then 'CHAOS. The curve has no rhythm left: anything can happen now.'
                when c.r < 3.544 and nr >= 3.544 then 'Split again: 8, 16, 32… the rhythm is falling apart.'
                when c.r < 3.449 and nr >= 3.449 then 'The curve split again: a rhythm of 4. Period doubling has begun.'
                when c.r < 3.0 and nr >= 3.0 then 'The chaos curve split in two: twists now come every other move. x → r·x·(1−x)' end;
  if phase is not null then
    foreach other in array c.players loop perform _chaos_event(other, null, 'twist', p_kind, p_game, '🌀', phase); end loop;
  end if;
  return nx > 0.75;
end $$;
revoke execute on function public._chaos_curve(text, uuid) from public, anon, authenticated;

do $$
declare d text;
begin
  d := pg_get_functiondef('public._chaos_after_move(text,uuid,uuid,uuid[],double precision,double precision,text)'::regprocedure);
  if position('_chaos_curve(p_kind, p_game)' in d) = 0 then
    if position('if random() < 0.33 then perform _chaos_twist(p_kind, p_game); end if;' in d) = 0 then raise exception '058: _chaos_after_move is not the shape this patch expects'; end if;
    execute replace(d, 'if random() < 0.33 then perform _chaos_twist(p_kind, p_game); end if;',
                       'if _chaos_curve(p_kind, p_game) then perform _chaos_twist(p_kind, p_game); end if;   -- the chaos curve (058)');
  end if;
  d := pg_get_functiondef('public.card_play'::regproc);
  if position('_chaos_curve(''cards'', p_game)' in d) = 0 then
    if position('if (_card_wild(p_card) or substr(p_card, 2) in (''S'', ''R'', ''+2'')) and random() < 0.25' in d) = 0 then raise exception '058: card_play is not the shape this patch expects'; end if;
    d := replace(d, 'if (_card_wild(p_card) or substr(p_card, 2) in (''S'', ''R'', ''+2'')) and random() < 0.25',
                    'if _chaos_curve(''cards'', p_game) and (_card_wild(p_card) or substr(p_card, 2) in (''S'', ''R'', ''+2''))');
    execute d;
  end if;
end $$;
