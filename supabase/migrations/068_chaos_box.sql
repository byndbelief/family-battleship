-- 068: 🌀 THE BOX. The chaos standard (CHAOS.md, web/chaos.js) applied to the server's curve, which
--   drives every multiplayer game. The numbers are unchanged (r 2.9 → 4 by 0.04 a move, twist above
--   0.75, Route to Chaos rounds start 6 moves further along); what's new is the symmetry:
--   * The window: at r in [3.8284, 3.8415] (the period-3 window inside chaos) no move twists, and
--     the players hear once that the chaos has fallen into a rhythm of 3.
--   * The mirror: a move whose x lands on the mirror of the move before (|x − (1 − x_prev)| < 0.02,
--     since f(x) = f(1−x)) is a ✨ symmetry beat: the mover gets a drop (_chaos_after_move).
--   * Full chaos: reaching r = 4 is announced, like the other phases.
--   The page's chaos.js implements the same steps; t_chaosbox runs both from one x0 and compares.
-- Applied with the Supabase connector (apply_migration '068_chaos_box'). Safe to run again.

create or replace function public._chaos_curve(p_kind text, p_game uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare c chaos_curve; ps uuid[]; gid uuid; n0 int := 0; nr float8; nx float8; other uuid; phase text; win boolean;
begin
  select * into c from chaos_curve where game_id = p_game for update;
  if not found then
    case p_kind
      when 'battleship' then select players, gauntlet_id into ps, gid from games where id = p_game;
      when 'golf' then select players, gauntlet_id into ps, gid from golf_games where id = p_game;
      when 'duel' then select players, gauntlet_id into ps, gid from duel_games where id = p_game;
      when 'cards' then select players, gauntlet_id into ps, gid from card_games where id = p_game;
      else null;
    end case;
    if ps is null then return false; end if;
    -- 🌀 Route to Chaos (062): each round starts further along the curve.
    if gid is not null then select greatest(0, (round - 1) * 6) into n0 from gauntlets where id = gid; end if;
    insert into chaos_curve (game_id, kind, players, x, n, r) values (p_game, p_kind, ps, 0.05 + random() * 0.9, coalesce(n0, 0), least(4.0, 2.9 + 0.04 * coalesce(n0, 0)))
      on conflict (game_id) do nothing;
    select * into c from chaos_curve where game_id = p_game for update;
  end if;
  nr := least(4.0, 2.9 + 0.04 * (c.n + 1));
  nx := nr * c.x * (1 - c.x);
  if nx <= 1e-9 or nx >= 1 - 1e-9 then nx := 0.5 + (random() - 0.5) * 1e-3; end if;   -- stuck on 0 or 1: a butterfly flaps
  update chaos_curve set n = c.n + 1, r = nr, x = nx, updated_at = now(),
    hist = (hist || nx::real)[greatest(1, cardinality(hist) + 2 - 48):]
    where game_id = p_game;
  win := (c.n + 1) between 24 and 26;   -- 🔁 the period-3 window (068): three moves as r passes 1 + √8 (by move, so a 0.04 step can't skip it)
  phase := case when nr >= 4 and c.r < 4 then 'r = 4: the top of the curve. Full chaos.'
                when win and not (c.n between 24 and 26) then '🔁 THE WINDOW: inside the chaos, a rhythm of 3. No twists here; things come in threes.'
                when c.r < 3.5699 and nr >= 3.5699 then 'CHAOS. The curve has no rhythm left: anything can happen now.'
                when c.r < 3.544 and nr >= 3.544 then 'Split again: 8, 16, 32… the rhythm is falling apart.'
                when c.r < 3.449 and nr >= 3.449 then 'The curve split again: a rhythm of 4. Period doubling has begun.'
                when c.r < 3.0 and nr >= 3.0 then 'The chaos curve split in two: twists now come every other move. x → r·x·(1−x)' end;
  if phase is not null then
    foreach other in array c.players loop perform _chaos_event(other, null, 'twist', p_kind, p_game, '🌀', phase); end loop;
  end if;
  return nx > 0.75 and not win;
end $$;
revoke execute on function public._chaos_curve(text, uuid) from public, anon, authenticated;

-- ✨ Did the last move land on the mirror of the one before? (f(x) = f(1−x))
create or replace function public._chaos_mirror(p_game uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(cardinality(hist) >= 2 and abs(hist[cardinality(hist)] - (1 - hist[cardinality(hist) - 1])) < 0.02, false)
  from chaos_curve where game_id = p_game;
$$;
revoke execute on function public._chaos_mirror(uuid) from public, anon, authenticated;

do $$
declare d text;
begin
  d := pg_get_functiondef('public._chaos_after_move(text, uuid, uuid, uuid[], double precision, double precision, text)'::regprocedure);
  if position('_chaos_mirror' in d) > 0 then return; end if;
  if position('if _chaos_curve(p_kind, p_game) then perform _chaos_twist(p_kind, p_game); end if;' in d) = 0 then
    raise exception '068: _chaos_after_move is not the shape this patch expects';
  end if;
  d := replace(d, 'if _chaos_curve(p_kind, p_game) then perform _chaos_twist(p_kind, p_game); end if;',
    'if _chaos_curve(p_kind, p_game) then perform _chaos_twist(p_kind, p_game); end if;
  if _chaos_mirror(p_game) then perform _chaos_drop(p_mover, p_kind, p_game, '' the mirror: x landed on 1 minus the move before''); end if;   -- ✨ symmetry (068)');
  execute d;
end $$;
