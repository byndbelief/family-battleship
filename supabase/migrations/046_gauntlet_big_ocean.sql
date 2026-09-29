-- 046: A 4+ player Gauntlet deals Battleship on the big shared ocean, like a new game does.
--   Its Battleship rounds were always classic boards (mode 0): with 6 players, five boards to flip
--   between. With 4 or more, a round is now the 16×16 shared ocean (mode 3, 028/034), each robot's
--   fleet placed clear of the others. Hilltop and Putt Post rounds already got the wider field and
--   the bigger course. A Gauntlet round of that kind still in setup, with only robot fleets placed
--   and no shot fired, is switched over now.
-- Applied with the Supabase connector (apply_migration '046_gauntlet_big_ocean'). Safe to run again.

do $$
declare d text;
begin
  d := pg_get_functiondef('public._gauntlet_next(uuid)'::regprocedure);
  if position('046' in d) = 0 then
    if position('values (gt.created_by, rot, 0, 3, p_gauntlet) returning id into child;' in d) = 0
       or position('insert into fleets (game_id, player_id, ships) select child, b.profile_id, _random_fleet(0::smallint) from bots b where b.profile_id = any (rot);' in d) = 0 then
      raise exception '046: _gauntlet_next is not the shape this patch expects';
    end if;
    d := replace(d, 'values (gt.created_by, rot, 0, 3, p_gauntlet) returning id into child;',
                    'values (gt.created_by, rot, case when n >= 4 then 3 else 0 end, 3, p_gauntlet) returning id into child;');
    d := replace(d, 'insert into fleets (game_id, player_id, ships) select child, b.profile_id, _random_fleet(0::smallint) from bots b where b.profile_id = any (rot);',
'if n >= 4 then   -- 4+ (046): the big shared ocean; each robot''s fleet clear of the others
      for p in select b.profile_id from bots b where b.profile_id = any (rot) loop
        insert into fleets (game_id, player_id, ships) values (child, p, _random_fleet_avoid(3::smallint, _ocean_taken(child, null)));
      end loop;
    else
      insert into fleets (game_id, player_id, ships) select child, b.profile_id, _random_fleet(0::smallint) from bots b where b.profile_id = any (rot);
    end if;');
    execute d;
  end if;
end $$;

-- Rounds dealt the old way that haven't started: over to the shared ocean.
do $$
declare g games; b uuid;
begin
  for g in select * from games gm
           where gm.gauntlet_id is not null and gm.status = 'setup' and gm.mode = 0 and cardinality(gm.players) >= 4
             and not exists (select 1 from shots s where s.game_id = gm.id)
             and not exists (select 1 from fleets f where f.game_id = gm.id and not exists (select 1 from bots where profile_id = f.player_id))
  loop
    update games set mode = 3 where id = g.id;
    delete from fleets where game_id = g.id;
    for b in select profile_id from bots where profile_id = any (g.players) loop
      insert into fleets (game_id, player_id, ships) values (g.id, b, _random_fleet_avoid(3::smallint, _ocean_taken(g.id, null)));
    end loop;
  end loop;
end $$;
