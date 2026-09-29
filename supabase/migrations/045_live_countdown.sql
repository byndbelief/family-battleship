-- 045: A countdown to the start of a live game, the same on every screen.
--   Liveness comes from 3-second heartbeats, so pages learn a game went live up to 3 s apart. Each
--   presence row now remembers when that player arrived (since; a heartbeat after 8 s away counts
--   as arriving again), and live_go(kind, game) says when the game goes: 5 s after the last one
--   still here arrived, plus the server's clock so a page can correct for its own. Pages count down
--   to it and hold fire/putts until GO (liveCountdown in common.js). kind: 'battleship', 'golf',
--   'cards' or 'duel'.
-- Applied with the Supabase connector (apply_migration '045_live_countdown'). Safe to run again.

alter table public.live_here add column if not exists since timestamptz not null default now();
alter table public.duel_here add column if not exists since timestamptz not null default now();

-- The heartbeats keep since, unless the player had been gone (then they've just arrived).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.live_here(text,uuid,boolean)'::regprocedure);
  if position('since' in d) = 0 then
    if position('on conflict (kind, game_id, player) do update set seen_at = now();' in d) = 0 then raise exception '045: live_here is not the shape this patch expects'; end if;
    execute replace(d, 'on conflict (kind, game_id, player) do update set seen_at = now();',
      'on conflict (kind, game_id, player) do update set since = case when live_here.seen_at < now() - interval ''8 seconds'' then now() else live_here.since end, seen_at = now();');
  end if;
  d := pg_get_functiondef('public.duel_here(uuid,boolean)'::regprocedure);
  if position('since' in d) = 0 then
    if position('on conflict (game_id, player) do update set seen_at = now();' in d) = 0 then raise exception '045: duel_here is not the shape this patch expects'; end if;
    execute replace(d, 'on conflict (game_id, player) do update set seen_at = now();',
      'on conflict (game_id, player) do update set since = case when duel_here.seen_at < now() - interval ''8 seconds'' then now() else duel_here.since end, seen_at = now();');
  end if;
end $$;

create or replace function public.live_go(p_kind text, p_game uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_kind = 'duel' then
    select max(since) into s from duel_here where game_id = p_game and seen_at > now() - interval '8 seconds';
  else
    select max(since) into s from live_here where kind = p_kind and game_id = p_game and seen_at > now() - interval '8 seconds';
  end if;
  return jsonb_build_object('go', (extract(epoch from coalesce(s, now()) + interval '5 seconds') * 1000)::bigint,
                            'now', (extract(epoch from clock_timestamp()) * 1000)::bigint);
end $$;
revoke execute on function public.live_go(text, uuid) from public, anon;
grant execute on function public.live_go(text, uuid) to authenticated;
