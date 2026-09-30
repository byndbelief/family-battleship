-- 🧭 YOUR COMPANION BENDS THE CURVE'S EDGES (CHAOS.md § The pals; web/chaos.js EDGES says the same):
--   Fig (chaos): the peak line is 0.68, not 0.75: your moves twist more often.
--   Kit (symmetry): the mirror is 0.05 wide, not 0.02; balance 0.03, not 0.01.
--   Bit (fractals): the window lasts 7 moves (22–28), not 3: no twists, things in threes, longer.
--   Phi (geometry): the golden cut is 0.03 wide, not 0.012; Fibonacci luck is doubled.
-- The mover reaches these through the chaos.mover setting (078). Safe to re-run.
create or replace function public._chaos_edge(p_pal text, p_what text) returns float8
language sql immutable as $$
  select case p_what
    when 'peak' then case when p_pal = 'fig' then 0.68 else 0.75 end
    when 'mirror' then case when p_pal = 'kit' then 0.05 else 0.02 end
    when 'balance' then case when p_pal = 'kit' then 0.03 else 0.01 end
    when 'golden' then case when p_pal = 'phi' then 0.03 else 0.012 end
    when 'fib_luck' then case when p_pal = 'phi' then 2.0 else 1.0 end
    when 'win_lo' then case when p_pal = 'bit' then 22 else 24 end
    when 'win_hi' then case when p_pal = 'bit' then 28 else 26 end
    else 0 end
$$;
create or replace function public._chaos_mover() returns uuid
language sql stable as $$ select nullif(current_setting('chaos.mover', true), '')::uuid $$;
-- the mirror and the golden cut, at the mover's width
create or replace function public._chaos_mirror(p_game uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(cardinality(hist) >= 2 and abs(hist[cardinality(hist)] - (1 - hist[cardinality(hist) - 1])) < _chaos_edge(_chaos_companion(_chaos_mover()), 'mirror'), false)
  from chaos_curve where game_id = p_game;
$$;
create or replace function public._chaos_golden(p_game uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(abs(x - 0.6180339887) < _chaos_edge(_chaos_companion(_chaos_mover()), 'golden'), false) from chaos_curve where game_id = p_game;
$$;
do $$ declare d text; old text; pal text; begin
  -- _chaos_curve: the mover's peak line and window
  d := pg_get_functiondef('public._chaos_curve(text,uuid)'::regprocedure);
  if position('_chaos_edge(' in d) = 0 then
    old := '  win := (c.n + 1) between 24 and 26;';
    if position(old in d) = 0 then raise exception '079: window line not found in _chaos_curve'; end if;
    d := replace(d, old, E'  mover := _chaos_mover();   -- 🧭 whose edges (079)\n  win := (c.n + 1) between _chaos_edge(_chaos_companion(mover), ''win_lo'')::int and _chaos_edge(_chaos_companion(mover), ''win_hi'')::int;');
    old := '  return nx > 0.75 and not win;';
    if position(old in d) = 0 then raise exception '079: return line not found in _chaos_curve'; end if;
    d := replace(d, old, '  return nx > _chaos_edge(_chaos_companion(mover), ''peak'') and not win;');
    execute d;
  end if;
  -- Fibonacci luck, in the two move paths
  d := pg_get_functiondef('public._chaos_after_move(text,uuid,uuid,uuid[],double precision,double precision,text)'::regprocedure);
  old := 'if _chaos_fib(p_game) and random() < 0.35 then';
  if position(old in d) > 0 then execute replace(d, old, 'if _chaos_fib(p_game) and random() < 0.35 * _chaos_edge(_chaos_companion(p_mover), ''fib_luck'') then'); end if;
  d := pg_get_functiondef('public.card_play(uuid,text,text,uuid,boolean)'::regprocedure);
  old := 'if _chaos_fib(p_game) and random() < 0.35 then';
  if position(old in d) > 0 then execute replace(d, old, 'if _chaos_fib(p_game) and random() < 0.35 * _chaos_edge(_chaos_companion(auth.uid()), ''fib_luck'') then'); end if;
  -- the rating marks what the player's own edges met
  d := pg_get_functiondef('public._chaos_mark_move(uuid,text,uuid)'::regprocedure);
  if position('_chaos_edge(' in d) = 0 then
    old := '  win := c.n between 24 and 26;';
    if position(old in d) = 0 then raise exception '079: window line not found in _chaos_mark_move'; end if;
    d := replace(d, old, '  win := c.n between _chaos_edge(_chaos_companion(p_player), ''win_lo'')::int and _chaos_edge(_chaos_companion(p_player), ''win_hi'')::int;');
    old := 'if c.x > 0.75 and not win then';
    if position(old in d) = 0 then raise exception '079: peak line not found in _chaos_mark_move'; end if;
    d := replace(d, old, 'if c.x > _chaos_edge(_chaos_companion(p_player), ''peak'') and not win then');
    old := 'if abs(c.x - (1 - 1 / c.r)) < 0.01 then';
    if position(old in d) = 0 then raise exception '079: balance line not found in _chaos_mark_move'; end if;
    d := replace(d, old, 'if abs(c.x - (1 - 1 / c.r)) < _chaos_edge(_chaos_companion(p_player), ''balance'') then');
    execute d;
  end if;
end $$;
revoke execute on function public._chaos_edge(text, text), public._chaos_mover() from public, anon, authenticated;
