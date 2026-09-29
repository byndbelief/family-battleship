-- 039: Backpack items come more often, and mostly for the game you're in.
--   * Every loot chance after a move is 1.8× what it was (a Hilltop hit 20% → 36%, a solid hit
--     50% → 90%, a knockout: one for sure and 80% a second; Battleship and Putt Post alike).
--   * Any move at all, a miss included, has a 6% "lucky find".
--   * Chaos Cards: a special card drops loot 25% of the time (was 12.5%).
--   * 70% of a Battleship, Putt Post or Hilltop drop is that game's own item; the rest is the
--     general table as before (it used to be the general table always, so half of a Hilltop drop
--     was for another game).
-- Applied with the Supabase connector (apply_migration '039_more_loot'). Safe to run again.

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
  if random() < 0.125 then perform _chaos_twist(p_kind, p_game); end if;
end $$;

-- 038's drop table, now mostly the game's own items.
create or replace function public._chaos_drop(p_player uuid, p_kind text, p_game uuid, p_why text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r float8 := random();
  own text[] := case p_kind when 'duel' then array['shield', 'bertha', 'cluster', 'homing', 'railgun', 'dirt', 'foxhole', 'buster', 'drone']
                            when 'battleship' then array['sonar', 'salvo'] when 'golf' then array['golden_tee', 'magnet'] end;
  item text := case when p_kind = 'cards' then (array['xray', 'paint', 'trash', 'gift'])[1 + floor(random() * 4)::int]
                    when own is not null and random() < 0.7 then own[1 + floor(random() * cardinality(own))::int]
                    when r < 0.08 then 'sonar' when r < 0.16 then 'salvo' when r < 0.24 then 'golden_tee'
                    when r < 0.32 then 'magnet' when r < 0.39 then 'shield' when r < 0.46 then 'bertha'
                    when r < 0.53 then 'cluster' when r < 0.60 then 'homing' when r < 0.67 then 'railgun'
                    when r < 0.72 then 'dirt' when r < 0.77 then 'foxhole' when r < 0.82 then 'buster' when r < 0.86 then 'drone'
                    when r < 0.89 then 'xray' when r < 0.91 then 'paint'
                    when r < 0.94 then 'trash' when r < 0.97 then 'gift' else 'scroll' end;
begin
  if _is_bot(p_player) then return; end if;
  insert into loot (player, item, from_kind) values (p_player, item, p_kind);
  perform _chaos_event(p_player, null, 'loot', p_kind, p_game, '🎒', format('Loot! %s dropped %s into your backpack.', upper(left(p_why, 1)) || substr(p_why, 2), _item_label(item)));
end $$;

-- Chaos Cards: a special card drops loot twice as often. Patched in place, once.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.card_play'::regproc);
  if position('''+2'')) and random() < 0.125' in d) > 0 then
    execute replace(d, '''+2'')) and random() < 0.125', '''+2'')) and random() < 0.25');
  end if;
end $$;
