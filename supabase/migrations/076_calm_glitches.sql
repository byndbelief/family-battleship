-- ⚡ Glitches (CHAOS.md § Calm): the chaos leaks through a calm. While a curve is held, a move whose
-- x lands above 0.7 changes nothing in the rules but posts a 'glitch' event, and the pages flicker:
-- the theme swaps for a second, tanks turn into squirrels, cards too. Safe to re-run.
do $$ declare d text; old text; begin
  d := pg_get_functiondef('public._chaos_curve(text,uuid)'::regprocedure);
  old := E'    if c.hold = 1 then\n      foreach other in array c.players loop perform _chaos_event(other, null, ''twist'', p_kind, p_game, ''😎'', ''Here comes that chaos curve again: from the next move r climbs and peaks twist.''); end loop;\n    end if;\n    return false;';
  if position('⚡' in d) > 0 then return; end if;   -- already patched
  if position(old in d) = 0 then raise exception '076: hold branch not found in _chaos_curve (074 not applied?)'; end if;
  d := replace(d, old, E'    if nx > 0.7 then   -- ⚡ a glitch: the chaos leaks through the calm (nothing changes; the pages flicker)\n      foreach other in array c.players loop perform _chaos_event(other, null, ''glitch'', p_kind, p_game, ''⚡'', ''GLITCH: the chaos leaked through the calm for a moment. Nothing changed. Probably.''); end loop;\n    end if;\n' || old);
  execute d;
end $$;
