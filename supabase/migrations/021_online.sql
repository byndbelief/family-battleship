-- 021: who's live. Every page checks in every 15 s with where it is (the lobby, or a game);
-- a player is live while their last check-in is under 45 s old and they haven't left.
-- Applied with the Supabase connector (apply_migration '021_online'). Safe to run again.
--
-- The table is only touched through here_now(), which checks you in and hands back the whole
-- family's status in one call: live or not, where, and when last seen. Robots aren't listed.

create table if not exists public.online (
  player uuid primary key references public.profiles (id) on delete cascade,
  page text not null default 'lobby' check (page in ('lobby', 'battleship', 'golf', 'duel', 'cards')),
  game_id uuid,
  away boolean not null default false,       -- tab hidden or page closed
  seen_at timestamptz not null default now()
);
alter table public.online enable row level security;   -- no policies: here_now() only
revoke all on public.online from anon, authenticated;

-- Check in (p_away: you just left or hid the page) and get everyone's status back:
-- [{ id, u (username), live, page, game, seen_at }], page and game only while live.
create or replace function public.here_now(p_page text default 'lobby', p_game uuid default null, p_away boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first'; end if;
  if p_page is null or p_page not in ('lobby', 'battleship', 'golf', 'duel', 'cards') then p_page := 'lobby'; p_game := null; end if;
  insert into online (player, page, game_id, away, seen_at) values (me, p_page, p_game, p_away, now())
    on conflict (player) do update set page = excluded.page, game_id = excluded.game_id, away = excluded.away, seen_at = now();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.player, 'u', p.username,
      'live', not o.away and o.seen_at > now() - interval '45 seconds',
      'page', case when not o.away and o.seen_at > now() - interval '45 seconds' then o.page end,
      'game', case when not o.away and o.seen_at > now() - interval '45 seconds' then o.game_id end,
      'seen_at', o.seen_at))
    from online o join profiles p on p.id = o.player where not exists (select 1 from bots b where b.profile_id = o.player)), '[]');
end $$;
revoke execute on function public.here_now(text, uuid, boolean) from public, anon;
grant execute on function public.here_now(text, uuid, boolean) to authenticated;
