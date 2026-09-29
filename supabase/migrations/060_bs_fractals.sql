-- 060: Battleship fractals.
--   🏝️ Islands: every new shared ocean (mode 2: 2 islands, mode 3: 3) has islands, 3-6 squares each,
--      grown at random from a centre clear of the edges and of each other (games.islands). The page
--      draws their shores as fractal coastlines (midpoint displacement round each island's outline).
--      Nothing anchors or fires there: _ocean_taken counts them (ship placement, shuffles, robots'
--      fleets, whirlpools), _fire_ocean treats them as fired at, and the robot never aims at one.
--   🔺 Sierpiński Salvo (loot): pick the top square of a triangle and it's staged for you: Pascal's
--      triangle mod 2, 4 rows (9 squares, fewer where the board, islands, your ships or squares
--      already taken cut it off). Like the Double Salvo, it adds that many shots to your turn (or
--      your live volley); the page stages the pattern and fires it.
-- Applied with the Supabase connector (apply_migration '060_bs_fractals'). Safe to run again.

alter table public.games add column if not exists islands smallint[];

create or replace function public._ocean_islands(p_mode smallint) returns smallint[]
language plpgsql volatile set search_path = public as $$
declare n int := mode_n(p_mode); out smallint[] := '{}'; isle int[]; want int; tries int; c int; r0 int; c0 int; nb int; d int;
begin
  for k in 1 .. case when p_mode = 3 then 3 else 2 end loop
    tries := 0;
    loop   -- a centre at least 2 in from the edge and 4 from any other island
      tries := tries + 1; exit when tries > 60;
      r0 := 2 + floor(random() * (n - 4))::int; c0 := 2 + floor(random() * (n - 4))::int;
      exit when not exists (select 1 from unnest(out) x where abs(x / n - r0) + abs(x % n - c0) < 5);
    end loop;
    continue when tries > 60;
    isle := array[r0 * n + c0]; want := 3 + floor(random() * 4)::int; tries := 0;
    while cardinality(isle) < want and tries < 80 loop
      tries := tries + 1;
      c := isle[1 + floor(random() * cardinality(isle))::int]; d := floor(random() * 4)::int;
      nb := case d when 0 then c + 1 when 1 then c - 1 when 2 then c + n else c - n end;
      continue when (d = 0 and c % n = n - 2) or (d = 1 and c % n = 1) or nb / n < 1 or nb / n > n - 2 or nb = any (isle);
      isle := isle || nb;
    end loop;
    out := out || isle::smallint[];
  end loop;
  return out;
end $$;

create or replace function public._games_islands() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.mode in (2, 3) and new.islands is null then new.islands := _ocean_islands(new.mode::smallint); end if;
  return new;
end $$;
drop trigger if exists games_islands on public.games;
create trigger games_islands before insert on public.games for each row execute function public._games_islands();
revoke execute on function public._ocean_islands(smallint) from public, anon, authenticated;
revoke execute on function public._games_islands() from public, anon, authenticated;

create or replace function public._ocean_taken(p_game uuid, p_except uuid) returns integer[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(x), '{}') from (
    select unnest(_fleet_cells(g.mode, f.ships)) x from fleets f, games g
    where f.game_id = p_game and g.id = p_game and f.player_id is distinct from p_except
    union all
    select unnest(coalesce(islands, '{}'))::int from games where id = p_game) z
$$;

alter table public.loot drop constraint if exists loot_item_check;
alter table public.loot add constraint loot_item_check check (item in
  ('sonar', 'salvo', 'golden_tee', 'magnet', 'shield', 'bertha', 'scroll', 'cluster', 'homing', 'railgun', 'dirt',
   'xray', 'paint', 'trash', 'gift', 'foxhole', 'buster', 'drone', 'atk_ice', 'atk_wind', 'atk_cup', 'atk_bumpers',
   'atk_butter', 'chip', 'fractal', 'sierpinski'));

do $$
declare d text;
begin
  d := pg_get_functiondef('public._fire_ocean(uuid,uuid,integer[],boolean)'::regprocedure);
  if position('g.islands' in d) = 0 then
    if position('into shot from shots s where s.game_id = p_game and (s.hit or s.shooter = me);' in d) = 0 then raise exception '060: _fire_ocean is not the shape this patch expects'; end if;
    execute replace(d, 'into shot from shots s where s.game_id = p_game and (s.hit or s.shooter = me);',
      'into shot from shots s where s.game_id = p_game and (s.hit or s.shooter = me);' || chr(10) || '  shot := shot || coalesce(g.islands::int[], ''{}'');   -- 🏝️ islands (060)');
  end if;
  d := pg_get_functiondef('public._bot_pick_shared(uuid,uuid,integer)'::regprocedure);
  if position('g.islands' in d) = 0 then
    if position('into fired from shots where game_id = p_game;' in d) = 0 then raise exception '060: _bot_pick_shared is not the shape this patch expects'; end if;
    execute replace(d, 'into fired from shots where game_id = p_game;',
      'into fired from shots where game_id = p_game;' || chr(10) || '  fired := fired || coalesce(g.islands::int[], ''{}'');   -- 🏝️ islands (060)');
  end if;
  d := pg_get_functiondef('public._item_label(text)'::regprocedure);
  if position('sierpinski' in d) = 0 then
    if position('when ''salvo'' then ''⚓ Double Salvo''' in d) = 0 then raise exception '060: _item_label is not the shape this patch expects'; end if;
    execute replace(d, 'when ''salvo'' then ''⚓ Double Salvo''', 'when ''salvo'' then ''⚓ Double Salvo'' when ''sierpinski'' then ''🔺 Sierpiński Salvo''');
  end if;
  d := pg_get_functiondef('public._chaos_drop(uuid,text,uuid,text)'::regprocedure);
  if position('sierpinski' in d) = 0 then
    if position('when ''battleship'' then array[''sonar'', ''salvo'']' in d) = 0 then raise exception '060: _chaos_drop is not the shape this patch expects'; end if;
    execute replace(d, 'when ''battleship'' then array[''sonar'', ''salvo'']', 'when ''battleship'' then array[''sonar'', ''salvo'', ''sierpinski'']');
  end if;
  d := pg_get_functiondef('public.use_loot(bigint,uuid,uuid,integer)'::regprocedure);
  if position('sierpinski' in d) = 0 then
    if position('  res jsonb := ''{}'';' in d) = 0 or position('  elsif l.item in (''atk_ice'',' in d) = 0 then raise exception '060: use_loot is not the shape this patch expects'; end if;
    d := replace(d, '  res jsonb := ''{}'';', '  res jsonb := ''{}''; tk int[];');
    d := replace(d, '  elsif l.item in (''atk_ice'',', $x$  elsif l.item = 'sierpinski' then   -- 🔺 (060): Pascal's triangle mod 2, 4 rows, from p_cell down and right
    select * into g from games where id = p_game for update;
    if not found or not (me = any (g.players)) or g.status <> 'playing' or (g.players[g.turn + 1] <> me and not _bs_live(g)) then raise exception 'Use it on your Battleship turn'; end if;
    if g.mode not in (2, 3) then raise exception 'Use it on the shared ocean'; end if;
    n := mode_n(g.mode);
    if p_cell is null or p_cell < 0 or p_cell >= n * n then raise exception 'Pick the top of the triangle'; end if;
    select coalesce(array_agg(s.cell::int), '{}') into tk from shots s where s.game_id = p_game and (s.hit or s.shooter = me);
    tk := tk || coalesce(g.islands::int[], '{}') || coalesce((select _fleet_cells(g.mode, ships) from fleets where game_id = p_game and player_id = me), '{}');
    for rr in 0 .. 3 loop for k in 0 .. rr loop
      continue when (k & rr) <> k;
      r := p_cell / n + rr; c := p_cell % n + k;
      if r < n and c < n and not ((r * n + c) = any (tk)) then area := area || (r * n + c); end if;
    end loop; end loop;
    if cardinality(area) = 0 then raise exception 'No open squares in that triangle'; end if;
    insert into player_mods (game_id, player_id, shot_mod) values (p_game, me, cardinality(area))
      on conflict (game_id, player_id) do update set shot_mod = player_mods.shot_mod + cardinality(area);
    res := jsonb_build_object('cells', area);
    update loot set used_at = now(), used_kind = 'battleship', used_game = p_game, detail = res where id = p_loot;

  elsif l.item in ('atk_ice',$x$);
    execute d;
  end if;
end $$;

-- One to try, for everyone (once).
insert into loot (player, item, from_kind)
  select p.id, 'sierpinski', 'sierpinskicrate'
  from profiles p
  where not exists (select 1 from bots b where b.profile_id = p.id)
    and not exists (select 1 from loot l where l.player = p.id and l.from_kind = 'sierpinskicrate');
insert into chaos_events (player, actor, kind, game_kind, icon, message)
  select p.id, null, 'loot', 'battleship', '🔺', 'New in Battleship: the 🔺 Sierpiński Salvo. Tap the top of a triangle and it fires a fractal of shots: a triangle with a triangle-shaped hole in it. And the shared ocean has 🏝️ islands now, with ragged fractal shores.'
  from profiles p
  where not exists (select 1 from bots b where b.profile_id = p.id)
    and not exists (select 1 from chaos_events e where e.player = p.id and e.icon = '🔺' and e.message like 'New in Battleship: the 🔺%');
