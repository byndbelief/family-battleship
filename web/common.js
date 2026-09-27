// Shared by the game pages (golf.html, duel.html): the Supabase client, who's signed in,
// player names, which players are robots, and turn alerts.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { sfx, soundButton } from './sfx.js';
export { sfx };

soundButton();

// ---------------------------------------------------------------- full screen for the game area
// A page puts fsButton('#someId') inside the part of the page that is the game. On phones
// the button makes just that part cover the screen (browser bars hidden where the browser
// allows it; iPhone Safari keeps its bars but the game still fills the rest).
export const fsButton = (target) => `<button type="button" class="fsbtn" data-fs="${target}" aria-label="Full screen">⛶</button>`;
const fsStyle = document.createElement('style');
fsStyle.textContent = `
  .fsbtn{width:40px;height:40px;border-radius:12px;border:1.5px solid #ffffff55;background:#141026cc;color:#fff;font-size:20px;line-height:1;padding:0;cursor:pointer}
  @media (pointer:fine){.fsbtn{display:none!important}}
  .fs-on{position:fixed!important;inset:0;z-index:60;margin:0!important;max-width:none!important;width:auto!important;overflow:auto;overscroll-behavior:contain;
    background:var(--bg,#101024);box-sizing:border-box;padding:max(8px,env(safe-area-inset-top)) max(8px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left))}
  body.fs-lock{overflow:hidden}
  body.fs-lock #sfxToggle{bottom:auto;top:calc(8px + env(safe-area-inset-top,0px))}`;
document.head.appendChild(fsStyle);
const fsNative = () => document.fullscreenElement || document.webkitFullscreenElement;
function fsLabels() {
  const on = !!document.querySelector('.fs-on');
  document.body.classList.toggle('fs-lock', on);
  document.querySelectorAll('[data-fs]').forEach((b) => { b.textContent = on ? '✕' : '⛶'; b.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen'); });
}
function fsSync() { fsLabels(); dispatchEvent(new Event('resize')); }
export function fsExit() {
  document.querySelectorAll('.fs-on').forEach((el) => el.classList.remove('fs-on'));
  if (fsNative()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
  fsSync();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-fs]');
  if (!b) return;
  if (document.querySelector('.fs-on')) return fsExit();
  const el = document.querySelector(b.dataset.fs);
  if (!el) return;
  el.classList.add('fs-on');
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  try { req?.call(el, { navigationUI: 'hide' })?.catch?.(() => {}); } catch {}
  fsSync();
});
const fsChanged = () => { if (!fsNative() && document.querySelector('.fs-on') && (document.fullscreenEnabled || document.webkitFullscreenEnabled)) fsExit(); else fsSync(); };
document.addEventListener('fullscreenchange', fsChanged); document.addEventListener('webkitfullscreenchange', fsChanged);
// The page redrew the game area: keep its button's label right.
export const fsRefresh = () => fsLabels();

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
  // Join realtime as this player (not anonymously), or row-level security hides every change.
  try { await sb.realtime.setAuth(session.access_token); } catch {}
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  return true;
}

// Ask the server to send "your turn" alerts. Never blocks the game.
export function notify(kind, gameId) {
  sb.functions.invoke('notify', { body: { game_id: gameId, kind } }).catch(() => {});
  nudge();
}

// Keeps a game page live three ways, so a move shows up even if one path drops:
// database changes over realtime, a direct "I moved" nudge from the other player's page,
// and a light check every few seconds (and whenever the page comes back into view).
let liveCh = null;
export function nudge() { liveCh?.send({ type: 'broadcast', event: 'moved', payload: {} }).catch?.(() => {}); }
// `extra` maps more broadcast events (like a duel's live aiming) to handlers; send(event, payload) sends one.
export function liveGame(topic, changes, onChange, check, extra = {}) {
  liveCh = sb.channel(topic, { config: { broadcast: { self: false } } });
  changes.forEach((c) => liveCh.on('postgres_changes', { schema: 'public', ...c }, onChange));
  liveCh.on('broadcast', { event: 'moved' }, onChange);
  Object.entries(extra).forEach(([event, fn]) => liveCh.on('broadcast', { event }, (m) => fn(m.payload || {})));
  liveCh.subscribe((s) => { const el = document.getElementById('live'); if (el) el.textContent = s === 'SUBSCRIBED' ? '● Live' : 'Reconnecting…'; });
  setInterval(() => { if (!document.hidden) check(); }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) onChange(); });
  addEventListener('online', onChange);
  return { send: (event, payload) => { liveCh.send({ type: 'broadcast', event, payload }).catch?.(() => {}); } };
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
    sfx({ loot: 'chime', curse: 'curse', twist: 'twist', gauntlet: 'birdie' }[kind] || 'pop');
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

// ---------------------------------------------------------------- "your move" queue
const KIND_ICON = { battleship: '⚓', golf: '⛳', duel: '💥' };
const hrefFor = (kind, id) => (kind === 'battleship' ? `./#game=${id}` : `${kind}.html#game=${id}`);
// Every game where it's this player's move, newest first: { kind, id, href, at, players }.
export async function myTurns(meId) {
  const [bs, fl, golf, duel] = await Promise.all([
    sb.from('games').select('id, players, turn, status, eliminated, updated_at').in('status', ['setup', 'playing']).limit(60),
    sb.from('fleets').select('game_id').eq('player_id', meId),
    sb.from('golf_games').select('id, players, t, status, updated_at').eq('status', 'playing').limit(60),
    sb.from('duel_games').select('id, players, turn, status, updated_at').eq('status', 'playing').limit(60),
  ]);
  const placed = new Set((fl.data ?? []).map((f) => f.game_id)), out = [];
  (bs.data ?? []).forEach((g) => {
    if (!g.players.includes(meId)) return;
    if (g.status === 'setup' ? !placed.has(g.id) : g.players[g.turn] === meId && !g.eliminated.includes(meId)) out.push({ kind: 'battleship', id: g.id, at: g.updated_at, players: g.players });
  });
  (golf.data ?? []).forEach((g) => { if (g.players[g.t % g.players.length] === meId) out.push({ kind: 'golf', id: g.id, at: g.updated_at, players: g.players }); });
  (duel.data ?? []).forEach((g) => { if (g.players[g.turn] === meId) out.push({ kind: 'duel', id: g.id, at: g.updated_at, players: g.players }); });
  out.forEach((x) => { x.href = hrefFor(x.kind, x.id); });
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}
// A chip in the bottom-left corner of a game page: "▶ Next: ⛳ vs Sam +2", linking to the
// next game waiting on you. Call it again whenever things may have changed.
let nextBusy = false;
export async function nextUpChip(meId, currentId, nameOf) {
  if (nextBusy || !meId) return; nextBusy = true;
  try {
    const list = (await myTurns(meId)).filter((x) => x.id !== currentId);
    let chip = document.getElementById('nextUp');
    if (!list.length) { chip?.remove(); return; }
    if (!chip) {
      chip = document.createElement('a'); chip.id = 'nextUp';
      chip.style.cssText = 'position:fixed;left:calc(12px + env(safe-area-inset-left,0px));bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:70;max-width:calc(100vw - 88px);display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:999px;background:#F2C230;color:#2A2100;font:800 15px/1.2 system-ui,sans-serif;text-decoration:none;box-shadow:0 8px 22px #0007;white-space:nowrap;overflow:hidden';
      chip.addEventListener('click', (e) => {
        const u = new URL(chip.getAttribute('href'), location.href);
        if (u.pathname === location.pathname && !/\/(index\.html)?$/.test(u.pathname)) { e.preventDefault(); location.hash = u.hash; location.reload(); }
      });
      document.body.appendChild(chip);
      if (!document.getElementById('nextUpCss')) {
        const st = document.createElement('style'); st.id = 'nextUpCss';
        st.textContent = 'body.fs-lock #nextUp{display:none!important} #nextUp:focus-visible{outline:3px solid #fff;outline-offset:2px} @keyframes nudgeIn{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}} #nextUp{animation:nudgeIn .35s ease-out}';
        document.head.appendChild(st);
      }
    }
    const n = list[0], vs = n.players.filter((p) => p !== meId).map(nameOf).join(' & ') || 'solo';
    chip.href = n.href;
    chip.innerHTML = `<span>▶ Next:</span><span style="overflow:hidden;text-overflow:ellipsis">${KIND_ICON[n.kind]} vs ${esc(vs)}</span>${list.length > 1 ? `<span style="background:#2A2100;color:#F2C230;border-radius:99px;padding:1px 8px;font-size:13px">+${list.length - 1}</span>` : ''}`;
    chip.setAttribute('aria-label', `Next game waiting on you: ${n.kind} versus ${vs}${list.length > 1 ? `, and ${list.length - 1} more` : ''}`);
  } finally { nextBusy = false; }
}
