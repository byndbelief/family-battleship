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

// ---------------------------------------------------------------- chaos: loot, curses, twists
export const ITEMS = {
  sonar: { icon: '📡', name: 'Sonar Ping', game: 'battleship', desc: 'Reveal ship squares in a 3×3 patch.' },
  salvo: { icon: '🎆', name: 'Double Salvo', game: 'battleship', desc: 'Fire two extra shots this turn.' },
  golden_tee: { icon: '🏌️', name: 'Golden Tee', game: 'golf', desc: 'One free, honest mulligan this hole.' },
  magnet: { icon: '🧲', name: 'Magnet Cup', game: 'golf', desc: 'A huge, grabby cup for this hole.' },
  shield: { icon: '🛡️', name: 'Shield', game: 'duel', desc: 'Halves the next hit on your tank.' },
  bertha: { icon: '💣', name: 'Big Bertha', game: 'duel', desc: 'Your next shell has a monster blast.' },
  scroll: { icon: '📜', name: 'Curse Scroll', game: 'any', desc: 'Hex any player in a random game of theirs.' },
};

export async function backpack() {
  const { data } = await sb.from('loot').select('*').is('used_at', null).order('id');
  return data ?? [];
}
export async function useLoot(id, gameId = null, target = null, cell = null) {
  return sb.rpc('use_loot', { p_loot: id, p_game: gameId, p_target: target, p_cell: cell });
}

// Pops up chaos news (loot, curses, twists, Gauntlet rounds) one after another, then marks it seen.
let toastQueue = Promise.resolve();
export async function announceChaos(filter = {}) {
  let q = sb.from('chaos_events').select('*').is('seen_at', null).order('id').limit(8);
  if (filter.gameId) q = q.eq('game_id', filter.gameId);
  const { data } = await q;
  if (!data?.length) return [];
  await sb.rpc('chaos_seen', { p_ids: data.map((e) => e.id) });
  data.forEach((e) => { toastQueue = toastQueue.then(() => toast(e.icon, e.message, e.kind)); });
  return data;
}
function toast(icon, message, kind) {
  return new Promise((done) => {
    let box = document.getElementById('chaosToasts');
    if (!box) {
      box = document.createElement('div'); box.id = 'chaosToasts';
      box.style.cssText = 'position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:80;display:flex;flex-direction:column;gap:8px;width:min(440px,calc(100vw - 32px));pointer-events:none';
      document.body.appendChild(box);
    }
    const colors = { loot: '#F2C230', curse: '#B37BFF', twist: '#3DD6C6', gauntlet: '#FF8A3D' };
    const t = document.createElement('div');
    t.style.cssText = `pointer-events:auto;display:flex;gap:10px;align-items:center;padding:12px 14px;border-radius:14px;background:#141026f2;color:#fff;font:600 15px/1.35 system-ui,sans-serif;box-shadow:0 12px 30px #0008;border:2px solid ${colors[kind] || '#fff'};transform:translateY(-20px) scale(.9);opacity:0;transition:transform .35s cubic-bezier(.2,1.6,.4,1),opacity .25s`;
    t.innerHTML = `<span style="font-size:28px;line-height:1">${icon}</span><span></span>`;
    t.lastChild.textContent = message;
    box.appendChild(t);
    requestAnimationFrame(() => { t.style.transform = 'none'; t.style.opacity = '1'; });
    setTimeout(done, 900);
    const bye = () => { t.style.opacity = '0'; t.style.transform = 'translateY(-10px)'; setTimeout(() => t.remove(), 300); };
    t.onclick = bye; setTimeout(bye, 5200);
  });
}

// A backpack bar for a game page: the items usable in this game (plus scrolls), as buttons.
export function backpackBarHTML(items, gameKind, enabled) {
  const usable = items.filter((l) => ITEMS[l.item].game === gameKind);
  if (!usable.length) return '';
  const counts = {}; usable.forEach((l) => { counts[l.item] = (counts[l.item] || []).concat(l.id); });
  return `<div class="backpack" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;border:1.5px dashed #F2C23099;border-radius:14px;padding:10px 12px">
    <span style="font-weight:800;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#F2C230">🎒 Backpack</span>
    ${Object.entries(counts).map(([item, ids]) => `<button type="button" data-loot="${ids[0]}" data-item="${item}" ${enabled ? '' : 'disabled'} title="${esc(ITEMS[item].desc)}">${ITEMS[item].icon} ${ITEMS[item].name}${ids.length > 1 ? ` ×${ids.length}` : ''}</button>`).join('')}
  </div>`;
}
