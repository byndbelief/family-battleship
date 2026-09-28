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
  body.fs-lock #sfxToggle{bottom:auto!important;top:calc(8px + env(safe-area-inset-top,0px))}`;
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

// ---------------------------------------------------------------- phones: game first
export const isPhone = () => matchMedia('(max-width: 640px)').matches;
// A section that is open on big screens and folded to a one-line header on phones.
export const foldOpen = () => (isPhone() ? '' : 'open');
// A quick message that pops in at the top and fades, instead of a line of text on the page.
let lastNote = '', lastNoteAt = 0;
export function note(text, tone = '') {
  text = String(text || '').trim();
  if (!text || (text === lastNote && Date.now() - lastNoteAt < 4000)) return;
  lastNote = text; lastNoteAt = Date.now();
  let box = document.getElementById('notes');
  if (!box) {
    box = document.createElement('div'); box.id = 'notes'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    box.style.cssText = 'position:fixed;left:50%;top:calc(10px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:85;display:flex;flex-direction:column;gap:6px;align-items:center;width:min(420px,calc(100vw - 24px));pointer-events:none';
    document.body.appendChild(box);
  }
  while (box.children.length >= 2) box.firstChild.remove();
  const n = document.createElement('div');
  const bg = tone === 'error' ? '#8E1F1Af2' : '#141026ee';
  n.style.cssText = `pointer-events:auto;padding:9px 14px;border-radius:12px;background:${bg};color:#fff;font:600 14px/1.35 system-ui,sans-serif;box-shadow:0 8px 20px #0007;text-align:center;opacity:0;transform:translateY(-8px);transition:opacity .2s,transform .2s`;
  n.textContent = text; n.onclick = () => n.remove();
  box.appendChild(n);
  requestAnimationFrame(() => { n.style.opacity = '1'; n.style.transform = 'none'; });
  setTimeout(() => { n.style.opacity = '0'; setTimeout(() => n.remove(), 250); }, Math.min(5000, 1800 + text.length * 35));
}
// Turns a line of page text (like a tip or an error) into quick notes on phones and in full screen:
// the line is hidden there, and each new message it shows pops up instead.
export function noteMirror(el, tone = '') {
  if (!el) return;
  el.classList.add('noteline');
  new MutationObserver(() => { if (isPhone() || document.querySelector('.fs-on')) note(el.textContent, tone); })
    .observe(el, { childList: true, characterData: true, subtree: true });
}
const foldCss = document.createElement('style');
foldCss.textContent = `
  details.mfold > summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px}
  details.mfold > summary::-webkit-details-marker{display:none}
  details.mfold > summary::after{content:'▾';font-size:18px;opacity:.7;transition:transform .2s}
  details.mfold:not([open]) > summary::after{transform:rotate(-90deg)}
  details.mfold > summary > *{margin:0}
  @media (max-width:640px){.noteline{display:none!important}}
  .fs-on .noteline{display:none!important}`;
document.head.appendChild(foldCss);

// ---------------------------------------------------------------- the Gauntlet bar on a game page
// Shows the series around this game: scores, the round track, and a button on to the next
// round once this one is decided. Put <div id="gtbar"></div> where it should go.
const GT_ICON = { battleship: '⚓', golf: '⛳', duel: '💥' };
export async function gauntletBar(gauntletId, gameId, meId, nameOf) {
  const el = document.getElementById('gtbar');
  if (!gauntletId) { if (el) el.innerHTML = ''; return ''; }
  const { data: gt } = await sb.from('gauntlets').select('*').eq('id', gauntletId).maybeSingle();
  if (!gt) { if (el) el.innerHTML = ''; return ''; }
  roundIntro(gt, gameId, meId, nameOf);
  const lead = Math.max(...gt.scores), who = (p) => (p === meId ? 'You' : esc(nameOf(p)));
  const table = gt.players.map((p, i) => `<span class="gtp${gt.scores[i] === lead && lead > 0 ? ' lead' : ''}">${gt.scores[i] === lead && lead > 0 ? '👑 ' : ''}${who(p)} <b>${gt.scores[i]}</b></span>`).join('');
  const done = gt.history || [];
  const dots = Array.from({ length: gt.rounds }, (_, i) => {
    const h = done[i], cur = !h && i === gt.round - 1 && gt.status === 'playing';
    const k = h ? h.kind : cur ? gt.current_kind : null;
    return `<i class="${h ? 'done' : cur ? 'cur' : ''}" title="Round ${i + 1}">${k ? GT_ICON[k] : ''}</i>`;
  }).join('');
  let go = '';
  if (gt.status === 'over') {
    const champs = gt.players.filter((_, i) => gt.scores[i] === lead).map(who).join(' & ');
    // The rivalry rolls straight into its next Gauntlet: offer its first round.
    const key = [...gt.players].sort().join(',');
    const { data: nextOnes } = await sb.from('gauntlets').select('*').eq('status', 'playing').order('created_at', { ascending: false }).limit(20);
    const nx = (nextOnes ?? []).find((x) => [...x.players].sort().join(',') === key);
    go = nx ? `<a class="gtgo" data-reload href="${nx.current_kind === 'battleship' ? `./#game=${nx.current_game}` : `${nx.current_kind}.html#game=${nx.current_game}`}">👑 ${champs} ${champs === 'You' ? 'win' : 'wins'}! Next Gauntlet: ${GT_ICON[nx.current_kind]} ›</a>`
      : `<a class="gtgo" href="./">👑 ${champs} ${champs === 'You' ? 'win' : 'wins'} the Gauntlet! ›</a>`;
  } else if (gt.current_game !== gameId) {
    go = `<a class="gtgo" data-reload href="${gt.current_kind === 'battleship' ? `./#game=${gt.current_game}` : `${gt.current_kind}.html#game=${gt.current_game}`}">Round ${gt.round}: ${GT_ICON[gt.current_kind]} Play ›</a>`;
  }
  const thisRound = done.findIndex((h) => h.game === gameId);
  const label = gt.status === 'over' ? 'Final' : `Round ${thisRound >= 0 ? thisRound + 1 : gt.round} of ${gt.rounds}`;
  const off = gt.status === 'playing' && gt.created_by === meId ? `<button type="button" class="gtoffbar" data-gtoff="${gt.id}">Call off</button>` : '';
  const html = `<div class="gtbar"><span class="gtt">🏆 Gauntlet · ${label}</span><span class="gtdots">${dots}</span><span class="gtscores">${table}</span>${go}${off}</div>`;
  const now = document.getElementById('gtbar'); if (now) now.innerHTML = html;
  return html;
}
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[data-reload]');
  if (!a) return;
  const u = new URL(a.getAttribute('href'), location.href);
  if (u.pathname === location.pathname && !/\/(index\.html)?$/.test(u.pathname)) { e.preventDefault(); location.hash = u.hash; location.reload(); }
});
// Call off from the bar: tap twice (within 4s). Remembered here, not on the button, because
// some pages redraw the bar between taps.
let gtOffArmed = null, gtOffAt = 0;
document.addEventListener('click', async (e) => {
  const b = e.target.closest?.('[data-gtoff]');
  if (!b) return;
  const id = b.dataset.gtoff;
  if (gtOffArmed !== id || Date.now() - gtOffAt > 4000) {
    gtOffArmed = id; gtOffAt = Date.now();
    b.textContent = 'Tap to confirm'; b.classList.add('armed');
    setTimeout(() => { if (b.isConnected && gtOffArmed === id && Date.now() - gtOffAt >= 4000) { b.textContent = 'Call off'; b.classList.remove('armed'); } }, 4100);
    return;
  }
  gtOffArmed = null; b.disabled = true;
  const { error } = await sb.rpc('gauntlet_delete', { p_gauntlet: id });
  if (error) { note(error.message.replace(/^.*?ERROR:\s*/, ''), 'error'); b.disabled = false; return; }
  note('Gauntlet called off.');
  setTimeout(() => { location.href = './'; }, 900);
});
const gtCss = document.createElement('style');
gtCss.textContent = `
  .gtbar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;padding:8px 12px;border-radius:14px;background:linear-gradient(90deg,#3A1D00,#6B3A00);color:#FFE7B0;font:600 14px/1.3 system-ui,sans-serif;border:1.5px solid #FFC85777}
  .gtbar .gtt{font-weight:800;letter-spacing:.02em}
  .gtbar .gtdots{display:flex;gap:4px}
  .gtbar .gtdots i{width:20px;height:20px;border-radius:50%;background:#ffffff22;display:grid;place-items:center;font-size:11px;font-style:normal}
  .gtbar .gtdots i.done{background:#FFC857}
  .gtbar .gtdots i.cur{background:#FF8A3D;box-shadow:0 0 0 2px #FFE7B0}
  .gtbar .gtscores{display:flex;flex-wrap:wrap;gap:8px}
  .gtbar .gtp b{color:#FFC857}
  .gtbar .gtp.lead{color:#fff}
  .gtbar .gtoffbar{min-height:30px;padding:3px 10px;border-radius:99px;font:700 12px/1 system-ui,sans-serif;background:#00000044;color:#F3D9A6;border:1.5px solid #FFC85766;cursor:pointer}
  .gtbar .gtoffbar.armed{background:#C0392B;color:#fff;border-color:#C0392B}
  .gtbar .gtoffbar:first-child,.gtbar .gtgo + .gtoffbar{margin-left:0}
  .gtbar > .gtoffbar{margin-left:auto}
  .gtbar .gtgo + .gtoffbar{margin-left:0}
  .gtbar .gtgo{margin-left:auto;background:#FFC857;color:#2A1600;border-radius:99px;padding:6px 14px;font-weight:800;text-decoration:none;animation:gtPulse 1.4s ease-in-out infinite}
  @keyframes gtPulse{50%{transform:scale(1.05)}}
  @media (prefers-reduced-motion:reduce){.gtbar .gtgo{animation:none}}
  .fs-on .gtbar{display:none}`;
document.head.appendChild(gtCss);

// ---------------------------------------------------------------- drama
// A full-screen moment: big lines slam in over a dark flash ("ROUND 3", "K.O.!"), then clear.
// Tap to skip. Reduced motion keeps the words and drops the slam.
export function splash(lines, { tone = 'gold', ms = 2200, sound = 'stinger' } = {}) {
  document.getElementById('dramaSplash')?.remove();
  const el = document.createElement('div'); el.id = 'dramaSplash'; el.className = `drama drama-${tone}`;
  el.setAttribute('role', 'status');
  el.innerHTML = lines.map((l, i) => `<span class="dl dl${i}" style="animation-delay:${i * 180}ms">${l}</span>`).join('');
  el.onclick = () => el.remove();
  document.body.appendChild(el);
  if (sound) sfx(sound);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, ms);
}
// A red pulse around the screen with a heartbeat while you're nearly out.
let dangerTimer = null;
export function danger(on) {
  let v = document.getElementById('dangerV');
  if (!on) { v?.remove(); clearInterval(dangerTimer); dangerTimer = null; return; }
  if (v) return;
  v = document.createElement('div'); v.id = 'dangerV'; v.setAttribute('aria-hidden', 'true');
  document.body.appendChild(v);
  sfx('heartbeat'); dangerTimer = setInterval(() => { if (!document.hidden) sfx('heartbeat'); }, 1300);
}
// The first time you open a Gauntlet round: which round, which game, and what's at stake.
const GT_NAME = { battleship: 'Battleship', golf: 'Putt Post', duel: 'Hilltop Duel' };
export function roundIntro(gt, gameId, meId, nameOf) {
  if (!gt || gt.status !== 'playing' || gt.current_game !== gameId) return;
  const key = `drama.intro.${gameId}`;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { return; }
  const left = gt.rounds - gt.round;   // rounds after this one
  const clinch = gt.players.filter((_, i) => gt.scores[i] + 1 > Math.max(...gt.players.map((__, j) => (j === i ? -1 : gt.scores[j] + left))));
  const who = (p) => (p === meId ? 'YOU' : esc(nameOf(p)).toUpperCase());
  const stakes = clinch.length === 1 ? `MATCH POINT: ${who(clinch[0])}` : gt.round === gt.rounds ? 'FINAL ROUND' : `${gt.scores.join(' – ')}`;
  splash([`ROUND ${gt.round}`, `${GT_ICON[gt.current_kind]} ${GT_NAME[gt.current_kind].toUpperCase()}`, stakes], { tone: clinch.length || gt.round === gt.rounds ? 'red' : 'gold', ms: 2600 });
}
const dramaCss = document.createElement('style');
dramaCss.textContent = `
  .drama{position:fixed;inset:0;z-index:90;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:16px;text-align:center;
    background:radial-gradient(circle at 50% 50%,#000a,#000e 70%);cursor:pointer;overflow:hidden;animation:dramaIn .2s ease-out both}
  .drama.out{opacity:0;transition:opacity .3s}
  .drama .dl{display:block;font-family:"Bungee","Rubik Mono One","Arial Black",Impact,sans-serif;line-height:1;color:#FFE08A;-webkit-text-stroke:2px #3A1D00;paint-order:stroke fill;
    text-shadow:0 5px 0 #3A1D00,0 0 36px #F2C230;animation:dramaSlam .5s cubic-bezier(.2,1.6,.4,1) both}
  .drama .dl0{font-size:clamp(20px,6vw,34px);letter-spacing:.2em;color:#fff}
  .drama .dl1{font-size:clamp(38px,12vw,84px)}
  .drama .dl2{font-size:clamp(18px,5.5vw,30px);letter-spacing:.08em;color:#fff;max-width:92vw;animation-name:dramaRise}
  @keyframes dramaRise{from{transform:translateY(14px);opacity:0}}
  .drama-red .dl1,.drama-red .dl2{color:#FF6B5E;-webkit-text-stroke-color:#2A0000;text-shadow:0 5px 0 #2A0000,0 0 36px #FF5A4E}
  @keyframes dramaIn{from{opacity:0}}
  @keyframes dramaSlam{0%{transform:scale(2.6);opacity:0}60%{transform:scale(.94);opacity:1}100%{transform:none}}
  #dangerV{position:fixed;inset:0;z-index:55;pointer-events:none;box-shadow:inset 0 0 90px 30px #E0201Aaa;animation:dangerPulse 1.3s ease-in-out infinite}
  @keyframes dangerPulse{0%,100%{opacity:.35}15%{opacity:1}30%{opacity:.5}45%{opacity:.85}}
  @media (prefers-reduced-motion:reduce){.drama,.drama .dl{animation:none}#dangerV{animation:none;opacity:.6}}`;
document.head.appendChild(dramaCss);

// ---------------------------------------------------------------- hidden cheats: secret gestures
// Cheats have no buttons. They hide behind a press-and-hold or a triple tap on ordinary-looking
// parts of the page. Both helpers delegate from `root`, so they survive pages that redraw.
// After a hold fires, the click that follows is swallowed so the tap underneath doesn't also act.
export function onHold(root, selector, fn, ms = 700) {
  let timer = null, start = null, swallow = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest?.(selector); if (!el || !root.contains(el)) return;
    start = { x: e.clientX, y: e.clientY }; cancel();
    timer = setTimeout(() => { timer = null; swallow = true; navigator.vibrate?.(15); fn(el, e); setTimeout(() => { swallow = false; }, 600); }, ms);
  });
  root.addEventListener('pointermove', (e) => { if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => root.addEventListener(t, cancel));
  root.addEventListener('click', (e) => { if (swallow && e.target.closest?.(selector)) { e.stopPropagation(); e.preventDefault(); swallow = false; } }, true);
  root.addEventListener('contextmenu', (e) => { if (e.target.closest?.(selector)) e.preventDefault(); });
}
export function onTaps(root, selector, n, fn) {
  let count = 0, last = 0;
  root.addEventListener('click', (e) => {
    const el = e.target.closest?.(selector); if (!el || !root.contains(el)) return;
    const now = Date.now(); count = now - last < 450 ? count + 1 : 1; last = now;
    if (count >= n) { count = 0; fn(el, e); }
  });
}
// Now and then, a rumour hints that the cheats exist. At most one per game page visit.
let rumourShown = false;
export function rumour(lines, chance = 0.25) {
  if (rumourShown || Math.random() > chance) return;
  rumourShown = true;
  setTimeout(() => note(`🤫 ${lines[Math.floor(Math.random() * lines.length)]}`), 1800);
}
const holdCss = document.createElement('style');
holdCss.textContent = '.nohold{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}';
document.head.appendChild(holdCss);

// ---------------------------------------------------------------- clocks
// Shot clock: a countdown pill while it's your turn. The time left is remembered for this turn
// (so reloading doesn't reset it) and pauses while the page is hidden. At zero, onExpire runs
// once; the server decides the penalty (shot_clock), once per turn.
let clockState = null;
// It sits in the page's [data-clockslot] (next to the game's controls) when there is one.
const mountClock = (el) => { const slot = document.querySelector('[data-clockslot]'); el.classList.toggle('inline', !!slot); if (slot) { if (el.parentNode !== slot) slot.appendChild(el); } else if (!el.isConnected) document.body.appendChild(el); };
export function shotClock(key, seconds, onExpire) {
  if (clockState?.key === key) { mountClock(clockState.el); return; }   // pages that redraw get it back
  stopShotClock();
  const store = `clock.${key}`;
  let left = seconds;
  try { const v = sessionStorage.getItem(store); if (v != null) left = +v; } catch {}
  if (left <= 0) return;
  const el = document.createElement('div'); el.id = 'shotClock'; el.setAttribute('role', 'timer'); el.setAttribute('aria-label', 'Shot clock');
  mountClock(el);
  const st = { key, left, el, timer: null };
  const paint = () => {
    const s = Math.max(0, Math.ceil(st.left));
    el.innerHTML = `<span>⏱</span><b>${s}</b>`;
    el.classList.toggle('hurry', s <= 10); el.style.setProperty('--frac', String(Math.max(0, st.left / seconds)));
  };
  st.timer = setInterval(() => {
    if (document.hidden) return;
    st.left -= 1; try { sessionStorage.setItem(store, String(st.left)); } catch {}
    paint();
    if (st.left <= 10 && st.left > 0) sfx('tick', { hi: st.left <= 5 });
    if (st.left <= 0) { stopShotClock(); sfx('alarm'); onExpire(); }
  }, 1000);
  clockState = st; paint();
}
export function stopShotClock() {
  if (!clockState) return;
  clearInterval(clockState.timer); clockState.el.remove(); clockState = null;
}
// Chaos clock: ask the server to apply anything overdue on my games (throttled). Returns how
// many hits landed, so a page can reload when something changed.
let lastChaosClock = 0;
export async function chaosClock() {
  if (Date.now() - lastChaosClock < 60000) return 0;
  lastChaosClock = Date.now();
  const { data } = await sb.rpc('chaos_clock');
  return data || 0;
}
// "chaos in 1h 20m" for a turn that started at turnAt (2h, 8h, then 24h for Gauntlet rounds).
export function chaosIn(turnAt, gauntlet) {
  if (!turnAt) return '';
  const hrs = (Date.now() - new Date(turnAt).getTime()) / 3600000;
  const next = [2, 8, ...(gauntlet ? [24] : [])].find((h) => h > hrs);
  if (next == null) return '';
  const m = Math.max(1, Math.round((next - hrs) * 60));
  const txt = m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  return next === 24 ? `⏰ forfeit in ${txt}` : `⏰ chaos in ${txt}`;
}
const clockCss = document.createElement('style');
clockCss.textContent = `
  #shotClock{position:fixed;left:50%;top:calc(8px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:75;display:flex;align-items:center;gap:6px;
    padding:6px 14px 6px 12px;border-radius:99px;background:#141026ee;color:#fff;font:800 18px/1 system-ui,sans-serif;box-shadow:0 6px 18px #0008;
    border:2px solid #FFC857;background-image:linear-gradient(90deg,#FFC85733 calc(var(--frac,1)*100%),transparent 0)}
  #shotClock b{font-variant-numeric:tabular-nums;min-width:1.4em;text-align:right}
  #shotClock.hurry{border-color:#FF5A4E;background-image:linear-gradient(90deg,#FF5A4E55 calc(var(--frac,1)*100%),transparent 0);animation:clockPulse 1s ease-in-out infinite}
  @keyframes clockPulse{50%{transform:translateX(-50%) scale(1.12)}}
  @media (prefers-reduced-motion:reduce){#shotClock.hurry{animation:none}}
  #shotClock.inline{position:static;transform:none;box-shadow:none;font-size:16px;padding:4px 12px 4px 10px;flex:none}
  #shotClock.inline.hurry{animation-name:clockPulseIn}
  @keyframes clockPulseIn{50%{transform:scale(1.12)}}`;
document.head.appendChild(clockCss);
