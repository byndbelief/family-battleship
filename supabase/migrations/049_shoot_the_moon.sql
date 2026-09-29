-- 049: Shoot the moon. In Hilltop a shell that flies into the moon shatters it (the pages fly it:
--   setMoon/moonAt in duel-engine.js) and that duel's morning comes: duel_games.sun is the move whose
--   shell brought it down (-1 while it's still up), and the sky stays day for everyone from then on.
--   The sun that rises is angry: after each move of a duel with a sun, 30% of the time it fires a
--   beam at a random tank still in for 6-14 (never below 1 HP: only a shot ends a duel), saved as
--   duel_games.sun_shot = [count, tank index (0-based), damage] for the pages to draw.
-- Applied with the Supabase connector (apply_migration '049_shoot_the_moon'). Safe to run again.

alter table public.duel_games add column if not exists sun int not null default -1;
alter table public.duel_games add column if not exists sun_shot int[] not null default '{}';

-- Any page in the duel that flew the shell into the moon says so; the first one counts.
create or replace function public.duel_moon_hit(p_game uuid, p_move int) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g duel_games; other uuid;
begin
  select * into g from duel_games where id = p_game for update;
  if not found or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' or g.sun >= 0 or p_move is null or p_move < 0 or p_move > g.move then return; end if;
  update duel_games set sun = p_move, updated_at = now() where id = p_game;
  foreach other in array g.players loop
    perform _chaos_event(other, null, 'twist', 'duel', p_game, '🌙', 'MOON DOWN! Morning breaks… and the sun woke up angry. It shoots back ☀️🔫');
  end loop;
end $$;
revoke execute on function public.duel_moon_hit(uuid, int) from public, anon;
grant execute on function public.duel_moon_hit(uuid, int) to authenticated;

-- ☀️🔫 The angry sun takes a shot.
create or replace function public._duel_sun_fire(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g duel_games; j int; dmg int; other uuid;
begin
  select * into g from duel_games where id = p_game for update;
  if not found or g.status <> 'playing' or g.sun < 0 then return; end if;
  select k into j from generate_series(1, cardinality(g.players)) k where g.hp[k] > 0 order by random() limit 1;
  if j is null then return; end if;
  dmg := 6 + floor(random() * 9)::int;
  dmg := least(dmg, g.hp[j] - 1);
  if dmg <= 0 then return; end if;
  update duel_games set hp[j] = hp[j] - dmg, sun_shot = array[coalesce(sun_shot[1], 0) + 1, j - 1, dmg], updated_at = now() where id = p_game;
  foreach other in array g.players loop
    perform _chaos_event(other, null, 'twist', 'duel', p_game, '☀️',
      case when other = g.players[j] then format('The SUN shot you! −%s', dmg) else format('The SUN shot %s! −%s', _uname(g.players[j]), dmg) end);
  end loop;
end $$;
revoke execute on function public._duel_sun_fire(uuid) from public, anon, authenticated;

-- 047's after-move chaos, with the sun's turn at the end.
create or replace function public._chaos_after_move(p_kind text, p_game uuid, p_mover uuid, p_others uuid[], p_loot double precision, p_curse double precision, p_why text)
returns void language plpgsql security definer set search_path = public as $$
declare
  victim uuid;
  l float8 := least(2.0, p_loot * 1.8);
begin
  if l > 0 and random() < l then perform _chaos_drop(p_mover, p_kind, p_game, p_why);
  elsif random() < 0.06 then perform _chaos_drop(p_mover, p_kind, p_game, 'a lucky find');
  end if;
  if l > 1 and random() < l - 1 then perform _chaos_drop(p_mover, p_kind, p_game, p_why); end if;
  if p_curse > 0 and random() < p_curse and cardinality(p_others) > 0 then
    victim := p_others[1 + floor(random() * cardinality(p_others))::int];
    perform _chaos_curse(p_mover, victim, p_game, lower(p_why));
  end if;
  if random() < 0.33 then perform _chaos_twist(p_kind, p_game); end if;
  if p_kind = 'duel' and random() < 0.3 then perform _duel_sun_fire(p_game); end if;   -- ☀️🔫 (049)
end $$;
