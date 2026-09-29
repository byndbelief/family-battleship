-- 054: Everyone may miss on the same square. The page no longer shows other players' misses on the
--   boards you fire at, so a square one rival missed is still open to you: firing there is your own
--   shot (and your own miss). A hit is still once only (hits show to everyone).
--   Rows: one hit per square (shots_one_hit), one shot per player per square (shots_one_each /
--   shots_ocean_each on the shared ocean) in place of one shot per square.
--   fire / _fire_ocean: a square is taken for you if anyone hit it or you fired at it yourself.
-- Applied with the Supabase connector (apply_migration '054_bs_shared_misses'). Safe to run again.

alter table public.shots drop constraint if exists shots_game_id_target_cell_key;
drop index if exists public.shots_ocean_cell;
create unique index if not exists shots_one_hit on public.shots (game_id, target, cell) where hit;
create unique index if not exists shots_one_each on public.shots (game_id, target, cell, shooter) where target is not null;
create unique index if not exists shots_ocean_each on public.shots (game_id, cell, shooter) where target is null;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.fire(uuid,uuid,integer[])'::regprocedure);
  if position('and (s.hit or s.shooter = me)' in d) = 0 then
    if position('into shot from shots s where s.game_id = p_game and s.target = p_target;' in d) = 0 then raise exception '054: fire is not the shape this patch expects'; end if;
    execute replace(d, 'into shot from shots s where s.game_id = p_game and s.target = p_target;',
                       'into shot from shots s where s.game_id = p_game and s.target = p_target and (s.hit or s.shooter = me);');
  end if;
  d := pg_get_functiondef('public._fire_ocean(uuid,uuid,integer[],boolean)'::regprocedure);
  if position('and (s.hit or s.shooter = me)' in d) = 0 then
    if position('into shot from shots s where s.game_id = p_game;' in d) = 0 then raise exception '054: _fire_ocean is not the shape this patch expects'; end if;
    execute replace(d, 'into shot from shots s where s.game_id = p_game;',
                       'into shot from shots s where s.game_id = p_game and (s.hit or s.shooter = me);');
  end if;
end $$;
