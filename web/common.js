// Shared by the game pages (golf.html, duel.html): the Supabase client, who's signed in,
// player names, which players are robots, and turn alerts.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const me = { id: null, username: null };
export const names = {};          // profile id -> username
export const bots = new Set();    // profile ids of robot players

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const nm = (id) => (bots.has(id) ? '🤖 ' : '') + esc(names[id] ?? 'someone');
export const friendly = (err) => (err?.message || String(err)).replace(/^.*?ERROR:\s*/, '');

// Loads the signed-in player, or sends them to the sign-in page.
export async function signedIn() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.href = './'; return false; }
  const [{ data: profiles }, { data: botRows }] = await Promise.all([
    sb.from('profiles').select('id, username'),
    sb.from('bots').select('profile_id'),
  ]);
  (profiles ?? []).forEach((p) => { names[p.id] = p.username; });
  (botRows ?? []).forEach((b) => bots.add(b.profile_id));
  me.id = session.user.id; me.username = names[me.id];
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  return true;
}

// Ask the server to send "your turn" alerts. Never blocks the game.
export function notify(kind, gameId) {
  sb.functions.invoke('notify', { body: { game_id: gameId, kind } }).catch(() => {});
}
