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

  let gameId: string;
  try {
    ({ game_id: gameId } = await req.json());
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
  const { data: game } = await caller.from('games').select('*').eq('id', gameId).maybeSingle();
  if (!game) return json({ error: 'Game not found' }, 404);

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
    body = `The game is over. Tap to see both fleets.`;
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
  if (!recipients.length) return json({ sent: 0 });

  const { data: subs } = await admin.from('push_subscriptions').select('*').in('user_id', recipients);
  const payload = JSON.stringify({ title, body, url: `./#game=${gameId}`, tag: `game-${gameId}` });
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
});
