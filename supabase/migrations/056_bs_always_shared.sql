-- 056: Battleship is always played on the Shared Ocean (028): every fleet on one grid, 12x12, or
--   16x16 (mode 3) for 4 or more players, however the game is made. create_game ignores the board
--   it's asked for (an older page or a rematch of an old game may still send 0 or 1); a Gauntlet
--   round (_gauntlet_next) was Quick 8x8 for under 4 and is now the 12x12 ocean. Games already under
--   way keep their board.
-- Applied with the Supabase connector (apply_migration '056_bs_always_shared'). Safe to run again.

do $$
declare d text;
begin
  d := pg_get_functiondef('public.create_game(text[],integer,integer)'::regprocedure);
  if position('always the shared ocean (056)' in d) = 0 then
    if position('if p_mode = 2 and cardinality(ids) >= 3 then p_mode := 3; end if;' in d) = 0 then raise exception '056: create_game is not the shape this patch expects'; end if;
    execute replace(d, 'if p_mode = 2 and cardinality(ids) >= 3 then p_mode := 3; end if;',
                       'p_mode := case when cardinality(ids) >= 3 then 3 else 2 end;   -- always the shared ocean (056)');
  end if;
  d := pg_get_functiondef('public._gauntlet_next(uuid)'::regprocedure);
  if position('always the shared ocean (056)' in d) = 0 then
    if position('case when n >= 4 then 3 else 0 end, 3, p_gauntlet) returning id into child;' in d) = 0
       or position('    if n >= 4 then   -- 4+ (046)' in d) = 0 then
      raise exception '056: _gauntlet_next is not the shape this patch expects';
    end if;
    d := replace(d, 'case when n >= 4 then 3 else 0 end, 3, p_gauntlet) returning id into child;',
                    'case when n >= 4 then 3 else 2 end, 3, p_gauntlet) returning id into child;   -- always the shared ocean (056)');
    d := replace(d, '    if n >= 4 then   -- 4+ (046)', '    if true then   -- the shared ocean (046, 056)');
    d := replace(d, '_random_fleet_avoid(3::smallint, _ocean_taken(child, null))', '_random_fleet_avoid(case when n >= 4 then 3 else 2 end::smallint, _ocean_taken(child, null))');
    execute d;
  end if;
end $$;
