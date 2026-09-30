-- 069: 🃏 Chaos Cards gets the box's ✨ mirror too (068 wired it through _chaos_after_move, which
--   the card table doesn't use): a play whose x lands on the mirror of the play before drops a card
--   item on the player, like every other game.
-- Applied with the Supabase connector (apply_migration '069_cards_mirror'). Safe to run again.

do $$
declare d text;
begin
  d := pg_get_functiondef('public.card_play(uuid, text, text, uuid, boolean)'::regprocedure);
  if position('_chaos_mirror' in d) > 0 then return; end if;
  if position('    perform _chaos_drop(auth.uid(), ''cards'', p_game, ''A chaos card fluttered loose and'');
  end if;' in d) = 0 then
    raise exception '069: card_play is not the shape this patch expects';
  end if;
  d := replace(d, '    perform _chaos_drop(auth.uid(), ''cards'', p_game, ''A chaos card fluttered loose and'');
  end if;',
  '    perform _chaos_drop(auth.uid(), ''cards'', p_game, ''A chaos card fluttered loose and'');
  end if;
  if _chaos_mirror(p_game) and exists (select 1 from card_games where id = p_game and status = ''playing'') then
    perform _chaos_drop(auth.uid(), ''cards'', p_game, '' the mirror: x landed on 1 minus the play before'');   -- ✨ symmetry (069)
  end if;');
  execute d;
end $$;
