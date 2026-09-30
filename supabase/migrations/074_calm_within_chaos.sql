-- 🧘 CALM WITHIN THE CHAOS (CHAOS.md): a category of games that need a think (Putt Post, Chaos
-- Cards). Their curve starts with a HOLD: for the first 8 moves r doesn't climb and no move twists
-- (x still walks, so the box's gifts still land). The last held move says so: here comes that chaos
-- curve again. Safe to re-run.
alter table public.chaos_curve add column if not exists hold int not null default 0;

create or replace function public._chaos_curve(p_kind text, p_game uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare c chaos_curve; ps uuid[]; gid uuid; n0 int := 0; nr float8; nx float8; other uuid; phase text; win boolean; calm boolean;
begin
  select * into c from chaos_curve where game_id = p_game for update;
  if not found then
    case p_kind
      when 'battleship' then select players, gauntlet_id into ps, gid from games where id = p_game;
      when 'golf' then select players, gauntlet_id into ps, gid from golf_games where id = p_game;
      when 'duel' then select players, gauntlet_id into ps, gid from duel_games where id = p_game;
      when 'cards' then select players, gauntlet_id into ps, gid from card_games where id = p_game;
      else null;
    end case;
    if ps is null then return false; end if;
    -- 🌀 Route to Chaos (062): each round starts further along the curve.
    if gid is not null then select greatest(0, (round - 1) * 6) into n0 from gauntlets where id = gid; end if;
    calm := p_kind in ('golf', 'cards');   -- 🧘 the calm category: the curve holds for the first moves
    insert into chaos_curve (game_id, kind, players, x, n, r, hold) values (p_game, p_kind, ps, 0.05 + random() * 0.9, coalesce(n0, 0), least(4.0, 2.9 + 0.04 * coalesce(n0, 0)), case when calm then 8 else 0 end)
      on conflict (game_id) do nothing;
    select * into c from chaos_curve where game_id = p_game for update;
    if c.hold > 0 then
      foreach other in array c.players loop perform _chaos_event(other, null, 'twist', p_kind, p_game, '🧘', 'CALM WITHIN THE CHAOS: r holds for ' || c.hold || ' moves and nothing twists. Take your time.'); end loop;
    end if;
  end if;
  if c.hold > 0 then
    -- 🧘 held: x walks, r stays, no twist. The last held move announces what comes next.
    nx := c.r * c.x * (1 - c.x);
    if nx <= 1e-9 or nx >= 1 - 1e-9 then nx := 0.5 + (random() - 0.5) * 1e-3; end if;
    update chaos_curve set hold = c.hold - 1, x = nx, updated_at = now(),
      hist = (hist || nx::real)[greatest(1, cardinality(hist) + 2 - 48):]
      where game_id = p_game;
    if c.hold = 1 then
      foreach other in array c.players loop perform _chaos_event(other, null, 'twist', p_kind, p_game, '😎', 'Here comes that chaos curve again: from the next move r climbs and peaks twist.'); end loop;
    end if;
    return false;
  end if;
  nr := least(4.0, 2.9 + 0.04 * (c.n + 1));
  nx := nr * c.x * (1 - c.x);
  if nx <= 1e-9 or nx >= 1 - 1e-9 then nx := 0.5 + (random() - 0.5) * 1e-3; end if;   -- stuck on 0 or 1: a butterfly flaps
  update chaos_curve set n = c.n + 1, r = nr, x = nx, updated_at = now(),
    hist = (hist || nx::real)[greatest(1, cardinality(hist) + 2 - 48):]
    where game_id = p_game;
  win := (c.n + 1) between 24 and 26;   -- 🔁 the period-3 window (068): three moves as r passes 1 + √8 (by move, so a 0.04 step can't skip it)
  phase := case when nr >= 4 and c.r < 4 then 'r = 4: the top of the curve. Full chaos.'
                when win and not (c.n between 24 and 26) then '🔁 THE WINDOW: inside the chaos, a rhythm of 3. No twists here; things come in threes.'
                when c.r < 3.5699 and nr >= 3.5699 then 'CHAOS. The curve has no rhythm left: anything can happen now.'
                when c.r < 3.544 and nr >= 3.544 then 'Split again: 8, 16, 32… the rhythm is falling apart.'
                when c.r < 3.449 and nr >= 3.449 then 'The curve split again: a rhythm of 4. Period doubling has begun.'
                when c.r < 3.0 and nr >= 3.0 then 'The chaos curve split in two: twists now come every other move. x → r·x·(1−x)' end;
  if phase is not null then
    foreach other in array c.players loop perform _chaos_event(other, null, 'twist', p_kind, p_game, '🌀', phase); end loop;
  end if;
  return nx > 0.75 and not win;
end $$;
revoke execute on function public._chaos_curve(text, uuid) from public, anon, authenticated;
