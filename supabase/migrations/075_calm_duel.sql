-- 🧘 Hilltop Duel joins the calm category (074): its curve holds for its first 8 moves too. Safe to re-run.
do $$ declare d text; begin
  d := pg_get_functiondef('public._chaos_curve(text,uuid)'::regprocedure);
  if position('calm := p_kind in (''golf'', ''cards'');' in d) > 0 then
    d := replace(d, 'calm := p_kind in (''golf'', ''cards'');', 'calm := p_kind in (''golf'', ''cards'', ''duel'');');
    execute d;
  elsif position('calm := p_kind in (''golf'', ''cards'', ''duel'');' in d) = 0 then
    raise exception '075: _chaos_curve has no calm list to patch (074 not applied?)';
  end if;
end $$;
