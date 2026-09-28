-- 030: Battleship themes are picked on the ship placement screen now, not in ⚙️ Settings, so the
-- unlock notes say so. (027's functions, with only the wording changed.)
-- Applied with the Supabase connector (apply_migration '030_bs_theme_wording'). Safe to run again.

-- The easter egg: the page sends the secret word when you've done the trick.
create or replace function public.unlock_bs_theme(p_word text) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or lower(coalesce(p_word, '')) <> 'take me to your leader' then return null; end if;
  if exists (select 1 from profiles where id = me and 'ufo' = any (bs_eggs)) then return 'ufo'; end if;
  update profiles set bs_eggs = array_append(bs_eggs, 'ufo'), bs_theme = 'ufo' where id = me;
  perform _chaos_event(me, null, 'loot', 'battleship', null, '👽', 'You found the UFO fleet! Your Battleship ships are flying saucers now (switch fleets when you place your ships).');
  return 'ufo';
end $$;

-- A win that crosses 3 or 10 unlocks a theme: say so in the chaos feed.
create or replace function public._bs_theme_news() returns trigger
language plpgsql security definer set search_path = public as $$
declare p uuid; w int;
begin
  if new.kind <> 'battleship' or cardinality(new.players) < 2 then return new; end if;
  foreach p in array new.winners loop
    if exists (select 1 from bots where profile_id = p) then continue; end if;
    w := _bs_wins(p);
    if w = 3 then perform _chaos_event(p, null, 'loot', 'battleship', new.game_id, '🏴‍☠️', 'Pirate Cove unlocked (3 Battleship wins)! Pick it when you place your ships and sail under the black flag.');
    elsif w = 10 then perform _chaos_event(p, null, 'loot', 'battleship', new.game_id, '⚔️', 'Viking Fjord unlocked (10 Battleship wins)! Pick it when you place your ships and raise the longships.');
    end if;
  end loop;
  return new;
end $$;
