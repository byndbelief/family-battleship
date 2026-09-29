-- 053: Battleship live volleys, and more chaos at sea.
--   ⚔️ Volleys: in a live battle you stage squares, and when the volley is full it goes off together:
--      fire_live_volley(game, target, cells) fires them all at once (1 to 3 + shot_mod squares), then the
--      guns reload for 2 s (while the shells fly). A square someone else fired at first is skipped.
--   ⚓ Double Salvo works in a live battle now (it was "use it on your turn", which a live battle
--      never has): +2 squares on your next volley, like a Frenzy. A volley uses up the extra (or a Jam).
--   🐙 Kraken: wraps round a rival's ship and crushes up to 2 of its squares (never its last).
--   🌪️ Tornado: tears along a row or column of a rival's waters and hits every ship square there it can
--      (up to 3, never a ship's last square).
--   Both are saved as ordinary hits with shots.chaos = 'kraken' / 'tornado' and the victim as the shooter
--   (shots.shooter must be a player); _log_result leaves chaos shots out of everyone's stats.
--   🌫️ Fog (047) lasts 20 s in a live battle too (games.fog_until), where moves fly by.
--   Twist odds for a Battleship move: frenzy 20%, jam 12%, whirlpool 14%, fog 14%, kraken 14%,
--   tornado 12%, crate otherwise.
-- Applied with the Supabase connector (apply_migration '053_bs_volleys_kraken'). Safe to run again.

alter table public.shots add column if not exists chaos text;
alter table public.games add column if not exists fog_until timestamptz;

-- ⚔️ A live volley.
create or replace function public.fire_live_volley(p_game uuid, p_target uuid, p_cells int[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g games; m int; size int; fired int := 0; c int;
begin
  select * into g from games where id = p_game for update;
  if not found or me is null or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This game isn''t being played right now'; end if;
  if me = any (g.eliminated) then raise exception 'Your fleet is sunk'; end if;
  if not _bs_live(g) then raise exception 'The live battle is over: back to taking turns'; end if;
  if exists (select 1 from shots where game_id = p_game and shooter = me and chaos is null and created_at > now() - interval '1.9 seconds') then
    raise exception 'Still reloading';
  end if;
  m := coalesce((select shot_mod from player_mods where game_id = p_game and player_id = me), 0);
  size := greatest(1, 3 + m);
  if p_cells is null or cardinality(p_cells) < 1 or cardinality(p_cells) > size then raise exception 'Stage 1 to % squares', size; end if;
  perform set_config('bs.live', '1', true);
  foreach c in array (select array_agg(distinct x) from unnest(p_cells) x) loop
    begin
      perform fire(p_game, p_target, array[c]);
      fired := fired + 1;
    exception when others then
      if sqlerrm ~ 'nobody has fired at yet' then null;   -- someone got there first: skip it
      else perform set_config('bs.live', '', true); raise; end if;
    end;
    exit when (select status from games where id = p_game) <> 'playing';
  end loop;
  perform set_config('bs.live', '', true);
  -- The volley used up a Salvo/Frenzy's extra squares, or a Jam.
  if m <> 0 then
    update player_mods set shot_mod = case when m < 0 then 0 else greatest(0, m - greatest(0, fired - 3)) end
      where game_id = p_game and player_id = me;
  end if;
  return jsonb_build_object('fired', fired);
end $$;
revoke execute on function public.fire_live_volley(uuid, uuid, int[]) from public, anon;
grant execute on function public.fire_live_volley(uuid, uuid, int[]) to authenticated;

-- Battleship's own twists: 047's whirlpool and fog, and the kraken and the tornado.
create or replace function public._chaos_twist_bs(p_game uuid, p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  g games; p uuid; other uuid; victim uuid; f jsonb; lens int[]; nn int;
  k int; L int; c int; h boolean; cells int[]; blocked int[]; ids bigint[];
  fired int[]; sc int[]; unhit int[]; hitcells int[] := '{}'; line int; horiz boolean; take int; tries int;
begin
  select * into g from games where id = p_game for update;
  if not found or g.status <> 'playing' then return false; end if;
  -- Turn by turn: the player up next. Live: anyone still afloat.
  p := case when _bs_live(g)
            then (select q from unnest(g.players) q where not (q = any (g.eliminated)) and not _is_bot(q) order by random() limit 1)
            else g.players[g.turn + 1] end;
  if p is null then p := g.players[g.turn + 1]; end if;
  lens := mode_ships(g.mode); nn := mode_n(g.mode);
  if p_kind = 'whirlpool' then
    -- A rival's ship (someone other than p) that nobody has hit yet.
    for victim, f, k in
      select fl.player_id, fl.ships, s.i - 1 from fleets fl, generate_series(1, cardinality(mode_ships(g.mode))) s(i)
      where fl.game_id = p_game and fl.player_id <> p and not (fl.player_id = any (g.eliminated))
        and not (ship_cells(g.mode, (fl.ships -> (s.i - 1) ->> 'c')::int, (fl.ships -> (s.i - 1) ->> 'h')::boolean, (mode_ships(g.mode))[s.i])
                 && coalesce((select array_agg(x.cell::int) from shots x where x.game_id = p_game and x.hit), '{}'))
      order by random()
    loop
      L := lens[k + 1];
      -- Clear of every other ship (theirs, and on the shared ocean everyone's) and every square fired at.
      blocked := coalesce((select array_agg(x.cell::int) from shots x where x.game_id = p_game and (x.target is null or x.target = victim)), '{}')
        || case when g.mode in (2, 3) then _ocean_taken(p_game, victim) else '{}' end;
      for t in 0 .. cardinality(lens) - 1 loop
        if t <> k then blocked := blocked || ship_cells(g.mode, (f -> t ->> 'c')::int, (f -> t ->> 'h')::boolean, lens[t + 1]); end if;
      end loop;
      for t in 1 .. 200 loop
        h := random() < 0.5;
        c := case when h then floor(random() * nn)::int * nn + floor(random() * (nn - L + 1))::int
                  else floor(random() * (nn - L + 1))::int * nn + floor(random() * nn)::int end;
        cells := ship_cells(g.mode, c, h, L);
        if not (cells && blocked) and c <> (f -> k ->> 'c')::int then
          update fleets set ships = jsonb_set(ships, array[k::text], jsonb_build_object('c', c, 'h', h)) where game_id = p_game and player_id = victim;
          update games set updated_at = now() where id = p_game;
          foreach other in array g.players loop
            if not _is_bot(other) then
              perform _chaos_event(other, null, 'twist', 'battleship', p_game, '🌀', case when other = victim
                then format('Chaos twist: WHIRLPOOL! It swept your %s-square ship to a new spot.', L)
                else format('Chaos twist: WHIRLPOOL! One of %s''s ships got swept somewhere else.', _uname(victim)) end);
            end if;
          end loop;
          return true;
        end if;
      end loop;
    end loop;
    return false;

  elsif p_kind in ('kraken', 'tornado') then
    -- A rival still afloat (not p), and squares of their ships nobody has fired at yet.
    for victim, f in
      select fl.player_id, fl.ships from fleets fl
      where fl.game_id = p_game and fl.player_id <> p and not (fl.player_id = any (g.eliminated)) order by random()
    loop
      fired := coalesce((select array_agg(x.cell::int) from shots x where x.game_id = p_game and (x.target = victim or x.target is null)), '{}');
      hitcells := '{}';
      if p_kind = 'kraken' then
        -- 🐙 One ship with 2+ squares left: it crushes up to 2 (never the last).
        for k in select s.i - 1 from generate_series(1, cardinality(lens)) s(i) order by random() loop
          sc := ship_cells(g.mode, (f -> k ->> 'c')::int, (f -> k ->> 'h')::boolean, lens[k + 1]);
          unhit := array(select x from unnest(sc) x where not (x = any (fired)) order by random());
          if cardinality(unhit) >= 2 then hitcells := unhit[1 : least(2, cardinality(unhit) - 1)]; L := lens[k + 1]; exit; end if;
        end loop;
      else
        -- 🌪️ A row or column with ship squares in it: each ship there loses what it can spare (3 at most).
        for tries in 1 .. 12 loop
          horiz := random() < 0.5; line := floor(random() * nn)::int; hitcells := '{}';
          for k in 0 .. cardinality(lens) - 1 loop
            sc := ship_cells(g.mode, (f -> k ->> 'c')::int, (f -> k ->> 'h')::boolean, lens[k + 1]);
            unhit := array(select x from unnest(sc) x where not (x = any (fired)));
            take := cardinality(unhit) - 1;
            if take > 0 then
              hitcells := hitcells || array(select x from unnest(unhit) x
                where (case when horiz then x / nn else x % nn end) = line order by x limit take);
            end if;
          end loop;
          hitcells := hitcells[1 : 3];
          exit when cardinality(hitcells) > 0;
        end loop;
      end if;
      if cardinality(hitcells) > 0 then
        foreach c in array hitcells loop
          insert into shots (game_id, move, shooter, target, cell, hit, chaos) values (p_game, g.move, victim, victim, c, true, p_kind);
        end loop;
        update games set updated_at = now() where id = p_game;
        foreach other in array g.players loop
          if not _is_bot(other) then
            if p_kind = 'kraken' then
              perform _chaos_event(other, null, 'twist', 'battleship', p_game, '🐙', case when other = victim
                then format('Chaos twist: KRAKEN! It wrapped round your %s-square ship and crushed %s of its squares.', L, cardinality(hitcells))
                else format('Chaos twist: KRAKEN! It crushed %s squares of one of %s''s ships. Go finish it!', cardinality(hitcells), _uname(victim)) end);
            else
              perform _chaos_event(other, null, 'twist', 'battleship', p_game, '🌪️', case when other = victim
                then format('Chaos twist: TORNADO! It tore along %s %s of your waters and hit %s of your ship squares.', case when horiz then 'row' else 'column' end, case when horiz then chr(65 + line) else (line + 1)::text end, cardinality(hitcells))
                else format('Chaos twist: TORNADO! It tore through %s''s waters and hit %s ship squares.', _uname(victim), cardinality(hitcells)) end);
            end if;
          end if;
        end loop;
        return true;
      end if;
    end loop;
    return false;

  else   -- 🌫️ fog: the next shooter's last 6 results hidden until their turn ends (live: for 20 s)
    select array_agg(id) into ids from (select id from shots where game_id = p_game and shooter = p and chaos is null and sunk_ship is null order by id desc limit 6) x;
    if ids is null or _is_bot(p) then return false; end if;
    update games set fog_player = p, fog_move = g.move, fog_shots = ids, fog_until = now() + interval '20 seconds', updated_at = now() where id = p_game;
    perform _chaos_event(p, null, 'twist', 'battleship', p_game, '🌫️', format('Chaos twist: FOG! You can''t see how your last %s shots went for a while.', cardinality(ids)));
    return true;
  end if;
end $$;
revoke execute on function public._chaos_twist_bs(uuid, text) from public, anon, authenticated;

do $$
declare d text;
begin
  -- 047's twist odds for Battleship: room for the kraken and the tornado. Patched in place, once.
  d := pg_get_functiondef('public._chaos_twist(text,uuid)'::regprocedure);
  if position('''kraken''' in d) = 0 then
    if position('if r < 0.3 then' || chr(10) || '      insert into player_mods' in d) = 0
       or position('elsif r < 0.5 then' || chr(10) || '      insert into player_mods' in d) = 0
       or position('elsif r < 0.8 and _chaos_twist_bs(p_game, case when r < 0.65 then ''whirlpool'' else ''fog'' end) then null;' in d) = 0 then
      raise exception '053: _chaos_twist is not the shape this patch expects';
    end if;
    d := replace(d, 'if r < 0.3 then' || chr(10) || '      insert into player_mods', 'if r < 0.2 then' || chr(10) || '      insert into player_mods');
    d := replace(d, 'elsif r < 0.5 then' || chr(10) || '      insert into player_mods', 'elsif r < 0.32 then' || chr(10) || '      insert into player_mods');
    d := replace(d, 'elsif r < 0.8 and _chaos_twist_bs(p_game, case when r < 0.65 then ''whirlpool'' else ''fog'' end) then null;',
      'elsif r < 0.86 and _chaos_twist_bs(p_game, case when r < 0.46 then ''whirlpool'' when r < 0.6 then ''fog'' when r < 0.74 then ''kraken'' else ''tornado'' end) then null;');
    execute d;
  end if;

  -- Sonar and Salvo in a live battle, where there are no turns.
  d := pg_get_functiondef('public.use_loot(bigint,uuid,uuid,integer)'::regprocedure);
  if position('or (g.players[g.turn + 1] <> me and not _bs_live(g))' in d) = 0 then
    if position('or g.status <> ''playing'' or g.players[g.turn + 1] <> me then raise exception ''Use it on your Battleship turn''' in d) = 0 then
      raise exception '053: use_loot is not the shape this patch expects';
    end if;
    execute replace(d, 'or g.status <> ''playing'' or g.players[g.turn + 1] <> me then raise exception ''Use it on your Battleship turn''',
                       'or g.status <> ''playing'' or (g.players[g.turn + 1] <> me and not _bs_live(g)) then raise exception ''Use it on your Battleship turn''');
  end if;

  -- Chaos shots aren't anyone's shots in the stats.
  d := pg_get_functiondef('public._log_result(text,uuid)'::regprocedure);
  if position('chaos is null' in d) = 0 then
    if position('from shots where game_id = p_game and shooter = p' in d) = 0 then raise exception '053: _log_result is not the shape this patch expects'; end if;
    execute replace(d, 'from shots where game_id = p_game and shooter = p', 'from shots where game_id = p_game and shooter = p and chaos is null');
  end if;
end $$;
