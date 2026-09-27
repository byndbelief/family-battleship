import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY, USERNAME_DOMAIN } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const app = document.getElementById('app');

const MODES = [
  { n: 8, ships: [4, 3, 3, 2] },
  { n: 10, ships: [5, 4, 3, 3, 2] },
];
const ROWS = 'ABCDEFGHIJ';

// ---------------------------------------------------------------- state

let me = null;            // { id, username }
let names = {};           // profile id -> username
let channel = null;       // the realtime subscription for the current screen
let G = null;             // the open game: { game, shots, myFleet, fleets }
let aims = { target: null, cells: new Set() };
let busy = false;

// ---------------------------------------------------------------- helpers

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nm = (id) => esc(names[id] ?? 'someone');
const cellName = (mode, i) => ROWS[Math.floor(i / MODES[mode].n)] + ((i % MODES[mode].n) + 1);
function shipName(mode, idx) {
  const lens = MODES[mode].ships, L = lens[idx];
  if (L === 3) return lens.slice(0, idx).includes(3) ? 'Submarine' : 'Cruiser';
  return { 5: 'Carrier', 4: 'Battleship', 2: 'Destroyer' }[L];
}
function shipCells(mode, s, len) {
  const n = MODES[mode].n, out = [];
  for (let k = 0; k < len; k++) out.push(s.c + k * (s.h ? 1 : n));
  return out;
}
const fleetCells = (mode, fleet) => fleet.map((s, i) => shipCells(mode, s, MODES[mode].ships[i]));
function randomFleet(mode) {
  const { n, ships } = MODES[mode];
  for (;;) {
    const used = new Set(), fleet = [];
    for (const len of ships) {
      for (let t = 0; t < 200; t++) {
        const h = Math.random() < 0.5;
        const r = Math.floor(Math.random() * (h ? n : n - len + 1));
        const c = Math.floor(Math.random() * (h ? n - len + 1 : n));
        const s = { c: r * n + c, h };
        const cells = shipCells(mode, s, len);
        if (cells.some((x) => used.has(x))) continue;
        cells.forEach((x) => used.add(x));
        fleet.push(s);
        break;
      }
    }
    if (fleet.length === ships.length) return fleet;
  }
}
function friendly(err) {
  const m = err?.message || String(err);
  return m.replace(/^.*?ERROR:\s*/, '');
}
function view(html) { app.innerHTML = html; }
function setChannel(ch) {
  if (channel) sb.removeChannel(channel);
  channel = ch;
}
// Ask the server to send "your turn" alerts. Never blocks the game.
function notify(gameId) {
  sb.functions.invoke('notify', { body: { game_id: gameId } }).catch(() => {});
}

// ---------------------------------------------------------------- boot & routing

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.url) location.hash = new URL(e.data.url, location.href).hash;
  });
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return loginView();
  await loadMe(session.user.id);
  route();
}
async function loadMe(uid) {
  const { data } = await sb.from('profiles').select('id, username');
  names = Object.fromEntries((data ?? []).map((p) => [p.id, p.username]));
  me = { id: uid, username: names[uid] };
}
function route() {
  if (!me) return loginView();
  const m = location.hash.match(/game=([0-9a-f-]{36})/);
  if (m) openGame(m[1]); else lobby();
}
window.addEventListener('hashchange', route);

// ---------------------------------------------------------------- login

function loginView(msg) {
  setChannel(null);
  view(`
    <div class="narrow">
      <header class="stack"><span class="eyebrow">Family Battleship</span><h1>Report for duty</h1>
        <p class="muted">Sign in with your player name and password.</p></header>
      <form class="card" id="login">
        <label class="field" for="user">Username<input type="text" id="user" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
        <label class="field" for="pass">Password<input type="password" id="pass" autocomplete="current-password" required></label>
        ${msg ? `<p class="error">${esc(msg)}</p>` : ''}
        <div><button class="primary" type="submit">Sign in</button></div>
      </form>
    </div>`);
  document.getElementById('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('user').value.trim().toLowerCase();
    const password = document.getElementById('pass').value;
    // Accept a bare username or the full login email.
    const email = user.includes('@') ? user : `${user}@${USERNAME_DOMAIN}`;
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return loginView(`That username and password don't match (signed in as ${email}). Check the spelling and try again.`);
    await loadMe(data.user.id);
    route();
  });
}

async function signOut() {
  // Stop this device getting the signed-out player's alerts.
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
  } catch {}
  await sb.auth.signOut();
  me = null;
  location.hash = '';
  loginView();
}

// ---------------------------------------------------------------- alerts

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

async function alertsState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIOS && !standalone ? 'ios-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}
async function enableAlerts() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'blocked';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
  if (error) throw error;
  return 'on';
}
async function renderAlerts() {
  const box = document.getElementById('alerts');
  if (!box) return;
  const st = await alertsState();
  const text = {
    on: `<p>Turn alerts are on for this device.</p>`,
    off: `<p>Get a notification when it's your turn, even with this page closed.</p><div><button class="primary" id="alertsOn">Turn on turn alerts</button></div>`,
    blocked: `<p class="muted">Notifications are blocked for this site. Allow them in your browser's site settings, then reload.</p>`,
    'ios-install': `<p>On iPhone or iPad, alerts work once the game is on your home screen: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>, and open Battleship from there.</p>`,
    unsupported: `<p class="muted">This browser can't show turn alerts. The game still updates live while it's open.</p>`,
  }[st];
  box.innerHTML = `<h2>Turn alerts</h2>${text}`;
  const btn = document.getElementById('alertsOn');
  if (btn) btn.onclick = async () => {
    btn.disabled = true;
    try { await enableAlerts(); } catch (e) { box.insertAdjacentHTML('beforeend', `<p class="error">Couldn't turn on alerts: ${esc(friendly(e))}</p>`); return; }
    renderAlerts();
  };
}

// ---------------------------------------------------------------- lobby

async function lobby() {
  G = null;
  const others = Object.entries(names).filter(([id]) => id !== me.id).sort((a, b) => a[1].localeCompare(b[1]));
  view(`
    <div class="narrow">
      <header class="row between">
        <div class="stack"><span class="eyebrow">Family Battleship</span><h1>Ahoy, ${esc(me.username)}</h1></div>
        <button class="link" id="signout">Sign out</button>
      </header>
      <section class="card">
        <div class="row between"><h2>Your games</h2><span class="live" id="live">Live</span></div>
        <ul class="games" id="games"><li class="muted">Loading games…</li></ul>
      </section>
      <section class="card">
        <h2>New game</h2>
        <form id="newgame" class="stack" style="gap:14px">
          <div class="stack"><span class="eyebrow">Opponents (pick one, or both for a 3-way battle)</span>
            <div class="choice">${others.map(([id, u]) => `<button type="button" class="chip" data-opp="${esc(u)}" aria-pressed="false">${esc(u)}</button>`).join('')}</div></div>
          <div class="stack"><span class="eyebrow">Board</span>
            <div class="choice"><label><input type="radio" name="mode" value="0">Quick 8×8 · 4 ships</label><label><input type="radio" name="mode" value="1" checked>Classic 10×10 · 5 ships</label></div></div>
          <div class="stack"><span class="eyebrow">Shots per turn</span>
            <div class="choice"><label><input type="radio" name="spt" value="1">1 shot</label><label><input type="radio" name="spt" value="3" checked>3 shots</label></div></div>
          <p class="error" id="newerr" hidden></p>
          <div><button class="primary" type="submit" id="start" disabled>Start game</button></div>
        </form>
      </section>
      <section class="card" id="alerts"></section>
    </div>`);
  document.getElementById('signout').onclick = signOut;
  const chips = [...app.querySelectorAll('[data-opp]')];
  const start = document.getElementById('start');
  chips.forEach((c) => c.addEventListener('click', () => {
    c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    start.disabled = !chips.some((x) => x.getAttribute('aria-pressed') === 'true');
  }));
  document.getElementById('newgame').addEventListener('submit', async (e) => {
    e.preventDefault();
    const opponents = chips.filter((x) => x.getAttribute('aria-pressed') === 'true').map((x) => x.dataset.opp);
    const mode = +app.querySelector('input[name=mode]:checked').value;
    const spt = +app.querySelector('input[name=spt]:checked').value;
    start.disabled = true;
    const { data, error } = await sb.rpc('create_game', { opponents, p_mode: mode, p_spt: spt });
    if (error) { const el = document.getElementById('newerr'); el.hidden = false; el.textContent = friendly(error); start.disabled = false; return; }
    notify(data);
    location.hash = `game=${data}`;
  });
  renderAlerts();
  setChannel(sb.channel('lobby')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, () => loadGames())
    .subscribe((s) => { const l = document.getElementById('live'); if (l) l.classList.toggle('off', s !== 'SUBSCRIBED'); }));
  loadGames();
}

async function loadGames() {
  const [{ data: games, error }, { data: placed }] = await Promise.all([
    sb.from('games').select('*').order('updated_at', { ascending: false }),
    sb.from('fleets').select('game_id').eq('player_id', me.id),
  ]);
  const list = document.getElementById('games');
  if (!list) return;
  if (error) { list.innerHTML = `<li class="error">Couldn't load games: ${esc(friendly(error))}</li>`; return; }
  if (!games.length) { list.innerHTML = `<li class="muted">No games yet. Start one below.</li>`; return; }
  const mine = new Set((placed ?? []).map((f) => f.game_id));
  list.innerHTML = games.map((g) => {
    const vs = g.players.filter((p) => p !== me.id).map(nm).join(' & ');
    let pill;
    if (g.status === 'over') pill = g.winner === me.id ? `<span class="pill done">You won</span>` : `<span class="pill done">${nm(g.winner)} won</span>`;
    else if (g.status === 'setup') pill = mine.has(g.id) ? `<span class="pill wait">Waiting for ships</span>` : `<span class="pill turn">Place your ships</span>`;
    else if (g.eliminated.includes(me.id)) pill = `<span class="pill out">You're out</span>`;
    else pill = g.players[g.turn] === me.id ? `<span class="pill turn">Your turn</span>` : `<span class="pill wait">${nm(g.players[g.turn])}'s turn</span>`;
    return `<li><button data-game="${g.id}"><span>vs <strong>${vs}</strong><br><span class="muted small">${g.players.length}-player · ${MODES[g.mode].n}×${MODES[g.mode].n}${g.move ? ` · move ${g.move}` : ''}</span></span>${pill}</button></li>`;
  }).join('');
  list.querySelectorAll('[data-game]').forEach((b) => b.addEventListener('click', () => { location.hash = `game=${b.dataset.game}`; }));
}

// ---------------------------------------------------------------- game

async function openGame(id) {
  aims = { target: null, cells: new Set() };
  view(`<p class="muted">Loading game…</p>`);
  const ok = await loadGame(id);
  if (!ok) {
    view(`<div class="narrow"><h1>Game not found</h1><p class="muted">It may have been deleted.</p><div><button class="primary" id="back">Back to games</button></div></div>`);
    document.getElementById('back').onclick = () => { location.hash = ''; };
    return;
  }
  let pending = false;
  const refresh = () => { if (pending) return; pending = true; setTimeout(async () => { pending = false; await loadGame(id); renderGame(); }, 150); };
  setChannel(sb.channel(`game-${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${id}` }, refresh)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'shots', filter: `game_id=eq.${id}` }, refresh)
    .subscribe((s) => { const l = document.getElementById('live'); if (l) l.classList.toggle('off', s !== 'SUBSCRIBED'); }));
  renderGame();
}

async function loadGame(id) {
  const [{ data: game }, { data: shots }, { data: fleets }] = await Promise.all([
    sb.from('games').select('*').eq('id', id).maybeSingle(),
    sb.from('shots').select('*').eq('game_id', id).order('id'),
    sb.from('fleets').select('*').eq('game_id', id),
  ]);
  if (!game) return false;
  const same = G?.game.id === id;
  const prevMove = same ? G.game.move : null;
  G = {
    game, shots: shots ?? [],
    draft: same ? G.draft : null, // keep an unsaved ship layout across live refreshes
    fleets: Object.fromEntries((fleets ?? []).map((f) => [f.player_id, f.ships])),
  };
  if (prevMove != null && game.move !== prevMove) aims = { target: null, cells: new Set() };
  return true;
}

function boardHTML({ owner, ships, clickable, fresh }) {
  const { game, shots } = G;
  const { n } = MODES[game.mode];
  const at = shots.filter((s) => s.target === owner);
  const shotAt = new Map(at.map((s) => [s.cell, s]));
  const sunk = new Set(at.flatMap((s) => s.sunk_cells ?? []));
  const shipAt = new Set(ships ? fleetCells(game.mode, ships).flat() : []);
  const aiming = aims.target === owner ? aims.cells : null;
  let h = `<div class="board" style="grid-template-columns:18px repeat(${n},1fr)"><span></span>`;
  for (let c = 0; c < n; c++) h += `<span class="lbl">${c + 1}</span>`;
  for (let r = 0; r < n; r++) {
    h += `<span class="lbl">${ROWS[r]}</span>`;
    for (let c = 0; c < n; c++) {
      const i = r * n + c, cls = ['cell'], s = shotAt.get(i);
      if (shipAt.has(i)) cls.push('ship');
      if (sunk.has(i)) cls.push('sunk');
      else if (s) cls.push(s.hit ? 'hit' : 'miss');
      if (aiming?.has(i)) cls.push('aim');
      if (s && fresh && s.move === game.move) cls.push('new');
      const label = cellName(game.mode, i);
      h += clickable && !s
        ? `<button class="${cls.join(' ')}" data-target="${owner}" data-cell="${i}" aria-label="Aim at ${label}"></button>`
        : `<span class="${cls.join(' ')}" aria-label="${label}"></span>`;
    }
  }
  return h + '</div>';
}
function fleetListHTML(owner) {
  const { game, shots } = G;
  const sunk = new Set(shots.filter((s) => s.target === owner && s.sunk_ship != null).map((s) => s.sunk_ship));
  return `<div class="fleet-list">${MODES[game.mode].ships.map((L, i) => `<span class="${sunk.has(i) ? 'gone' : ''}">${shipName(game.mode, i)} · ${L}</span>`).join('')}</div>`;
}
const legend = `<div class="legend"><span><i class="sw" style="background:var(--miss);box-shadow:0 0 0 1.5px var(--line)"></i>Miss</span><span><i class="sw" style="background:var(--hit)"></i>Hit</span><span><i class="sw" style="background:var(--hit)"></i>✕ Sunk</span><span><i class="sw" style="background:var(--flag)"></i>Aiming</span></div>`;

function feedHTML() {
  const { game, shots } = G;
  const moves = [...new Set(shots.map((s) => s.move))].sort((a, b) => b - a).slice(0, 4);
  if (!moves.length) return '';
  const items = moves.map((m) => {
    const ss = shots.filter((s) => s.move === m);
    const hits = ss.filter((s) => s.hit).length;
    const who = ss[0].shooter === me.id ? 'You' : nm(ss[0].shooter);
    const tgt = ss[0].target === me.id ? 'you' : nm(ss[0].target);
    const cells = ss.map((s) => `${cellName(game.mode, s.cell)} ${s.hit ? 'hit' : 'miss'}`).join(', ');
    const sank = ss.filter((s) => s.sunk_ship != null).map((s) => shipName(game.mode, s.sunk_ship));
    return `<li class="${hits ? 'hit' : ''}"><strong>${who}</strong> fired at <strong>${tgt}</strong>: ${cells}.${sank.length ? ` Sank the ${sank.join(' and ')}.` : ''}</li>`;
  }).join('');
  return `<section class="card"><h2>Latest shots</h2><ul class="feed">${items}</ul></section>`;
}

function renderGame() {
  if (!G) return;
  const { game } = G;
  const opponents = game.players.filter((p) => p !== me.id);
  const myTurn = game.status === 'playing' && game.players[game.turn] === me.id;
  const imOut = game.eliminated.includes(me.id);
  const need = aims.target ? Math.min(game.spt, MODES[game.mode].n ** 2 - G.shots.filter((s) => s.target === aims.target).length) : game.spt;

  let title, sub = '';
  if (game.status === 'setup') title = G.fleets[me.id] ? 'Waiting for ships' : 'Place your fleet';
  else if (game.status === 'over') title = game.winner === me.id ? 'You win!' : `${nm(game.winner)} wins!`;
  else if (imOut) { title = "You're out"; sub = 'Your fleet is sunk. You can keep watching the battle.'; }
  else if (myTurn) { title = 'Your turn'; sub = `Pick ${game.spt === 1 ? 'a square' : `${game.spt} squares`} on ${opponents.length > 1 ? "one opponent's" : `${nm(opponents[0])}'s`} board, then fire.`; }
  else { title = `${nm(game.players[game.turn])}'s turn`; sub = 'This page updates as soon as they fire.'; }

  const playersStrip = `<div class="players">${game.players.map((p) => {
    const cls = ['player'];
    if (game.status === 'playing' && game.players[game.turn] === p) cls.push('turn');
    if (game.eliminated.includes(p)) cls.push('out');
    return `<span class="${cls.join(' ')}">${p === me.id ? 'You' : nm(p)}${game.winner === p ? ' 🏆' : ''}</span>`;
  }).join('')}</div>`;

  let body = '';
  if (game.status === 'setup' && !G.fleets[me.id]) {
    if (!G.draft) G.draft = randomFleet(game.mode);
    body = `<section class="card narrow" style="margin:0">
      <p class="muted">Shuffle until you like where your ships are. Nobody else can see them.</p>
      ${boardHTML({ owner: me.id, ships: G.draft })}
      <div class="fleet-list">${MODES[game.mode].ships.map((L, i) => `<span>${shipName(game.mode, i)} · ${L}</span>`).join('')}</div>
      <p class="error" id="err" hidden></p>
      <div class="row"><button id="shuffle">Shuffle ships</button><button class="primary" id="ready">Ready</button></div>
    </section>`;
  } else if (game.status === 'setup') {
    const waiting = game.players.filter((p) => !G.fleets[p] && p !== me.id);
    body = `<div class="status">Your ships are placed. ${waiting.length ? `Waiting for ${waiting.map(nm).join(' and ')} to place theirs.` : ''} This page updates the moment the game starts.</div>
      <section class="card narrow" style="margin:0"><h2>Your fleet</h2>${boardHTML({ owner: me.id, ships: G.fleets[me.id] })}</section>`;
  } else {
    const over = game.status === 'over';
    const targets = opponents.map((p) => {
      const out = game.eliminated.includes(p);
      const cls = ['card'];
      if (aims.target === p) cls.push('target-active');
      if (out) cls.push('eliminated');
      return `<section class="${cls.join(' ')}">
        <div class="row between"><h2>${nm(p)}'s waters</h2>${out ? '<span class="pill out">Sunk</span>' : ''}</div>
        ${boardHTML({ owner: p, ships: over ? G.fleets[p] : null, clickable: myTurn && !out, fresh: true })}
        ${fleetListHTML(p)}
      </section>`;
    }).join('');
    body = `${feedHTML()}
      <div class="boards">${targets}
        <section class="card"><div class="row between"><h2>Your fleet</h2>${imOut ? '<span class="pill out">Sunk</span>' : ''}</div>
          ${boardHTML({ owner: me.id, ships: G.fleets[me.id], fresh: true })}
          ${fleetListHTML(me.id)}
          <p class="muted small">Yellow outlines mark the latest shots.</p></section>
      </div>
      ${legend}`;
  }

  const canDelete = game.created_by === me.id;
  view(`
    <header class="stack">
      <div class="row between"><button class="link" id="back">← All games</button><span class="live" id="live">Live</span></div>
      <h1>${title}</h1>
      ${sub ? `<p class="muted">${sub}</p>` : ''}
      ${playersStrip}
    </header>
    ${body}
    ${canDelete ? `<p><button class="link danger" id="del">Delete this game</button></p>` : ''}
    ${myTurn ? `<div class="firebar"><span id="aimtext">${aims.target ? `Aimed ${aims.cells.size} of ${need} at ${nm(aims.target)}` : 'Tap squares to aim'}</span><button class="fire" id="fire" ${aims.target && aims.cells.size === need && !busy ? '' : 'disabled'}>Fire!</button><span class="error" id="fireerr" hidden></span></div>` : ''}`);

  if (channel) { const l = document.getElementById('live'); l.classList.toggle('off', channel.state !== 'joined'); }
  document.getElementById('back').onclick = () => { location.hash = ''; };

  const del = document.getElementById('del');
  if (del) del.onclick = async () => {
    if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Tap again to delete the game for everyone'; return; }
    const { error } = await sb.rpc('delete_game', { p_game: game.id });
    if (error) { del.textContent = friendly(error); return; }
    location.hash = '';
  };

  const shuffle = document.getElementById('shuffle');
  if (shuffle) {
    shuffle.onclick = () => { G.draft = randomFleet(game.mode); renderGame(); };
    document.getElementById('ready').onclick = async (e) => {
      e.target.disabled = true;
      const { error } = await sb.rpc('set_fleet', { p_game: game.id, p_ships: G.draft });
      if (error) { const el = document.getElementById('err'); el.hidden = false; el.textContent = friendly(error); e.target.disabled = false; return; }
      notify(game.id);
      await loadGame(game.id);
      renderGame();
    };
  }

  app.querySelectorAll('[data-cell]').forEach((b) => b.addEventListener('click', () => {
    const target = b.dataset.target, cell = +b.dataset.cell;
    if (aims.target !== target) aims = { target, cells: new Set() };
    const max = Math.min(game.spt, MODES[game.mode].n ** 2 - G.shots.filter((s) => s.target === target).length);
    if (aims.cells.has(cell)) aims.cells.delete(cell);
    else if (aims.cells.size < max) aims.cells.add(cell);
    else if (max === 1) aims.cells = new Set([cell]);
    renderGame();
  }));

  const fire = document.getElementById('fire');
  if (fire) fire.onclick = async () => {
    busy = true; fire.disabled = true;
    const { error } = await sb.rpc('fire', { p_game: game.id, p_target: aims.target, p_cells: [...aims.cells] });
    busy = false;
    if (error) { const el = document.getElementById('fireerr'); el.hidden = false; el.textContent = friendly(error); fire.disabled = false; return; }
    aims = { target: null, cells: new Set() };
    notify(game.id);
    await loadGame(game.id);
    renderGame();
  };
}

boot();
