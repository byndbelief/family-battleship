-- 048: Hilltop starting spots rotate. A tank's spot (and the turn order) follows its place in
--   duel_games.players, which was always the creator first. Now each new duel between the same
--   people turns the order round by one: with A, B, C, the 1st game is A B C, the 2nd B C A, the 3rd
--   C A B. Everyone gets every end of the field, and a turn at shooting first.
-- Applied with the Supabase connector (apply_migration '048_duel_rotate_start'). Safe to run again.

create or replace function public._duel_new(p_by uuid, p_players uuid[], p_bot_level integer, p_gauntlet uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  gid uuid; n int := cardinality(p_players); w int := _duel_world(cardinality(p_players));
  k int; ps uuid[];
begin
  -- How many duels these same people have had before: that many places round.
  select count(*) % n into k from duel_games d
    where cardinality(d.players) = n and d.players @> p_players and d.players <@ p_players;
  ps := p_players[k + 1 : n] || p_players[1 : k];
  insert into duel_games (created_by, players, seed, bot_level, gauntlet_id, hp, tank_x, turn_x, world)
    values (p_by, ps, 1 + floor(random() * 65534)::int, p_bot_level, p_gauntlet,
            array_fill(100, array[n]), _duel_start_x(n, w), _duel_start_x(n, w), w)
    returning id into gid;
  return gid;
end $$;
