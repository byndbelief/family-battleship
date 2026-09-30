-- ⚡ Glitches belong to players (CHAOS.md § Calm): the move that leaks through the calm is somebody's,
-- and it is THEIR companion that leaks: the event carries the mover (actor) and the companion in its
-- kind ('glitch:<pal>'), and says whose it was. The mover reaches _chaos_curve through a transaction
-- setting (chaos.mover) set by _chaos_after_move and card_play, its two callers. Safe to re-run.
do $$ declare d text; old text; begin
  -- 1. _chaos_after_move: name the mover before stepping the curve
  d := pg_get_functiondef('public._chaos_after_move(text,uuid,uuid,uuid[],double precision,double precision,text)'::regprocedure);
  old := 'if _chaos_curve(p_kind, p_game) then perform _chaos_twist(p_kind, p_game); end if;';
  if position('chaos.mover' in d) = 0 then
    if position(old in d) = 0 then raise exception '078: curve call not found in _chaos_after_move'; end if;
    d := replace(d, old, 'perform set_config(''chaos.mover'', coalesce(p_mover::text, ''''), true); ' || old);
    execute d;
  end if;
  -- 2. card_play: the same
  d := pg_get_functiondef('public.card_play(uuid,text,text,uuid,boolean)'::regprocedure);
  old := 'perform _card_play(p_game, auth.uid(), p_card, p_color, p_target, p_last);';
  if position('chaos.mover' in d) = 0 then
    if position(old in d) = 0 then raise exception '078: _card_play call not found in card_play'; end if;
    d := replace(d, old, old || ' perform set_config(''chaos.mover'', auth.uid()::text, true);');
    execute d;
  end if;
  -- 3. _chaos_curve: the glitch is the mover's companion's
  d := pg_get_functiondef('public._chaos_curve(text,uuid)'::regprocedure);
  if position('''glitch:'' || pal' in d) = 0 then
    old := E'      foreach other in array c.players loop perform _chaos_event(other, null, ''glitch'', p_kind, p_game, ''⚡'', ''GLITCH: the chaos leaked through the calm for a moment. Nothing changed. Probably.''); end loop;';
    if position(old in d) = 0 then raise exception '078: glitch event not found in _chaos_curve (076 not applied?)'; end if;
    d := replace(d, old, E'      mover := nullif(current_setting(''chaos.mover'', true), '''')::uuid;\n      pal := case when mover is null then ''fig'' else _chaos_companion(mover) end;\n      select username into mname from profiles where id = mover;\n      foreach other in array c.players loop perform _chaos_event(other, mover, ''glitch:'' || pal, p_kind, p_game, ''⚡'', ''GLITCH: '' || coalesce(mname || ''''''s '', ''the '') || initcap(pal) || '' leaked through the calm for a moment. Nothing changed. Probably.''); end loop;');
    old := 'phase text; win boolean; calm boolean;';
    if position(old in d) = 0 then raise exception '078: declare line not found in _chaos_curve'; end if;
    d := replace(d, old, old || ' mover uuid; pal text; mname text;');
    execute d;
  end if;
end $$;
