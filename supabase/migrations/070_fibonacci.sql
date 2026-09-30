-- 070: 🌻 Fibonacci joins the box (CHAOS.md). For the multiplayer games:
--   * The golden cut: a move whose x lands within 0.012 of 1/φ = 0.618 drops loot on the mover.
--   * Fibonacci moves: on move 1, 2, 3, 5, 8, 13, 21, 34, 55, 89 of the curve, luck runs higher: a 35%
--     drop on top of the usual odds.
--   Battleship, Putt Post and Hilltop get both through _chaos_after_move; Chaos Cards through card_play.
-- Applied with the Supabase connector (apply_migration '070_fibonacci'). Safe to run again.

create or replace function public._chaos_golden(p_game uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(abs(x - 0.6180339887) < 0.012, false) from chaos_curve where game_id = p_game;
$$;
create or replace function public._chaos_fib(p_game uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(n = any (array[1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144]), false) from chaos_curve where game_id = p_game;
$$;
revoke execute on function public._chaos_golden(uuid), public._chaos_fib(uuid) from public, anon, authenticated;

do $$
declare d text;
begin
  d := pg_get_functiondef('public._chaos_after_move(text, uuid, uuid, uuid[], double precision, double precision, text)'::regprocedure);
  if position('_chaos_golden' in d) > 0 then return; end if;
  if position('perform _chaos_drop(p_mover, p_kind, p_game, '' the mirror: x landed on 1 minus the move before''); end if;' in d) = 0 then
    raise exception '070: _chaos_after_move is not the shape this patch expects';
  end if;
  d := replace(d, 'perform _chaos_drop(p_mover, p_kind, p_game, '' the mirror: x landed on 1 minus the move before''); end if;',
    'perform _chaos_drop(p_mover, p_kind, p_game, '' the mirror: x landed on 1 minus the move before''); end if;
  if _chaos_golden(p_game) then perform _chaos_drop(p_mover, p_kind, p_game, '' the golden cut: x landed on 1/φ''); end if;   -- 🌻 (070)
  if _chaos_fib(p_game) and random() < 0.35 then perform _chaos_drop(p_mover, p_kind, p_game, '' a Fibonacci move: luck runs higher''); end if;');
  execute d;
end $$;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.card_play(uuid, text, text, uuid, boolean)'::regprocedure);
  if position('_chaos_golden' in d) > 0 then return; end if;
  if position('the mirror: x landed on 1 minus the play before'');   -- ✨ symmetry (069)
  end if;' in d) = 0 then
    raise exception '070: card_play is not the shape this patch expects';
  end if;
  d := replace(d, 'the mirror: x landed on 1 minus the play before'');   -- ✨ symmetry (069)
  end if;',
    'the mirror: x landed on 1 minus the play before'');   -- ✨ symmetry (069)
  end if;
  if exists (select 1 from card_games where id = p_game and status = ''playing'') then   -- 🌻 (070)
    if _chaos_golden(p_game) then perform _chaos_drop(auth.uid(), ''cards'', p_game, '' the golden cut: x landed on 1/φ''); end if;
    if _chaos_fib(p_game) and random() < 0.35 then perform _chaos_drop(auth.uid(), ''cards'', p_game, '' a Fibonacci play: luck runs higher''); end if;
  end if;');
  execute d;
end $$;
