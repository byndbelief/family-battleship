// Sends "your turn" phone/desktop alerts after a move.
//
// The web app calls this right after it creates a game, places ships or fires.
// It works out who needs to hear about the game's new state and sends each of
// their registered devices a Web Push message.
//
// Secrets it needs (Supabase > Edge Functions > Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (a mailto: address)
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided
// automatically.

import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:alerts@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  let gameId: string, kind = 'battleship';
  try {
    ({ game_id: gameId, kind = 'battleship' } = await req.json());
  } catch {
    return json({ error: 'Send {"game_id": "..."}' }, 400);
  }

  const url = Deno.env.get('SUPABASE_URL')!;
  // Read the game as the caller, so row-level security proves they're in it.
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json({ error: 'Sign in first' }, 401);
  if (kind === 'golf' || kind === 'duel' || kind === 'cards') return otherGame(kind, gameId, user.id, caller);
  const { data: game } = await caller.from('games').select('*').eq('id', gameId).maybeSingle();
  if (!game) return json({ error: 'Game not found' }, 404);
  if (game.status === 'over' && game.gauntlet_id) await gauntletNudge(game.gauntlet_id, user.id);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: profiles } = await admin.from('profiles').select('id, username').in('id', game.players);
  const name = (id: string) => profiles?.find((p) => p.id === id)?.username ?? 'Someone';
  const me = name(user.id);
  const others = (game.players as string[]).filter((id) => id !== user.id);

  let recipients: string[] = [];
  let title = 'Family Battleship';
  let body = '';
  if (game.status === 'over') {
    recipients = others;
    title = `${name(game.winner)} won!`;
    body = `The game is over. Tap to see every fleet.`;
  } else if (game.status === 'playing') {
    const next = game.players[game.turn];
    if (next !== user.id) recipients = [next];
    title = 'Your turn';
    body = game.move === 0 ? 'All ships are placed. You fire first.' : `${me} just fired. Your move.`;
  } else if (user.id === game.created_by) {
    // Setup: the creator has just started the game (before placing their own
    // ships), so invite everyone else. Later setup calls send nothing.
    const { data: placed } = await admin.from('fleets').select('player_id').eq('game_id', gameId);
    const done = new Set((placed ?? []).map((f) => f.player_id));
    if (!done.has(user.id)) recipients = others;
    title = 'New game';
    body = `${me} started a game with you. Place your ships.`;
  }
  return send(recipients, title, body, `./#game=${gameId}`, gameId);
});

// Putt Post, Hilltop Duel and Chaos Cards: tell whoever is up next.
const TABLE: Record<string, string> = { golf: 'golf_games', duel: 'duel_games', cards: 'card_games', battleship: 'games' };
const LABEL: Record<string, string> = { golf: 'Putt Post', duel: 'Hilltop Duel', cards: 'Chaos Cards', battleship: 'Battleship' };
async function otherGame(kind: string, gameId: string, callerId: string, caller: ReturnType<typeof createClient>) {
  const { data: game } = await caller.from(TABLE[kind]).select('*').eq('id', gameId).maybeSingle();
  if (!game) return json({ error: 'Game not found' }, 404);
  if (game.status === 'over' && game.gauntlet_id) await gauntletNudge(game.gauntlet_id, callerId);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: profiles } = await admin.from('profiles').select('id, username').in('id', game.players);
  const name = (id: string) => profiles?.find((p) => p.id === id)?.username ?? 'Someone';
  const others = (game.players as string[]).filter((id) => id !== callerId);
  const label = LABEL[kind];
  let recipients: string[] = [], title = label, body = '';
  if (game.status === 'over') {
    recipients = others;
    title = `${label}: game over`;
    body = kind === 'duel' ? `${name(game.winner)} took the hill. Tap to see.` : kind === 'cards' ? `${name(game.winner)} emptied their hand. Tap to see.` : 'The round is over. Tap for the final scores.';
  } else {
    const next = kind === 'golf' ? game.players[game.t % game.players.length] : game.players[game.turn];
    if (next !== callerId) recipients = [next];
    title = `Your turn: ${label}`;
    body = kind === 'golf' ? `Hole ${game.start + Math.floor(game.t / game.players.length) + 1} is waiting. ${name(callerId)} just played.`
      : kind === 'cards' ? `${name(callerId)} just played. Your cards.` : `${name(callerId)} just fired. Your shot.`;
  }
  return send(recipients, title, body, `./${kind}.html#game=${gameId}`, gameId);
}

async function send(recipients: string[], title: string, body: string, url: string, gameId: string) {
  if (!recipients.length) return json({ sent: 0 });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: subs } = await admin.from('push_subscriptions').select('*').in('user_id', recipients);
  const payload = JSON.stringify({ title, body, url, tag: `game-${gameId}` });
  let sent = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (e) {
      // 404/410: the device unsubscribed or the browser dropped it.
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
    }
  }));
  return json({ sent });
}

// A Gauntlet round just ended: tell whoever opens the next round.
async function gauntletNudge(gauntletId: string, callerId: string) {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: gt } = await admin.from('gauntlets').select('*').eq('id', gauntletId).maybeSingle();
  if (!gt) return;
  if (gt.status === 'over') {
    await send((gt.players as string[]).filter((p) => p !== callerId), 'The Gauntlet is over', 'Tap to see who took the crown.', './', gauntletId);
    return;
  }
  const kind = gt.current_kind as string;
  const table = TABLE[kind];
  const { data: g } = await admin.from(table).select('*').eq('id', gt.current_game).maybeSingle();
  if (!g) return;
  // Battleship starts with everyone placing ships; the other games have a first player.
  const recipients = kind === 'battleship' ? (g.players as string[]) : [kind === 'golf' ? g.players[g.t % g.players.length] : g.players[g.turn]];
  const label = LABEL[kind];
  const url = kind === 'battleship' ? `./#game=${g.id}` : `./${kind}.html#game=${g.id}`;
  await send(recipients.filter((p) => p !== callerId), `🏆 Gauntlet round ${gt.round} of ${gt.rounds}`, `${label} is up. Your move!`, url, g.id);
}
