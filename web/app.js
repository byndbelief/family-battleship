import { VAPID_PUBLIC_KEY, USERNAME_DOMAIN } from './config.js';
import { sb, ITEMS, backpack, useLoot, announceChaos, backpackBarHTML, sfx } from './common.js';
import { HOLES, holeWithAttack, drawHole, LW, LH } from './golf-engine.js';
import { W as DW, H as DH, TANK_X, buildTop } from './duel-engine.js';
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
let peekMode = false;           // next tap on an opponent's board spends a peek cheat
let sonarLoot = null;           // next tap on an opponent's board spends this Sonar Ping
const seenShots = new Map();    // game id -> Set of shot ids already animated
const seenAccusations = new Map();
const pending = new Set();      // shot ids whose shell is still in the air
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- helpers

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let bots = new Set();      // profile ids of robot players
const nm = (id) => (bots.has(id) ? '🤖 ' : '') + esc(names[id] ?? 'someone');
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
function notify(gameId, kind = 'battleship') {
  sb.functions.invoke('notify', { body: { game_id: gameId, kind } }).catch(() => {});
}

// ---------------------------------------------------------------- battle effects
// One full-screen canvas for shells, explosions, splashes and fireworks.
const fx = (() => {
  const c = document.createElement('canvas'); c.id = 'fx'; document.body.appendChild(c);
  const ctx = c.getContext('2d'); let parts = [], running = false;
  const size = () => { const d = Math.min(2, devicePixelRatio || 1); c.width = innerWidth * d; c.height = innerHeight * d; ctx.setTransform(d, 0, 0, d, 0, 0); };
  size(); addEventListener('resize', size);
  const loop = () => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter((p) => p.step());
    ctx.globalCompositeOperation = 'lighter';
    parts.forEach((p) => p.draw(ctx));
    ctx.globalCompositeOperation = 'source-over';
    if (parts.length) requestAnimationFrame(loop); else running = false;
  };
  const add = (p) => { parts.push(p); if (!running) { running = true; requestAnimationFrame(loop); } };
  const spark = (x, y, vx, vy, color, size, life, g = 0.12, drag = 0.97) => add({
    x, y, vx, vy, life, max: life,
    step() { this.x += this.vx; this.y += this.vy; this.vy += g; this.vx *= drag; this.vy *= drag; return --this.life > 0; },
    draw(k) { const a = this.life / this.max; k.globalAlpha = a; k.fillStyle = color; k.beginPath(); k.arc(this.x, this.y, size * (0.4 + a * 0.6), 0, 7); k.fill(); k.globalAlpha = 1; },
  });
  const ring = (x, y, color, maxR, life, width = 3) => add({
    t: 0, step() { return ++this.t < life; },
    draw(k) { const f = this.t / life; k.globalAlpha = 1 - f; k.strokeStyle = color; k.lineWidth = width * (1 - f) + 0.5; k.beginPath(); k.arc(x, y, maxR * f, 0, 7); k.stroke(); k.globalAlpha = 1; },
  });
  const smoke = (x, y) => add({
    x, y, r: 4, life: 60, vy: -0.6 - Math.random() * 0.6, vx: (Math.random() - 0.5) * 0.8,
    step() { this.x += this.vx; this.y += this.vy; this.r += 0.5; return --this.life > 0; },
    draw(k) { k.globalCompositeOperation = 'source-over'; k.globalAlpha = this.life / 60 * 0.35; k.fillStyle = '#3a3a44'; k.beginPath(); k.arc(this.x, this.y, this.r, 0, 7); k.fill(); k.globalAlpha = 1; k.globalCompositeOperation = 'lighter'; },
  });
  return {
    explode(x, y, big = 1) {
      ring(x, y, '#FFF3C4', 46 * big, 22, 5); ring(x, y, '#FF8A3D', 30 * big, 30, 3);
      const cols = ['#FFF3C4', '#FFD166', '#FF8A3D', '#FF4D3D'];
      for (let i = 0; i < 46 * big; i++) { const a = Math.random() * 6.283, v = (1.5 + Math.random() * 5) * big; spark(x, y, Math.cos(a) * v, Math.sin(a) * v - 1.5, cols[i % 4], 2 + Math.random() * 2.5, 30 + Math.random() * 25); }
      for (let i = 0; i < 7; i++) smoke(x + (Math.random() - 0.5) * 14, y + (Math.random() - 0.5) * 10);
    },
    splash(x, y) {
      ring(x, y, '#BFE9FF', 34, 34, 3); setTimeout(() => ring(x, y, '#7FC8F8', 24, 34, 2), 120);
      for (let i = 0; i < 26; i++) { const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6, v = 2 + Math.random() * 4; spark(x, y, Math.cos(a) * v, Math.sin(a) * v, i % 2 ? '#DFF4FF' : '#6FC3F5', 1.5 + Math.random() * 1.5, 34, 0.22); }
    },
    shell(fromX, fromY, x, y, onArrive, dur = 520) {
      const t0 = performance.now(), lift = Math.min(160, Math.abs(y - fromY) * 0.35 + 40);
      add({
        px: fromX, py: fromY,
        step() {
          const f = Math.min(1, (performance.now() - t0) / dur);
          this.px = fromX + (x - fromX) * f; this.py = fromY + (y - fromY) * f - Math.sin(f * Math.PI) * lift;
          spark(this.px, this.py, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, '#FFB25A', 1.6, 16, 0);
          if (f >= 1) { onArrive(); return false; } return true;
        },
        draw(k) { k.fillStyle = '#FFF6D8'; k.shadowColor = '#FFB25A'; k.shadowBlur = 16; k.beginPath(); k.arc(this.px, this.py, 4, 0, 7); k.fill(); k.shadowBlur = 0; },
      });
    },
    fireworks(n = 8) {
      const cols = ['#FFD166', '#FF6B5A', '#7FD3F7', '#B6F09C', '#FF8AD8', '#FFFFFF'];
      for (let i = 0; i < n; i++) setTimeout(() => {
        const x = innerWidth * (0.15 + Math.random() * 0.7), y = innerHeight * (0.15 + Math.random() * 0.35), col = cols[i % cols.length];
        this.shell(x + (Math.random() - 0.5) * 80, innerHeight + 10, x, y, () => {
          ring(x, y, col, 70, 36, 2); sfx('pop');
          for (let k = 0; k < 60; k++) { const a = k / 60 * 6.283, v = 3 + Math.random() * 2.5; spark(x, y, Math.cos(a) * v, Math.sin(a) * v, col, 2.2, 60, 0.05, 0.985); }
        }, 700);
      }, i * 280);
    },
  };
})();
function stamp(text, tone = '', ms = 2400) {
  if (!text) return;
  const el = document.createElement('div'); el.className = `stamp ${tone}`; el.innerHTML = `<span>${text}</span>`;
  document.body.appendChild(el); setTimeout(() => el.remove(), ms);
}
function banner(text) { const el = document.createElement('div'); el.className = 'banner'; el.innerHTML = `<span>${text}</span>`; document.body.appendChild(el); setTimeout(() => el.remove(), 1900); }
function quake(red) {
  if (reduceMotion) return;
  document.body.classList.remove('quake'); void document.body.offsetWidth; document.body.classList.add('quake');
  if (red) { const v = document.createElement('div'); v.className = 'vignette'; document.body.appendChild(v); setTimeout(() => v.remove(), 800); }
}
const cellEl = (owner, i) => app.querySelector(`[data-o="${owner}"][data-i="${i}"]`);
const centerOf = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

// Flies a shell at each new shot, then reveals the result where it lands.
function animateShots(newShots) {
  const { game } = G;
  if (reduceMotion || !newShots.length) { newShots.forEach((s) => pending.delete(s.id)); if (newShots.length) renderGame(); return; }
  const byMove = newShots.reduce((m, s) => ((m[s.move] ||= []).push(s), m), {});
  let delay = 0;
  // Bring the impact into view first.
  const first = cellEl(newShots[0].target, newShots[0].cell);
  if (first) { const r = first.getBoundingClientRect(); if (r.top < 60 || r.bottom > innerHeight - 90) { first.scrollIntoView({ block: 'center', behavior: 'smooth' }); delay = 450; } }
  Object.values(byMove).forEach((batch) => {
    batch.forEach((s, k) => {
      setTimeout(() => {
        const el = cellEl(s.target, s.cell);
        if (!el) { pending.delete(s.id); renderGame(); return; }
        const [x, y] = centerOf(el);
        const incoming = s.target === me.id;
        const fromX = x + (Math.random() - 0.5) * 120, fromY = incoming ? -20 : innerHeight + 20;
        sfx(incoming ? 'whistle' : 'cannon', { dur: 0.5 });
        fx.shell(fromX, fromY, x, y, () => {
          pending.delete(s.id);
          renderGame();
          const el2 = cellEl(s.target, s.cell);
          if (el2) { el2.classList.add('land'); }
          if (s.hit) { fx.explode(x, y, s.sunk_ship != null ? 1.6 : 1); sfx('boom', { size: s.sunk_ship != null ? 1.6 : 0.8 }); if (incoming) quake(true); } else { fx.splash(x, y); sfx('splash'); }
          if (s.sunk_ship != null) {
            (s.sunk_cells || []).forEach((c, j) => setTimeout(() => { const e = cellEl(s.target, c); if (e) { const [cx, cy] = centerOf(e); fx.explode(cx, cy, 0.7); } }, 120 * j));
            const ship = shipName(game.mode, s.sunk_ship);
            if (incoming) stamp(`Your ${ship}<br>is sunk!`, 'red');
            else if (s.shooter === me.id) stamp(`Sunk!<br><small style="font-size:.45em">${ship}</small>`);
            else stamp(`${ship} sunk!`, 'blue', 1800);
          }
        });
      }, delay + k * 260);
    });
    delay += batch.length * 260 + 700;
  });
  return delay;
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
  const { data: botRows } = await sb.from('bots').select('profile_id');   // missing table = no robot yet
  bots = new Set((botRows ?? []).map((b) => b.profile_id));
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
      <header class="stack"><span class="eyebrow">Family Game Room</span><h1>Game on</h1>
        <p class="muted">Sign in with your player name to jump into Battleship, Putt Post, Hilltop Duel and the Gauntlet.</p></header>
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
    if (error) return loginView(`That username and password don't match (tried ${email}). Check the spelling and try again.`);
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
    'ios-install': `<p>On iPhone or iPad, alerts work once the game is on your home screen: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>, and open the Game Room from there.</p>`,
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
const KIND_ICON = { battleship: '⚓', golf: '⛳', duel: '💥', gauntlet: '🏆' };
const KIND_NAME = { battleship: 'Battleship', golf: 'Putt Post', duel: 'Hilltop Duel', gauntlet: 'The Gauntlet' };
const KIND_BLURB = {
  battleship: 'Hide your fleet, hunt theirs. Peeking is allowed.',
  golf: '18 wild holes, sneak attacks and mulligans.',
  duel: 'Tanks on hills. Mind the wind.',
  gauntlet: 'A best-of series of random games. Winner takes the crown.',
};
const KIND_WHO = { battleship: '2–3 players', golf: 'Solo or up to 4', duel: '2 players', gauntlet: '2–4 players · 3, 5 or 7 rounds' };

async function lobby() {
  G = null;
  const others = Object.entries(names).filter(([id]) => id !== me.id).sort((a, b) => a[1].localeCompare(b[1]));
  view(`
    <div class="lobby">
      <header class="row between">
        <div class="stack"><span class="eyebrow">Family Game Room</span><h1>Ahoy, ${esc(me.username)}</h1></div>
        <button class="link" id="signout">Sign out</button>
      </header>
      <section class="stack" id="newSec">
        <h2>New game</h2>
        <div class="ncards" role="radiogroup" aria-label="Pick a game">
          ${Object.keys(KIND_NAME).map((k) => `
          <button type="button" class="ncard k-${k}" data-kind="${k}" role="radio" aria-checked="false">
            <canvas class="preview" data-kind="${k}" width="320" height="200" aria-hidden="true"></canvas>
            <span class="nbody"><strong>${KIND_ICON[k]} ${KIND_NAME[k]}</strong><span class="muted small">${KIND_BLURB[k]}</span><span class="eyebrow">${KIND_WHO[k]}</span></span>
          </button>`).join('')}
        </div>
        <form id="newgame" class="card" style="gap:14px" hidden>
          <h2 id="setupTitle"></h2>
          <div class="stack"><span class="eyebrow" id="oppHint">Opponents</span>
            <div class="choice">${others.map(([id, u]) => `<button type="button" class="chip" data-opp="${esc(u)}" data-id="${id}" aria-pressed="false">${bots.has(id) ? '🤖 ' : ''}${esc(u)}${bots.has(id) ? ' (robot)' : ''}</button>`).join('')}</div></div>
          <div class="stack" data-for="battleship"><span class="eyebrow">Board</span>
            <div class="choice"><label><input type="radio" name="mode" value="0">Quick 8×8 · 4 ships</label><label><input type="radio" name="mode" value="1" checked>Classic 10×10 · 5 ships</label></div></div>
          <div class="stack" data-for="battleship"><span class="eyebrow">Shots per turn</span>
            <div class="choice"><label><input type="radio" name="spt" value="1">1 shot</label><label><input type="radio" name="spt" value="3" checked>3 shots</label></div></div>
          <div class="stack" data-for="golf" hidden><span class="eyebrow">Course</span>
            <div class="choice"><label><input type="radio" name="course" value="0,18" checked>All 18</label><label><input type="radio" name="course" value="0,9">Front 9</label><label><input type="radio" name="course" value="9,9">Back 9</label></div>
            <div class="choice"><label><input type="checkbox" id="golfRandom" checked>Random obstacles</label></div></div>
          <div class="stack" data-for="gauntlet" hidden><span class="eyebrow">Rounds</span>
            <div class="choice"><label><input type="radio" name="rounds" value="3" checked>3</label><label><input type="radio" name="rounds" value="5">5</label><label><input type="radio" name="rounds" value="7">7</label></div>
            <p class="muted small">Each round is a random game: a single golf hole, a duel, or a quick Battleship. Win a round, win a point.</p></div>
          <div class="stack" data-for="botlevel" hidden><span class="eyebrow">Robot skill</span>
            <div class="choice"><label><input type="radio" name="botlvl" value="0">🟢 Rookie</label><label><input type="radio" name="botlvl" value="1" checked>🟡 Pro</label><label><input type="radio" name="botlvl" value="2">🔴 Ace</label></div></div>
          <p class="error" id="newerr" hidden></p>
          <div><button class="primary" type="submit" id="start" disabled>Start game</button></div>
        </form>
      </section>
      <section class="stack">
        <div class="row between"><h2>Your games</h2><span class="row" style="gap:14px"><button type="button" class="link" id="gamesMore" hidden></button><span class="live" id="live">Live</span></span></div>
        <div id="games"><p class="muted">Loading games…</p></div>
      </section>
      <div class="lobby-cols">
        <section class="card" id="packCard" hidden></section>
        <section class="card" id="chaosCard" hidden></section>
      </div>
      <section class="card" id="alerts"></section>
    </div>`);
  document.getElementById('signout').onclick = signOut;
  const chips = [...app.querySelectorAll('[data-opp]')];
  const start = document.getElementById('start');
  let chosen = null;
  const kind = () => chosen;
  const picked = () => chips.filter((x) => x.getAttribute('aria-pressed') === 'true');
  const LIMITS = {
    battleship: [1, 2, 'Opponents (pick one, or two for a 3-way battle)'], golf: [0, 3, 'Opponents (none for a solo round, up to three)'],
    duel: [1, 1, 'Opponent (pick one)'], gauntlet: [1, 3, 'Opponents (one to three)'],
  };
  const refreshForm = () => {
    if (!chosen) return;
    const k = kind(), [lo, hi, hint] = LIMITS[k];
    let sel = picked();
    while (sel.length > hi) { sel[0].setAttribute('aria-pressed', 'false'); sel = picked(); }
    document.getElementById('oppHint').textContent = hint;
    app.querySelectorAll('[data-for]').forEach((el) => {
      el.hidden = el.dataset.for === 'botlevel' ? !((k === 'golf' || k === 'duel') && sel.some((c) => bots.has(c.dataset.id))) : el.dataset.for !== k;
    });
    start.disabled = sel.length < lo || sel.length > hi;
    start.textContent = k === 'golf' && sel.length === 0 ? 'Start a solo round' : k === 'gauntlet' ? 'Start the Gauntlet' : 'Start game';
  };
  chips.forEach((c) => c.addEventListener('click', () => {
    c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    if (kind() === 'duel') chips.forEach((o) => { if (o !== c) o.setAttribute('aria-pressed', 'false'); });
    refreshForm();
  }));
  const form = document.getElementById('newgame');
  app.querySelectorAll('.ncard').forEach((card) => card.addEventListener('click', () => {
    chosen = card.dataset.kind;
    app.querySelectorAll('.ncard').forEach((o) => o.setAttribute('aria-checked', String(o === card)));
    document.getElementById('setupTitle').textContent = `${KIND_ICON[chosen]} ${KIND_NAME[chosen]}`;
    document.getElementById('newerr').hidden = true;
    form.hidden = false;
    refreshForm();
    const r = form.getBoundingClientRect();
    if (r.bottom > innerHeight) form.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  }));
  app.querySelectorAll('canvas.preview[data-kind]').forEach((cv) => drawSample(cv, cv.dataset.kind));
  document.getElementById('newgame').addEventListener('submit', async (e) => {
    e.preventDefault();
    const opponents = picked().map((x) => x.dataset.opp);
    const k = kind(), botLevel = +app.querySelector('input[name=botlvl]:checked').value;
    start.disabled = true;
    let res;
    if (k === 'golf') {
      const [st, ct] = app.querySelector('input[name=course]:checked').value.split(',').map(Number);
      res = await sb.rpc('golf_create', { opponents, p_start: st, p_count: ct, p_random: document.getElementById('golfRandom').checked, p_bot_level: botLevel });
    } else if (k === 'duel') {
      res = await sb.rpc('duel_create', { p_opponent: opponents[0], p_bot_level: botLevel });
    } else if (k === 'gauntlet') {
      res = await sb.rpc('gauntlet_create', { opponents, p_rounds: +app.querySelector('input[name=rounds]:checked').value });
    } else {
      res = await sb.rpc('create_game', { opponents, p_mode: +app.querySelector('input[name=mode]:checked').value, p_spt: +app.querySelector('input[name=spt]:checked').value });
    }
    const { data, error } = res;
    if (error) { const el = document.getElementById('newerr'); el.hidden = false; el.textContent = friendly(error); start.disabled = false; return; }
    if (k === 'gauntlet') {
      const { data: gt } = await sb.from('gauntlets').select('current_kind, current_game').eq('id', data).maybeSingle();
      notify(gt.current_game, gt.current_kind);
      location.href = gt.current_kind === 'battleship' ? `./#game=${gt.current_game}` : `${gt.current_kind}.html#game=${gt.current_game}`;
      if (gt.current_kind === 'battleship') route();
      return;
    }
    notify(data, k);
    if (k === 'battleship') location.hash = `game=${data}`;
    else location.href = `${k}.html#game=${data}`;
  });
  renderAlerts();
  const reload = () => { loadGames(); loadChaos(); };
  setChannel(['games', 'golf_games', 'duel_games', 'gauntlets', 'chaos_events'].reduce(
    (ch, table) => ch.on('postgres_changes', { event: '*', schema: 'public', table }, reload), sb.channel('lobby'))
    .subscribe((st) => { const l = document.getElementById('live'); if (l) l.classList.toggle('off', st !== 'SUBSCRIBED'); }));
  loadGames(); loadChaos();
}

// ---- your games, as a list of game states
async function loadGames() {
  const [bsRes, golfRes, duelRes, gtRes] = await Promise.all([
    sb.from('games').select('*').order('updated_at', { ascending: false }).limit(40),
    sb.from('golf_games').select('*').order('updated_at', { ascending: false }).limit(40),
    sb.from('duel_games').select('*').order('updated_at', { ascending: false }).limit(40),
    sb.from('gauntlets').select('*').order('updated_at', { ascending: false }).limit(20),
  ]);
  const list = document.getElementById('games');
  if (!list) return;
  if (bsRes.error) { list.innerHTML = `<p class="error">Couldn't load games: ${esc(friendly(bsRes.error))}</p>`; return; }
  const bs = bsRes.data ?? [], golf = golfRes.data ?? [], duel = duelRes.data ?? [], gts = gtRes.data ?? [];
  const bsIds = bs.map((g) => g.id), golfIds = golf.map((g) => g.id);
  const [{ data: myFleets }, { data: atMe }, { data: golfTurns }] = await Promise.all([
    bsIds.length ? sb.from('fleets').select('game_id, ships').eq('player_id', me.id).in('game_id', bsIds) : { data: [] },
    bsIds.length ? sb.from('shots').select('game_id, cell, hit, sunk_cells').eq('target', me.id).in('game_id', bsIds) : { data: [] },
    golfIds.length ? sb.from('golf_turns').select('game_id, player, written, fine, skipped').in('game_id', golfIds) : { data: [] },
  ]);
  const gtName = Object.fromEntries(gts.map((g) => [g.id, g]));
  const turnPill = (id) => (id === me.id ? `<span class="pill turn">Your turn</span>` : `<span class="pill wait">${nm(id)}'s turn</span>`);
  const vsOf = (players) => { const o = players.filter((p) => p !== me.id); return o.length ? `vs ${o.map(nm).join(' & ')}` : 'Solo round'; };
  const round = (g) => (g.gauntlet_id && gtName[g.gauntlet_id] ? `<span class="pill gt">🏆 Round ${gtName[g.gauntlet_id].round}</span>` : '');
  const cards = [];
  bs.forEach((g) => {
    let pill;
    if (g.status === 'over') pill = g.winner === me.id ? `<span class="pill done">You won</span>` : `<span class="pill done">${nm(g.winner)} won</span>`;
    else if (g.status === 'setup') pill = (myFleets ?? []).some((f) => f.game_id === g.id) ? `<span class="pill wait">Waiting for ships</span>` : `<span class="pill turn">Place your ships</span>`;
    else if (g.eliminated.includes(me.id)) pill = `<span class="pill out">You're out</span>`;
    else pill = turnPill(g.players[g.turn]);
    cards.push({ at: g.updated_at, kind: 'battleship', g, href: `#game=${g.id}`, mine: pill.includes('turn"'), over: g.status === 'over', prog: null, pill, sub: `${MODES[g.mode].n}×${MODES[g.mode].n}${g.move ? ` · move ${g.move}` : ''}`, vs: vsOf(g.players), extra: round(g) });
  });
  golf.forEach((g) => {
    const n = g.players.length, hole = g.start + Math.floor(Math.min(g.t, g.count * n - 1) / n);
    const pill = g.status === 'over' ? `<span class="pill done">Finished</span>` : turnPill(g.players[g.t % n]);
    const mine = (golfTurns ?? []).filter((t) => t.game_id === g.id && t.player === me.id && !t.skipped).reduce((a, t) => a + t.written + t.fine, 0);
    cards.push({ at: g.updated_at, kind: 'golf', g, hole, href: `golf.html#game=${g.id}`, mine: pill.includes('turn"'), over: g.status === 'over', prog: g.status === 'over' ? 1 : g.t / (g.count * n), pill, sub: `${g.status === 'over' ? 'Final' : `Hole ${hole + 1}`} · ${HOLES[hole].name}${mine ? ` · you: ${mine}` : ''}`, vs: vsOf(g.players), extra: round(g) });
  });
  duel.forEach((g) => {
    const pill = g.status === 'over' ? (g.winner === me.id ? `<span class="pill done">You won</span>` : `<span class="pill done">${nm(g.winner)} won</span>`) : turnPill(g.players[g.turn]);
    cards.push({ at: g.updated_at, kind: 'duel', g, href: `duel.html#game=${g.id}`, mine: pill.includes('turn"'), over: g.status === 'over', prog: null, pill, sub: `${g.hp[0]} – ${g.hp[1]} HP${g.move ? ` · shot ${g.move}` : ''}`, vs: vsOf(g.players), extra: round(g) });
  });
  gts.forEach((g) => {
    const lead = Math.max(...g.scores);
    const table = g.players.map((p, i) => `${g.scores[i] === lead && lead > 0 ? '👑 ' : ''}${p === me.id ? 'You' : nm(p)} ${g.scores[i]}`).join(' · ');
    const href = g.status === 'over' ? '#' : g.current_kind === 'battleship' ? `#game=${g.current_game}` : `${g.current_kind}.html#game=${g.current_game}`;
    cards.push({ at: g.updated_at, kind: 'gauntlet', g, href, mine: false, over: g.status === 'over', prog: (g.history || []).length / g.rounds, pill: g.status === 'over' ? `<span class="pill done">Champion decided</span>` : `<span class="pill gt">Round ${g.round} of ${g.rounds}: ${KIND_ICON[g.current_kind]}</span>`, sub: table, vs: vsOf(g.players), extra: '' });
  });
  if (!cards.length) { list.innerHTML = `<p class="muted">No games yet. Pick one above.</p>`; return; }
  // Your move first, then games waiting on someone else, then finished ones (folded away).
  cards.sort((a, b) => (a.at < b.at ? 1 : -1));
  const groups = [
    ['Your move', cards.filter((c) => c.mine)],
    ['Waiting on others', cards.filter((c) => !c.mine && !c.over)],
    ['Finished', cards.filter((c) => c.over)],
  ];
  const row = (c) => `
    <li><a class="grow ${c.mine ? 'mine' : ''} ${c.over ? 'over' : ''} k-${c.kind}" href="${c.href}">
      <canvas class="thumb" data-i="${cards.indexOf(c)}" width="160" height="100" aria-hidden="true"></canvas>
      <span class="gmain">
        <span class="gtitle"><strong>${KIND_ICON[c.kind]} ${KIND_NAME[c.kind]}</strong> <span class="small">${c.vs}</span></span>
        <span class="muted small">${c.sub}</span>
        ${c.prog != null ? `<span class="prog" aria-hidden="true"><i style="width:${Math.round(Math.max(0, Math.min(1, c.prog)) * 100)}%"></i></span>` : ''}
      </span>
      <span class="gstate">${c.extra}${c.pill}</span>
    </a></li>`;
  list.innerHTML = groups.filter(([, cs]) => cs.length).map(([title, cs]) => title === 'Finished'
    ? `<div class="stack glist-fold" style="gap:6px"><div class="row between"><span class="eyebrow">Finished (${cs.length})</span><button type="button" class="link small" id="finMore" hidden></button></div><ul class="glist">${cs.map(row).join('')}</ul></div>`
    : `<div class="stack" style="gap:6px"><span class="eyebrow">${title} (${cs.length})</span><ul class="glist">${cs.map(row).join('')}</ul></div>`).join('');
  foldGames();
  list.querySelectorAll('canvas.thumb').forEach((cv) => drawPreview(cv, cards[+cv.dataset.i], myFleets ?? [], atMe ?? []));
}
let finishedOpen = false;
let gamesOpen = false;   // Your games shows its first 3 rows until expanded

// Collapsed, Your games shows only its first 3 active rows (your move first) and hides Finished,
// unless nothing is active. Finished shows its 3 most recent games until expanded on its own.
function foldGames() {
  const list = document.getElementById('games'), btn = document.getElementById('gamesMore');
  if (!list || !btn) return;
  const rows = [...list.querySelectorAll(':scope > .stack:not(.glist-fold) .glist > li')], fold = list.querySelector('.glist-fold');
  const done = fold ? [...fold.querySelectorAll('li')] : [];
  const showDone = gamesOpen || !rows.length;
  const more = Math.max(0, rows.length - 3) + (rows.length ? (finishedOpen ? done.length : Math.min(3, done.length)) : 0);
  btn.hidden = more <= 0;
  rows.forEach((li, i) => { li.hidden = i >= 3 && !gamesOpen; });
  done.forEach((li, i) => { li.hidden = !showDone || (i >= 3 && !finishedOpen); });
  list.querySelectorAll(':scope > .stack').forEach((g) => { g.hidden = ![...g.querySelectorAll('li')].some((li) => !li.hidden); });
  btn.setAttribute('aria-expanded', gamesOpen);
  btn.textContent = gamesOpen ? 'Show less' : `Show ${more} more`;
  btn.onclick = () => { gamesOpen = !gamesOpen; foldGames(); };
  const fin = document.getElementById('finMore');
  if (fin) {
    fin.hidden = done.length <= 3;
    fin.setAttribute('aria-expanded', finishedOpen);
    fin.textContent = finishedOpen ? 'Show less' : `Show ${done.length - 3} more`;
    fin.onclick = () => { finishedOpen = !finishedOpen; foldGames(); };
  }
}

// Sample pictures for the new-game cards.
let sampleFleet = null;
function drawSample(cv, kind) {
  if (kind === 'battleship') {
    sampleFleet ??= randomFleet(1);
    const ships = new Set(fleetCells(1, sampleFleet).flat());
    const shots = [];
    for (let i = 0; i < 100; i++) if ((i * 37) % 11 === 3) shots.push({ game_id: 'sample', cell: i, hit: ships.has(i), sunk_cells: [] });
    drawPreview(cv, { kind, g: { id: 'sample', mode: 1 } }, [{ game_id: 'sample', ships: sampleFleet }], shots);
  } else if (kind === 'golf') drawPreview(cv, { kind, g: { seed: 20260927 }, hole: 6 });
  else if (kind === 'duel') drawPreview(cv, { kind, g: { seed: 4242, craters: [], hp: [80, 45] } });
  else drawPreview(cv, { kind, g: { rounds: 5, round: 3, status: 'playing', current_kind: 'battleship', history: [{ kind: 'golf' }, { kind: 'duel' }] } });
}

// Little live pictures of each game.
function drawPreview(cv, card, myFleets, atMe) {
  const c = cv.getContext('2d'), w = cv.width, h = cv.height;
  c.clearRect(0, 0, w, h);
  if (card.kind === 'battleship') {
    const g = card.g, n = MODES[g.mode].n, cell = Math.floor((h - 16) / n), ox = (w - cell * n) / 2, oy = 8;
    c.fillStyle = '#0E2A44'; c.fillRect(0, 0, w, h);
    const fleet = myFleets.find((f) => f.game_id === g.id);
    const ships = new Set(fleet ? fleetCells(g.mode, fleet.ships).flat() : []);
    const shots = new Map(atMe.filter((s) => s.game_id === g.id).map((s) => [s.cell, s]));
    const sunk = new Set(atMe.filter((s) => s.game_id === g.id).flatMap((s) => s.sunk_cells || []));
    for (let i = 0; i < n * n; i++) {
      const x = ox + (i % n) * cell, y = oy + Math.floor(i / n) * cell, s = shots.get(i);
      c.fillStyle = sunk.has(i) ? '#E0453A' : ships.has(i) ? '#7C8BA0' : '#1D4A70'; c.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      if (s && s.hit && !sunk.has(i)) { c.fillStyle = '#FF6B3D'; c.beginPath(); c.arc(x + cell / 2, y + cell / 2, cell * 0.3, 0, 7); c.fill(); }
      else if (s && !s.hit) { c.fillStyle = '#DDEBF7'; c.beginPath(); c.arc(x + cell / 2, y + cell / 2, cell * 0.14, 0, 7); c.fill(); }
    }
  } else if (card.kind === 'golf') {
    const hole = holeWithAttack(card.g.seed, card.hole, 0), k = Math.min(w / LH, h / LW) * 1.08;
    c.save(); c.fillStyle = '#1F5B3A'; c.fillRect(0, 0, w, h);
    // centre on the hole, rotated sideways so it fills a wide card
    c.translate(w / 2, h / 2); c.rotate(-Math.PI / 2); c.scale(k, k); c.translate(-LW / 2, -LH / 2);
    drawHole(c, hole, 0, { ball: { x: hole.tee[0], y: hole.tee[1] } });
    c.restore();
  } else if (card.kind === 'duel') {
    const g = card.g, top = buildTop(g.seed, g.craters), sx = w / DW, sy = h / DH;
    const sky = c.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#1B1646'); sky.addColorStop(1, '#7A3E72'); c.fillStyle = sky; c.fillRect(0, 0, w, h);
    c.fillStyle = '#FFE3A3'; c.beginPath(); c.arc(w * 0.76, h * 0.2, 14, 0, 7); c.fill();
    c.fillStyle = '#1F8C8A'; c.beginPath(); c.moveTo(0, h); for (let x = 0; x < DW; x += 4) c.lineTo(x * sx, top[x] * sy); c.lineTo(w, h); c.fill();
    c.strokeStyle = '#9BF5EA'; c.lineWidth = 1.5; c.beginPath(); for (let x = 0; x < DW; x += 4) c[x ? 'lineTo' : 'moveTo'](x * sx, top[x] * sy); c.stroke();
    [0, 1].forEach((p) => {
      const tx = TANK_X[p] * sx, ty = top[TANK_X[p]] * sy;
      c.fillStyle = p ? '#3DD6C6' : '#FF6B5A'; c.fillRect(tx - 8, ty - 7, 16, 7);
      c.fillStyle = '#ffffff33'; c.fillRect(tx - 20, ty - 20, 40, 4); c.fillStyle = p ? '#3DD6C6' : '#FF6B5A'; c.fillRect(tx - 20, ty - 20, 40 * g.hp[p] / 100, 4);
    });
  } else {
    const g = card.g;
    const bg = c.createLinearGradient(0, 0, w, h); bg.addColorStop(0, '#3A1D00'); bg.addColorStop(1, '#8A4B00'); c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.font = '64px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('🏆', w / 2, h / 2 - 18);
    const r = 9, gap = 26, x0 = w / 2 - ((g.rounds - 1) * gap) / 2;
    for (let i = 0; i < g.rounds; i++) {
      const done = i < (g.history || []).length, cur = i === g.round - 1 && g.status === 'playing';
      c.fillStyle = done ? '#FFC857' : cur ? '#FF8A3D' : '#ffffff33'; c.beginPath(); c.arc(x0 + i * gap, h - 34, cur ? r + 2 : r, 0, 7); c.fill();
      const k = done ? g.history[i].kind : cur ? g.current_kind : null;
      if (k) { c.font = '11px system-ui'; c.fillText(KIND_ICON[k], x0 + i * gap, h - 34); }
    }
  }
}

// ---- backpack and chaos feed
let feedOpen = false;   // the feed shows its last 3 events until expanded
let packOpen = false;   // the backpack shows its first 3 kinds of item until expanded
async function loadChaos() {
  const packCard = document.getElementById('packCard'), feedCard = document.getElementById('chaosCard');
  if (!packCard) return;
  const [items, feedRes] = await Promise.all([backpack(), sb.from('chaos_events').select('*').order('id', { ascending: false }).limit(12)]);
  if (feedRes.error) return;   // chaos isn't installed yet
  const counts = {}; items.forEach((l) => { (counts[l.item] ||= []).push(l.id); });
  packCard.hidden = false;
  const others = Object.entries(names).filter(([id]) => id !== me.id && !bots.has(id));
  const packMore = Object.keys(counts).length - 3;
  packCard.innerHTML = `<div class="row between"><h2>🎒 Backpack</h2>${packMore > 0 ? `<button type="button" class="link" id="packMore" aria-expanded="${packOpen}">${packOpen ? 'Show less' : `Show ${packMore} more`}</button>` : ''}</div>
    ${items.length ? `<ul class="pack">${Object.entries(counts).map(([it, ids], i) => `<li ${i >= 3 && !packOpen ? 'hidden' : ''}><span class="big">${ITEMS[it].icon}</span><span><strong>${ITEMS[it].name}${ids.length > 1 ? ` ×${ids.length}` : ''}</strong><br><span class="muted small">${ITEMS[it].desc} ${ITEMS[it].game === 'any' ? '' : `Use it in ${KIND_ICON[ITEMS[it].game]} ${KIND_NAME[ITEMS[it].game]}.`}</span></span></li>`).join('')}</ul>`
      : '<p class="muted small">Empty. Good plays in any game can drop loot: hits, sinkings, birdies, holes in one, big shell hits.</p>'}
    ${counts.scroll ? `<div class="row"><select id="curseWho">${others.map(([id, u]) => `<option value="${id}">${esc(u)}</option>`).join('')}</select><button id="curseGo">📜 Cast a curse</button></div><p class="small muted" id="curseMsg"></p>` : ''}`;
  const pbtn = document.getElementById('packMore');
  if (pbtn) pbtn.onclick = () => {
    packOpen = !packOpen;
    packCard.querySelectorAll('.pack li').forEach((li, i) => { li.hidden = i >= 3 && !packOpen; });
    pbtn.setAttribute('aria-expanded', packOpen); pbtn.textContent = packOpen ? 'Show less' : `Show ${packMore} more`;
  };
  const go = document.getElementById('curseGo');
  if (go) go.onclick = async () => {
    go.disabled = true;
    const { error } = await useLoot(counts.scroll[0], null, document.getElementById('curseWho').value);
    if (error) { document.getElementById('curseMsg').textContent = friendly(error); go.disabled = false; return; }
    announceChaos(); loadChaos();
  };
  const feed = feedRes.data ?? [];
  feedCard.hidden = !feed.length;
  const more = feed.length - 3;
  feedCard.innerHTML = `<div class="row between"><h2>🌀 Chaos feed</h2>${more > 0 ? `<button type="button" class="link" id="feedMore" aria-expanded="${feedOpen}">${feedOpen ? 'Show less' : `Show ${more} more`}</button>` : ''}</div>
    <ul class="chaosfeed">${feed.map((e, i) => `<li class="${e.seen_at ? '' : 'new'}" ${i >= 3 && !feedOpen ? 'hidden' : ''}><span class="big">${e.icon}</span><span>${esc(e.message)}<br><span class="muted small">${new Date(e.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></span></li>`).join('')}</ul>`;
  const btn = document.getElementById('feedMore');
  if (btn) btn.onclick = () => {
    feedOpen = !feedOpen;
    feedCard.querySelectorAll('.chaosfeed li').forEach((li, i) => { li.hidden = i >= 3 && !feedOpen; });
    btn.setAttribute('aria-expanded', feedOpen); btn.textContent = feedOpen ? 'Show less' : `Show ${more} more`;
  };
  announceChaos();
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
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'accusations', filter: `game_id=eq.${id}` }, refresh)
    .subscribe((s) => { const l = document.getElementById('live'); if (l) l.classList.toggle('off', s !== 'SUBSCRIBED'); }));
  renderGame();
}

async function loadGame(id) {
  const [{ data: game }, { data: shots }, { data: fleets }, cheatsRes, accRes, modRes] = await Promise.all([
    sb.from('games').select('*').eq('id', id).maybeSingle(),
    sb.from('shots').select('*').eq('game_id', id).order('id'),
    sb.from('fleets').select('*').eq('game_id', id),
    sb.from('cheats').select('*').eq('game_id', id).order('id'),
    sb.from('accusations').select('*').eq('game_id', id).order('move'),
    sb.from('player_mods').select('*').eq('game_id', id),
  ]);
  if (!game) return false;
  const [{ data: sonars }, pack] = await Promise.all([sb.from('loot').select('*').eq('used_game', id).eq('item', 'sonar'), backpack()]);
  const same = G?.game.id === id;
  const prevMove = same ? G.game.move : null;
  const prevStatus = same ? G.game.status : null, prevTurnMine = same ? G.game.status === 'playing' && G.game.players[G.game.turn] === me.id : null;
  // Which shots and accusations are new since we last looked?
  const seen = seenShots.get(id), fresh = [];
  if (!seen) seenShots.set(id, new Set((shots ?? []).map((s) => s.id)));
  else (shots ?? []).forEach((s) => { if (!seen.has(s.id)) { seen.add(s.id); pending.add(s.id); fresh.push(s); } });
  const seenA = seenAccusations.get(id), freshA = [];
  if (!seenA) seenAccusations.set(id, new Set((accRes.data ?? []).map((a) => a.move)));
  else (accRes.data ?? []).forEach((a) => { if (!seenA.has(a.move)) { seenA.add(a.move); freshA.push(a); } });
  G = {
    game, shots: shots ?? [],
    cheats: cheatsRes.data ?? [], accusations: accRes.data ?? [], sonars: sonars ?? [], pack,
    cheatsOn: !cheatsRes.error && !accRes.error,
    shotMod: (modRes.data ?? []).find((m) => m.player_id === me.id)?.shot_mod ?? 0,
    fresh, freshA, prevStatus, prevTurnMine, fxDue: true,
    draft: same ? G.draft : null, // keep an unsaved ship layout across live refreshes
    fleets: Object.fromEntries((fleets ?? []).map((f) => [f.player_id, f.ships])),
  };
  if (prevMove != null && game.move !== prevMove) aims = { target: null, cells: new Set() };
  return true;
}

function boardHTML({ owner, ships, clickable, fresh }) {
  const { game, shots } = G;
  const { n } = MODES[game.mode];
  const at = shots.filter((s) => s.target === owner && !pending.has(s.id));
  const shotAt = new Map(at.map((s) => [s.cell, s]));
  const peeks = (G.cheats || []).filter((c) => c.kind === 'peek' && c.player_id === me.id && c.detail?.target === owner)
    .concat((G.sonars || []).filter((l) => l.detail?.target === owner));
  const peekShip = new Set(peeks.flatMap((c) => c.detail.ships)), peekArea = new Set(peeks.flatMap((c) => c.detail.area));
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
      if (!s && peekShip.has(i)) cls.push('peek-ship'); else if (!s && peekArea.has(i)) cls.push('peek-empty');
      const label = cellName(game.mode, i);
      h += clickable && !s
        ? `<button class="${cls.join(' ')}" data-o="${owner}" data-i="${i}" data-target="${owner}" data-cell="${i}" aria-label="Aim at ${label}"></button>`
        : `<span class="${cls.join(' ')}" data-o="${owner}" data-i="${i}" aria-label="${label}"></span>`;
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
    const acc = (G.accusations || []).find((a) => a.move === m);
    const accLine = acc ? `<li class="accuse">🚨 <strong>${acc.accuser === me.id ? 'You' : nm(acc.accuser)}</strong> called cheater on <strong>${acc.accused === me.id ? 'you' : nm(acc.accused)}</strong>: ${acc.busted ? `busted! (${acc.kinds.map(cheatLabel).join(', ')})` : 'false alarm.'}</li>` : '';
    return `${accLine}<li class="${hits ? 'hit' : ''}"><strong>${who}</strong> fired at <strong>${tgt}</strong>: ${cells}.${sank.length ? ` Sank the ${sank.join(' and ')}.` : ''}</li>`;
  }).join('');
  return `<section class="card"><h2>Latest shots</h2><ul class="feed">${items}</ul></section>`;
}

function renderGame() {
  if (!G) return;
  const { game } = G;
  const opponents = game.players.filter((p) => p !== me.id);
  const myTurn = game.status === 'playing' && game.players[game.turn] === me.id;
  const imOut = game.eliminated.includes(me.id);
  const perTurn = Math.max(1, game.spt + (myTurn ? G.shotMod : 0));
  const need = aims.target ? Math.min(perTurn, MODES[game.mode].n ** 2 - G.shots.filter((s) => s.target === aims.target).length) : perTurn;

  let title, sub = '';
  if (game.status === 'setup') title = G.fleets[me.id] ? 'Waiting for ships' : 'Place your fleet';
  else if (game.status === 'over') title = game.winner === me.id ? 'You win!' : `${nm(game.winner)} wins!`;
  else if (imOut) { title = "You're out"; sub = 'Your fleet is sunk. You can keep watching the battle.'; }
  else if (myTurn) { title = 'Your turn'; sub = `Pick ${perTurn === 1 ? 'a square' : `${perTurn} squares`}${G.shotMod < 0 ? ' (one fewer for that false accusation)' : G.shotMod > 0 ? ' (one sneaky extra 🤫)' : ''} on ${opponents.length > 1 ? "one opponent's" : `${nm(opponents[0])}'s`} board, then fire.`; }
  else { title = `${nm(game.players[game.turn])}'s turn`; sub = 'This page updates as soon as they fire.'; }

  const playersStrip = `<div class="players">${game.players.map((p) => {
    const cls = ['player'];
    if (game.status === 'playing' && game.players[game.turn] === p) cls.push('turn');
    if (game.eliminated.includes(p)) cls.push('out');
    return `<span class="${cls.join(' ')}">${p === me.id ? 'You' : nm(p)}${game.winner === p ? ' 🏆' : ''}${(game.skip_next || []).includes(p) ? ' <span class="skipnote" title="Busted: loses their next turn">⏭</span>' : ''}</span>`;
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
    body = `${callOutHTML()}${myTurn ? cheatBarHTML() + backpackBarHTML(G.pack || [], 'battleship', !busy) + (sonarLoot ? '<p class="status">📡 Tap a square on an opponent\'s board to ping the 3×3 patch around it.</p>' : '') : ''}${over ? cheatLogHTML() : ''}${feedHTML()}
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

  wireCheats();
  app.querySelectorAll('[data-cell]').forEach((b) => b.addEventListener('click', () => {
    const target = b.dataset.target, cell = +b.dataset.cell;
    if (sonarLoot) { doSonar(target, cell); return; }
    if (peekMode) { doPeek(target, cell); return; }
    if (aims.target !== target) aims = { target, cells: new Set() };
    const max = Math.min(Math.max(1, game.spt + G.shotMod), MODES[game.mode].n ** 2 - G.shots.filter((s) => s.target === target).length);
    if (aims.cells.has(cell)) aims.cells.delete(cell);
    else if (aims.cells.size < max) aims.cells.add(cell);
    else if (max === 1) aims.cells = new Set([cell]);
    renderGame();
  }));

  playEffects();

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

// ---------------------------------------------------------------- cheating (server-run, 2 per player per game)
const CHEATS = { peek: '👀 Peek', extra: '➕ Extra shot', move: '🚢 Ship slipped away' };
const cheatLabel = (k) => CHEATS[k] || k;
function lastShooter() { const s = [...G.shots].reverse().find((x) => x.move === G.game.move); return s?.shooter; }
function cheatBarHTML() {
  if (!G.cheatsOn || G.game.eliminated.includes(me.id)) return '';
  const mine = G.cheats.filter((c) => c.player_id === me.id);
  const left = Math.max(0, 2 - mine.length);
  const extraNow = mine.some((c) => c.kind === 'extra' && c.move === G.game.move + 1);
  return `<section class="cheatbar">
    <div class="row between"><h2>Cheat (if you dare)</h2><span class="small">${'🃏'.repeat(left) || '—'} ${left} left this game</span></div>
    <div class="row">
      <button id="chPeek" ${left ? '' : 'disabled'} aria-pressed="${peekMode}">👀 Peek</button>
      <button id="chExtra" ${left && !extraNow ? '' : 'disabled'}>➕ Extra shot</button>
      <button id="chMove" ${left ? '' : 'disabled'}>🚢 Sneak a ship away</button>
      <span class="error small" id="cheatErr" hidden></span>
    </div>
    <p class="muted small">${peekMode ? 'Tap any square on an opponent’s board to spy on the 3×3 patch around it.' : 'Anyone can call cheater after your turn. Caught: you lose your next turn.'}</p>
  </section>`;
}
function callOutHTML() {
  const g = G.game;
  if (!G.cheatsOn || g.status !== 'playing' || !g.move || g.eliminated.includes(me.id)) return '';
  const shooter = lastShooter();
  if (!shooter || shooter === me.id || G.accusations.some((a) => a.move === g.move)) return '';
  return `<div class="callout"><span><strong>${nm(shooter)}</strong> just fired. Something fishy?<br><span class="muted small">Right: they lose their next turn. Wrong: you fire one shot fewer.</span></span>
    <button class="fire" id="callIt" style="animation:none">🚨 Call cheater!</button></div>`;
}
function cheatLogHTML() {
  if (!G.cheatsOn) return '';
  const byPlayer = G.game.players.map((p) => {
    const used = G.cheats.filter((c) => c.player_id === p);
    const caught = G.accusations.filter((a) => a.accused === p && a.busted).length;
    const catches = G.accusations.filter((a) => a.accuser === p && a.busted).length;
    const away = new Set(used.map((c) => c.move)).size - caught;
    return { p, used, caught, catches, away };
  });
  const top = (k) => { const m = Math.max(...byPlayer.map((x) => x[k])); return m > 0 ? byPlayer.filter((x) => x[k] === m).map((x) => (x.p === me.id ? 'You' : nm(x.p))).join(' & ') + ` (${m})` : null; };
  const awards = [['away', '🦊 Sneakiest'], ['catches', '🔍 Sharpest eye'], ['caught', '🚨 Most busted']].map(([k, l]) => top(k) && `<li>${l}: <strong>${top(k)}</strong></li>`).filter(Boolean).join('');
  const log = byPlayer.map((x) => `<li><strong>${x.p === me.id ? 'You' : nm(x.p)}</strong>: ${x.used.length ? x.used.map((c) => `${cheatLabel(c.kind)} on move ${c.move}`).join(', ') : 'played it straight 😇'}</li>`).join('');
  return `<section class="card"><h2>The truth comes out</h2>${awards ? `<ul class="feed">${awards}</ul>` : ''}<ul class="feed">${log}</ul></section>`;
}
function cheatError(e) { const el = document.getElementById('cheatErr'); if (el) { el.hidden = false; el.textContent = friendly(e); } }
async function afterCheat() { await loadGame(G.game.id); renderGame(); }
async function doPeek(target, cell) {
  peekMode = false;
  const { data, error } = await sb.rpc('cheat_peek', { p_game: G.game.id, p_target: target, p_center: cell });
  if (error) { renderGame(); cheatError(error); return; }
  await afterCheat();
  stamp(data.ships.length ? `👀 ${data.ships.length} ship square${data.ships.length > 1 ? 's' : ''}!` : '👀 Nothing there', 'purple', 1800); sfx('sneaky');
}
async function doSonar(target, cell) {
  const id = sonarLoot; sonarLoot = null;
  const { data, error } = await useLoot(id, G.game.id, target, cell);
  if (error) { renderGame(); cheatError(error); return; }
  await loadGame(G.game.id); renderGame();
  stamp(data.ships.length ? `📡 ${data.ships.length} ship square${data.ships.length > 1 ? 's' : ''}!` : '📡 Just fish', 'blue', 1800); sfx('ping');
}
function wireCheats() {
  app.querySelectorAll('.backpack [data-loot]').forEach((b) => {
    b.onclick = async () => {
      if (b.dataset.item === 'sonar') { sonarLoot = sonarLoot ? null : +b.dataset.loot; renderGame(); return; }
      b.disabled = true;
      const { error } = await useLoot(+b.dataset.loot, G.game.id);
      if (error) { cheatError(error); return; }
      await loadGame(G.game.id); renderGame(); stamp('🎆 Double Salvo!', 'purple', 1600); sfx('pop');
    };
  });
  const peek = document.getElementById('chPeek');
  if (peek) peek.onclick = () => { peekMode = !peekMode; renderGame(); };
  const extra = document.getElementById('chExtra');
  if (extra) extra.onclick = async () => {
    extra.disabled = true;
    const { error } = await sb.rpc('cheat_extra_shot', { p_game: G.game.id });
    if (error) return cheatError(error);
    await afterCheat(); stamp('➕ Extra shot 🤫', 'purple', 1600); sfx('sneaky');
  };
  const mv = document.getElementById('chMove');
  if (mv) mv.onclick = async () => {
    mv.disabled = true;
    const { data, error } = await sb.rpc('cheat_move_ship', { p_game: G.game.id });
    if (error) return cheatError(error);
    await afterCheat(); stamp(`🚢 Your ${shipName(G.game.mode, data.ship)}<br>slipped away`, 'purple', 1900); sfx('sneaky');
  };
  const call = document.getElementById('callIt');
  if (call) call.onclick = async () => {
    call.disabled = true;
    const { error } = await sb.rpc('call_cheater', { p_game: G.game.id });
    if (error) { call.textContent = friendly(error); return; }
    await loadGame(G.game.id); renderGame();
  };
}

// ---------------------------------------------------------------- what changed since the last look
function playEffects() {
  if (!G.fxDue) return;          // effects run once per fresh load, not on every re-render
  G.fxDue = false;
  const { game } = G;
  const fresh = G.fresh || [], freshA = G.freshA || [];
  const wait = animateShots(fresh.filter((s) => pending.has(s.id))) || 0;
  setTimeout(() => {
    freshA.forEach((a) => {
      if (a.busted) { stamp(`Busted!<br><small style="font-size:.4em">${a.accused === me.id ? 'You were' : nm(a.accused) + ' was'} caught: ${a.kinds.map(cheatLabel).join(', ')}</small>`, 'red', 2800); sfx('buzz'); quake(a.accused === me.id); }
      else stamp(`False alarm!<br><small style="font-size:.4em">${a.accuser === me.id ? 'You fire' : nm(a.accuser) + ' fires'} one shot fewer</small>`, 'blue', 2600);
    });
    const nowMine = game.status === 'playing' && game.players[game.turn] === me.id;
    if (G.prevStatus === 'playing' && game.status === 'over') {
      if (game.winner === me.id) { stamp('Victory!'); sfx('fanfare'); if (!reduceMotion) fx.fireworks(10); } else { stamp('Defeated', 'red', 2800); sfx('lose'); }
    } else if (G.prevStatus === 'setup' && game.status === 'playing') {
      banner(nowMine ? 'Battle stations! You fire first' : 'Battle stations!');
    } else if (nowMine && (G.prevTurnMine === false || fresh.some((s) => s.shooter !== me.id))) banner('Your turn');
    announceChaos({ gameId: game.id });
  }, wait);
}

boot();
