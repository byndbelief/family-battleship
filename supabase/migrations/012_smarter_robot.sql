-- 012: a smarter Battleship robot.
-- Applied with the Supabase connector (apply_migration '012_smarter_robot'). Safe to run again.
--
-- The robot used to hunt on a checkerboard at random and follow up hits. Now it hunts by
-- probability, the way strong players do: for every enemy ship still afloat it tries every way
-- that ship could still fit (not across a miss or a sunk ship), adds each fit to the squares it
-- covers, and weights fits through its unsunk hits heavily. It fires at the hottest squares.
-- Squares it peeked at still come first. It only uses what the board shows (and its own peeks).

create or replace function public._bot_pick(p_game uuid, p_bot uuid, p_target uuid, k int, m smallint) returns int[]
language plpgsql volatile set search_path = public as $$
declare
  n int := mode_n(m);
  ships int[] := mode_ships(m);
  fired int[]; sunk int[]; live int[]; peeked int[]; gone int[]; blocked int[];
  heat float8[];
  picks int[] := '{}';
  i int; len int; c int; h boolean; cells int[]; w float8; sq int;
begin
  select coalesce(array_agg(cell::int), '{}') into fired from shots where game_id = p_game and target = p_target;
  select coalesce(array_agg(x::int), '{}') into sunk from shots s, unnest(s.sunk_cells) x where s.game_id = p_game and s.target = p_target;
  select coalesce(array_agg(cell::int), '{}') into live from shots where game_id = p_game and target = p_target and hit and not (cell::int = any (sunk));
  select coalesce(array_agg(distinct sunk_ship::int), '{}') into gone from shots where game_id = p_game and target = p_target and sunk_ship is not null;
  select coalesce(array_agg(distinct x::int), '{}') into peeked
    from cheats ch, jsonb_array_elements_text(ch.detail -> 'ships') x
    where ch.game_id = p_game and ch.player_id = p_bot and ch.kind = 'peek' and ch.detail ->> 'target' = p_target::text;
  -- A ship can't lie across a miss or a sunk ship; it can lie across an unsunk hit.
  blocked := array(select f from unnest(fired) f where not (f = any (live)));

  foreach c in array peeked loop picks := _add_pick(picks, c, fired, k); end loop;

  heat := array_fill(0::float8, array[n * n]);
  for i in 1 .. cardinality(ships) loop
    continue when (i - 1) = any (gone);
    len := ships[i];
    for c in 0 .. n * n - 1 loop
      foreach h in array array[true, false] loop
        continue when (h and c % n + len > n) or (not h and c / n + len > n);
        cells := ship_cells(m, c, h, len);
        continue when cells && blocked;
        w := 1 + 25 * cardinality(array(select y from unnest(cells) y where y = any (live)));
        foreach sq in array cells loop
          if not (sq = any (fired)) then heat[sq + 1] := heat[sq + 1] + w; end if;
        end loop;
      end loop;
    end loop;
  end loop;

  for c in select q - 1 from generate_subscripts(heat, 1) q where heat[q] > 0 order by heat[q] desc, random() loop
    exit when cardinality(picks) >= k;
    picks := _add_pick(picks, c, fired, k);
  end loop;
  -- Anything left over (shouldn't happen): any open square.
  foreach c in array array(select q from generate_series(0, n * n - 1) q order by random()) loop
    exit when cardinality(picks) >= k; picks := _add_pick(picks, c, fired, k);
  end loop;
  return picks;
end $$;

revoke execute on function public._bot_pick(uuid, uuid, uuid, int, smallint) from public, anon, authenticated;
