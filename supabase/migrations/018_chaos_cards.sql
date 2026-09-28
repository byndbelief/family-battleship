-- 018: Chaos Cards, a shedding card game (plays like Uno) with a chaos layer.
-- Applied with the Supabase connector (apply_migration '018_chaos_cards'). Safe to run again.
--
-- 2-4 players (the robot can play), 7 cards each; match the colour or the number/symbol, first to
-- empty their hand wins. Cards are text codes: a colour letter R G B Y + 0-9, S (skip), R (reverse)
-- or +2; wilds W and W4; chaos wilds CS (swap hands with anyone), CT (target: they draw 3),
-- CP (everyone passes their hand along), CB (bomb: everyone else draws 2). Every few moves a random
-- chaos event hits the table (colour storm, card rain, reverse).
-- Down to one card? Call "Last card!" with the play (p_last), or anyone can catch you (+2) until
-- you do or the next move is made. Hands are secret (you only ever read your own); the piles never
-- leave the server. While everyone is on the page (live_here 'cards'; the robot always counts),
-- turns have a 10 s timer: card_timeout() draws for the slow player and moves on.
-- The robot plays from the watching page (card_bot_play), and plays into the Gauntlet, the results
-- log and the chaos clock like the other games.

-- ---------------------------------------------------------------- tables
create table if not exists public.card_games (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id),
  players uuid[] not null check (cardinality(players) between 2 and 4),
  bot_level smallint check (bot_level between 0 and 2),
  gauntlet_id uuid references public.gauntlets (id) on delete set null,
  status text not null default 'playing' check (status in ('playing', 'over')),
  turn smallint not null default 0,
  dir smallint not null default 1,
  color text not null default 'R',
  top text not null default '',
  counts int[] not null default '{}',
  move int not null default 0,
  drew boolean not null default false,        -- the player on turn drew and may play it or pass
  exposed uuid,                               -- down to one card without calling it: catchable
  called uuid[] not null default '{}',        -- who has called "Last card!"
  next_chaos int not null default 5,          -- the move the next chaos event lands on
  last_play jsonb,                            -- what just happened, for the pages to show
  winner uuid references public.profiles (id),
  turn_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.card_hands (
  game_id uuid not null references public.card_games (id) on delete cascade,
  player uuid not null references public.profiles (id),
  cards text[] not null default '{}',
  primary key (game_id, player)
);
create table if not exists public.card_piles (
  game_id uuid primary key references public.card_games (id) on delete cascade,
  draw text[] not null default '{}',
  discard text[] not null default '{}'
);
alter table public.card_games enable row level security;
alter table public.card_hands enable row level security;
alter table public.card_piles enable row level security;
drop policy if exists "see card games you're in" on public.card_games;
create policy "see card games you're in" on public.card_games for select to authenticated using (auth.uid() = any (players));
drop policy if exists "see your own hand" on public.card_hands;
create policy "see your own hand" on public.card_hands for select to authenticated using (player = auth.uid());
revoke insert, update, delete, truncate on public.card_games, public.card_hands, public.card_piles from anon, authenticated;
do $$ begin
  alter publication supabase_realtime add table public.card_games;
exception when duplicate_object then null; end $$;

-- The turn clock (008) for card games.
create or replace function public._card_turn_moved() returns trigger
language plpgsql as $$
begin
  if new.move is distinct from old.move or new.turn is distinct from old.turn then new.turn_at := now(); end if;
  return new;
end $$;
drop trigger if exists turn_moved on public.card_games;
create trigger turn_moved before update on public.card_games for each row execute function public._card_turn_moved();

-- ---------------------------------------------------------------- cards
create or replace function public._card_deck() returns text[]
language sql volatile as $$
  select array_agg(c order by random()) from (
    select col || v as c from unnest(array['R', 'G', 'B', 'Y']) col,
      unnest(array['0', '1', '1', '2', '2', '3', '3', '4', '4', '5', '5', '6', '6', '7', '7', '8', '8', '9', '9', 'S', 'S', 'R', 'R', '+2', '+2']) v
    union all select unnest(array['W', 'W', 'W', 'W', 'W4', 'W4', 'W4', 'W4', 'CS', 'CS', 'CT', 'CT', 'CP', 'CP', 'CB', 'CB'])
  ) d
$$;
create or replace function public._card_wild(c text) returns boolean
language sql immutable as $$ select c in ('W', 'W4', 'CS', 'CT', 'CP', 'CB') $$;
create or replace function public._card_playable(c text, color text, top text) returns boolean
language sql immutable as $$
  select _card_wild(c) or left(c, 1) = color or (not _card_wild(top) and substr(c, 2) = substr(top, 2))
$$;
-- Removes one copy of a card from a hand.
create or replace function public._card_without(hand text[], c text) returns text[]
language sql immutable as $$
  select case when array_position(hand, c) is null then hand
    else hand[1 : array_position(hand, c) - 1] || hand[array_position(hand, c) + 1 :] end
$$;
-- Index (0-based) k seats on from i in direction d.
create or replace function public._card_seat(i int, k int, d int, n int) returns int
language sql immutable as $$ select (((i + k * d) % n) + n) % n $$;

-- Deals k cards to a player (reshuffling the discards into the pile when it runs out).
create or replace function public._card_give(p_game uuid, p_player uuid, k int) returns text[]
language plpgsql security definer set search_path = public as $$
declare pile card_piles; got text[] := '{}'; take int;
begin
  if k <= 0 then return got; end if;
  select * into pile from card_piles where game_id = p_game for update;
  if cardinality(pile.draw) < k then
    pile.draw := pile.draw || array(select x from unnest(pile.discard) x order by random());
    pile.discard := '{}';
  end if;
  take := least(k, cardinality(pile.draw));
  got := pile.draw[1 : take];
  update card_piles set draw = pile.draw[take + 1 :], discard = pile.discard where game_id = p_game;
  update card_hands set cards = cards || got where game_id = p_game and player = p_player;
  return got;
end $$;

-- Hand sizes, for everyone to see.
create or replace function public._card_recount(p_game uuid) returns void
language sql security definer set search_path = public as $$
  update card_games g set counts = array(
    select coalesce(cardinality(h.cards), 0) from generate_subscripts(g.players, 1) i
    left join card_hands h on h.game_id = g.id and h.player = g.players[i] order by i)
  where g.id = p_game
$$;

-- Shuffles, deals 7 each and turns up a first card (never a wild).
create or replace function public._card_setup(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g card_games; deck text[]; p uuid; first text; i int;
begin
  select * into g from card_games where id = p_game for update;
  deck := _card_deck();
  i := array_position(deck, (select x from unnest(deck) x where not _card_wild(x) and substr(x, 2) ~ '^[0-9]$' limit 1));
  first := deck[i]; deck := deck[1 : i - 1] || deck[i + 1 :];
  insert into card_piles (game_id, draw, discard) values (p_game, deck, '{}')
    on conflict (game_id) do update set draw = excluded.draw, discard = '{}';
  foreach p in array g.players loop
    insert into card_hands (game_id, player, cards) values (p_game, p, '{}') on conflict (game_id, player) do update set cards = '{}';
    perform _card_give(p_game, p, 7);
  end loop;
  update card_games set top = first, color = left(first, 1), next_chaos = 4 + floor(random() * 3)::int, updated_at = now() where id = p_game;
  perform _card_recount(p_game);
end $$;

create or replace function public.card_create(opponents text[], p_bot_level int default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); others uuid[]; gid uuid;
begin
  if me is null then raise exception 'Sign in first'; end if;
  -- Seated in the order they were picked.
  others := array(select p.id from (select distinct on (u) u, k from unnest(opponents) with ordinality o(u, k) order by u, k) o
                  join profiles p on p.username = o.u where p.id <> me order by o.k);
  if cardinality(others) < 1 or cardinality(others) > 3 then raise exception 'Pick 1 to 3 other players'; end if;
  insert into card_games (created_by, players, bot_level)
    values (me, array[me] || others,
            case when exists (select 1 from bots where profile_id = any (others)) then least(2, greatest(0, coalesce(p_bot_level, 1))) end)
    returning id into gid;
  perform _card_setup(gid);
  return gid;
end $$;

create or replace function public.card_delete(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from card_games where id = p_game and created_by = auth.uid();
  if not found then raise exception 'Only the player who started this game can delete it'; end if;
end $$;

-- ---------------------------------------------------------------- playing
-- Moves the turn on, fires any chaos event that's due, and records what happened.
create or replace function public._card_advance(p_game uuid, p_steps int, p_play jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare g card_games; n int; ev text; r float8; cols text[]; p uuid; win uuid;
begin
  perform _card_recount(p_game);
  select * into g from card_games where id = p_game for update;
  n := cardinality(g.players);
  -- An empty hand wins (checking the mover first: chaos cards can empty someone else's).
  select g.players[_card_seat(g.turn, k, g.dir, n) + 1] into win
    from generate_series(0, n - 1) k where g.counts[_card_seat(g.turn, k, g.dir, n) + 1] = 0 order by k limit 1;
  g.move := g.move + 1;
  if win is not null then
    update card_games set status = 'over', winner = win, move = g.move, drew = false, exposed = null,
      last_play = p_play || jsonb_build_object('won', win), updated_at = now() where id = p_game;
    perform _chaos_drop(win, 'cards', p_game, 'Emptying your hand');
    return;
  end if;
  g.turn := _card_seat(g.turn, p_steps, g.dir, n);
  if g.move >= g.next_chaos then
    r := random();
    if r < 0.34 then
      cols := array_remove(array['R', 'G', 'B', 'Y'], g.color);
      g.color := cols[1 + floor(random() * 3)::int]; ev := 'storm';
    elsif r < 0.67 or n = 2 then
      foreach p in array g.players loop perform _card_give(p_game, p, 1); end loop;
      perform _card_recount(p_game); ev := 'rain';
    else
      g.dir := -g.dir; ev := 'reverse';
    end if;
    g.next_chaos := g.move + 4 + floor(random() * 3)::int;
    p_play := p_play || jsonb_build_object('event', ev, 'color', g.color);
  end if;
  update card_games set turn = g.turn, dir = g.dir, color = g.color, move = g.move, next_chaos = g.next_chaos, drew = false,
    exposed = case when exposed is not null and exposed = (p_play ->> 'player')::uuid then exposed else null end,
    last_play = p_play, updated_at = now() where id = p_game;
end $$;

-- One play by `who` (a person through card_play, the robot through card_bot_play).
create or replace function public._card_play(p_game uuid, who uuid, p_card text, p_color text, p_target uuid, p_last boolean) returns void
language plpgsql security definer set search_path = public as $$
declare g card_games; hand text[]; n int; i int; nxt uuid; steps int := 1; tmp text[]; p uuid; left_ int;
begin
  select * into g from card_games where id = p_game for update;
  if not found or not (who = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This game is over'; end if;
  if g.players[g.turn + 1] <> who then raise exception 'It''s not your turn'; end if;
  select cards into hand from card_hands where game_id = p_game and player = who for update;
  if not (p_card = any (hand)) then raise exception 'That card isn''t in your hand'; end if;
  if not _card_playable(p_card, g.color, g.top) then raise exception 'That card doesn''t match'; end if;
  if _card_wild(p_card) and (p_color is null or p_color not in ('R', 'G', 'B', 'Y')) then raise exception 'Pick a colour'; end if;
  if p_card in ('CS', 'CT') and (p_target is null or p_target = who or not (p_target = any (g.players))) then raise exception 'Pick a player'; end if;
  n := cardinality(g.players); i := array_position(g.players, who) - 1;
  hand := _card_without(hand, p_card);
  update card_hands set cards = hand where game_id = p_game and player = who;
  update card_piles set discard = discard || g.top where game_id = p_game;
  update card_games set top = p_card, color = case when _card_wild(p_card) then p_color else left(p_card, 1) end where id = p_game;
  nxt := g.players[_card_seat(i, 1, g.dir, n) + 1];
  if substr(p_card, 2) = 'S' and not _card_wild(p_card) then steps := 2;
  elsif substr(p_card, 2) = 'R' and not _card_wild(p_card) then
    if n = 2 then steps := 2; else update card_games set dir = -dir where id = p_game; end if;
  elsif substr(p_card, 2) = '+2' then perform _card_give(p_game, nxt, 2); steps := 2;
  elsif p_card = 'W4' then perform _card_give(p_game, nxt, 4); steps := 2;
  elsif p_card = 'CT' then perform _card_give(p_game, p_target, 3);
  elsif p_card = 'CB' then
    foreach p in array g.players loop if p <> who then perform _card_give(p_game, p, 2); end if; end loop;
  elsif p_card = 'CS' then
    select cards into tmp from card_hands where game_id = p_game and player = p_target;
    update card_hands set cards = hand where game_id = p_game and player = p_target;
    update card_hands set cards = tmp where game_id = p_game and player = who;
  elsif p_card = 'CP' then
    -- Everyone hands their cards to the next player in the direction of play.
    create temp table if not exists _card_pass (player uuid, cards text[]) on commit drop;
    delete from _card_pass;
    insert into _card_pass select g.players[_card_seat(array_position(g.players, h.player) - 1, 1, g.dir, n) + 1], h.cards
      from card_hands h where h.game_id = p_game;
    update card_hands h set cards = x.cards from _card_pass x where h.game_id = p_game and h.player = x.player;
  end if;
  -- Last card: called with the play, or left open to be caught.
  select cardinality(cards) into left_ from card_hands where game_id = p_game and player = who;
  if left_ = 1 then
    if p_last then update card_games set called = array_append(array_remove(called, who), who), exposed = null where id = p_game;
    else update card_games set exposed = who, called = array_remove(called, who) where id = p_game; end if;
  else
    update card_games set called = array_remove(called, who), exposed = case when exposed = who then null else exposed end where id = p_game;
  end if;
  perform _card_advance(p_game, steps, jsonb_build_object('player', who, 'card', p_card, 'color', coalesce(p_color, left(p_card, 1)), 'target', p_target, 'move', g.move + 1));
end $$;

create or replace function public.card_play(p_game uuid, p_card text, p_color text default null, p_target uuid default null, p_last boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  perform _card_play(p_game, auth.uid(), p_card, p_color, p_target, p_last);
end $$;

-- Draw one. If it can be played you may play it (or pass); if not, the turn moves on.
create or replace function public._card_draw(p_game uuid, who uuid) returns text
language plpgsql security definer set search_path = public as $$
declare g card_games; got text[];
begin
  select * into g from card_games where id = p_game for update;
  if not found or not (who = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This game is over'; end if;
  if g.players[g.turn + 1] <> who then raise exception 'It''s not your turn'; end if;
  if g.drew then raise exception 'You already drew: play it or pass'; end if;
  got := _card_give(p_game, who, 1);
  update card_games set called = array_remove(called, who), exposed = case when exposed = who then null else exposed end where id = p_game;
  if cardinality(got) = 1 and _card_playable(got[1], g.color, g.top) then
    perform _card_recount(p_game);
    update card_games set drew = true, last_play = jsonb_build_object('player', who, 'drew', 1, 'move', g.move), updated_at = now() where id = p_game;
  else
    perform _card_advance(p_game, 1, jsonb_build_object('player', who, 'drew', 1, 'move', g.move + 1));
  end if;
  return got[1];
end $$;
create or replace function public.card_draw(p_game uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return _card_draw(p_game, auth.uid());
end $$;

create or replace function public.card_pass(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g card_games;
begin
  select * into g from card_games where id = p_game for update;
  if not found or not (auth.uid() = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' or g.players[g.turn + 1] <> auth.uid() then raise exception 'It''s not your turn'; end if;
  if not g.drew then raise exception 'Draw a card first'; end if;
  perform _card_advance(p_game, 1, jsonb_build_object('player', auth.uid(), 'passed', true, 'move', g.move + 1));
end $$;

-- "Last card!" said late (before anyone caught you) still counts.
create or replace function public.card_last(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g card_games;
begin
  select * into g from card_games where id = p_game for update;
  if not found or not (auth.uid() = any (g.players)) then raise exception 'Game not found'; end if;
  if g.exposed is distinct from auth.uid() then return; end if;
  update card_games set exposed = null, called = array_append(array_remove(called, auth.uid()), auth.uid()), updated_at = now() where id = p_game;
end $$;

-- Caught someone who didn't call their last card: they draw 2.
create or replace function public._card_catch(p_game uuid, who uuid, p_target uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare g card_games;
begin
  select * into g from card_games where id = p_game for update;
  if not found or not (who = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' or g.exposed is null or g.exposed <> p_target or p_target = who then return false; end if;
  perform _card_give(p_game, p_target, 2);
  perform _card_recount(p_game);
  update card_games set exposed = null, last_play = jsonb_build_object('player', who, 'caught', p_target, 'move', g.move), updated_at = now() where id = p_game;
  return true;
end $$;
create or replace function public.card_catch(p_game uuid, p_target uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return _card_catch(p_game, auth.uid(), p_target);
end $$;

-- ---------------------------------------------------------------- live mode (10 s a turn)
create or replace function public._card_live(g card_games) returns boolean
language sql stable security definer set search_path = public as $$
  select g.status = 'playing'
     and not exists (
       select 1 from unnest(g.players) p
       where not exists (select 1 from bots where profile_id = p)
         and not exists (select 1 from live_here h where h.kind = 'cards' and h.game_id = g.id and h.player = p and h.seen_at > now() - interval '8 seconds'));
$$;

-- The turn timer ran out: the slow player draws one and the turn moves on. Anyone at the table can
-- call it; only one call per turn does anything.
create or replace function public.card_timeout(p_game uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare g card_games; slow uuid;
begin
  select * into g from card_games where id = p_game for update;
  if not found or not (auth.uid() = any (g.players)) then raise exception 'Game not found'; end if;
  if not _card_live(g) or now() - g.turn_at < interval '9.5 seconds' then return false; end if;
  slow := g.players[g.turn + 1];
  if exists (select 1 from bots where profile_id = slow) then return false; end if;
  if not g.drew then perform _card_give(p_game, slow, 1); end if;
  perform _card_advance(p_game, 1, jsonb_build_object('player', slow, 'timeout', true, 'move', g.move + 1));
  return true;
end $$;

-- ---------------------------------------------------------------- the robot
-- Plays its turn (asked by a watching page, after a moment so people can follow). Rookie plays any
-- card that fits and forgets to call its last card half the time; Pro and Ace hold wilds back,
-- hit whoever is closest to winning, pick the colour they hold most, and catch people more often.
create or replace function public.card_bot_play(p_game uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  g card_games; bot uuid; hand text[]; lvl int; ok text[]; pick text; col text; tgt uuid; n int; i int; lead uuid; drawn text;
begin
  select * into g from card_games where id = p_game;
  if not found or not (auth.uid() = any (g.players)) then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then return false; end if;
  n := cardinality(g.players); lvl := coalesce(g.bot_level, 1);
  -- Anyone to catch? The robot notices more at higher levels.
  if g.exposed is not null then
    select b.profile_id into bot from bots b where b.profile_id = any (g.players) and b.profile_id <> g.exposed limit 1;
    if bot is not null and random() < (array[0.3, 0.6, 0.9])[lvl + 1] then perform _card_catch(p_game, bot, g.exposed); end if;
    select * into g from card_games where id = p_game;
  end if;
  bot := g.players[g.turn + 1];
  if not exists (select 1 from bots where profile_id = bot) then return false; end if;
  -- The player (not the robot) closest to winning.
  select q into lead from unnest(g.players) with ordinality u(q, k) where q <> bot order by g.counts[k] asc, random() limit 1;
  select cards into hand from card_hands where game_id = p_game and player = bot;
  ok := array(select c from unnest(hand) c where _card_playable(c, g.color, g.top));
  if cardinality(ok) = 0 then
    if g.drew then perform _card_advance(p_game, 1, jsonb_build_object('player', bot, 'passed', true, 'move', g.move + 1)); return true; end if;
    drawn := _card_draw(p_game, bot);
    select * into g from card_games where id = p_game;
    if not g.drew then return true; end if;
    select cards into hand from card_hands where game_id = p_game and player = bot;
    ok := array[drawn];
  end if;
  if lvl = 0 then pick := ok[1 + floor(random() * cardinality(ok))::int];
  else
    -- Hit the leader when they're close to winning; otherwise keep the wilds for later.
    select c into pick from unnest(ok) c order by
      case when g.counts[array_position(g.players, lead)] <= 3 and (c in ('W4', 'CT', 'CB', 'CS') or substr(c, 2) in ('+2', 'S')) then 0
           when _card_wild(c) then 2 else 1 end,
      case when substr(c, 2) in ('+2', 'S', 'R') then 0 else 1 end, random()
      limit 1;
    if pick = 'CS' and cardinality(hand) - 1 <= g.counts[array_position(g.players, lead)] then
      pick := coalesce((select c from unnest(ok) c where c <> 'CS' order by random() limit 1), pick);
    end if;
  end if;
  if _card_wild(pick) then
    select coalesce((select left(c, 1) from unnest(_card_without(hand, pick)) c where not _card_wild(c) group by left(c, 1) order by count(*) desc limit 1),
                    (array['R', 'G', 'B', 'Y'])[1 + floor(random() * 4)::int]) into col;
  end if;
  tgt := case when pick in ('CS', 'CT') then lead end;
  perform _card_play(p_game, bot, pick, col, tgt, random() < (array[0.5, 0.85, 1.0])[lvl + 1]);
  return true;
end $$;

-- ---------------------------------------------------------------- the rest of the site
-- Check-ins for live mode.
alter table public.live_here drop constraint if exists live_here_kind_check;
alter table public.live_here add constraint live_here_kind_check check (kind in ('battleship', 'golf', 'cards'));
create or replace function public.live_here(p_kind text, p_game uuid, p_on boolean default true) returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); b games; gg golf_games; cg card_games;
begin
  if p_kind = 'battleship' then
    select * into b from games where id = p_game;
    if not found or not (me = any (b.players)) then raise exception 'Game not found'; end if;
  elsif p_kind = 'golf' then
    select * into gg from golf_games where id = p_game;
    if not found or not (me = any (gg.players)) then raise exception 'Game not found'; end if;
  elsif p_kind = 'cards' then
    select * into cg from card_games where id = p_game;
    if not found or not (me = any (cg.players)) then raise exception 'Game not found'; end if;
  else
    raise exception 'Unknown game';
  end if;
  if p_on then
    insert into live_here (kind, game_id, player, seen_at) values (p_kind, p_game, me, now())
      on conflict (kind, game_id, player) do update set seen_at = now();
  else
    delete from live_here where kind = p_kind and game_id = p_game and player = me;
  end if;
  return case p_kind when 'battleship' then _bs_live(b) when 'golf' then _golf_live(gg) else _card_live(cg) end;
end $$;
create or replace function public._live_here_gone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from live_here where game_id = old.id
    and kind = (case tg_table_name when 'games' then 'battleship' when 'golf_games' then 'golf' else 'cards' end);
  return old;
end $$;
drop trigger if exists live_here_gone on public.card_games;
create trigger live_here_gone after delete on public.card_games for each row execute function public._live_here_gone();
drop trigger if exists game_deleted on public.card_games;
create trigger game_deleted after delete on public.card_games for each row execute function public._game_deleted();

-- The Gauntlet deals a hand of Chaos Cards too.
create or replace function public._kind_label(k text) returns text
language sql immutable as $$ select case k when 'battleship' then '⚓ Battleship' when 'golf' then '⛳ Putt Post' when 'cards' then '🃏 Chaos Cards' else '💥 Hilltop Duel' end $$;

create or replace function public._gauntlet_next(p_gauntlet uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  gt gauntlets;
  n int; rnd int; kinds text[]; k text; rot uuid[]; child uuid; has_bot boolean; p uuid;
begin
  select * into gt from gauntlets where id = p_gauntlet for update;
  n := cardinality(gt.players);
  rnd := gt.round + 1;
  kinds := array['golf', 'cards'] || case when n = 2 then array['duel', 'battleship'] when n = 3 then array['battleship'] else '{}'::text[] end;
  if cardinality(kinds) > 1 then kinds := array_remove(kinds, gt.current_kind); end if;
  k := kinds[1 + floor(random() * cardinality(kinds))::int];
  rot := gt.players[((rnd - 1) % n) + 1 : n] || gt.players[1 : ((rnd - 1) % n)];
  has_bot := exists (select 1 from bots where profile_id = any (gt.players));
  if k = 'battleship' then
    insert into games (created_by, players, mode, spt, gauntlet_id) values (gt.created_by, rot, 0, 3, p_gauntlet) returning id into child;
    insert into fleets (game_id, player_id, ships) select child, b.profile_id, _random_fleet(0::smallint) from bots b where b.profile_id = any (rot);
  elsif k = 'golf' then
    insert into golf_games (created_by, players, start, count, seed, bot_level, gauntlet_id)
      values (gt.created_by, rot, floor(random() * 18)::int, 1, 1 + floor(random() * 65534)::int, case when has_bot then 1 end, p_gauntlet)
      returning id into child;
    insert into golf_players (game_id, player) select child, x from unnest(rot) x;
  elsif k = 'cards' then
    insert into card_games (created_by, players, bot_level, gauntlet_id) values (gt.created_by, rot, case when has_bot then 1 end, p_gauntlet)
      returning id into child;
    perform _card_setup(child);
  else
    insert into duel_games (created_by, players, seed, bot_level, gauntlet_id)
      values (gt.created_by, rot, 1 + floor(random() * 65534)::int, case when has_bot then 1 end, p_gauntlet) returning id into child;
  end if;
  update gauntlets set round = rnd, current_kind = k, current_game = child, updated_at = now() where id = p_gauntlet;
  foreach p in array gt.players loop
    perform _chaos_event(p, null, 'gauntlet', k, child, '🏆', format('Gauntlet round %s of %s: %s!', rnd, gt.rounds, _kind_label(k)));
  end loop;
end $$;
drop trigger if exists gauntlet_cards on public.card_games;
create trigger gauntlet_cards after update on public.card_games for each row execute function public._gauntlet_round_over('cards');

create or replace function public.gauntlet_delete(p_gauntlet uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from gauntlets where id = p_gauntlet and created_by = auth.uid()) then
    raise exception 'Only the player who started the Gauntlet can call it off';
  end if;
  delete from games where gauntlet_id = p_gauntlet and status <> 'over';
  delete from golf_games where gauntlet_id = p_gauntlet and status <> 'over';
  delete from duel_games where gauntlet_id = p_gauntlet and status <> 'over';
  delete from card_games where gauntlet_id = p_gauntlet and status <> 'over';
  delete from chaos_events where game_id = p_gauntlet;
  delete from gauntlets where id = p_gauntlet;
end $$;

-- The results log and the family scoreboard count card games.
alter table public.results drop constraint if exists results_kind_check;
alter table public.results add constraint results_kind_check check (kind in ('battleship', 'golf', 'duel', 'cards', 'gauntlet'));
create or replace function public._log_card_result(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cg card_games; st jsonb := '{}'; p uuid;
begin
  if exists (select 1 from results where kind = 'cards' and game_id = p_game) then return; end if;
  select * into cg from card_games where id = p_game and status = 'over'; if not found then return; end if;
  foreach p in array cg.players loop
    st := st || jsonb_build_object(p::text, jsonb_build_object('left', cg.counts[array_position(cg.players, p)]));
  end loop;
  insert into results (kind, game_id, players, winners, gauntlet_id, stats)
    values ('cards', p_game, cg.players, case when cg.winner is null then '{}' else array[cg.winner] end, cg.gauntlet_id, st)
    on conflict (kind, game_id) do nothing;
end $$;
create or replace function public._card_result_on_finish() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'over' and old.status is distinct from 'over' then perform _log_card_result(new.id); end if;
  return new;
end $$;
drop trigger if exists log_result on public.card_games;
create trigger log_result after update on public.card_games for each row execute function public._card_result_on_finish();

create or replace function public.family_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (select * from results),
  per as (
    select p.id, p.username, exists (select 1 from bots b where b.profile_id = p.id) as bot,
      (select count(*) from r where kind = 'gauntlet' and p.id = any (players)) gauntlets,
      (select count(*) from r where kind = 'gauntlet' and p.id = any (winners)) titles,
      (select coalesce(sum((stats -> p.id::text ->> 'rounds')::int), 0) from r where kind = 'gauntlet' and p.id = any (players)) rounds_won,
      (select count(*) from r where kind <> 'gauntlet' and p.id = any (players) and cardinality(players) > 1) played,
      (select count(*) from r where kind <> 'gauntlet' and p.id = any (winners) and cardinality(players) > 1) won,
      (select jsonb_object_agg(k, jsonb_build_object(
          'played', (select count(*) from r where kind = k and p.id = any (players) and cardinality(players) > 1),
          'won', (select count(*) from r where kind = k and p.id = any (winners) and cardinality(players) > 1)))
        from unnest(array['battleship', 'golf', 'duel', 'cards']) k) by_kind,
      (select coalesce(sum((stats -> p.id::text ->> 'sunk')::int), 0) from r where kind = 'battleship') sunk,
      (select coalesce(sum((stats -> p.id::text ->> 'hits')::int), 0) from r where kind = 'battleship') hits,
      (select coalesce(sum((stats -> p.id::text ->> 'shots')::int), 0) from r where kind = 'battleship') bs_shots,
      (select coalesce(sum((stats -> p.id::text ->> 'hio')::int), 0) from r where kind = 'golf') hio,
      (select coalesce(sum((stats -> p.id::text ->> 'under')::int), 0) from r where kind = 'golf') under_par,
      (select coalesce(sum((stats -> p.id::text ->> 'holes')::int), 0) from r where kind = 'golf') holes,
      (select coalesce(sum((stats -> p.id::text ->> 'strokes')::int - (stats -> p.id::text ->> 'par')::int), 0) from r where kind = 'golf') to_par,
      (select count(*) from r where kind = 'duel' and (stats -> p.id::text ->> 'ko')::boolean) kos,
      (select coalesce(sum((stats -> p.id::text ->> 'direct')::int), 0) from r where kind = 'duel') direct_hits,
      (select count(*) from r where kind = 'cards' and p.id = any (winners)) cards_won,
      (select coalesce(sum((stats -> p.id::text ->> 'away')::int), 0) from r where kind in ('battleship', 'golf')) sneaky,
      (select coalesce(sum((stats -> p.id::text ->> 'busted')::int), 0) from r where kind in ('battleship', 'golf')) busted,
      (select coalesce(sum((stats -> p.id::text ->> 'catches')::int), 0) from r where kind in ('battleship', 'golf')) catches,
      -- current win streak: wins in a row, most recent first, games against someone
      (select count(*) from (
          select p.id = any (winners) w, row_number() over (order by finished_at desc) n,
                 sum(case when p.id = any (winners) then 0 else 1 end) over (order by finished_at desc rows unbounded preceding) losses
          from r where kind <> 'gauntlet' and p.id = any (players) and cardinality(players) > 1) s where losses = 0) streak
    from profiles p
  )
  select jsonb_build_object(
    'since', (select min(finished_at) from results),
    'players', coalesce((select jsonb_agg(to_jsonb(per) order by titles desc, won desc, played) from per), '[]'),
    'h2h', coalesce((select jsonb_agg(jsonb_build_object('a', a.id, 'b', b.id,
        'a_wins', (select count(*) from r where kind <> 'gauntlet' and cardinality(players) = 2 and a.id = any (players) and b.id = any (players) and winners = array[a.id]),
        'b_wins', (select count(*) from r where kind <> 'gauntlet' and cardinality(players) = 2 and a.id = any (players) and b.id = any (players) and winners = array[b.id])))
      from profiles a join profiles b on a.id < b.id), '[]'));
$$;

-- The chaos clock (008) covers card games: 2 h waiting = draw 2, 8 h = draw 4, 24 h on a Gauntlet
-- round = forfeit (the player with the fewest cards takes it).
create or replace function public._clock_turn(p_kind text, p_game uuid, out who uuid, out turn_key int, out turn_at timestamptz, out gauntlet uuid, out n int)
language plpgsql stable security definer set search_path = public as $$
declare g games; gg golf_games; dg duel_games; cg card_games;
begin
  if p_kind = 'battleship' then
    select * into g from games where id = p_game and status = 'playing';
    if found then who := g.players[g.turn + 1]; turn_key := g.move * 10 + g.turn; turn_at := g.turn_at; gauntlet := g.gauntlet_id; n := cardinality(g.players); end if;
  elsif p_kind = 'golf' then
    select * into gg from golf_games where id = p_game and status = 'playing';
    if found then who := gg.players[gg.t % cardinality(gg.players) + 1]; turn_key := gg.t; turn_at := gg.turn_at; gauntlet := gg.gauntlet_id; n := cardinality(gg.players); end if;
  elsif p_kind = 'cards' then
    select * into cg from card_games where id = p_game and status = 'playing';
    if found then who := cg.players[cg.turn + 1]; turn_key := cg.move * 10 + cg.turn; turn_at := cg.turn_at; gauntlet := cg.gauntlet_id; n := cardinality(cg.players); end if;
  else
    select * into dg from duel_games where id = p_game and status = 'playing';
    if found then who := dg.players[dg.turn + 1]; turn_key := dg.move; turn_at := dg.turn_at; gauntlet := dg.gauntlet_id; n := 2; end if;
  end if;
end $$;

create or replace function public._clock_hit(p_kind text, p_game uuid, p_who uuid, p_level int, p_why text) returns text
language plpgsql security definer set search_path = public as $$
declare effect text; gt int;
begin
  if p_kind = 'battleship' then
    insert into player_mods (game_id, player_id, shot_mod) values (p_game, p_who, -p_level)
      on conflict (game_id, player_id) do update set shot_mod = player_mods.shot_mod - p_level;
    effect := case when p_level = 1 then 'one shot fewer this turn' else 'two shots fewer this turn' end;
    update games set updated_at = now() where id = p_game;
  elsif p_kind = 'golf' then
    update golf_players set penalty = penalty + p_level where game_id = p_game and player = p_who;
    effect := format('+%s stroke%s on the card', p_level, case when p_level = 1 then '' else 's' end);
    update golf_games set updated_at = now() where id = p_game;
  elsif p_kind = 'cards' then
    perform _card_give(p_game, p_who, 2 * p_level);
    perform _card_recount(p_game);
    effect := format('%s extra cards in your hand', 2 * p_level);
    update card_games set updated_at = now() where id = p_game;
  else
    if p_level = 1 then
      update duel_games set gust = move, updated_at = now() where id = p_game;
      effect := 'a hurricane whips up for this shot';
    else
      update duel_games set hp = case when players[1] = p_who then array[greatest(1, hp[1] - 15), hp[2]] else array[hp[1], greatest(1, hp[2] - 15)] end,
        gust = move, updated_at = now() where id = p_game;
      effect := 'your tank rusts for −15 HP and a hurricane whips up';
    end if;
  end if;
  return effect;
end $$;

create or replace function public.chaos_clock() returns int
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); x record; c record; tier int; hrs float8; effect text; applied int := 0; p uuid; others uuid[]; msg text;
  g games; cg card_games;
begin
  if me is null then return 0; end if;
  for x in
    select 'battleship' k, id, players from games where status = 'playing' and me = any (players)
    union all select 'golf', id, players from golf_games where status = 'playing' and me = any (players) and cardinality(players) > 1
    union all select 'duel', id, players from duel_games where status = 'playing' and me = any (players)
    union all select 'cards', id, players from card_games where status = 'playing' and me = any (players)
  loop
    select * into c from _clock_turn(x.k, x.id);
    if c.who is null or exists (select 1 from bots where profile_id = c.who) then continue; end if;
    hrs := extract(epoch from now() - c.turn_at) / 3600;
    for tier in 1..3 loop
      exit when hrs < (array[2, 8, 24])[tier];
      if tier = 3 and c.gauntlet is null then exit; end if;
      insert into clock_marks (kind, game_id, turn_key, tier, player) values (x.k, x.id, c.turn_key, tier, c.who) on conflict do nothing;
      if not found then continue; end if;
      applied := applied + 1;
      others := array_remove(x.players, c.who);
      if tier < 3 then
        effect := _clock_hit(x.k, x.id, c.who, tier, 'chaos clock');
        perform _chaos_event(c.who, null, 'curse', x.k, x.id, '⏰', format('The chaos clock struck (%s hours waiting): %s.', (array[2, 8])[tier], effect));
        foreach p in array others loop
          perform _chaos_event(p, null, 'twist', x.k, x.id, '⏰', format('The chaos clock struck %s for stalling: %s.', _uname(c.who), effect));
        end loop;
      else
        -- 24 hours on a Gauntlet round: the slow player forfeits it.
        if x.k = 'golf' then
          perform _golf_submit(x.id, c.who, '[]'::jsonb, 8, 0, false);
        elsif x.k = 'duel' then
          update duel_games set status = 'over', winner = others[1], updated_at = now() where id = x.id;
        elsif x.k = 'cards' then
          select * into cg from card_games where id = x.id for update;
          update card_games set status = 'over', updated_at = now(),
            winner = (select q from unnest(cg.players) with ordinality u(q, k) where q <> c.who order by cg.counts[k], random() limit 1)
          where id = x.id;
        else
          select * into g from games where id = x.id for update;
          g.eliminated := array_append(g.eliminated, c.who);
          if cardinality(array(select q from unnest(g.players) q where not (q = any (g.eliminated)))) <= 1 then
            update games set eliminated = g.eliminated, status = 'over', updated_at = now(),
              winner = (select q from unnest(g.players) q where not (q = any (g.eliminated)) limit 1) where id = x.id;
          else
            -- Out of the battle; the turn passes to the next player still afloat.
            update games set eliminated = g.eliminated, updated_at = now(),
              turn = (g.turn + (select min(i) from generate_series(1, cardinality(g.players)) i
                                where not (g.players[((g.turn + i) % cardinality(g.players)) + 1] = any (g.eliminated)))) % cardinality(g.players)
            where id = x.id;
          end if;
        end if;
        msg := case when x.k = 'golf' then format('%s waited 24 hours: picked up with 8 strokes on the Gauntlet hole.', _uname(c.who))
                    else format('%s waited 24 hours and forfeits the Gauntlet round.', _uname(c.who)) end;
        foreach p in array x.players loop perform _chaos_event(p, null, 'gauntlet', x.k, x.id, '⏰', msg); end loop;
      end if;
    end loop;
  end loop;
  return applied;
end $$;

-- ---------------------------------------------------------------- permissions
revoke execute on function public._card_deck(), public._card_give(uuid, uuid, int), public._card_recount(uuid), public._card_setup(uuid),
  public._card_advance(uuid, int, jsonb), public._card_play(uuid, uuid, text, text, uuid, boolean), public._card_draw(uuid, uuid),
  public._card_catch(uuid, uuid, uuid), public._card_live(card_games), public._log_card_result(uuid), public._card_result_on_finish(),
  public._card_turn_moved() from public, anon, authenticated;
revoke execute on function public.card_create(text[], int), public.card_delete(uuid), public.card_play(uuid, text, text, uuid, boolean),
  public.card_draw(uuid), public.card_pass(uuid), public.card_last(uuid), public.card_catch(uuid, uuid), public.card_timeout(uuid),
  public.card_bot_play(uuid) from public, anon;
grant execute on function public.card_create(text[], int), public.card_delete(uuid), public.card_play(uuid, text, text, uuid, boolean),
  public.card_draw(uuid), public.card_pass(uuid), public.card_last(uuid), public.card_catch(uuid, uuid), public.card_timeout(uuid),
  public.card_bot_play(uuid) to authenticated;
