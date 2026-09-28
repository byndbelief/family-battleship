-- 026: faster reloads in a live Battleship battle. The page reloads your guns in 1 s (was 2 s) and
-- the server allows a shot every 0.8 s (was 1.5); the robot fires every 1.2 s (was 2.4), asked
-- every 0.6 s by a page at the table.
-- Applied with the Supabase connector (apply_migration '026_bs_fast_reload'). Safe to run again.

create or replace function public.fire_live(p_game uuid, p_target uuid, p_cell int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g games; r jsonb;
begin
  select * into g from games where id = p_game for update;
  if not found or me is null or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This game isn''t being played right now'; end if;
  if me = any (g.eliminated) then raise exception 'Your fleet is sunk'; end if;
  if not _bs_live(g) then raise exception 'The live battle is over: back to taking turns'; end if;
  if exists (select 1 from shots where game_id = p_game and shooter = me and created_at > now() - interval '0.8 seconds') then
    raise exception 'Still reloading';
  end if;
  perform set_config('bs.live', '1', true);
  r := fire(p_game, p_target, array[p_cell]);
  perform set_config('bs.live', '', true);
  return r;
end $$;

create or replace function public.fire_live_bot(p_game uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g games; bot uuid; tgt uuid; cell int; orig text; r jsonb;
begin
  select * into g from games where id = p_game for update;
  if not found or me is null or not (me = any (g.players)) then raise exception 'Game not found'; end if;
  if not _bs_live(g) then return null; end if;
  select p into bot from unnest(g.players) p where exists (select 1 from bots where profile_id = p) and not (p = any (g.eliminated)) limit 1;
  if bot is null then return null; end if;
  if exists (select 1 from shots where game_id = p_game and shooter = bot and created_at > now() - interval '1.2 seconds') then return null; end if;
  -- Whoever it has wounded most, otherwise anyone still afloat.
  select t into tgt from unnest(g.players) t
    where t <> bot and not (t = any (g.eliminated))
    order by (select count(*) from shots s where s.game_id = p_game and s.target = t and s.hit
                and not exists (select 1 from shots s2 where s2.game_id = p_game and s2.target = t and s.cell = any (s2.sunk_cells))) desc, random()
    limit 1;
  if tgt is null then return null; end if;
  cell := (_bot_pick(p_game, bot, tgt, 1, g.mode))[1];
  if cell is null then return null; end if;
  orig := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claim.sub', bot::text, true);
  r := fire_live(p_game, tgt, cell);
  perform set_config('request.jwt.claim.sub', coalesce(orig, ''), true);
  return r || jsonb_build_object('target', tgt, 'cell', cell);
end $$;
