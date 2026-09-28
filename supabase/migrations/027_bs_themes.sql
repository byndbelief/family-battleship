-- 027: Battleship themes. Each fleet is drawn in its owner's theme, so everyone sees it.
--   🌊 sea     Classic Sea: free for everyone
--   🏴‍☠️ pirate  Pirate Cove: unlocks at 3 Battleship wins
--   ⚔️ viking  Viking Fjord: unlocks at 10 Battleship wins
--   👽 ufo     UFO: a hidden easter egg (the page knows the trick; the server just checks the word)
-- Wins count finished Battleship games you won against someone (the results log). A win that
-- unlocks a theme drops a chaos-feed note. Profiles are readable by every player, so the pages
-- read each other's theme straight from profiles.bs_theme; it only changes through set_bs_theme.
-- Applied with the Supabase connector (apply_migration '027_bs_themes'). Safe to run again.

alter table public.profiles add column if not exists bs_theme text not null default 'sea';
alter table public.profiles add column if not exists bs_eggs text[] not null default '{}';   -- easter-egg themes found
alter table public.profiles drop constraint if exists profiles_bs_theme_check;
alter table public.profiles add constraint profiles_bs_theme_check check (bs_theme in ('sea', 'pirate', 'viking', 'ufo'));
revoke update on public.profiles from anon, authenticated;

create or replace function public._bs_wins(p uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from results where kind = 'battleship' and p = any (winners) and cardinality(players) > 1
$$;

-- What you have: { current, wins, unlocked: [...] }.
create or replace function public.bs_themes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); p profiles; w int;
begin
  select * into p from profiles where id = me; if not found then raise exception 'Sign in first'; end if;
  w := _bs_wins(me);
  return jsonb_build_object('current', p.bs_theme, 'wins', w,
    'unlocked', to_jsonb(array['sea'] || case when w >= 3 then array['pirate'] else '{}' end || case when w >= 10 then array['viking'] else '{}' end || p.bs_eggs));
end $$;

create or replace function public.set_bs_theme(p_theme text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if not ((bs_themes() -> 'unlocked') ? p_theme) then raise exception 'That theme is still locked'; end if;
  update profiles set bs_theme = p_theme where id = me;
end $$;

-- The easter egg: the page sends the secret word when you've done the trick.
create or replace function public.unlock_bs_theme(p_word text) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or lower(coalesce(p_word, '')) <> 'take me to your leader' then return null; end if;
  if exists (select 1 from profiles where id = me and 'ufo' = any (bs_eggs)) then return 'ufo'; end if;
  update profiles set bs_eggs = array_append(bs_eggs, 'ufo'), bs_theme = 'ufo' where id = me;
  perform _chaos_event(me, null, 'loot', 'battleship', null, '👽', 'You found the UFO fleet! Your Battleship ships are flying saucers now (change it in ⚙️ Settings).');
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
    if w = 3 then perform _chaos_event(p, null, 'loot', 'battleship', new.game_id, '🏴‍☠️', 'Pirate Cove unlocked (3 Battleship wins)! Pick it in ⚙️ Settings and sail under the black flag.');
    elsif w = 10 then perform _chaos_event(p, null, 'loot', 'battleship', new.game_id, '⚔️', 'Viking Fjord unlocked (10 Battleship wins)! Pick it in ⚙️ Settings and raise the longships.');
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists bs_theme_news on public.results;
create trigger bs_theme_news after insert on public.results for each row execute function public._bs_theme_news();

revoke execute on function public._bs_wins(uuid), public._bs_theme_news() from public, anon, authenticated;
revoke execute on function public.bs_themes(), public.set_bs_theme(text), public.unlock_bs_theme(text) from public, anon;
grant execute on function public.bs_themes(), public.set_bs_theme(text), public.unlock_bs_theme(text) to authenticated;
