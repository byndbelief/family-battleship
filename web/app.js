import { USERNAME_DOMAIN } from './config.js';
import { rankOf, RANK_ICON, WEIGHTS, CHAOS, phaseOf, makeCurve, stepCurve } from './chaos.js';   // 🌀 the box
import { PAL, PALS, drawPal, palWidget, palMood } from './pals.js';   // 🎨 who lives in r4box
import { resident, residentNow, picked as myCompanion, vote, TOPIC_RESIDENT } from './studio.js';
import { sb, ITEMS, backpack, useLoot, announceChaos, backpackBarHTML, sfx, fsButton, fsRefresh, fsExit, nextUpChip, isPhone, note, gauntletBar, splash, danger, onHold, onTaps, rumour, shotClock, stopShotClock, chaosClock, chaosIn, gauntletRounds, openSettings, avatar, face, livePresence, jumpToNext, startOnline, online, agoText, setGameTools, themeTiles, forgetThemes, golfTheme, liveCountdown, overlayHost, bifurcation } from './common.js';
import { holeName, holeWithAttack, holeWithTwists, drawHole, LW, LH, setCourse, setGolfTheme } from './golf-engine.js';
import { THEMES, themeOf, vesselSVG } from './bs-themes.js';
import { W as DW, H as DH, startXs, buildTop, setWorld, setTerrain } from './duel-engine.js';
const app = document.getElementById('app');

const MODES = [
  { n: 8, ships: [4, 3, 3, 2] },
  { n: 10, ships: [5, 4, 3, 3, 2] },
  { n: 12, ships: [4, 3, 3, 2], shared: true },   // Shared Ocean (028): every fleet on one grid
  { n: 16, ships: [4, 3, 3, 2], shared: true },   // the same, a bigger sea for 4-6 players (034)
];
const ROWS = 'ABCDEFGHIJKLMNOP';
// The Shared Ocean board has one owner, the sea itself: aims, cells and tabs use this in mode 2.
const OCEAN = 'ocean';
// Each player's colour (by seat), on their ships, their hits and next to their name everywhere,
// so fleets are told apart even when two share a theme.
const PCOLS = ['#FF6B5A', '#3DD6C6', '#FFC857', '#B79CFF', '#7FE07A', '#FF8FD0'];
const pcol = (p) => PCOLS[Math.max(0, G?.game.players.indexOf(p) ?? 0) % PCOLS.length];
const pdot = (p) => `<i class="pdot" style="--pc:${pcol(p)}" aria-hidden="true"></i>`;
const isShared = () => !!MODES[G?.game.mode]?.shared;

// ---------------------------------------------------------------- state

let me = null;            // { id, username }
let names = {};           // profile id -> username
let channel = null;       // the realtime subscription for the current screen
let G = null;             // the open game: { game, shots, myFleet, fleets }
let aims = { target: null, cells: new Set() };
let busy = false;
// Phones show one board at a time: which one (an owner's id), and the turn state it was picked for.
let boardTab = null, boardTabFor = null;
let shotsOpen = null, lastNoteKey = '';   // Latest shots folded or open; the last message popped up on a phone
let peekMode = false;           // next tap on an opponent's board spends a peek cheat
let sonarLoot = null;
let triLoot = null;             // 🔺 armed Sierpiński Salvo: the next tap on the ocean is the triangle's top (060)           // next tap on an opponent's board spends this Sonar Ping
// Live battle: while everyone still afloat has the game open there are no turns. Tap any rival's
// square to fire, one shot at a time, whenever your guns have reloaded (bsPresence checks in).
let bsPresence = null, liveBS = false, bsPoll = null;
// Live volleys (053): tap squares to stage them; when the volley is full (3, or more after a Salvo or
// a Frenzy) it goes off together (fire_live_volley), and the guns reload for 2 s while it flies.
// "Fire now" lets a part volley go early. Staging a full volley while reloading fires it on reload.
const BS_RELOAD = 2000;
let bsReloadUntil = 0, volleyTimer = null;
const volleySize = () => Math.max(1, 3 + (G?.shotMod || 0));
function bsGunsText() {
  const n = volleySize(), st = aims.cells.size, rl = Math.max(0, bsReloadUntil - Date.now());
  const dots = `<span class="ammo" aria-label="${st} of ${n} squares staged">${'<i class="on"></i>'.repeat(Math.min(st, n))}${'<i></i>'.repeat(Math.max(0, n - st))}</span>`;
  if (rl > 0) return `${dots} Reloading… ${(rl / 1000).toFixed(1)}s${st ? ` · ${st} staged` : ''}`;
  return `⚔️ ${dots} ${st ? `${st} of ${n} staged: it fires at ${n}` : `Tap ${n} squares: they fire together`}`;
}
// Keep the gun readout ticking during a live battle.
setInterval(() => { if (!liveBS) return; const t = document.getElementById('aimtext'); if (t && t.closest('.livebar')) t.innerHTML = bsGunsText(); }, 150);
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
function view(html) { setGameTools(null); app.innerHTML = html; }   // only a game view shows the toolbar again
function setChannel(ch) {
  if (bsPresence) { bsPresence.stop(); bsPresence = null; liveBS = false; }
  clearInterval(bsPoll); bsPoll = null;
  if (channel) sb.removeChannel(channel);
  channel = ch;
}
// Ask the server to send "your turn" alerts. Never blocks the game.
function notify(gameId, kind = 'battleship') {
  sb.functions.invoke('notify', { body: { game_id: gameId, kind } }).catch(() => {});
  setTimeout(upNext, 800);
}
// The ▶ Next chip on a game: the next game waiting on you.
const upNext = () => { if (G && me) nextUpChip(me.id, G.game.id, (p) => (bots.has(p) ? '🤖 ' : '') + (names[p] ?? 'someone')); };

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
    // A hit's fireball in the colour of the player whose ship it was (col), a white-hot core.
    explode(x, y, big = 1, col = null) {
      ring(x, y, '#FFF3C4', 46 * big, 22, 5); ring(x, y, col || '#FF8A3D', 30 * big, 30, col ? 5 : 3);
      const cols = col ? ['#FFF3C4', col, col, '#FFD166'] : ['#FFF3C4', '#FFD166', '#FF8A3D', '#FF4D3D'];
      for (let i = 0; i < 46 * big; i++) { const a = Math.random() * 6.283, v = (1.5 + Math.random() * 5) * big; spark(x, y, Math.cos(a) * v, Math.sin(a) * v - 1.5, cols[i % 4], 2 + Math.random() * 2.5, 30 + Math.random() * 25); }
      for (let i = 0; i < 7; i++) smoke(x + (Math.random() - 0.5) * 14, y + (Math.random() - 0.5) * 10);
    },
    splash(x, y) {
      ring(x, y, '#BFE9FF', 34, 34, 3); setTimeout(() => ring(x, y, '#7FC8F8', 24, 34, 2), 120);
      for (let i = 0; i < 26; i++) { const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6, v = 2 + Math.random() * 4; spark(x, y, Math.cos(a) * v, Math.sin(a) * v, i % 2 ? '#DFF4FF' : '#6FC3F5', 1.5 + Math.random() * 1.5, 34, 0.22); }
    },
    // A shell in its shooter's colour (col): the trail, the glow and a ring where it lands.
    shell(fromX, fromY, x, y, onArrive, dur = 520, col = '#FFB25A') {
      const t0 = performance.now(), lift = Math.min(160, Math.abs(y - fromY) * 0.35 + 40);
      add({
        px: fromX, py: fromY,
        step() {
          const f = Math.min(1, (performance.now() - t0) / dur);
          this.px = fromX + (x - fromX) * f; this.py = fromY + (y - fromY) * f - Math.sin(f * Math.PI) * lift;
          spark(this.px, this.py, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, col, 2.2, 18, 0);
          if (f >= 1) { ring(x, y, col, 26, 26, 4); onArrive(); return false; } return true;
        },
        draw(k) { k.fillStyle = col; k.shadowColor = col; k.shadowBlur = 18; k.beginPath(); k.arc(this.px, this.py, 6, 0, 7); k.fill(); k.shadowBlur = 0;
          k.fillStyle = '#FFFFFF'; k.beginPath(); k.arc(this.px, this.py, 2.6, 0, 7); k.fill(); },
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
  overlayHost().appendChild(el); setTimeout(() => el.remove(), ms);
}
function banner(text) { const el = document.createElement('div'); el.className = 'banner'; el.innerHTML = `<span>${text}</span>`; overlayHost().appendChild(el); setTimeout(() => el.remove(), 1900); }
function quake(red) {
  if (reduceMotion) return;
  document.body.classList.remove('quake'); void document.body.offsetWidth; document.body.classList.add('quake');
  if (red) { const v = document.createElement('div'); v.className = 'vignette'; overlayHost().appendChild(v); setTimeout(() => v.remove(), 800); }
}
const cellEl = (owner, i) => app.querySelector(`[data-o="${isShared() ? OCEAN : owner}"][data-i="${i}"]`);
const centerOf = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

// Your own shells leave the moment you fire (launchShell), before the server has answered; when the
// shot comes back from it, the result is revealed where that shell landed (or lands), with no second
// flight. launched: board square → when its shell arrives.
const launched = new Map();
// Squares you've fired at stay marked (staged, then landing) until each one's result shows: the
// aim is cleared the moment you fire, and a redraw would lose the marks (6 s at most, in case one
// never comes back, e.g. someone else got there first).
const inFlight = new Map();
const flightKey = (owner, cell) => (owner === OCEAN ? `o|${cell}` : `${owner}|${cell}`);
const markInFlight = (owner, cells) => cells.forEach((c) => inFlight.set(flightKey(owner, c), Date.now()));
const flying = (owner, cell) => { const t = inFlight.get(flightKey(owner, cell)); return t != null && Date.now() - t < 6000; };
const shotKey = (s) => (MODES[G.game.mode].shared ? `o|${s.cell}` : `${s.target}|${s.cell}`);
function launchShell(owner, cell) {
  const key = owner === OCEAN ? `o|${cell}` : `${owner}|${cell}`, el = cellEl(owner, cell);
  sfx('cannon', { dur: 0.5 });
  if (reduceMotion || !el) { launched.set(key, Date.now()); return; }
  const [x, y] = centerOf(el);
  launched.set(key, Date.now() + 520);
  fx.shell(x + (Math.random() - 0.5) * 120, innerHeight + 20, x, y, () => { const e = cellEl(owner, cell); if (e && launched.has(key)) e.classList.add('landing'); }, 520, pcol(me.id));
}
const unlaunch = (owner, cells) => cells.forEach((c) => { launched.delete(flightKey(owner, c)); inFlight.delete(flightKey(owner, c)); cellEl(owner, c)?.classList.remove('landing'); });
// What a shot did, shown where it landed: the splash or the blast, the sinking.
function revealShot(s) {
  const { game } = G;
  pending.delete(s.id); inFlight.delete(shotKey(s));
  renderGame();
  const el2 = cellEl(s.target, s.cell);
  if (!el2) return;
  const [x, y] = centerOf(el2), incoming = s.target === me.id;
  el2.classList.add('land');
  if (s.hit) { fx.explode(x, y, s.sunk_ship != null ? 1.6 : 1, s.target ? pcol(s.target) : null); sfx('boom', { size: s.sunk_ship != null ? 1.6 : 0.8 }); if (incoming) quake(true); } else { fx.splash(x, y); sfx('splash'); }
  if (s.sunk_ship != null) {
    (s.sunk_cells || []).forEach((c, j) => setTimeout(() => { const e = cellEl(s.target, c); if (e) { const [cx, cy] = centerOf(e); fx.explode(cx, cy, 0.7, pcol(s.target)); } }, 120 * j));
    const ship = shipName(game.mode, s.sunk_ship);
    if (incoming) stamp(`Your ${ship}<br>is sunk!`, 'red');
    else if (s.shooter === me.id) stamp(`Sunk!<br><small style="font-size:.45em">${ship}</small>`);
    else stamp(`${ship} sunk!`, 'blue', 1800);
  }
}
// Flies a shell at each new shot, then reveals the result where it lands.
function animateShots(newShots) {
  const { game } = G;
  // 🐙🌪️ Chaos hits (053): no shell. The kraken rises / the tornado spins over each square, then the hit.
  let delay = 0;
  newShots.filter(hiddenMiss).forEach((s) => pending.delete(s.id));   // their misses: nothing to watch
  newShots = newShots.filter((s) => !hiddenMiss(s));
  const wild = newShots.filter((s) => s.chaos);
  wild.forEach((s, k) => {
    setTimeout(() => {
      if (!liveBS) showBoard(s.target);
      const el = cellEl(s.target, s.cell);
      if (el && !reduceMotion) { const [x, y] = centerOf(el), m = document.createElement('div'); m.className = `seabeast ${s.chaos}`; m.textContent = s.chaos === 'kraken' ? '🐙' : '🌪️'; m.style.left = `${x}px`; m.style.top = `${y}px`; overlayHost().appendChild(m); setTimeout(() => m.remove(), 1300);
        if (s.chaos === 'kraken') { const t = krakenArms(s.cell); t.style.left = `${x}px`; t.style.top = `${y}px`; overlayHost().appendChild(t); setTimeout(() => t.remove(), 1500); } }
      if (k === 0) sfx(s.chaos === 'kraken' ? 'thud' : 'whistle', { dur: 0.6 });
      setTimeout(() => revealShot(s), reduceMotion ? 0 : 450);
    }, (reduceMotion ? 0 : 300) + k * 320);
  });
  if (wild.length) delay = 300 + wild.length * 320 + 600;
  newShots = newShots.filter((s) => !s.chaos);
  // Shells you already launched: just the result, as soon as each has arrived.
  const flown = newShots.filter((s) => launched.has(shotKey(s)));
  flown.forEach((s) => { const at = launched.get(shotKey(s)), wait = Math.max(0, at - Date.now()); launched.delete(shotKey(s)); delay = Math.max(delay, wait + 150); setTimeout(() => revealShot(s), wait); });
  newShots = newShots.filter((s) => !flown.includes(s));
  if (reduceMotion || !newShots.length) { newShots.forEach((s) => pending.delete(s.id)); if (newShots.length) renderGame(); return delay; }
  const byMove = newShots.reduce((m, s) => ((m[s.move] ||= []).push(s), m), {});
  // Bring the impact into view first.
  const first = cellEl(newShots[0].target, newShots[0].cell);
  if (first) { const r = first.getBoundingClientRect(); if (r.top < 60 || r.bottom > innerHeight - 90) { first.scrollIntoView({ block: 'center', behavior: 'smooth' }); delay = 450; } }
  // Incoming! A drumroll before their shells land on you.
  if (newShots.some((s) => s.target === me.id)) { if (liveBS) sfx('whistle', { dur: 0.5 }); else { showBoard(me.id); sfx('drumroll', { dur: 0.9 }); delay += 950; } }
  Object.values(byMove).forEach((batch) => {
    batch.forEach((s, k) => {
      setTimeout(() => {
        if (!liveBS) showBoard(s.target);   // live: stay on the board you're aiming at
        const el = cellEl(s.target, s.cell);
        if (!el) { pending.delete(s.id); renderGame(); return; }
        const [x, y] = centerOf(el);
        const incoming = s.target === me.id;
        const fromX = x + (Math.random() - 0.5) * 120, fromY = incoming ? -20 : innerHeight + 20;
        sfx(incoming ? 'whistle' : 'cannon', { dur: 0.5 });
        fx.shell(fromX, fromY, x, y, () => revealShot(s), 520, pcol(s.shooter));   // in the shooter's colour
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
  startOnline(me.username);
}
function route() {
  if (!me) return loginView();
  const m = location.hash.match(/game=([0-9a-f-]{36})/);
  const pm = location.hash.match(/player=([0-9a-f-]{36})/);
  if (m) openGame(m[1]); else if (pm) profileView(pm[1]); else if (location.hash === '#stats') statsView(); else lobby();
}
window.addEventListener('hashchange', route);

// ---------------------------------------------------------------- login

function loginView(msg) {
  setChannel(null);
  view(`
    <div class="narrow login">
      <header class="stack"><a class="r4mark" href="./"><i aria-hidden="true"></i>r4box<small>r = 4</small></a><h1>Game on</h1>
        <p class="muted">Sign in with your player name to jump into the Route to Chaos.</p></header>
      <div class="hello"><canvas id="palHi" width="240" height="240" aria-hidden="true"></canvas><p class="bubble" id="palSay">Hi! I live in r4box.</p></div>
      <form class="card" id="login">
        <label class="field" for="user">Username<input type="text" id="user" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
        <label class="field" for="pass">Password<input type="password" id="pass" autocomplete="current-password" required></label>
        ${msg ? `<p class="error">${esc(msg)}</p>` : ''}
        <div><button class="primary" type="submit">Sign in</button></div>
      </form>
    </div>`);
  { const k = residentNow(); palWidget(document.getElementById('palHi'), { pal: k, s: 40, beat: 0.8, dpr: 2 }); document.getElementById('palSay').textContent = `Hi, I'm ${PAL[k].name}. I live in r4box. ${PAL[k].tag}`; }
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


// ---------------------------------------------------------------- lobby
const KIND_ICON = { battleship: '⚓', golf: '⛳', duel: '💥', cards: '🃏', gauntlet: '🌀' };
const KIND_NAME = { battleship: 'Battleship', golf: 'Putt Post', duel: 'Hilltop Duel', cards: 'Chaos Cards', gauntlet: 'Route to Chaos' };
const KIND_BLURB = {
  battleship: 'Hide your fleet, hunt theirs. Peeking is allowed.',
  golf: '🧘 Calm within the chaos: 18 wild holes, sneak attacks and mulligans.',
  duel: '🧘 Calm within the chaos: tanks on hills. Mind the wind. Up to 4 in a free-for-all.',
  cards: '🧘 Calm within the chaos: match colours, dump your hand. Chaos cards and card storms.',
  gauntlet: 'A best-of series of random games. Winner takes the crown.',
};
const KIND_SHORT = { battleship: 'Battleship', golf: 'Putt Post', duel: 'Duel', cards: 'Cards', gauntlet: 'Chaos' };
// The robots in a new-game form (and Route to Chaos): one − N + counter instead of a chip each. The
// robot chips are still there (hidden, data-bot), so the rest of the form works as before: the counter
// just presses the first N of them.
function syncBotStep(key, chips) {
  const el = app.querySelector(`[data-botstep="${key}"]`); if (!el) return;
  const n = chips.filter((c) => c.hasAttribute('data-bot') && c.getAttribute('aria-pressed') === 'true').length;
  el.querySelector('b').textContent = n; el.classList.toggle('on', n > 0);
}
function wireBotStep(key, chips, room, onChange) {
  const el = app.querySelector(`[data-botstep="${key}"]`); if (!el) return;
  const botChips = chips.filter((c) => c.hasAttribute('data-bot'));
  if (!botChips.length) { el.hidden = true; return; }
  el.querySelectorAll('[data-bs]').forEach((b) => b.addEventListener('click', () => {
    const now = botChips.filter((c) => c.getAttribute('aria-pressed') === 'true').length;
    const want = Math.max(0, Math.min(now + +b.dataset.bs, botChips.length, room()));   // room(): how many robots the table takes
    if (+b.dataset.bs > 0 && want === now) { note('That table is full.'); return; }
    botChips.forEach((c, i) => c.setAttribute('aria-pressed', String(i < want)));
    onChange(); syncBotStep(key, chips);
  }));
}
const KIND_WHO = { battleship: '2–3 players', golf: 'Solo or up to 4 · 🧘 calm', duel: '2–4 players · 🧘 calm', cards: '2–4 players · 🧘 calm', gauntlet: '2–4 players · 3, 5 or 7 rounds' };

async function lobby() {
  G = null;
  setChannel(null);   // close the old live channel first: lobby -> Quick play -> lobby reuses the same channel name
  if (document.querySelector('.fs-on')) fsExit();
  document.getElementById('nextUp')?.remove();   // the lobby has its own Your move strip
  document.body.classList.remove('has-firebar');
  danger(false); stopShotClock();
  const others = Object.entries(names).filter(([id]) => id !== me.id).sort((a, b) => a[1].localeCompare(b[1]));
  // Quick play (a single game on its own) is one layer down, at #quick; the lobby leads with the Gauntlet.
  const quick = location.hash === '#quick';
  queueMicrotask(renderHere);
  view(`
    <div class="lobby${quick ? ' quickmode' : ' lobhome'}">
      <div class="quickhead"><a href="#">← r4box</a><h1>Practice</h1><p class="muted">One game on its own, off the Route to Chaos. One of each kind per group of players at a time. It still counts toward your chaos rating.</p></div>
      <header class="row between gtop">
        <div class="stack lobhead"><a class="r4mark" href="./"><i aria-hidden="true"></i>r4box<small>r = 4</small></a><h1 id="greet">${esc(PAL[residentNow()].greet.replace('{name}', me.username))}</h1></div>
        <div class="herenow" id="hereNow" aria-label="Who's here"></div>
      </header>
      <div class="lobmain">
      <section class="gthero" id="gtSec">
        <div class="boxhero">
          <canvas id="boxHero" aria-label="The Box: the chaos curve's bifurcation diagram, with a live x walking it as r climbs"></canvas>
          <div class="boxwords"><span class="eyebrow">The Box · chaos · symmetry · fractals · fibonacci</span><h2>Route to Chaos</h2>
            <p class="small"><span id="palMind">This is Fig's mind.</span> Every game here runs on one curve, x → r·x·(1−x): its mood. A Chaos is rounds of the games against your rivals, wilder as r climbs; win the most rounds for the crown, and the next Chaos starts on its own. The games are won by playing Chaos.</p>
            <div class="row" style="gap:10px;flex-wrap:wrap"><a class="enter" id="enterChaos" href="#start">Enter Chaos 🌀</a><a class="enter alt" href="run.html">🧬 Solo run</a></div>
            <a class="meet" id="meetPal" href="studio.html"><canvas id="palMini" width="88" height="88" aria-hidden="true"></canvas><span><b id="palName">…</b><small>your companion · change in the Design Studio ›</small></span></a></div>
        </div>
        <details class="gtfold" id="gtFold"><summary class="gtlabel" id="gtLabel">➕ Start a rivalry</summary>
        <form class="gtstart" id="gtStart">
          <div class="choice">${others.map(([id, u]) => `<button type="button" class="chip" data-gopp="${esc(u)}" data-gid="${id}" aria-pressed="false" ${bots.has(id) ? 'data-bot hidden' : ''}>${esc(u)}</button>`).join('')}<span class="botstep" data-botstep="g" role="group" aria-label="How many robots"><span>🤖 Robots</span><button type="button" data-bs="-1" aria-label="One robot fewer">−</button><b aria-live="polite">0</b><button type="button" data-bs="1" aria-label="One more robot">+</button></span></div>
          <div class="row gtrow">
            <div class="seg" role="radiogroup" aria-label="Rounds">${[3, 5, 7].map((r) => `<label><input type="radio" name="gtRounds" value="${r}" ${r === gauntletRounds() ? 'checked' : ''}>${r} rounds</label>`).join('')}</div>
            <button class="gtbtn" type="submit" id="gtGo" disabled>Start 🏆</button>
          </div>
          <p class="error" id="gtErr" hidden></p>
        </form>
        </details>
      </section>
      <section class="stack upsec" id="upSec" hidden>
        <div class="row between"><h2>Your move <span class="upcount" id="upCount"></span></h2>
          <span class="row" style="gap:6px"><button type="button" class="upnav" id="upPrev" aria-label="Previous game">‹</button><button type="button" class="upnav" id="upNext" aria-label="Next game">›</button></span></div>
        <div class="upstrip" id="upStrip"></div>
      </section>
      <section class="stack" id="newSec">
        <h2 class="qpick">Pick a game</h2>
        <div class="ncards" role="radiogroup" aria-label="Pick a game">
          ${['battleship', 'golf', 'duel', 'cards'].map((k) => `
          <button type="button" class="ncard k-${k}" data-kind="${k}" role="radio" aria-checked="false">
            <canvas class="preview" data-kind="${k}" width="320" height="200" aria-hidden="true"></canvas>
            <span class="nbody"><strong><span class="nfull">${KIND_ICON[k]} ${KIND_NAME[k]}</span><span class="nshort">${KIND_ICON[k]} ${KIND_SHORT[k]}</span></strong><span class="muted small">${KIND_BLURB[k]}</span><span class="eyebrow">${KIND_WHO[k]}</span></span>
          </button>`).join('')}
        </div>
        <form id="newgame" class="card" style="gap:14px" hidden>
          <h2 id="setupTitle"></h2>
          <div class="stack"><span class="eyebrow" id="oppHint">Opponents</span>
            <div class="choice">${others.map(([id, u]) => `<button type="button" class="chip" data-opp="${esc(u)}" data-id="${id}" aria-pressed="false" ${bots.has(id) ? 'data-bot hidden' : ''}>${esc(u)}</button>`).join('')}<span class="botstep" data-botstep="n" role="group" aria-label="How many robots"><span>🤖 Robots</span><button type="button" data-bs="-1" aria-label="One robot fewer">−</button><b aria-live="polite">0</b><button type="button" data-bs="1" aria-label="One more robot">+</button></span></div></div>
          <div class="stack" data-for="battleship"><span class="eyebrow">Board</span>
            <p class="small muted" style="margin:0">🌊 Shared ocean: every fleet on one grid (12×12, 16×16 for 4 or more).</p></div>
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
      </div>
      <div class="lobside">
      <a class="quickentry" href="#stats"><span class="qicons" aria-hidden="true">🏅</span><span><strong>Family scoreboard</strong><span class="muted small">All-time titles, wins, streaks and bragging rights</span></span><span class="qgo" aria-hidden="true">›</span></a>
      <a class="quickentry" href="studio.html"><span class="qicons" aria-hidden="true">🎨</span><span><strong>Design Studio</strong><span class="muted small">Who lives in r4box? Poke the four and pick one</span></span><span class="qgo" aria-hidden="true">›</span></a>
      <details class="practice"><summary class="quickentry"><span class="qicons" aria-hidden="true">🎯</span><span><strong>Practice</strong><span class="muted small">One game on its own, off the Route to Chaos: it still feeds your chaos rating</span></span><span class="qgo" aria-hidden="true">›</span></summary>
        <a class="quickentry" href="#quick"><span class="qicons" aria-hidden="true">⚓⛳💥🃏</span><span><strong>A game against someone</strong><span class="muted small">Battleship, Putt Post, Hilltop Duel or Chaos Cards</span></span><span class="qgo" aria-hidden="true">›</span></a>
        <a class="quickentry" href="squirrel.html"><span class="qicons" aria-hidden="true">🐿️📎</span><span><strong>Squirrel Chaos</strong><span class="muted small">Solo: staple the squirrels in a fractal forest before the chaos swarms</span></span><span class="qgo" aria-hidden="true">›</span></a>
        <a class="quickentry" href="fractal.html"><span class="qicons" aria-hidden="true">🔺✨</span><span><strong>Fractal Dash</strong><span class="muted small">Solo: jump and dash over a fractal ridge as the chaos curve climbs</span></span><span class="qgo" aria-hidden="true">›</span></a>
      </details>
      <section class="stack">
        <div class="row between"><h2>Your games</h2><span class="row" style="gap:14px"><button type="button" class="link" id="gamesMore" hidden></button><span class="live" id="live">Live</span></span></div>
        <div id="games"><p class="muted">Loading games…</p></div>
      </section>
      <div class="lobby-cols">
        <div class="lobtoggles" role="group" aria-label="More">
          <button type="button" data-show="packCard" aria-expanded="false">🎒 Backpack <b id="packN"></b></button>
          <button type="button" data-show="chaosCard" aria-expanded="false">🌀 Chaos <b id="chaosN"></b></button>
        </div>
        <section class="card" id="packCard" hidden></section>
        <section class="card" id="chaosCard" hidden></section>
      </div>
      </div>
    </div>`);
  // 🌀 The Box on the wall: the bifurcation diagram with a live x walking it. Enter Chaos goes to your
  // running Chaos's round when there is one (renderGauntlets sets it), else opens the start form.
  if (!quick) { const k0 = residentNow(); boxHero(document.getElementById('boxHero'), k0); const mini = palWidget(document.getElementById('palMini'), { pal: k0, s: 15, beat: 0.8, dpr: 2 }); document.getElementById('palName').textContent = PAL[k0].name; document.getElementById('palMind').textContent = `This is ${PAL[k0].name}'s mind.`;
    resident().then((k) => { if (k !== k0 && document.getElementById('palMini')) { mini.set({ pal: k }); document.getElementById('palName').textContent = PAL[k].name; document.getElementById('palMind').textContent = `This is ${PAL[k].name}'s mind.`; document.getElementById('greet').textContent = PAL[k].greet.replace('{name}', me.username); document.documentElement.dataset.pal = k; boxHero(document.getElementById('boxHero'), k); }
      // 🧭 No companion yet: choose one first. Then 👋 meet it, once per device per companion (and any time at #meet).
      myCompanion().then((mine) => { if (!mine) return chooseCompanion(); let met = null; try { met = localStorage.getItem('r4.met'); } catch {} if (location.hash === '#meet' || met !== k) meetResident(k); }); }); }
  document.getElementById('enterChaos')?.addEventListener('click', (e) => {
    const a = e.currentTarget; if (a.dataset.go) return;   // a running Chaos: the link goes to its round
    e.preventDefault(); const fold = document.getElementById('gtFold'); fold.open = true; fold.scrollIntoView({ behavior: 'smooth', block: 'center' }); fold.querySelector('.chip:not([hidden])')?.focus();
  });
  // Start a Gauntlet: pick 1-5 opponents and a length, go.
  const gchips = [...app.querySelectorAll('[data-gopp]')], gtGo = document.getElementById('gtGo');
  const gPicked = () => gchips.filter((c) => c.getAttribute('aria-pressed') === 'true');
  const gUpdate = () => { gtGo.disabled = !gPicked().length; syncBotStep('g', gchips);
    const ids = gchips.filter((x) => x.getAttribute('aria-pressed') === 'true').map((x) => x.dataset.gid);
    const exists = ids.length && rivalGroups.has([me.id, ...ids].sort().join(','));
    gtGo.textContent = exists ? 'Go to your Chaos ›' : 'Start Chaos 🌀';
    app.querySelector('.gtrow .seg').hidden = !!exists; };
  wireBotStep('g', gchips, () => 5 - gPicked().filter((c) => !c.hasAttribute('data-bot')).length, gUpdate);
  gchips.forEach((c) => c.addEventListener('click', () => {
    const on = c.getAttribute('aria-pressed') !== 'true';
    if (on && gPicked().length >= 5) return note('Up to five opponents.');
    c.setAttribute('aria-pressed', String(on)); gtGo.disabled = !gPicked().length;
    const ids = gchips.filter((x) => x.getAttribute('aria-pressed') === 'true').map((x) => x.dataset.gid);
    const exists = ids.length && rivalGroups.has([me.id, ...ids].sort().join(','));
    gtGo.textContent = exists ? 'Go to your Chaos ›' : 'Start Chaos 🌀';
    app.querySelector('.gtrow .seg').hidden = !!exists;
  }));
  document.getElementById('gtStart').addEventListener('submit', async (e) => {
    e.preventDefault(); gtGo.disabled = true;
    const { data, error } = await sb.rpc('gauntlet_create', { opponents: gPicked().map((c) => c.dataset.gopp), p_rounds: +app.querySelector('input[name=gtRounds]:checked').value });
    if (error) { const el = document.getElementById('gtErr'); el.hidden = false; el.textContent = friendly(error); gtGo.disabled = false; return; }
    const { data: gt } = await sb.from('gauntlets').select('current_kind, current_game').eq('id', data).maybeSingle();
    notify(gt.current_game, gt.current_kind);
    if (gt.current_kind === 'battleship') location.hash = `game=${gt.current_game}`; else location.href = `${gt.current_kind}.html#game=${gt.current_game}`;
  });
  const chips = [...app.querySelectorAll('[data-opp]')];
  const start = document.getElementById('start');
  let chosen = null;
  const kind = () => chosen;
  const picked = () => chips.filter((x) => x.getAttribute('aria-pressed') === 'true');
  const LIMITS = {
    battleship: [1, 5, 'Opponents (one, or up to five for a free-for-all)'], golf: [0, 5, 'Opponents (none for a solo round, up to five)'],
    duel: [1, 5, 'Opponents (one for a duel, up to five for a free-for-all)'], cards: [1, 3, 'Opponents (one to three)'], gauntlet: [1, 5, 'Opponents (one to five)'],
  };
  const refreshForm = () => {
    if (!chosen) return;
    const k = kind(), [lo, hi, hint] = LIMITS[k];
    let sel = picked();
    while (sel.length > hi) { (sel.filter((c) => c.hasAttribute('data-bot')).pop() || sel[0]).setAttribute('aria-pressed', 'false'); sel = picked(); }   // robots go first
    syncBotStep('n', chips);
    document.getElementById('oppHint').textContent = hint;
    app.querySelectorAll('[data-for]').forEach((el) => {
      el.hidden = el.dataset.for === 'botlevel' ? !((k === 'golf' || k === 'duel' || k === 'cards') && sel.some((c) => bots.has(c.dataset.id))) : el.dataset.for !== k;
    });
    start.disabled = sel.length < lo || sel.length > hi;
    start.textContent = k === 'golf' && sel.length === 0 ? 'Start a solo round' : k === 'gauntlet' ? 'Start Chaos 🌀' : 'Start game';
  };
  chips.forEach((c) => c.addEventListener('click', () => {
    c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    refreshForm();
  }));
  wireBotStep('n', chips, () => (chosen ? LIMITS[chosen][1] : 5) - picked().filter((c) => !c.hasAttribute('data-bot')).length, refreshForm);
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
    // One game of each kind per group of players: if it's already going, pick it back up.
    const ids = picked().map((x) => x.dataset.id), group = [me.id, ...ids].sort().join(',');
    const table = { battleship: 'games', golf: 'golf_games', duel: 'duel_games', cards: 'card_games' }[k];
    const { data: running } = await sb.from(table).select('id, players, gauntlet_id').neq('status', 'over').is('gauntlet_id', null).limit(100);
    const same = (running ?? []).find((g) => [...g.players].sort().join(',') === group);
    if (same) {
      note(`You already have ${KIND_NAME[k]} going with ${ids.length ? ids.map(nm).join(' & ').replace(/<[^>]+>/g, '') : 'yourself'}. Picking it back up.`);
      setTimeout(() => { if (k === 'battleship') location.hash = `game=${same.id}`; else location.href = `${k}.html#game=${same.id}`; }, 900);
      return;
    }
    let res;
    if (k === 'golf') {
      const [st, ct] = app.querySelector('input[name=course]:checked').value.split(',').map(Number);
      res = await sb.rpc('golf_create', { opponents, p_start: st, p_count: ct, p_random: document.getElementById('golfRandom').checked, p_bot_level: botLevel });
    } else if (k === 'duel') {
      res = await sb.rpc('duel_create', { p_opponents: opponents, p_bot_level: botLevel });
    } else if (k === 'cards') {
      res = await sb.rpc('card_create', { opponents, p_bot_level: botLevel });
    } else if (k === 'gauntlet') {
      res = await sb.rpc('gauntlet_create', { opponents, p_rounds: +app.querySelector('input[name=rounds]:checked').value });
    } else {
      res = await sb.rpc('create_game', { opponents, p_mode: 2, p_spt: +app.querySelector('input[name=spt]:checked').value });
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
  // Old links to the alerts card (#alerts) open Settings, where turn alerts live now.
  if (location.hash === '#alerts') { history.replaceState(null, '', './'); openSettings(); }
  // Phones: Backpack, Chaos feed and Turn alerts sit behind one row of small buttons.
  app.querySelectorAll('[data-show]').forEach((b) => { b.onclick = () => {
    const el = document.getElementById(b.dataset.show), on = !el.classList.contains('show');
    app.querySelectorAll('[data-show]').forEach((o) => { document.getElementById(o.dataset.show).classList.remove('show'); o.setAttribute('aria-expanded', 'false'); });
    if (on) { el.classList.add('show'); b.setAttribute('aria-expanded', 'true'); }
  }; });
  const reload = () => { loadGames(); loadChaos(); };
  setChannel(['games', 'golf_games', 'duel_games', 'card_games', 'gauntlets', 'chaos_events'].reduce(
    (ch, table) => ch.on('postgres_changes', { event: '*', schema: 'public', table }, reload), sb.channel('lobby'))
    .subscribe((st) => { const l = document.getElementById('live'); if (l) l.classList.toggle('off', st !== 'SUBSCRIBED'); }));
  loadGames(); loadChaos();
  // Deletes don't always arrive over realtime, so also refresh when you come back and every 30s.
  clearInterval(lobbyTimer);
  lobbyTimer = setInterval(() => { if (!document.hidden && document.getElementById('games')) reload(); }, 30000);
}
let lobbyTimer = null;
document.addEventListener('visibilitychange', () => { if (!document.hidden && document.getElementById('games')) { loadGames(); loadChaos(); } });

// ---- your games, as a list of game states
async function loadGames() {
  chaosClock().then((n) => { if (n) loadGames(); });   // overdue stalls land first (throttled to once a minute)
  const [bsRes, golfRes, duelRes, gtRes, cardRes, hidRes] = await Promise.all([
    sb.from('games').select('*').order('updated_at', { ascending: false }).limit(40),
    sb.from('golf_games').select('*').order('updated_at', { ascending: false }).limit(40),
    sb.from('duel_games').select('*').order('updated_at', { ascending: false }).limit(40),
    sb.from('gauntlets').select('*').order('updated_at', { ascending: false }).limit(200),
    sb.from('card_games').select('*').order('updated_at', { ascending: false }).limit(40),
    sb.from('hidden_games').select('game_id'),
  ]);
  const list = document.getElementById('games');
  if (!list) return;
  if (bsRes.error) { list.innerHTML = `<p class="error">Couldn't load games: ${esc(friendly(bsRes.error))}</p>`; return; }
  // Finished games you deleted stay out of your list (they're only gone for you).
  const hidden = new Set((hidRes.data ?? []).map((h) => h.game_id)), shown = (r) => (r.data ?? []).filter((g) => !hidden.has(g.id));
  const bs = shown(bsRes), golf = shown(golfRes), duel = shown(duelRes), cardGames = shown(cardRes);
  // A Gauntlet still in progress whose current round is gone (deleted) is dead; don't list it.
  const alive = new Set([...bs, ...golf, ...duel, ...cardGames].map((g) => g.id));
  const gts = (gtRes.data ?? []).filter((g) => g.status === 'over' || alive.has(g.current_game));
  const bsIds = bs.map((g) => g.id), golfIds = golf.map((g) => g.id);
  const [{ data: myFleets }, { data: atMe }, { data: golfTurns }] = await Promise.all([
    bsIds.length ? sb.from('fleets').select('game_id, ships').eq('player_id', me.id).in('game_id', bsIds) : { data: [] },
    bsIds.length ? sb.from('shots').select('game_id, cell, hit, sunk_cells').eq('target', me.id).in('game_id', bsIds) : { data: [] },
    golfIds.length ? sb.from('golf_turns').select('game_id, player, written, fine, skipped').in('game_id', golfIds) : { data: [] },
  ]);
  const gtName = Object.fromEntries(gts.map((g) => [g.id, g]));
  const turnPill = (id) => (id === me.id ? `<span class="pill turn">Your turn</span>` : `<span class="pill wait">${nm(id)}'s turn</span>`);
  const vsOf = (players) => { const o = players.filter((p) => p !== me.id); return o.length ? `vs ${o.map(nm).join(' & ')}` : 'Solo round'; };
  // Which round of its Gauntlet a game is: its place in the history once played, else the current one.
  const roundNo = (g) => { const gt = gtName[g.gauntlet_id], i = (gt.history || []).findIndex((h) => h.game === g.id); return i >= 0 ? i + 1 : gt.round; };
  const round = (g) => (g.gauntlet_id && gtName[g.gauntlet_id] ? `<span class="pill gt">🏆 Round ${roundNo(g)}</span>` : '');
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
    cards.push({ at: g.updated_at, kind: 'golf', g, hole, href: `golf.html#game=${g.id}`, mine: pill.includes('turn"'), over: g.status === 'over', prog: g.status === 'over' ? 1 : g.t / (g.count * n), pill, sub: `${g.status === 'over' ? 'Final' : `Hole ${hole + 1}`} · ${holeName(hole, (g.course || 100) / 100)}${mine ? ` · you: ${mine}` : ''}`, vs: vsOf(g.players), extra: round(g) });
  });
  duel.forEach((g) => {
    const pill = g.status === 'over' ? (g.winner === me.id ? `<span class="pill done">You won</span>` : `<span class="pill done">${nm(g.winner)} won</span>`) : turnPill(g.players[g.turn]);
    cards.push({ at: g.updated_at, kind: 'duel', g, href: `duel.html#game=${g.id}`, mine: pill.includes('turn"'), over: g.status === 'over', prog: null, pill, sub: `${g.hp.join(' – ')} HP${g.hp.length > 2 ? ` · ${g.hp.filter((h) => h > 0).length} standing` : ''}${g.move ? ` · shot ${g.move}` : ''}`, vs: vsOf(g.players), extra: round(g) });
  });
  cardGames.forEach((g) => {
    const pill = g.status === 'over' ? (g.winner === me.id ? `<span class="pill done">You won</span>` : `<span class="pill done">${nm(g.winner)} won</span>`) : turnPill(g.players[g.turn]);
    const mine = g.counts[g.players.indexOf(me.id)];
    cards.push({ at: g.updated_at, kind: 'cards', g, href: `cards.html#game=${g.id}`, mine: pill.includes('turn"'), over: g.status === 'over', prog: null, pill,
      sub: g.status === 'over' ? `You ended with ${mine} card${mine === 1 ? '' : 's'}` : `You hold ${mine} · ${g.players.filter((p) => p !== me.id).map((p) => `${g.counts[g.players.indexOf(p)]}`).join(' / ')} for them`,
      vs: vsOf(g.players), extra: round(g) });
  });
  gts.forEach((g) => {
    const lead = Math.max(...g.scores);
    const table = g.players.map((p, i) => `${g.scores[i] === lead && lead > 0 ? '👑 ' : ''}${p === me.id ? 'You' : nm(p)} ${g.scores[i]}`).join(' · ');
    const href = g.status === 'over' ? '#' : g.current_kind === 'battleship' ? `#game=${g.current_game}` : `${g.current_kind}.html#game=${g.current_game}`;
    return;   // Gauntlets live on the rival cards at the top (running ones, and titles won)
    cards.push({ at: g.updated_at, kind: 'gauntlet', g, href, mine: false, over: g.status === 'over', prog: (g.history || []).length / g.rounds, pill: g.status === 'over' ? `<span class="pill done">Champion decided</span>` : `<span class="pill gt">Round ${g.round} of ${g.rounds}: ${KIND_ICON[g.current_kind]}</span>`, sub: table, vs: vsOf(g.players), extra: '' });
  });
  renderGauntlets(gts);
  if (!cards.length) { renderUpStrip([], [], [], []); list.innerHTML = `<p class="muted">No games yet. Pick one above.</p>`; return; }
  // Your move first, then games waiting on someone else, then finished ones (folded away).
  cards.sort((a, b) => (a.at < b.at ? 1 : -1));
  // Your move gets its own swipeable strip at the top; the list below holds the rest.
  renderUpStrip(cards.filter((c) => c.mine), cards, myFleets ?? [], atMe ?? []);
  const groups = [
    ['Waiting on others', cards.filter((c) => !c.mine && !c.over)],
    ['Finished', cards.filter((c) => c.over)],
  ];
  const del = (id, what) => `<button type="button" class="gdel" data-hide="${id}" aria-label="Delete ${what} from your list" title="Delete from your list">🗑</button>`;
  const row = (c) => `
    <li class="${c.over ? 'fin' : ''}"><a class="grow ${c.mine ? 'mine' : ''} ${c.over ? 'over' : ''} k-${c.kind}" href="${c.href}">
      <canvas class="thumb" data-i="${cards.indexOf(c)}" width="160" height="100" aria-hidden="true"></canvas>
      <span class="gmain">
        <span class="gtitle"><strong>${KIND_ICON[c.kind]} ${KIND_NAME[c.kind]}</strong> <span class="small">${c.vs}</span></span>
        <span class="muted small">${c.sub}${!c.over && !c.mine && c.kind !== 'gauntlet' && c.g.players.length > 1 && chaosIn(c.g.turn_at, c.g.gauntlet_id) ? ` · <span class="clk">${chaosIn(c.g.turn_at, c.g.gauntlet_id)}</span>` : ''}</span>
        ${c.prog != null ? `<span class="prog" aria-hidden="true"><i style="width:${Math.round(Math.max(0, Math.min(1, c.prog)) * 100)}%"></i></span>` : ''}
      </span>
      <span class="gstate">${c.extra}${c.pill}</span>
    </a>${c.over ? del(c.g.id, 'this game') : ''}</li>`;
  // Finished Gauntlet rounds are bundled: one row per Gauntlet, its rounds folded inside.
  const finishedRows = (cs) => {
    const items = [], seen = new Map();
    cs.forEach((c) => {
      const gid = c.g.gauntlet_id;
      if (!gid) { items.push({ at: c.at, html: row(c) }); return; }
      if (!seen.has(gid)) { const b = { at: c.at, gid, rounds: [] }; seen.set(gid, b); items.push(b); }
      const b = seen.get(gid); b.rounds.push(c); if (c.at > b.at) b.at = c.at;
    });
    return items.sort((a, b) => (a.at < b.at ? 1 : -1)).map((it) => it.html ?? bundleRow(it)).join('');
  };
  const bundleRow = ({ gid, rounds }) => {
    const gt = gts.find((x) => x.id === gid), players = gt?.players ?? rounds[0].g.players;
    const nth = gt ? gts.filter((x) => groupKey(x.players) === groupKey(gt.players) && x.created_at <= gt.created_at).length : null;
    let res = '';
    if (gt?.status === 'over') {
      const top = Math.max(...gt.scores), champs = gt.players.filter((_, i) => gt.scores[i] === top);
      res = top > 0 ? `👑 ${champs.map((p) => (p === me.id ? 'You' : nm(p))).join(' & ')} won ${gt.scores.join('–')}` : 'Called off';
    } else if (gt) res = `Still going: round ${gt.round} of ${gt.rounds} · ${gt.scores.join('–')}`;
    const icons = rounds.slice().sort((a, b) => (a.at < b.at ? -1 : 1)).map((c) => KIND_ICON[c.kind]).join(' ');
    return `<li class="gbundle fin"><details data-gid="${gid}" ${openBundles.has(gid) ? 'open' : ''}><summary class="grow over">
      <span class="thumb gthumb" aria-hidden="true">🏆</span>
      <span class="gmain">
        <span class="gtitle"><strong>🌀 Chaos${nth ? ` #${nth}` : ''}</strong> <span class="small">${vsOf(players)}</span></span>
        <span class="muted small">${res}${res ? ' · ' : ''}${rounds.length} round${rounds.length === 1 ? '' : 's'}: ${icons}</span>
      </span>
      <span class="gstate"><span class="pill done">${rounds.length} ▾</span></span>
    </summary><ul class="glist gbrounds">${rounds.map(row).join('')}</ul></details>${del(gid, 'this Chaos and its rounds')}</li>`;
  };
  list.innerHTML = groups.filter(([, cs]) => cs.length).map(([title, cs]) => title === 'Finished'
    ? `<div class="stack glist-fold" style="gap:6px"><div class="row between"><span class="eyebrow">Finished (${cs.length})</span><span class="row" style="gap:12px"><button type="button" class="link small" id="finMore" hidden></button><button type="button" class="link small gclear" id="finClear">🗑 Clear all</button></span></div><ul class="glist">${finishedRows(cs)}</ul></div>`
    : `<div class="stack" style="gap:6px"><span class="eyebrow">${title} (${cs.length})</span><ul class="glist">${cs.map(row).join('')}</ul></div>`).join('');
  foldGames();
  wireDeletes(list);
  list.querySelectorAll('details[data-gid]').forEach((d) => d.addEventListener('toggle', () => { openBundles[d.open ? 'add' : 'delete'](d.dataset.gid); }));
  list.querySelectorAll('canvas.thumb').forEach((cv) => drawPreview(cv, cards[+cv.dataset.i], myFleets ?? [], atMe ?? []));
}
let finishedOpen = false;

// 🗑 on a finished game, a Gauntlet bundle or a round inside one, and Clear all: tap, then tap
// again to confirm. It only leaves your list; scores, trophies and titles keep counting it.
const openBundles = new Set();   // Gauntlet bundles you opened stay open when the list refreshes
let armedDel = null;   // { key, until }: a 🗑 waiting for its second tap survives the list re-rendering
function wireDeletes(list) {
  const arm = (b, key, label, go) => {
    const was = b.innerHTML;
    const bubble = b.classList.contains('gdel');   // 🗑 keeps its icon and pops a "Delete?" bubble (CSS)
    const set = (on) => { b.classList.toggle('armed', on); if (on) { b.dataset.armed = '1'; if (!bubble) b.textContent = label; b.setAttribute('aria-label', label); } else { delete b.dataset.armed; b.innerHTML = was; } };
    if (armedDel?.key === key && armedDel.until > Date.now()) set(true);
    b.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!b.dataset.armed) {
        list.querySelectorAll('[data-armed]').forEach((x) => x.dispatchEvent(new Event('disarm')));
        armedDel = { key, until: Date.now() + 4000 }; set(true);
        b.addEventListener('disarm', () => set(false), { once: true });
        setTimeout(() => { if (b.isConnected && armedDel?.key === key && armedDel.until <= Date.now()) set(false); }, 4050);
        return;
      }
      armedDel = null; b.disabled = true;
      const { data, error } = await go();
      if (error) { note(friendly(error), 'error'); b.disabled = false; set(false); return; }
      const row = b.closest('li');
      if (row && b.dataset.hide) { row.classList.add('gone'); setTimeout(loadGames, 260); } else loadGames();
      if (!b.dataset.hide) note(data ? `Cleared ${data} finished game${data === 1 ? '' : 's'}.` : 'Nothing left to clear.');
    };
  };
  list.querySelectorAll('[data-hide]').forEach((b) => arm(b, b.dataset.hide, 'Tap again to delete', () => sb.rpc('hide_finished', { p_game: b.dataset.hide })));
  const clr = document.getElementById('finClear');
  if (clr) arm(clr, 'clear-all', 'Tap again to clear all', () => sb.rpc('hide_all_finished'));
}

// Who's here: everyone else in the family, live ones first, with where they are or when they were
// last seen. Robots are always around, so they're left out.
function renderHere() {
  const box = document.getElementById('hereNow');
  if (!box || !me) return;
  const people = Object.entries(names).filter(([id]) => id !== me.id && !bots.has(id)).map(([id, u]) => ({ id, u, r: online[u] }))
    .sort((a, b) => (b.r?.live ? 1 : 0) - (a.r?.live ? 1 : 0) || String(b.r?.seen_at ?? '').localeCompare(String(a.r?.seen_at ?? '')) || a.u.localeCompare(b.u));
  const where = (r) => (!r ? 'not yet' : !r.live ? agoText(r.seen_at) : r.page === 'lobby' ? 'Lobby' : `${KIND_ICON[r.page]} Playing`);
  const live = people.filter((p) => p.r?.live).length;
  box.innerHTML = `<span class="hnlabel">${live ? `<i class="hndot"></i>${live} live` : 'Nobody else here'}</span>` + people.map(({ u, r }) =>
    `<span class="hn ${r?.live ? 'on' : ''}" title="${esc(u)}: ${r?.live ? (r.page === 'lobby' ? 'live in the lobby' : `live, playing ${KIND_NAME[r.page]}`) : r ? `last seen ${agoText(r.seen_at)}` : 'not seen yet'}">
      ${avatar({ username: u }, 'hnav')}<small>${where(r)}</small></span>`).join('');
}
addEventListener('online', renderHere);

// Your move cards: a badge when an opponent in that game is live, and a glow when they're
// already at the table. Repainted in place on every check-in, so previews don't redraw.
function paintUpLive() {
  document.querySelectorAll('#upStrip .uplive').forEach((b) => {
    const ppl = b.dataset.players.split(',').filter(Boolean).map((id) => online[names[id]]).filter((r) => r?.live);
    const at = ppl.filter((r) => r.game === b.dataset.game), show = at.length ? at : ppl;
    b.hidden = !show.length;
    b.closest('.upcard').classList.toggle('attable', at.length > 0);
    if (!show.length) return;
    // One opponent: their name is on the line above, so keep it short.
    const solo = b.dataset.players.split(',').filter(Boolean).length === 1;
    const who = show.length === 1 ? esc(show[0].u) : `${show.length} players`, what = at.length ? 'at the table' : 'live';
    b.innerHTML = `<i></i>${solo ? `${at.length ? 'At the table' : 'Live'} now` : `${who} ${show.length === 1 ? 'is' : 'are'} ${what}`}`;
    b.title = `${show.map((r) => r.u).join(' & ')} ${show.length === 1 ? 'is' : 'are'} ${what} now`;
  });
}
addEventListener('online', paintUpLive);

// The Route to Chaos card is only for starting one: running Chaos matches show as their current
// round under Your move / Waiting on others (with a Round pill), and the game page's Chaos bar has the
// scores and Call off. Here we only remember which rivals already have one running, so the form says
// "Go to your Chaos" for them.
const groupKey = (players) => [...players].sort().join(',');
let rivalGroups = new Set();
function renderGauntlets(all) {
  const live = all.filter((g) => g.status !== 'over');
  rivalGroups = new Set(live.map((g) => groupKey(g.players)));
  const fold = document.getElementById('gtFold'), btn = document.getElementById('enterChaos');
  const mine = live.filter((g) => g.players.includes(me.id)).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0];
  if (fold) fold.open = !mine;
  if (btn) {
    if (mine) { btn.dataset.go = '1'; btn.href = mine.current_kind === 'battleship' ? `#game=${mine.current_game}` : `${mine.current_kind}.html#game=${mine.current_game}`; btn.textContent = `Go to your Chaos › round ${mine.round} of ${mine.rounds}`; }
    else { delete btn.dataset.go; btn.href = '#start'; btn.textContent = 'Enter Chaos 🌀'; }
  }
}
// 🧭 CHOOSE A COMPANION: the first time you sign in with nobody picked, the four of them, one per pillar
// of the box; pick who goes with you (design_votes, topic 'resident'). Then you meet it.
function chooseCompanion() {
  document.getElementById('meetOv')?.remove();
  const el = document.createElement('div'); el.id = 'meetOv'; el.className = 'meet-ov'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Choose a companion');
  el.innerHTML = `<div class="meet-card choose">
      <span class="eyebrow">Who lives in r4box</span><h2>Who goes with you?</h2>
      <p class="small">Four live in r4box, one for each pillar of the box. Pick a companion for your chaos adventures: it rides every game with you and <b>doubles its own pillar's events in your chaos rating</b>. You can change your mind in the Design Studio.</p>
      <div class="choose-grid">${PALS.map((p) => `<button type="button" class="choose-card" data-choose="${p.key}" style="--c:${p.colour}">
        <canvas width="220" height="220" aria-hidden="true"></canvas><b>${esc(p.name)}</b><span class="pillar">${p.pillarIcon} ${esc(p.pillar)}</span><small>${esc(p.perk)}</small></button>`).join('')}</div></div>`;
  document.body.appendChild(el);
  const widgets = PALS.map((p) => palWidget(el.querySelector(`[data-choose="${p.key}"] canvas`), { pal: p.key, s: 26, beat: 0.9, dpr: 2 }));
  el.querySelectorAll('[data-choose]').forEach((b) => b.addEventListener('click', async () => {
    const k = b.dataset.choose; el.querySelectorAll('[data-choose]').forEach((x) => { x.disabled = true; }); b.classList.add('picked');
    try { await vote(TOPIC_RESIDENT, k); } catch (err) { note(friendly(err), 'error'); el.querySelectorAll('[data-choose]').forEach((x) => { x.disabled = false; }); return; }
    try { localStorage.setItem('r4.pal', k); } catch {}
    widgets.forEach((w) => w.stop()); el.remove(); sfx('fanfare');
    lobby();   // the box, the chip and the hero are its now, and the lobby's own flow shows the meet card (nothing met yet)
  }));
}
// 👋 MEET THE COMPANION: the welcome the first time a device meets the one you picked (or whenever you
// change it), and at #meet. r4box is its mind; the pokes let you feel it react.
function meetResident(k) {
  document.getElementById('meetOv')?.remove();
  const P = PAL[k];
  const el = document.createElement('div'); el.id = 'meetOv'; el.className = 'meet-ov'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', `Meet ${P.name}`);
  el.innerHTML = `<div class="meet-card">
      <canvas id="meetCv" width="520" height="520" aria-hidden="true"></canvas>
      <span class="eyebrow">Who lives in r4box</span>
      <h2>Meet ${esc(P.name)}</h2>
      <p class="meet-tag">${esc(P.tag)}</p>
      <p class="small"><b>${P.pillarIcon} ${esc(P.pillar)}.</b> ${esc(P.perk)}</p>
      <p class="muted small">${esc(P.story)}</p>
      <p class="small"><b>r4box is ${esc(P.name)}'s mind.</b> The chaos curve, x → r·x·(1−x), is its mood, and every move you make in any game is a beat of it. Poke a beat and watch:</p>
      <div class="meet-pokes">
        <button type="button" data-m="peak">⚡ a peak</button><button type="button" data-m="mirror">✨ the mirror</button><button type="button" data-m="golden">🌻 the golden cut</button><button type="button" data-m="calm">🧘 a calm</button><button type="button" data-m="chaos">🌀 chaos</button>
      </div>
      <p class="muted small">You'll find it riding the 🌀 button in every game, in the corner of every solo run, taking a breath in every calm and blinking through every glitch. Want a different companion? Change it in the Design Studio.</p>
      <div class="row" style="gap:10px"><button type="button" class="enter" id="meetGo">Let's go 🌀</button><a class="enter alt" href="studio.html">🎨 Design Studio</a></div>
    </div>`;
  document.body.appendChild(el);
  const w = palWidget(document.getElementById("meetCv"), { pal: k, s: 60, beat: 0.9, dpr: 2 });
  el.querySelector('.meet-pokes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return; const m = b.dataset.m;
    if (m === 'calm') { w.set({ own: false, r: 2.9 }); w.force('gift', 1.8); setTimeout(() => w.set({ own: true }), 1800); }
    else if (m === 'chaos') { w.set({ own: false, r: 4 }); w.force('big', 1.4); setTimeout(() => w.set({ own: true }), 2200); }
    else w.force(m, m === 'peak' ? 0.9 : 1.6);
    sfx('click');
  });
  const close = () => { try { localStorage.setItem('r4.met', k); } catch {} w.stop(); el.remove(); if (location.hash === '#meet') history.replaceState(null, '', './'); };
  document.getElementById('meetGo').onclick = close;
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
}
// The Box, animated: the bifurcation diagram, a beat every 0.4 s walking x along the curve as r climbs
// 2.9 → 4 and starts over, the window band, the golden cut, a golden spiral, a Sierpiński, and the
// resident pal (pals.js, chosen in the Design Studio) as the live x.
function boxHero(cv, pal = 'fig') {
  if (!cv) return;
  const W = 720, H = 300; cv.width = W; cv.height = H; const c = cv.getContext('2d'), r0 = 2.8, r1 = 4;
  const bif = bifurcation(W, H, r0, r1), Y = (v) => (1 - v) * (H - 1), Xr = (r) => ((r - r0) / (r1 - r0)) * (W - 1);
  let curve = makeCurve(), acc = 0, last = 0, trail = [], mood = null, moodT = 0, moodDur = 1;
  const tri = (px, py, s, d) => { if (!d) { c.moveTo(px, py - s * 0.577); c.lineTo(px + s / 2, py + s * 0.289); c.lineTo(px - s / 2, py + s * 0.289); c.closePath(); return; } tri(px, py - s * 0.289, s / 2, d - 1); tri(px - s / 4, py + s * 0.144, s / 2, d - 1); tri(px + s / 4, py + s * 0.144, s / 2, d - 1); };
  const step = (t) => {
    if (!cv.isConnected) return;
    const dt = last ? Math.min(0.1, (t - last) / 1000) : 0; last = t; acc += dt;
    while (acc >= 0.4) { acc -= 0.4; if (curve.n >= 36) { curve = makeCurve(); trail = []; } const ev = stepCurve(curve); trail.push([curve.r, curve.x]); if (trail.length > 70) trail.shift(); const m = palMood(ev); if (m) { [mood, moodDur] = m; moodT = 0; } }
    if (mood) { moodT += dt; if (moodT >= moodDur) mood = null; }
    const r = curve.r;
    c.clearRect(0, 0, W, H); c.drawImage(bif, 0, 0);
    c.fillStyle = '#C9B8FF22'; c.fillRect(Xr(CHAOS.WINDOW[0]), 0, Math.max(3, Xr(CHAOS.WINDOW[1]) - Xr(CHAOS.WINDOW[0])), H);
    c.strokeStyle = '#FF5A4A66'; c.setLineDash([8, 6]); c.lineWidth = 2; c.beginPath(); c.moveTo(0, Y(CHAOS.PEAK)); c.lineTo(W, Y(CHAOS.PEAK)); c.stroke();
    c.strokeStyle = '#F5C54266'; c.setLineDash([3, 7]); c.beginPath(); c.moveTo(0, Y(CHAOS.CUT)); c.lineTo(W, Y(CHAOS.CUT)); c.stroke(); c.setLineDash([]);
    trail.forEach(([rr, xx], i) => { if (i === trail.length - 1) return; c.globalAlpha = 0.25 + (0.6 * i) / trail.length; c.fillStyle = xx > CHAOS.PEAK ? '#FF5A4A' : xx < CHAOS.GIFT ? '#3DD6C6' : '#fff'; c.beginPath(); c.arc(Xr(rr), Y(xx), 3.5, 0, 7); c.fill(); });
    c.globalAlpha = 1; c.strokeStyle = '#ffffff66'; c.lineWidth = 2; c.beginPath(); c.moveTo(Xr(r), 0); c.lineTo(Xr(r), H); c.stroke();
    c.fillStyle = '#FFE08A'; c.font = '800 24px Unbounded, system-ui'; c.textAlign = 'left'; c.fillText(`${phaseOf(r).toUpperCase()}  ·  r ${r.toFixed(2)}`, 14, 34);
    c.fillStyle = '#ffffff99'; c.font = '700 14px Sora, system-ui'; c.fillText('x → r·x·(1−x)', 14, 56);
    // 🌻 a golden spiral, and 🔺 a Sierpiński triangle, in the corners
    c.strokeStyle = '#F5C542aa'; c.lineWidth = 2; c.beginPath(); for (let th = 0; th <= Math.PI * 4.5; th += 0.1) { const rad = 2.2 * Math.pow(CHAOS.PHI, th / (Math.PI / 2)); const px = W - 74 + Math.cos(th) * rad, py = 64 + Math.sin(th) * rad; if (th === 0) c.moveTo(px, py); else c.lineTo(px, py); } c.stroke();
    c.fillStyle = '#C9FFF888'; c.beginPath(); tri(W - 60, H - 40, 70, 3); c.fill();
    // the resident rides the curve: the live x is the pal, in the mood the beat put it in
    if (trail.length) drawPal(pal, c, { x: Xr(r), y: Y(curve.x), s: 15, t: t / 1000, r, mood, mp: mood ? moodT / moodDur : 0, face: 1 });
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// The Your move strip: one big card per game waiting on you, swipe (or ‹ ›) through them.
function renderUpStrip(mine, cards, myFleets, atMe) {
  const sec = document.getElementById('upSec'), strip = document.getElementById('upStrip');
  if (!sec) return;
  document.title = (mine.length ? `(${mine.length}) ` : '') + 'r4box';
  sec.hidden = !mine.length;
  if (!mine.length) { strip.innerHTML = ''; return; }
  document.getElementById('upCount').textContent = mine.length;
  const keep = strip.scrollLeft;
  strip.innerHTML = mine.map((c) => `
    <a class="upcard k-${c.kind}" href="${c.href}">
      <canvas class="preview" data-i="${cards.indexOf(c)}" width="320" height="200" aria-hidden="true"></canvas>
      <span class="upbody">
        <span class="row between" style="gap:6px"><strong>${KIND_ICON[c.kind]} ${KIND_NAME[c.kind]}</strong>${c.extra}</span>
        <span class="small upvs">${c.g.players.filter((p) => p !== me.id && !bots.has(p)).map((p) => avatar({ username: names[p] }, 'mini')).join('')}${c.vs}</span>
        <span class="uplive" data-game="${c.g.id}" data-players="${c.g.players.filter((p) => p !== me.id && !bots.has(p)).join(',')}" hidden></span>
        <span class="muted small">${c.sub}</span>
        ${c.kind !== 'gauntlet' && c.g.players.length > 1 ? `<span class="small clk">${chaosIn(c.g.turn_at, c.g.gauntlet_id)}</span>` : ''}
        <span class="upgo">${c.pill.includes('Place') ? 'Place ships' : 'Play'} ›</span>
      </span>
    </a>`).join('');
  strip.scrollLeft = keep;
  paintUpLive();
  strip.querySelectorAll('canvas.preview').forEach((cv) => drawPreview(cv, cards[+cv.dataset.i], myFleets, atMe));
  const step = (d) => { const w = strip.querySelector('.upcard')?.getBoundingClientRect().width || 240; strip.scrollBy({ left: d * (w + 12), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); };
  document.getElementById('upPrev').onclick = () => step(-1);
  document.getElementById('upNext').onclick = () => step(1);
  const navs = () => { const pv = document.getElementById('upPrev'), nx = document.getElementById('upNext'); if (!pv || !nx) return; pv.hidden = nx.hidden = !(strip.scrollWidth > strip.clientWidth + 4); };
  navs(); addEventListener('resize', navs, { once: true });
}
let gamesOpen = false;   // Your games shows its first 3 rows until expanded

// Collapsed, Your games shows only its first 3 active rows (your move first) and hides Finished,
// unless nothing is active. Finished shows its 3 most recent games until expanded on its own.
function foldGames() {
  const list = document.getElementById('games'), btn = document.getElementById('gamesMore');
  if (!list || !btn) return;
  const rows = [...list.querySelectorAll(':scope > .stack:not(.glist-fold) .glist > li')], fold = list.querySelector('.glist-fold');
  const done = fold ? [...fold.querySelectorAll(':scope > ul.glist > li')] : [];   // a Gauntlet bundle counts as one
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
  else if (kind === 'duel') drawPreview(cv, { kind, g: { seed: 4242, craters: [], hp: [80, 45, 100] } });
  else if (kind === 'cards') drawPreview(cv, { kind, g: { top: 'CB', color: 'B' } });
  else drawPreview(cv, { kind, g: { rounds: 5, round: 3, status: 'playing', current_kind: 'battleship', history: [{ kind: 'golf' }, { kind: 'duel' }] } });
}

// Little live pictures of each game.
// A Chaos Cards table in miniature: felt, a fan of card backs, the face-up card in its colour.
function drawCardsPreview(c, w, h, g) {
  const col = { R: '#E5484D', G: '#2FB36C', B: '#3B82F6', Y: '#F5B81F' };
  const felt = c.createRadialGradient(w / 2, h * 0.45, 10, w / 2, h / 2, w * 0.7); felt.addColorStop(0, '#1C7355'); felt.addColorStop(1, '#0B3A2C');
  c.fillStyle = felt; c.fillRect(0, 0, w, h);
  const cw = h * 0.36, ch = h * 0.52, rr = (x, y, ww, hh, r) => { c.beginPath(); c.roundRect(x, y, ww, hh, r); };
  for (let i = 0; i < 5; i++) {   // a fan of backs
    c.save(); c.translate(w * 0.3, h * 0.72); c.rotate(-0.5 + i * 0.25); rr(-cw / 2, -ch, cw, ch, 6);
    c.fillStyle = '#23233d'; c.fill(); c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke(); c.restore();
  }
  const top = g.top || 'R7', wild = ['W', 'W4', 'CS', 'CT', 'CP', 'CB'].includes(top);
  c.save(); c.translate(w * 0.68, h * 0.5); c.rotate(0.12); rr(-cw / 2, -ch / 2, cw, ch, 6);
  c.fillStyle = wild ? '#1a1024' : col[top[0]] || '#333'; c.fill(); c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke();
  c.shadowColor = col[g.color] || '#fff'; c.shadowBlur = 16; c.strokeStyle = col[g.color] || '#fff'; c.lineWidth = 4; c.stroke(); c.shadowBlur = 0;
  c.fillStyle = '#fff'; c.font = `bold ${Math.round(ch * 0.4)}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText({ W: 'W', W4: '+4', CS: '🌀', CT: '🎯', CP: '🔀', CB: '💣' }[top] ?? ({ S: '⊘', R: '⇄' }[top.slice(1)] ?? top.slice(1)), 0, 2);
  c.restore();
}
function drawPreview(cv, card, myFleets, atMe) {
  const c = cv.getContext('2d'), w = cv.width, h = cv.height;
  c.clearRect(0, 0, w, h);
  if (card.kind === 'cards') return drawCardsPreview(c, w, h, card.g);
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
    setCourse((card.g.course || 100) / 100);   // 4+ players: the bigger course (036)
    setGolfTheme(golfTheme());
    const hole = holeWithTwists(card.g.seed, card.hole, 0, card.g.twists, card.g.t), k = Math.min(w / LH, h / LW) * 1.08;
    c.save(); c.fillStyle = golfTheme() === 'natural' ? '#4B7A33' : '#1F5B3A'; c.fillRect(0, 0, w, h);
    // centre on the hole, rotated sideways so it fills a wide card
    c.translate(w / 2, h / 2); c.rotate(-Math.PI / 2); c.scale(k, k); c.translate(-LW / 2, -LH / 2);
    drawHole(c, hole, 0, { ball: { x: hole.tee[0], y: hole.tee[1] } });
    c.restore();
  } else if (card.kind === 'duel') {
    setWorld(card.g.world); setTerrain(card.g.terrain);   // wider for 3-4 tanks (031); fractal hills (059)
    const g = card.g, n = g.hp.length, top = buildTop(g.seed, g.craters, n), sx = w / DW, sy = h / DH;
    const sky = c.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#1B1646'); sky.addColorStop(1, '#7A3E72'); c.fillStyle = sky; c.fillRect(0, 0, w, h);
    c.fillStyle = '#FFE3A3'; c.beginPath(); c.arc(w * 0.76, h * 0.2, 14, 0, 7); c.fill();
    c.fillStyle = '#1F8C8A'; c.beginPath(); c.moveTo(0, h); for (let x = 0; x < DW; x += 4) c.lineTo(x * sx, top[x] * sy); c.lineTo(w, h); c.fill();
    c.strokeStyle = '#9BF5EA'; c.lineWidth = 1.5; c.beginPath(); for (let x = 0; x < DW; x += 4) c[x ? 'lineTo' : 'moveTo'](x * sx, top[x] * sy); c.stroke();
    const cols = ['#FF6B5A', '#3DD6C6', '#FFC857', '#B79CFF', '#7FE07A', '#FF8FD0'], bw = n > 2 ? 28 : 40;
    g.hp.forEach((_, p) => {
      const X = g.tank_x || startXs(n), tx = X[p] * sx, ty = top[X[p]] * sy;
      c.globalAlpha = g.hp[p] > 0 ? 1 : 0.4;
      c.fillStyle = cols[p]; c.fillRect(tx - 8, ty - 7, 16, 7);
      c.fillStyle = '#ffffff33'; c.fillRect(tx - bw / 2, ty - 20, bw, 4); c.fillStyle = cols[p]; c.fillRect(tx - bw / 2, ty - 20, bw * g.hp[p] / 100, 4);
      c.globalAlpha = 1;
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
  const pn = document.getElementById('packN'); if (pn) pn.textContent = items.length || '';
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
  const cn = document.getElementById('chaosN'), fresh = feed.filter((e) => !e.seen_at).length;
  if (cn) { cn.textContent = fresh ? `${fresh} new` : ''; cn.closest('button').hidden = !feed.length; }
  const more = feed.length - 3;
  feedCard.innerHTML = `<div class="row between"><h2>🌀 Chaos feed</h2>${more > 0 ? `<button type="button" class="link" id="feedMore" aria-expanded="${feedOpen}">${feedOpen ? 'Show less' : `Show ${more} more`}</button>` : ''}</div>
    <ul class="chaosfeed">${feed.map((e, i) => `<li class="${e.seen_at ? '' : 'new'}" ${i >= 3 && !feedOpen ? 'hidden' : ''}><span class="big chaosic">${e.icon}${e.actor && !bots.has(e.actor) && names[e.actor] ? avatar({ username: names[e.actor] }, 'mini') : ''}</span><span>${esc(e.message)}<br><span class="muted small">${new Date(e.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></span></li>`).join('')}</ul>`;
  const btn = document.getElementById('feedMore');
  if (btn) btn.onclick = () => {
    feedOpen = !feedOpen;
    feedCard.querySelectorAll('.chaosfeed li').forEach((li, i) => { li.hidden = i >= 3 && !feedOpen; });
    btn.setAttribute('aria-expanded', feedOpen); btn.textContent = feedOpen ? 'Show less' : `Show ${more} more`;
  };
  announceChaos();
}

// ---------------------------------------------------------------- family scoreboard (#stats)
// All-time totals from the results log (family_stats), which outlives deleted games.
async function statsView() {
  G = null; setChannel(null); stopShotClock(); danger(false);
  document.getElementById('nextUp')?.remove(); document.body.classList.remove('has-firebar');
  view(`<div class="lobby statsview">
      <div class="statshead"><a href="#">← r4box</a><h1>🏅 Family scoreboard</h1><p class="muted" id="since">All-time</p></div>
      <div id="statsBody" class="stack" style="gap:18px"><p class="muted">Counting…</p></div>
    </div>`);
  const [{ data, error }, { data: ratings }] = await Promise.all([sb.rpc('family_stats'), sb.rpc('chaos_ratings')]);
  const body = document.getElementById('statsBody');
  if (!body) return;
  if (error) { body.innerHTML = `<p class="error">Couldn't load the scoreboard: ${esc(friendly(error))}</p>`; return; }
  const ps = data.players || [];
  const who = (p) => `${p.bot ? '🤖 ' : ''}${p.id === me.id ? 'You' : esc(p.username)}`;
  if (data.since) document.getElementById('since').textContent = `All-time, since ${new Date(data.since).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}`;
  const { data: dvRows } = await sb.from('design_votes').select('player, choice').eq('topic', TOPIC_RESIDENT);   // 🧭 everyone's companion, for the board
  const chaosBoard = chaosRatingsHTML(ratings || [], who, Object.fromEntries((dvRows || []).map((r) => [r.player, r.choice])));
  if (!ps.some((p) => p.played || p.gauntlets || p.holes)) { body.innerHTML = chaosBoard + '<p class="muted">No finished games yet. The board fills up as you play.</p>'; return; }
  const pct = (w, n) => (n ? `${Math.round((w / n) * 100)}%` : '–');
  const medal = ['🥇', '🥈', '🥉'];
  const ranked = ps.filter((p) => p.played || p.gauntlets);
  const cards = ranked.map((p, i) => `
    <a class="scard ${p.id === me.id ? 'me' : ''}" href="#player=${p.id}">
      <div class="row between"><strong class="sname">${medal[i] || ''} ${p.bot ? '' : avatar(p, 'mini')} ${who(p)}</strong>${p.streak >= 2 ? `<span class="streak">🔥 ${p.streak} in a row</span>` : ''}</div>
      <div class="sbig"><span><b>${p.titles}</b> 👑 Chaos title${p.titles === 1 ? '' : 's'}</span><span><b>${p.won}</b>–${p.played - p.won} <small>${pct(p.won, p.played)}</small></span></div>
      <div class="skinds">${['battleship', 'golf', 'duel', 'cards'].map((k) => `<span>${KIND_ICON[k]} ${p.by_kind[k]?.won ?? 0}/${p.by_kind[k]?.played ?? 0}</span>`).join('')}<span>🏁 ${p.rounds_won} round${p.rounds_won === 1 ? '' : 's'}</span><span class="sgo">🏆 Trophies ›</span></div>
    </a>`).join('');
  const award = (icon, label, key, fmt = (v) => v) => {
    const top = Math.max(0, ...ps.map((p) => p[key] || 0));
    if (!top) return '';
    return `<li><span class="big">${icon}</span><span><strong>${label}</strong><br><span class="muted small">${ps.filter((p) => (p[key] || 0) === top).map(who).join(' & ')} · ${fmt(top)}</span></span></li>`;
  };
  const awards = [
    award('👑', 'Chaos champion', 'titles', (v) => `${v} title${v === 1 ? '' : 's'}`),
    award('🎯', 'Sharpshooter', 'sunk', (v) => `${v} ship${v === 1 ? '' : 's'} sunk`),
    award('⛳', 'Ace', 'hio', (v) => `${v} hole${v === 1 ? '' : 's'} in one`),
    award('🐦', 'Birdie machine', 'under_par', (v) => `${v} under par`),
    award('🥊', 'Knockout king', 'kos', (v) => `${v} K.O.${v === 1 ? '' : 's'}`),
    award('💥', 'Heavy hitter', 'direct_hits', (v) => `${v} direct hit${v === 1 ? '' : 's'}`),
    award('🦊', 'Sneakiest', 'sneaky', (v) => `${v} cheat${v === 1 ? '' : 's'} got away with`),
    award('🔍', 'Sharpest eye', 'catches', (v) => `${v} cheater${v === 1 ? '' : 's'} caught`),
    award('🚨', 'Most busted', 'busted', (v) => `caught ${v} time${v === 1 ? '' : 's'}`),
    award('🔥', 'Hottest streak', 'streak', (v) => `${v} win${v === 1 ? '' : 's'} in a row`),
  ].join('');
  const byId = Object.fromEntries(ps.map((p) => [p.id, p]));
  const h2h = (data.h2h || []).filter((h) => h.a_wins + h.b_wins).map((h) => {
    const a = byId[h.a], b = byId[h.b];
    return `<li><span>${who(a)}</span><b class="${h.a_wins > h.b_wins ? 'lead' : ''}">${h.a_wins}</b><span class="dash">–</span><b class="${h.b_wins > h.a_wins ? 'lead' : ''}">${h.b_wins}</b><span>${who(b)}</span></li>`;
  }).join('');
  const rows = [
    ['👑 Chaos titles', 'titles'], ['🏁 Chaos rounds won', 'rounds_won'], ['🏆 Games won', 'won'], ['🎮 Games played', 'played'],
    ['⚓ Ships sunk', 'sunk'], ['⚓ Hit rate', (p) => pct(p.hits, p.bs_shots)], ['⛳ Holes in one', 'hio'], ['⛳ Holes under par', 'under_par'],
    ['⛳ Strokes vs par', (p) => (p.holes ? (p.to_par > 0 ? `+${p.to_par}` : p.to_par === 0 ? 'E' : p.to_par) : '–')],
    ['💥 K.O.s', 'kos'], ['💥 Direct hits', 'direct_hits'], ['🦊 Cheats got away with', 'sneaky'], ['🔍 Cheaters caught', 'catches'], ['🚨 Times busted', 'busted'],
  ];
  const cols = ps.filter((p) => p.played || p.gauntlets || p.holes);
  const table = `<div class="stable-wrap"><table class="stable"><thead><tr><th></th>${cols.map((p) => `<th>${who(p)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(([label, k]) => `<tr><th>${label}</th>${cols.map((p) => `<td>${typeof k === 'function' ? k(p) : p[k]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  // Desktop: standings and every stat on the left, hall of fame and head to head beside them.
  body.innerHTML = `
    <div class="smain">
    ${chaosBoard}
    <section class="stack" style="gap:10px"><h2>Standings</h2><div class="scards">${cards}</div></section>
    <section class="card sall"><h2>📊 Every stat</h2>${table}</section>
    </div>
    <div class="sside">
    ${awards ? `<section class="card"><h2>🏛️ Hall of fame</h2><ul class="pack">${awards}</ul></section>` : ''}
    ${h2h ? `<section class="card"><h2>⚔️ Head to head</h2><ul class="h2h">${h2h}</ul><p class="muted small">One-on-one games, Chaos rounds included.</p></section>` : ''}
    </div>`;
}

// 🌀 The chaos ratings (071): every game feeds them. A player's rating is the sum of the box's events
// their moves and beats have met; their rank is a phase of the curve.
const EVENT_LABEL = { peak: 'peaks', gift: 'gifts', fib: 'Fibonacci beats', phase: 'phases crossed', big: 'twists', window: 'window beats', balance: 'balances', mirror: 'mirrors', golden: 'golden cuts', gold: 'golden beats', r4: 'r = 4', bond: '🧭 companion bonus' };
function chaosRatingsHTML(rows, who, pals = {}) {
  const rated = rows.filter((r) => r.rating > 0);
  if (!rated.length) return `<section class="card"><h2>🌀 Chaos ratings</h2><p class="muted small">Every game feeds this: play the curve (mirrors, golden cuts, the window, peaks…) and your rating climbs through the phases, Calm to Strange Attractor.</p></section>`;
  const medal = ['🥇', '🥈', '🥉'];
  const top = (r) => Object.entries(r.counts || {}).sort((a, b) => (WEIGHTS[b[0]] || 0) * b[1] - (WEIGHTS[a[0]] || 0) * a[1]).slice(0, 3).map(([k, n]) => `${n} ${EVENT_LABEL[k] || k}`).join(' · ');
  return `<section class="card"><h2>🌀 Chaos ratings</h2><ul class="pack">${rated.map((r, i) => `<li><span class="big">${RANK_ICON[r.rank] || '🌀'}</span><span><strong>${medal[i] || ''} ${who({ id: r.player, username: r.name })}${PAL[pals[r.player]] ? ` <span title="goes with ${esc(PAL[pals[r.player]].name)}">${PAL[pals[r.player]].icon}</span>` : ''} · ${r.rating} · ${esc(r.rank)}</strong><br><span class="muted small">${top(r) || 'just started'}${r.next ? ` · ${r.next - r.rating} to ${rankOf(r.next)}` : ''}${r.week ? ` · +${r.week} this week` : ''}</span></span></li>`).join('')}</ul>
    <p class="muted small">How you play the curve, in every game: peaks and twists met, mirrors (x on 1 − x before), golden cuts (x on 1/φ), balances, window beats, Fibonacci beats, phases crossed; your 🧭 companion doubles its pillar's. Ranks: Calm · Rhythm ×2 (60) · Rhythm ×4 (160) · Cascade (320) · Chaos (640) · Strange Attractor (1280).</p></section>`;
}

// ---------------------------------------------------------------- a player's trophy case (#player=<id>)
// The shelf holds a cup for every Gauntlet title; badges light up as the numbers are reached
// (all from player_trophies, over the results log that outlives deleted games).
const BADGES = [
  ['🩸', 'First blood', 'Win your first game', (c) => c.won, 1],
  ['🎩', 'Hat trick', 'Win 3 games in a row', (c) => c.best_streak, 3],
  ['🔥', 'On fire', 'Win 5 games in a row', (c) => c.best_streak, 5],
  ['👑', 'Champion', 'Win a Route to Chaos', (c) => c.titles, 1],
  ['💎', 'Flawless', 'Win a Route to Chaos without dropping a round', (c, t) => t.filter((x) => x.perfect).length, 1],
  ['🏰', 'Dynasty', 'Win 5 Routes to Chaos', (c) => c.titles, 5],
  ['🏃', 'Grinder', 'Play 10 Routes to Chaos', (c) => c.gauntlets, 10],
  ['🎲', 'Triple threat', 'Win a game of each kind', (c) => [c.battleship_won, c.golf_won, c.duel_won].filter((x) => x > 0).length, 3],
  ['⚓', 'Admiral', 'Win 10 Battleship games', (c) => c.battleship_won, 10],
  ['🎯', 'Sharpshooter', 'Sink 10 ships', (c) => c.sunk, 10],
  ['⛳', 'Ace', 'Sink a hole in one', (c) => c.hio, 1],
  ['🐦', 'Birdie machine', 'Finish 10 holes under par', (c) => c.under, 10],
  ['🥊', 'Knockout artist', 'Win 5 duels by K.O.', (c) => c.kos, 5],
  ['💥', 'Heavy hitter', 'Land 10 direct hits', (c) => c.direct, 10],
  ['🤖', 'Robot slayer', 'Beat the robot 5 times', (c) => c.bot_wins, 5],
  ['🧹', 'Clean sweep', 'Beat every member of the family', (c) => c.beaten, (c) => c.family],
  ['🦊', 'Sneaky fox', 'Get away with 5 cheats', (c) => c.away, 5],
  ['🔍', 'Eagle eye', 'Catch 3 cheaters', (c) => c.catches, 3],
  ['🚨', 'Caught red-handed', 'Get busted cheating', (c) => c.busted, 1],
];
async function profileView(id) {
  G = null; setChannel(null); stopShotClock(); danger(false);
  document.getElementById('nextUp')?.remove(); document.body.classList.remove('has-firebar');
  view(`<div class="lobby profileview"><div class="statshead"><a href="#stats">← Scoreboard</a></div><div id="profBody"><p class="muted">Opening the trophy case…</p></div></div>`);
  const { data: d, error } = await sb.rpc('player_trophies', { p_player: id });
  const body = document.getElementById('profBody');
  if (!body) return;
  if (error || !d) { body.innerHTML = `<p class="error">${error ? esc(friendly(error)) : 'No such player.'}</p>`; return; }
  const c = d.counts || {}, titles = d.titles || [], mine = d.id === me.id;
  const name = `${d.bot ? '🤖 ' : ''}${esc(d.username)}`;
  const shelf = titles.length
    ? titles.map((t) => `<button type="button" class="trophy ${t.perfect ? 'perfect' : ''}" data-t="${esc(t.table.map((x) => `${x.name} ${x.score}`).join(' · '))}">
        <span class="cup" aria-hidden="true">🏆</span><span class="tvs">vs ${esc(t.table.filter((x) => x.id !== d.id).map((x) => x.name).join(' & '))}</span>
        <span class="tscore">${t.table.map((x) => x.score).join('–')}${t.perfect ? ' 💎' : ''}</span><span class="tdate">${new Date(t.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span></button>`).join('')
    : `<div class="trophy empty"><span class="cup" aria-hidden="true">🏆</span><span class="tvs">${mine ? 'Win a Route to Chaos to put a trophy here' : 'No Chaos titles yet'}</span></div>`;
  const badges = BADGES.map(([icon, title, how, get, goal]) => {
    const need = typeof goal === 'function' ? goal(c) : goal, have = Math.min(need, get(c, titles) || 0), got = need > 0 && have >= need;
    return { got, html: `<div class="badge ${got ? 'got' : ''}" title="${esc(how)}"><span class="bicon" aria-hidden="true">${icon}</span><strong>${title}</strong><span class="bhow">${how}</span>${got ? '' : `<span class="bprog" aria-label="${have} of ${need}"><i style="width:${need ? Math.round((have / need) * 100) : 0}%"></i></span><span class="bnum">${have}/${need}</span>`}</div>` };
  });
  const earned = badges.filter((b) => b.got).length;
  body.innerHTML = `
    <header class="phead">${avatar(d)}
      <div><h1>${name}</h1><p class="muted">👑 ${c.titles} title${c.titles === 1 ? '' : 's'} · ${c.won}–${c.played - c.won} in games · best streak ${c.best_streak}${c.streak >= 2 ? ` · 🔥 ${c.streak} now` : ''}</p></div></header>
    <section class="stack" style="gap:8px"><h2>🏆 Trophy case</h2><div class="shelf">${shelf}</div></section>
    <section class="stack" style="gap:8px"><div class="row between"><h2>🎖️ Badges</h2><span class="muted small">${earned} of ${badges.length}</span></div>
      <div class="badges">${badges.filter((b) => b.got).map((b) => b.html).join('')}${badges.filter((b) => !b.got).map((b) => b.html).join('')}</div></section>`;
  body.querySelectorAll('.trophy[data-t]').forEach((t) => { t.onclick = () => { note(`🏆 ${t.dataset.t}`); sfx('chime'); }; });
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
  const refresh = () => { if (pending) return; pending = true; setTimeout(async () => { pending = false; await loadGame(id); renderGame(); upNext(); }, 150); };
  // A light check every few seconds too (like the other pages' liveGame), so the end of a game
  // still lands when realtime drops a change: a Chaos round can't move on from a page that never
  // learned it was over.
  clearInterval(bsPoll);
  bsPoll = setInterval(async () => {
    if (document.hidden || !G || G.game.id !== id || pending) return;
    const { data } = await sb.from('games').select('updated_at, status, move').eq('id', id).maybeSingle();
    if (data && (data.updated_at !== G.game.updated_at || data.status !== G.game.status || data.move !== G.game.move)) refresh();
  }, 5000);
  setChannel(sb.channel(`game-${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${id}` }, refresh)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'shots', filter: `game_id=eq.${id}` }, refresh)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'accusations', filter: `game_id=eq.${id}` }, refresh)
    .subscribe((s) => { const l = document.getElementById('live'); if (l) l.classList.toggle('off', s !== 'SUBSCRIBED'); }));
  bsPresence = livePresence('battleship', id, (v) => {
    liveBS = v; aims = { target: null, cells: new Set() }; peekMode = false; if (v) bsLiveSince = Date.now();
    if (G?.game.status !== 'playing') return renderGame();
    if (v) { stopShotClock(); bsGo = Date.now() + 3000; liveCountdown('battleship', G.game.id, ['⚔️ LIVE BATTLE', G.game.players.some((p) => bots.has(p)) ? 'You vs the robot' : "Everyone's here"], { solo: G.game.players.filter((p) => !bots.has(p)).length < 2 }).then((t) => { bsGo = t; }); }
    else { aims = { target: null, cells: new Set() }; clearTimeout(volleyTimer); volleyTimer = null; note('Live battle over: back to taking turns.'); return refresh(); }   // live often ends because the game did: reload, don't just redraw
    renderGame();
  });
  renderGame();
  upNext();
}

async function loadGame(id) {
  // One round trip: everything at once (the players' themes come by the game's id, not its player list).
  const [{ data: game }, { data: shots }, { data: fleets }, cheatsRes, accRes, modRes, { data: sonars }, pack, themeRes] = await Promise.all([
    sb.from('games').select('*').eq('id', id).maybeSingle(),
    sb.from('shots').select('*').eq('game_id', id).order('id'),
    sb.from('fleets').select('*').eq('game_id', id),
    sb.from('cheats').select('*').eq('game_id', id).order('id'),
    sb.from('accusations').select('*').eq('game_id', id).order('move'),
    sb.from('player_mods').select('*').eq('game_id', id),
    sb.from('loot').select('*').eq('used_game', id).eq('item', 'sonar'), backpack(),
    G?.game.id === id && G.themes ? { data: null } : sb.from('games').select('players').eq('id', id).maybeSingle().then(async (r) => r.data ? sb.from('profiles').select('id, bs_theme').in('id', r.data.players) : { data: [] }),
  ]);
  if (!game) return false;
  const themeRows = themeRes.data ?? Object.entries(G.themes).map(([id, bs_theme]) => ({ id, bs_theme }));
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
    cheats: cheatsRes.data ?? [], accusations: accRes.data ?? [], sonars: sonars ?? [],
    pack: MODES[game.mode].shared ? pack.filter((l) => l.item !== 'sonar') : pack.filter((l) => l.item !== 'sierpinski'),   // a ping needs a rival's board; a triangle, the ocean
    themes: Object.fromEntries((themeRows ?? []).map((r) => [r.id, r.bs_theme])),   // each fleet is drawn in its owner's theme (027)
    cheatsOn: !cheatsRes.error && !accRes.error && !MODES[game.mode].shared,   // no cheats on the shared ocean
    shotMod: (modRes.data ?? []).find((m) => m.player_id === me.id)?.shot_mod ?? 0,
    fresh, freshA, prevStatus, prevTurnMine, fxDue: true,
    draft: same ? G.draft : null, // keep an unsaved ship layout across live refreshes
    fleets: Object.fromEntries((fleets ?? []).map((f) => [f.player_id, f.ships])),
  };
  // A new move clears your aim, turn by turn. Live, moves fly by: staged squares stay (053).
  // Only squares now taken for you: hit by anyone, or fired at by you. Someone else's miss there
  // doesn't count (054: you can still miss there too, and you can't see it anyway).
  if (liveBS && aims.target) { const gone = new Set((shots ?? []).filter((x) => (aims.target === OCEAN || x.target === aims.target) && (x.hit || x.shooter === me.id)).map((x) => x.cell)); aims.cells = new Set([...aims.cells].filter((c) => !gone.has(c))); }
  else if (prevMove != null && game.move !== prevMove) aims = { target: null, cells: new Set() };
  // Live fog (053) lifts on a clock, not a move: redraw the board when it does.
  if (game.fog_player === me.id && game.fog_until) { const ms = Date.parse(game.fog_until) - Date.now(); if (ms > 0 && ms < 60000) setTimeout(() => { if (G?.game.id === id) renderGame(); }, ms + 100); }
  G.gtHTML = G.game.gauntlet_id ? await gauntletBar(G.game.gauntlet_id, G.game.id, me.id, (p) => (bots.has(p) ? '🤖 ' : '') + (names[p] ?? 'someone')) : '';
  return true;
}

// 🌫️ Fog (047): a chaos twist hides the results of your last few shots from you until your turn ends.
function fogIds() {
  const g = G.game;
  const on = g.move <= g.fog_move || (g.fog_until && Date.now() < Date.parse(g.fog_until));   // live: 20 s (053)
  return g.fog_player === me.id && g.status === 'playing' && on ? new Set((g.fog_shots || []).map(Number)) : new Set();
}
// Other players' misses stay off the boards you fire at (and out of the feed) until the game is over:
// what they found is theirs. Your own board still shows every shot at you. Everyone may miss on the
// same square (054): a square a rival missed is still yours to try.
const hiddenMiss = (s) => !s.hit && !s.chaos && s.shooter !== me.id && s.target !== me.id && G.game.status !== 'over';
function boardHTML({ owner, ships, clickable, fresh }) {
  const { game, shots } = G;
  const { n } = MODES[game.mode];
  const ocean = owner === OCEAN, over = game.status === 'over';
  // The shared ocean shows every shot in the game (a miss there has no target).
  const at = shots.filter((s) => (ocean || s.target === owner) && !pending.has(s.id) && !hiddenMiss(s));
  const shotAt = new Map(at.map((s) => [s.cell, s]));
  const peeks = (G.cheats || []).filter((c) => c.kind === 'peek' && c.player_id === me.id && c.detail?.target === owner)
    .concat((G.sonars || []).filter((l) => l.detail?.target === owner));
  const peekShip = new Set(peeks.flatMap((c) => c.detail.ships)), peekArea = new Set(peeks.flatMap((c) => c.detail.area));
  const sunk = new Set(at.flatMap((s) => s.sunk_cells ?? [])), fog = fogIds();
  const shipAt = new Set(ships ? fleetCells(game.mode, ships).flat() : []);
  // On the ocean: your own fleet, and every fleet once the battle is over.
  const fleetsHere = ocean ? Object.entries(G.fleets).filter(([p]) => p === me.id || over) : [];
  if (ocean) fleetsHere.forEach(([, f]) => fleetCells(game.mode, f).flat().forEach((x) => shipAt.add(x)));
  const mine = new Set(ocean && G.fleets[me.id] ? fleetCells(game.mode, G.fleets[me.id]).flat() : []);
  const aiming = aims.target === owner ? aims.cells : null;
  // The sea view (027): one stretch of water in the owner's theme, the ships drawn across their
  // squares, and the squares on top (see-through) for aiming and the shot markers.
  const theme = themeOf(G.themes?.[ocean ? me.id : owner]), at2 = (r, c) => `grid-area:${r + 2}/${c + 2}`;
  let h = `<div class="board seaview t-${theme}" style="grid-template-columns:18px repeat(${n},1fr)"><span class="lbl egg" data-egg style="grid-area:1/1"></span>`
    + `<div class="sea sea-${theme}" style="grid-area:2/2/span ${n}/span ${n}"></div>`
    + (ocean && game.islands?.length ? coastSVG(game.islands, n) : '');
  const isle = new Set(ocean ? game.islands || [] : []);
  const vessel = (cells, L, wreck, th = theme, who = owner) => {
    const r0 = Math.min(...cells.map((x) => Math.floor(x / n))), c0 = Math.min(...cells.map((x) => x % n));
    const horiz = new Set(cells.map((x) => Math.floor(x / n))).size === 1 && L > 1;
    return `<span class="vessel pc ${wreck ? 'wreck' : ''}" style="grid-area:${r0 + 2}/${c0 + 2}/span ${horiz ? 1 : L}/span ${horiz ? L : 1};--pc:${pcol(who)}">${vesselSVG(th, L, horiz || L === 1)}</span>`;
  };
  if (ocean) {
    // Each fleet in its owner's theme; a rival's ship shows once it's sunk (or when it's all over).
    const drawn = new Set(fleetsHere.map(([p]) => p));
    fleetsHere.forEach(([p, f]) => fleetCells(game.mode, f).forEach((cells, k) => { h += vessel(cells, MODES[game.mode].ships[k], cells.every((x) => sunk.has(x)), themeOf(G.themes?.[p]), p); }));
    at.filter((s) => s.sunk_cells?.length && !drawn.has(s.target)).forEach((s) => { h += vessel(s.sunk_cells, s.sunk_cells.length, true, themeOf(G.themes?.[s.target]), s.target); });
  } else if (ships) fleetCells(game.mode, ships).forEach((cells, k) => { h += vessel(cells, MODES[game.mode].ships[k], cells.every((x) => sunk.has(x))); });
  else at.filter((s) => s.sunk_cells?.length).forEach((s) => { h += vessel(s.sunk_cells, s.sunk_cells.length, true); });   // their ships show once sunk
  for (let c = 0; c < n; c++) h += `<span class="lbl" style="${at2(-1, c)}">${c + 1}</span>`;
  for (let r = 0; r < n; r++) {
    h += `<span class="lbl" style="${at2(r, -1)}">${ROWS[r]}</span>`;
    for (let c = 0; c < n; c++) {
      const i = r * n + c, cls = ['cell'], s = shotAt.get(i);
      if (isle.has(i)) cls.push('isle');
      if (shipAt.has(i)) cls.push('ship');
      if (sunk.has(i)) cls.push('sunk');
      else if (s && fog.has(s.id) && !shipAt.has(i)) cls.push('fog');
      else if (s) cls.push(s.hit ? 'hit' : 'miss');
      const inAir = !s && flying(owner, i);   // fired, not landed yet: still staged, then landing
      if (aiming?.has(i) || inAir) cls.push('aim');
      if (inAir && (launched.get(flightKey(owner, i)) ?? Infinity) <= Date.now()) cls.push('landing');
      if (s && fresh && s.move === game.move) cls.push('new');
      if (!s && peekShip.has(i)) cls.push('peek-ship'); else if (!s && peekArea.has(i)) cls.push('peek-empty');
      const label = cellName(game.mode, i), pc = s?.hit && s.target && !cls.includes('fog') ? `;--pc:${pcol(s.target)}` : '';
      if (pc) cls.push('owned');
      h += clickable && !s && !mine.has(i) && !isle.has(i) && !inAir
        ? `<button class="${cls.join(' ')}" style="${at2(r, c)}" data-o="${owner}" data-i="${i}" data-target="${owner}" data-cell="${i}" aria-label="Aim at ${label}"></button>`
        : `<span class="${cls.join(' ')}" style="${at2(r, c)}${pc}" data-o="${owner}" data-i="${i}" aria-label="${label}"></span>`;
    }
  }
  return `<div class="bzoom">${h}</div></div>`;
}
// 🐙 The kraken's arms (060): six tentacles that curl out and fork, and fork again (3 levels, each
// branch 0.6 as long), drawn as they grow. A fresh tangle each time (seeded by the square).
function krakenArms(cell) {
  let seed = (cell + 1) * 2654435761 >>> 0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const paths = [];
  const arm = (x, y, a, len, w, depth) => {
    const bend = (rnd() - 0.5) * 1.2, mx = x + Math.cos(a + bend * 0.5) * len * 0.55, my = y + Math.sin(a + bend * 0.5) * len * 0.55;
    const x2 = x + Math.cos(a + bend) * len, y2 = y + Math.sin(a + bend) * len;
    paths.push(`<path d="M${x.toFixed(1)} ${y.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke-width="${w.toFixed(1)}" style="animation-delay:${(3 - depth) * 0.16}s"/>`);
    if (depth) [-0.5, 0.5].forEach((d) => arm(x2, y2, a + bend + d + (rnd() - 0.5) * 0.3, len * 0.6, w * 0.62, depth - 1));
  };
  const a0 = rnd() * 6.283;
  for (let i = 0; i < 6; i++) arm(100, 100, a0 + (i * 6.283) / 6, 34, 7, 3);
  const el = document.createElement('div'); el.className = 'krakenarms';
  el.innerHTML = `<svg viewBox="0 0 200 200" width="200" height="200" fill="none" stroke="#9B4DCA" stroke-linecap="round">${paths.join('')}</svg>`;
  return el;
}
// 🏝️ Islands (060): each island's outline traced round its squares, then every stretch of shore
// broken up by midpoint displacement (three levels, each half the last): a coastline that stays
// ragged however far you zoom. Seeded by where the shore is, so everyone sees the same islands.
function coastSVG(cells, n) {
  const set = new Set(cells), next = new Map();
  const key = (x, y) => `${x},${y}`;
  set.forEach((i) => {
    const x = i % n, y = Math.floor(i / n), has = (dx, dy) => { const nx = x + dx, ny = y + dy; return nx >= 0 && ny >= 0 && nx < n && ny < n && set.has(ny * n + nx); };
    if (!has(0, -1)) next.set(key(x, y), [x + 1, y]);
    if (!has(1, 0)) next.set(key(x + 1, y), [x + 1, y + 1]);
    if (!has(0, 1)) next.set(key(x + 1, y + 1), [x, y + 1]);
    if (!has(-1, 0)) next.set(key(x, y + 1), [x, y]);
  });
  const jag = (ax, ay, bx, by) => {   // midpoint displacement between two shore corners
    let pts = [[ax, ay], [bx, by]], amp = 0.34, seed = (ax * 73856093) ^ (ay * 19349663) ^ (bx * 83492791) ^ (by * 2654435);
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
    for (let lvl = 0; lvl < 3; lvl++, amp *= 0.5) {
      const out = [pts[0]];
      for (let k = 1; k < pts.length; k++) {
        const [x1, y1] = pts[k - 1], [x2, y2] = pts[k], nx = -(y2 - y1), ny = x2 - x1, d = rnd() * amp;
        out.push([(x1 + x2) / 2 + nx * d, (y1 + y2) / 2 + ny * d], pts[k]);
      }
      pts = out;
    }
    return pts.slice(1);
  };
  let d = '';
  const done = new Set();
  next.forEach((_, k0) => {
    if (done.has(k0)) return;
    let k = k0, [x, y] = k0.split(',').map(Number), path = `M${x} ${y}`;
    for (let guard = 0; guard < 400 && !done.has(k); guard++) {
      done.add(k); const [x2, y2] = next.get(k);
      jag(x, y, x2, y2).forEach(([px, py]) => { path += `L${px.toFixed(3)} ${py.toFixed(3)}`; });
      x = x2; y = y2; k = key(x, y);
    }
    d += path + 'Z';
  });
  return `<svg class="isles" style="grid-area:2/2/span ${n}/span ${n}" viewBox="0 0 ${n} ${n}" preserveAspectRatio="none" aria-hidden="true">`
    + `<path d="${d}" fill="none" stroke="#FFFFFF" stroke-opacity=".45" stroke-width="0.34" stroke-linejoin="round"/>`   // surf
    + `<path d="${d}" fill="#62A04E" stroke="#E9D8A6" stroke-width="0.24" stroke-linejoin="round"/></svg>`;   // beach round the green
}
// 🔍 Board zoom (053): 1× to 2.4×, the same for every board, remembered on this device. A zoomed
// board scrolls sideways inside its card.
// Pinch a board (two fingers; trackpad pinch or Ctrl + wheel on a computer) for any zoom from 1× to
// 3×, the spot between your fingers staying put; the buttons step 1 → 1.4 → 1.8 → 2.4 → 3.
const BZ = [1, 1.4, 1.8, 2.4, 3], BZ_MAX = 3;
let bz = (() => { try { const v = +localStorage.getItem('bs.zoom'); return v >= 1 && v <= BZ_MAX ? v : 1; } catch { return 1; } })();
const bzLabel = () => `${Math.round(bz * 10) / 10}×`;
const applyZoom = () => {
  document.documentElement.style.setProperty('--bz', bz); document.documentElement.classList.toggle('bz-on', bz > 1.001);
  document.querySelectorAll('.bzbar b').forEach((b) => { b.textContent = bzLabel(); });
  document.querySelectorAll('.bzbar [data-bz]').forEach((b) => { b.disabled = +b.dataset.bz < 0 ? bz <= 1.001 : bz >= BZ_MAX - 0.001; });
};
const saveZoom = () => { try { localStorage.setItem('bs.zoom', String(Math.round(bz * 100) / 100)); } catch {} };
applyZoom();
const zoomBar = () => `<div class="bzbar" role="group" aria-label="Board zoom">🔍<button type="button" data-bz="-1" aria-label="Zoom out"${bz <= 1.001 ? ' disabled' : ''}>−</button><b>${bzLabel()}</b><button type="button" data-bz="1" aria-label="Zoom in"${bz >= BZ_MAX - 0.001 ? ' disabled' : ''}>＋</button></div>`;
// Zoom to z keeping the board point under (cx, cy) on screen where it is: the zoom box scrolls
// sideways, the page up and down.
function zoomAround(box, z, cx, cy) {
  z = Math.max(1, Math.min(BZ_MAX, z));
  const r = box.getBoundingClientRect(), k = z / bz, px = cx - r.left + box.scrollLeft, py = cy - r.top;
  bz = z; applyZoom();
  box.scrollLeft = px * k - (cx - r.left);
  const dy = py * (k - 1); if (Math.abs(dy) > 0.5) scrollBy(0, dy);
}
let bzPinch = null;
document.addEventListener('touchstart', (e) => {
  const box = e.target.closest?.('.bzoom');
  if (!box || e.touches.length !== 2) return;
  const [a, b] = e.touches;
  bzPinch = { box, d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, z: bz };
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!bzPinch || e.touches.length !== 2) return;
  e.preventDefault();   // our zoom, not the page's
  const [a, b] = e.touches, d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
  zoomAround(bzPinch.box, bzPinch.z * (d / bzPinch.d), (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
}, { passive: false });
document.addEventListener('touchend', (e) => { if (bzPinch && e.touches.length < 2) { bzPinch = null; if (bz < 1.04) { bz = 1; applyZoom(); } saveZoom(); } });
document.addEventListener('wheel', (e) => {   // trackpad pinch arrives as Ctrl + wheel
  const box = e.ctrlKey && e.target.closest?.('.bzoom'); if (!box) return;
  e.preventDefault();
  zoomAround(box, bz * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY); saveZoom();
}, { passive: false });
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
  const fog = fogIds();
  const items = moves.map((m) => {
    // 🐙🌪️ what the kraken and the tornado did this move, on lines of their own (053)
    const wildLines = ['kraken', 'tornado'].map((k) => { const ws = shots.filter((s) => s.move === m && s.chaos === k); if (!ws.length) return '';
      const whose = ws[0].target === me.id ? 'your' : `${nm(ws[0].target)}'s`, cells = ws.map((s) => cellName(game.mode, s.cell)).join(', ');
      return `<li class="hit">${k === 'kraken' ? `🐙 <strong>The Kraken</strong> crushed ${whose} ship: ${cells}.` : `🌪️ <strong>A tornado</strong> tore through ${whose} waters: hit ${cells}.`}</li>`; }).join('');
    const ss = shots.filter((s) => s.move === m && !s.chaos).map((s) => (fog.has(s.id) ? { ...s, hit: false, fogged: true } : s));
    if (!ss.length) return wildLines;
    const hits = ss.filter((s) => s.hit).length;
    const who = ss[0].shooter === me.id ? 'You' : nm(ss[0].shooter);
    const whose = (p) => (p === me.id ? 'your' : `${nm(p)}'s`);
    if (MODES[game.mode].shared) {   // one ocean: say whose ship each hit found
      const cells = ss.map((s) => (hiddenMiss(s) ? 'a miss' : `${cellName(game.mode, s.cell)} ${s.fogged ? '🌫️' : s.hit ? `hit ${s.target === me.id ? 'you' : nm(s.target)}` : 'miss'}`)).join(', ');
      const sank = ss.filter((s) => s.sunk_ship != null).map((s) => `${whose(s.target)} ${shipName(game.mode, s.sunk_ship)}`);
      return `${wildLines}<li class="${hits ? 'hit' : ''}"><strong>${who}</strong> fired: ${cells}.${sank.length ? ` Sank ${sank.join(' and ')}.` : ''}</li>`;
    }
    const tgt = ss[0].target === me.id ? 'you' : nm(ss[0].target);
    const cells = ss.map((s) => (hiddenMiss(s) ? 'a miss' : `${cellName(game.mode, s.cell)} ${s.fogged ? '🌫️' : s.hit ? 'hit' : 'miss'}`)).join(', ');
    const sank = ss.filter((s) => s.sunk_ship != null).map((s) => shipName(game.mode, s.sunk_ship));
    const acc = (G.accusations || []).find((a) => a.move === m);
    const accLine = acc ? `<li class="accuse">🚨 <strong>${acc.accuser === me.id ? 'You' : nm(acc.accuser)}</strong> called cheater on <strong>${acc.accused === me.id ? 'you' : nm(acc.accused)}</strong>: ${acc.busted ? `busted! (${acc.kinds.map(cheatLabel).join(', ')})` : 'false alarm.'}</li>` : '';
    return `${wildLines}${accLine}<li class="${hits ? 'hit' : ''}"><strong>${who}</strong> fired at <strong>${tgt}</strong>: ${cells}.${sank.length ? ` Sank the ${sank.join(' and ')}.` : ''}</li>`;
  }).join('');
  if (shotsOpen === null) shotsOpen = !isPhone();   // folded on phones until opened, and remembered while you play
  return `<details class="card mfold" id="feedFold" ${shotsOpen ? 'open' : ''}><summary><h2>Latest shots</h2></summary><ul class="feed">${items}</ul></details>`;
}

// Switch a phone to one board without redrawing (the tabs; also used so a shot is always seen landing).
function showBoard(owner) {
  if (!owner || isShared()) return;   // the shared ocean is always on screen
  boardTab = owner;
  app.querySelectorAll('.bsec').forEach((el) => el.classList.toggle('tab-on', el.dataset.owner === owner));
  app.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === owner)));
  const t = app.querySelector(`.boardtabs.many [data-tab="${owner}"]`);   // a scrolling row: bring the picked tab into view
  if (t) t.parentElement.scrollTo({ left: t.offsetLeft - t.parentElement.clientWidth / 2 + t.offsetWidth / 2, behavior: 'smooth' });
}
function renderGame() {
  if (!G) return;
  const { game } = G;
  const opponents = game.players.filter((p) => p !== me.id);
  const myTurn = game.status === 'playing' && game.players[game.turn] === me.id;
  const imOut = game.eliminated.includes(me.id);
  const liveNow = liveBS && game.status === 'playing' && !imOut;
  const perTurn = Math.max(1, game.spt + (myTurn ? G.shotMod : 0));
  const shared = isShared();
  const need = aims.target ? Math.min(perTurn, openSquares(aims.target)) : perTurn;

  let title, sub = '';
  if (game.status === 'setup') title = G.fleets[me.id] ? 'Waiting for ships' : 'Place your fleet';
  else if (game.status === 'over') title = game.winner === me.id ? 'You win!' : `${nm(game.winner)} wins!`;
  else if (imOut) { title = "You're out"; sub = 'Your fleet is sunk. You can keep watching the battle.'; }
  else if (liveNow) { title = '⚔️ Live battle'; sub = `No turns! Tap ${volleySize()} squares ${shared ? 'of the ocean' : "of a rival's board"}: they fire together as a volley, and your guns reload while it flies.`; }
  else if (myTurn) { title = 'Your turn'; sub = `Pick ${perTurn === 1 ? 'a square' : `${perTurn} squares`}${G.shotMod < 0 ? ' (one fewer for that false accusation)' : G.shotMod > 0 ? ' (one sneaky extra 🤫)' : ''} ${shared ? 'anywhere on the ocean (not on your own ships)' : `on ${opponents.length > 1 ? "one opponent's" : `${nm(opponents[0])}'s`} board`}, then fire.`; }
  else { title = `${nm(game.players[game.turn])}'s turn`; sub = 'This page updates as soon as they fire.'; }

  const playersStrip = `<div class="players">${game.players.map((p) => {
    const cls = ['player'];
    if (game.status === 'playing' && (liveNow ? !game.eliminated.includes(p) : game.players[game.turn] === p)) cls.push('turn');
    if (game.eliminated.includes(p)) cls.push('out');
    return `<span class="${cls.join(' ')}">${pdot(p)}${p === me.id ? 'You' : nm(p)}${game.winner === p ? ' 🏆' : ''}${(game.skip_next || []).includes(p) ? ' <span class="skipnote" title="Busted: loses their next turn">⏭</span>' : ''}</span>`;
  }).join('')}</div>`;

  let body = '';
  if (game.status === 'setup' && !G.fleets[me.id]) {
    if (!G.draft && shared) oceanShuffle();   // the server knows where everyone else has anchored
    else if (!G.draft) G.draft = randomFleet(game.mode);
    body = `<section class="card narrow" style="margin:0">
      <p class="muted">${shared ? 'Everyone hides their ships on the same ocean. Shuffle until you like your spot: nobody else can see it, and it never overlaps anyone.' : 'Shuffle until you like where your ships are. Nobody else can see them.'}</p>
      ${G.draft ? boardHTML({ owner: me.id, ships: G.draft }) : '<p class="muted">Finding a clear patch of sea…</p>'}
      <div class="fleet-list">${MODES[game.mode].ships.map((L, i) => `<span>${shipName(game.mode, i)} · ${L}</span>`).join('')}</div>
      <div class="themepick"><div class="row between"><strong>⚓ Your fleet's look</strong><span class="muted small">Everyone sees your ships this way</span></div>
        <div class="themes" id="themeTiles" role="radiogroup" aria-label="Battleship theme"></div></div>
      <p class="error" id="err" hidden></p>
      <div class="row"><button id="shuffle">Shuffle ships</button><button class="primary" id="ready">Ready</button></div>
    </section>`;
  } else if (game.status === 'setup') {
    const isReady = (p) => !!G.fleets[p] || (game.ready || []).includes(p);   // others' fleets are secret; games.ready (022) says who's set
    const waiting = game.players.filter((p) => !isReady(p) && p !== me.id);
    // Who's set: everyone's avatar with ready or still placing (a green ring = on the site right now).
    const ready = game.players.filter(isReady).length;
    body = `<section class="card narrow readyroll" style="margin:0">
        <div class="row between"><h2>⚓ Ready check</h2><span class="pill ${waiting.length ? 'wait' : 'done'}">${ready} of ${game.players.length} ready</span></div>
        <ul class="rlist">${game.players.map((p) => { const ok = isReady(p);
          return `<li class="${ok ? 'ok' : ''}">${avatar({ username: names[p], bot: bots.has(p) }, 'rav')}<span class="rname">${p === me.id ? 'You' : nm(p)}</span>
            <span class="rstate">${ok ? '✅ Ready' : '<span class="rdots">⏳ Placing ships</span>'}</span></li>`; }).join('')}</ul>
        <p class="muted small">${waiting.length ? 'The battle starts the moment the last fleet is placed.' : 'Everyone is set. Starting…'}</p>
      </section>
      <section class="card narrow" style="margin:0"><h2>Your fleet</h2>${boardHTML({ owner: me.id, ships: G.fleets[me.id] })}</section>`;
  } else if (shared) {
    const over = game.status === 'over';
    const left = (p) => MODES[game.mode].ships.length - new Set(G.shots.filter((s) => s.target === p && s.sunk_ship != null).map((s) => s.sunk_ship)).size;
    const roll = game.players.map((p) => `<li class="${game.eliminated.includes(p) ? 'out' : ''}">${face(p, names[p], bots.has(p))}${pdot(p)}<strong>${p === me.id ? 'You' : nm(p)}</strong>
      <span class="muted small">${game.eliminated.includes(p) ? 'Sunk' : `${left(p)} ship${left(p) === 1 ? '' : 's'} left`}</span>${fleetListHTML(p)}</li>`).join('');
    body = `<section class="card bsec tab-on ${aims.target ? 'target-active' : ''}" data-owner="${OCEAN}">
        <div class="row between"><h2>🌊 The ocean</h2>${imOut ? '<span class="pill out">Your fleet is sunk</span>' : zoomBar()}</div>
        ${boardHTML({ owner: OCEAN, ships: G.fleets[me.id], clickable: (myTurn || liveNow) && !imOut, fresh: true })}
        <p class="muted small">Your ships are the ones you can see. Everyone else's are hiding out there too: a hit tells you whose.</p>
      </section>
      <section class="card"><h2>Fleets</h2><ul class="oceanroll">${roll}</ul></section>
      ${feedHTML()}
      ${legend}`;
  } else {
    const over = game.status === 'over';
    // Which board a phone shows: your target on your turn, your fleet otherwise, until you pick one.
    const tabState = liveNow ? 'live' : `${game.move}|${myTurn}`;
    if (boardTabFor !== tabState || ![...opponents, me.id].includes(boardTab) || (liveNow && game.eliminated.includes(boardTab))) {
      boardTabFor = tabState;
      boardTab = myTurn || liveNow ? (aims.target || opponents.find((p) => !game.eliminated.includes(p)) || opponents[0]) : me.id;
    }
    const left = (p) => MODES[game.mode].ships.length - new Set(G.shots.filter((s) => s.target === p && s.sunk_ship != null).map((s) => s.sunk_ship)).size;
    const tabs = `<div class="boardtabs${opponents.length > 3 ? ' many' : ''}" role="tablist" aria-label="Boards">${opponents.map((p) => `<button type="button" role="tab" data-tab="${p}" aria-selected="${boardTab === p}" style="--pc:${pcol(p)}">${pdot(p)}${face(p, names[p], bots.has(p))}${nm(p)} <small>${left(p)} left</small></button>`).join('')}<button type="button" role="tab" data-tab="${me.id}" aria-selected="${boardTab === me.id}" style="--pc:${pcol(me.id)}">${pdot(me.id)}🚢 Your fleet <small>${left(me.id)} left</small></button></div>`;
    const targets = opponents.map((p) => {
      const out = game.eliminated.includes(p);
      const cls = ['card', 'bsec'];
      if (boardTab === p) cls.push('tab-on');
      if (aims.target === p) cls.push('target-active');
      if (out) cls.push('eliminated');
      return `<section class="${cls.join(' ')}" data-owner="${p}">
        <div class="row between"><h2>${face(p, names[p], bots.has(p))}${pdot(p)}${nm(p)}'s waters</h2>${out ? '<span class="pill out">Sunk</span>' : ''}</div>
        ${boardHTML({ owner: p, ships: over ? G.fleets[p] : null, clickable: (myTurn || liveNow) && !out, fresh: true })}
        ${fleetListHTML(p)}
      </section>`;
    }).join('');
    body = `${callOutHTML()}${sonarLoot && (myTurn || liveNow) ? '<p class="status noteline">📡 Tap a square on an opponent\'s board to ping the 3×3 patch around it.</p>' : ''}${peekMode && (myTurn || liveNow) ? '<p class="status noteline">👀 Tap a square on an opponent\'s board to peek.</p>' : ''}
      ${tabs}
      ${zoomBar()}
      <div class="boards">${targets}
        <section class="card bsec ${boardTab === me.id ? 'tab-on' : ''}" data-owner="${me.id}"><div class="row between"><h2>Your fleet</h2>${imOut ? '<span class="pill out">Sunk</span>' : ''}</div>
          ${boardHTML({ owner: me.id, ships: G.fleets[me.id], fresh: true })}
          ${fleetListHTML(me.id)}
          <p class="muted small">Yellow outlines mark the latest shots.</p></section>
      </div>
      ${over ? cheatLogHTML() : ''}${feedHTML()}
      ${legend}`;
  }

  const canDelete = game.created_by === me.id;
  // The backpack rides in the fire bar: the full bar on a desktop, a row of icons on top of it otherwise.
  const packMini = (myTurn || liveNow) && !deskBar() ? backpackBarHTML(G.pack || [], 'battleship', !busy, { compact: true }) : '';
  const fbPack = deskBar() ? `<span class="fbpack">${backpackBarHTML(G.pack || [], 'battleship', !busy)}</span>` : packMini ? `<div class="fbmini">${packMini}</div>` : '';
  view(`
    <header class="stack">
      <div class="row between gtop"><button class="link" id="back">← r4box</button>${isPhone() ? `<h1 class="intop">${title}</h1>` : ''}<span class="live" id="live">Live</span></div>
      <div id="gtbar">${G.gtHTML || ''}</div>
      ${isPhone() ? '' : `<h1>${title}</h1>`}
      ${sub ? `<p class="muted gsub">${sub}</p>` : ''}
      ${playersStrip}
    </header>
    ${body}
    ${liveNow ? `<div class="firebar livebar ${packMini ? 'withmini' : ''}">${packMini ? fbPack : ''}<span class="aimwrap"><span id="aimtext">${bsGunsText()}</span></span>${aims.cells.size ? '<button class="link" id="clearAim">Clear</button><button class="fire ready" id="fireNow">Fire now</button>' : ''}${deskBar() ? fbPack : ''}</div>` : ''}
    ${myTurn && !liveNow ? `<div class="firebar ${packMini ? 'withmini' : ''}">${packMini ? fbPack : ''}
      <span class="aimwrap"><span class="aimdots" aria-hidden="true">${Array.from({ length: need }, (_, i) => `<i class="${i < aims.cells.size ? 'on' : ''}"></i>`).join('')}</span>
      <span id="aimtext">${aims.target ? (aims.cells.size === need ? `Ready: ${need} ${aims.target === OCEAN ? `shot${need === 1 ? '' : 's'}` : `at ${nm(aims.target)}`}` : `Aimed ${aims.cells.size} of ${need}`) : `Tap ${need === 1 ? 'a square' : `${need} squares`} to aim`}</span></span>
      ${aims.cells.size ? '<button class="link" id="clearAim">Clear</button>' : ''}
      ${deskBar() ? fbPack : ''}
      <span data-clockslot></span>
      <button class="fire ${aims.target && aims.cells.size === need && !busy ? 'ready' : ''}" id="fire" ${aims.target && aims.cells.size === need && !busy ? '' : 'disabled'}>Fire!</button><span class="error" id="fireerr" hidden></span></div>` : ''}`);
  document.body.classList.toggle('has-firebar', myTurn || liveNow);
  document.body.classList.toggle('fb-mini', !!packMini);
  if ((myTurn || liveNow) && G.cheatsOn) rumour(BS_RUMOURS);
  // Shot clock: 45 seconds to fire (not when every opponent is the robot).
  if (myTurn && !liveNow && !busy && opponents.some((p) => !bots.has(p))) shotClock(`bs.${game.id}.${game.move}.${game.turn}`, 45, async () => {
    const { data } = await sb.rpc('shot_clock', { p_kind: 'battleship', p_game: game.id });
    if (data) splash(['TOO SLOW!', '⏱ SHOT CLOCK', data], { tone: 'red', sound: null, ms: 2000 });
    aims = { target: null, cells: new Set() };
    await loadGame(game.id); renderGame();
  });
  else stopShotClock();
  // Phones and full screen: instructions pop up once instead of taking up room on the page.
  const tipNow = liveNow ? '' : sonarLoot && myTurn ? '📡 Tap a square on their board to ping the 3×3 around it.' : peekMode && myTurn ? '👀 Tap a square on their board to peek.' : myTurn || game.status === 'setup' ? sub.replace(/<[^>]+>/g, '') : '';
  const key = `${game.id}|${game.move}|${game.status}|${tipNow}`;
  if ((isPhone() || app.classList.contains('fs-on')) && key !== lastNoteKey && tipNow) note(tipNow);
  lastNoteKey = key;
  const ff = document.getElementById('feedFold'); if (ff) ff.addEventListener('toggle', () => { shotsOpen = ff.open; });
  const fb = app.querySelector('.firebar');   // keep the ▶ Next chip and 🔊 above it, whatever its height
  if (fb) document.documentElement.style.setProperty('--fbh', `${Math.ceil(fb.getBoundingClientRect().height)}px`);
  app.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => showBoard(b.dataset.tab); });
  const clr = document.getElementById('clearAim');
  if (clr) clr.onclick = () => { aims = { target: null, cells: new Set() }; renderGame(); };
  const fnow = document.getElementById('fireNow');
  if (fnow) fnow.onclick = () => fireVolley();
  app.querySelectorAll('.bzbar [data-bz]').forEach((b) => { b.onclick = () => {
    bz = +b.dataset.bz > 0 ? (BZ.find((v) => v > bz + 0.01) ?? BZ_MAX) : ([...BZ].reverse().find((v) => v < bz - 0.01) ?? 1);
    saveZoom(); applyZoom(); }; });

  if (channel) { const l = document.getElementById('live'); l.classList.toggle('off', channel.state !== 'joined'); }
  fsRefresh();
  document.getElementById('back').onclick = () => { location.hash = ''; };

  setGameTools({ fs: '#app', canDelete, chaos: { kind: 'battleship', id: game.id },
    bot: game.status === 'playing' && !imOut && game.players.some((p) => bots.has(p)) ? { on: !!game.live_bot, label: 'Live battle vs robot', onToggle: async () => {
      const { error } = await sb.rpc('set_live_bot', { p_kind: 'battleship', p_game: game.id, p_on: !game.live_bot });
      if (error) return friendly(error);
      await loadGame(game.id); renderGame();
    } } : null,
    onDelete: async () => {
    const { error } = await sb.rpc('delete_game', { p_game: game.id });
    if (error) return friendly(error);
    location.hash = '';
  } });

  themeTiles(document.getElementById('themeTiles'));   // placing your ships: pick how they look
  const shuffle = document.getElementById('shuffle');
  if (shuffle) {
    shuffle.onclick = () => { if (shared) oceanShuffle(); else { G.draft = randomFleet(game.mode); renderGame(); } };
    document.getElementById('ready').onclick = async (e) => {
      e.target.disabled = true;
      const { error } = await sb.rpc('set_fleet', { p_game: game.id, p_ships: G.draft });
      if (error) {
        const el = document.getElementById('err'); el.hidden = false; el.textContent = friendly(error); e.target.disabled = false;
        if (shared && /anchored there first/.test(error.message || '')) oceanShuffle();   // someone beat you to it: a fresh spot
        return;
      }
      notify(game.id);
      await loadGame(game.id);
      renderGame();
    };
  }

  wireCheats();
  app.querySelectorAll('[data-cell]').forEach((b) => b.addEventListener('click', () => {
    const target = b.dataset.target, cell = +b.dataset.cell;
    if (sonarLoot) { doSonar(target, cell); return; }
    if (triLoot) { doTriangle(cell); return; }
    if (peekMode) { doPeek(target, cell); return; }
    if (liveNow) { stageLive(target, cell); return; }
    if (aims.target !== target) aims = { target, cells: new Set() };
    const max = Math.min(Math.max(1, game.spt + G.shotMod), openSquares(target));
    if (aims.cells.has(cell)) aims.cells.delete(cell);
    else if (aims.cells.size < max) aims.cells.add(cell);
    else if (max === 1) aims.cells = new Set([cell]);
    navigator.vibrate?.(8);
    renderGame();
  }));

  playEffects();

  const fire = document.getElementById('fire');
  if (fire) fire.onclick = async () => {
    busy = true; fire.disabled = true;
    const owner = aims.target, cells = [...aims.cells]; markInFlight(owner, cells);
    cells.forEach((c, k) => setTimeout(() => launchShell(owner, c), k * 120));   // away now; the server tells us what they hit
    const { error } = await sb.rpc('fire', { p_game: game.id, p_target: aims.target === OCEAN ? null : aims.target, p_cells: cells });
    busy = false;
    if (error) { unlaunch(owner, cells); const el = document.getElementById('fireerr'); el.hidden = false; el.textContent = friendly(error); if (isPhone()) note(friendly(error), 'error'); fire.disabled = false; return; }
    aims = { target: null, cells: new Set() };
    notify(game.id);
    await loadGame(game.id);
    renderGame();
  };
}

// Squares still worth aiming at: on a rival's board, the ones nobody has fired at; on the shared
// ocean, those less your own ships.
function openSquares(target) {
  const { game, shots } = G, n = MODES[game.mode].n;
  // Taken for you: anything hit, and whatever you fired at yourself (054).
  const taken = (s) => s.hit || s.shooter === me.id;
  if (target !== OCEAN) return n ** 2 - new Set(shots.filter((s) => s.target === target && taken(s)).map((s) => s.cell)).size;
  const gone = new Set(shots.filter(taken).map((s) => s.cell));
  if (G.fleets[me.id]) fleetCells(game.mode, G.fleets[me.id]).flat().forEach((x) => gone.add(x));
  (game.islands || []).forEach((x) => gone.add(x));   // 🏝️ (060)
  return n ** 2 - gone.size;
}
// Shared Ocean setup: the server deals a spot clear of every fleet already anchored.
let oceanDealing = false;
async function oceanShuffle() {
  if (oceanDealing) return;
  oceanDealing = true;
  const id = G.game.id;
  let res; try { res = await sb.rpc('bs_shuffle', { p_game: id }); } finally { oceanDealing = false; }
  const { data, error } = res;
  if (G?.game.id !== id) return;
  if (error) return note(friendly(error), 'error');
  G.draft = data; renderGame();
}
// Desktop (not full screen): the backpack rides in the fire bar, so your turn is one panel.
const deskBar = () => matchMedia('(min-width:1000px) and (min-height:560px)').matches && !app.classList.contains('fs-on') && !matchMedia('(pointer: coarse)').matches;
// The robot in a live battle: ask the server to fire for it (it keeps the robot to one shot every
// 1.2 s however many pages ask, and picks the target and square itself).
let botAsk = false, bsLiveSince = 0, bsGo = 0;   // bsGo: live fire waits for the countdown's GO (045)
setInterval(async () => {
  if (!liveBS || botAsk || Date.now() - bsLiveSince < 3000 || Date.now() < bsGo + 1200 || !G || G.game.status !== 'playing' || !G.game.players.some((p) => bots.has(p))) return;
  botAsk = true;
  try {
    const { data } = await sb.rpc('fire_live_bot', { p_game: G.game.id });
    if (data) { await loadGame(G.game.id); renderGame(); }
  } finally { botAsk = false; }
}, 600);
// Themes (027): a new pick in Settings redraws the boards. And somewhere on every board there's a
// way to meet the UFO fleet (tap the empty corner five times, quickly). Nobody is told.
addEventListener('bstheme', async () => { if (G?.game) { G.themes = null; await loadGame(G.game.id); renderGame(); } });   // themes are cached between loads
let eggTaps = [];
document.addEventListener('click', async (e) => {
  if (!e.target.closest?.('[data-egg]')) return;
  const now = Date.now(); eggTaps = eggTaps.filter((t) => now - t < 2500).concat(now);
  if (eggTaps.length < 5) return;
  eggTaps = [];
  const { data } = await sb.rpc('unlock_bs_theme', { p_word: 'take me to your leader' });
  if (data !== 'ufo') return;
  forgetThemes();
  splash(['👽 ABDUCTED!', 'You found', 'THE UFO FLEET'], { tone: 'gold', ms: 2600 }); sfx('fanfare');
  if (G?.game) { await loadGame(G.game.id); renderGame(); }
});
// Live: stage a square (tap it again to take it back); a full volley fires.
function stageLive(target, cell) {
  if (Date.now() < bsGo) { note('Wait for GO!'); sfx('buzz'); return; }
  if (aims.target !== target) aims = { target, cells: new Set() };
  if (aims.cells.has(cell)) aims.cells.delete(cell);
  else if (aims.cells.size < volleySize()) { aims.cells.add(cell); sfx('tick'); }
  navigator.vibrate?.(12);
  renderGame();
  if (aims.cells.size >= volleySize()) fireVolley();
}
async function fireVolley() {
  if (!aims.target || !aims.cells.size || !liveBS) return;
  const wait = bsReloadUntil - Date.now();
  if (wait > 0) { if (!volleyTimer) volleyTimer = setTimeout(() => { volleyTimer = null; fireVolley(); }, wait + 20); return; }
  const owner = aims.target, cells = [...aims.cells]; markInFlight(owner, cells);
  aims = { target: null, cells: new Set() };
  bsReloadUntil = Date.now() + BS_RELOAD;
  navigator.vibrate?.([30, 40, 30]);
  cells.forEach((c, k) => setTimeout(() => launchShell(owner, c), k * 110));   // the volley: away now, the reload runs while it flies
  renderGame();
  const { error } = await sb.rpc('fire_live_volley', { p_game: G.game.id, p_target: owner === OCEAN ? null : owner, p_cells: cells });
  if (error) {
    unlaunch(owner, cells);
    note(friendly(error), 'error');
    if (/Still reloading/.test(error.message || '')) bsReloadUntil = Date.now() + 600;
    if (/live battle is over/i.test(error.message || '')) liveBS = false;
  }
  await loadGame(G.game.id); renderGame();
}

// ---------------------------------------------------------------- cheating (server-run, 2 per player per game)
const CHEATS = { peek: '👀 Peek', extra: '➕ Extra shot', move: '🚢 Ship slipped away' };
const cheatLabel = (k) => CHEATS[k] || k;
function lastShooter() { const s = [...G.shots].reverse().find((x) => x.move === G.game.move && !x.chaos); return s?.shooter; }
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
  // Not during a live battle: shots fly every second, and its penalties are about turns.
  if (!G.cheatsOn || liveBS || g.status !== 'playing' || !g.move || g.eliminated.includes(me.id)) return '';
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
function cheatError(e) { note(friendly(e), 'error'); }
// The cheats have no buttons (see CLAUDE.md for the gestures): hold a rival's square to peek,
// hold one of your own ships to sneak it away, triple-tap "Your turn" for an extra shot.
const canCheat = () => G && !busy && G.cheatsOn && G.game.status === 'playing' && (liveBS || G.game.players[G.game.turn] === me.id) && !G.game.eliminated.includes(me.id);
onHold(app, '.bsec button[data-cell]', (el) => { if (canCheat() && el.dataset.target !== me.id) doPeek(el.dataset.target, +el.dataset.cell); });
onHold(app, '.bsec .cell.ship', async (el) => {
  if (!canCheat() || el.closest('.bsec')?.dataset.owner !== me.id) return;
  const { data, error } = await sb.rpc('cheat_move_ship', { p_game: G.game.id });
  if (error) return cheatError(error);
  await afterCheat(); stamp(`🚢 Your ${shipName(G.game.mode, data.ship)}<br>slipped away`, 'purple', 1900); sfx('sneaky');
});
onTaps(app, '#app > header h1', 3, async () => {
  if (!canCheat()) return;
  const { error } = await sb.rpc('cheat_extra_shot', { p_game: G.game.id });
  if (error) return cheatError(error);
  await afterCheat(); stamp('➕ Extra shot 🤫', 'purple', 1600); sfx('sneaky');
});
const BS_RUMOURS = ['Old sailors say a long, hard stare at enemy waters shows what hides beneath.', 'They say a captain who holds on to a ship long enough can make it vanish.', 'Rumour has it shouting "your turn" three times gets you a little extra.'];
async function afterCheat() { await loadGame(G.game.id); renderGame(); }
async function doPeek(target, cell) {
  peekMode = false;
  const { data, error } = await sb.rpc('cheat_peek', { p_game: G.game.id, p_target: target, p_center: cell });
  if (error) { renderGame(); cheatError(error); return; }
  await afterCheat();
  stamp(data.ships.length ? `👀 ${data.ships.length} ship square${data.ships.length > 1 ? 's' : ''}!` : '👀 Nothing there', 'purple', 1800); sfx('sneaky');
}
// 🔺 Sierpiński Salvo (060): the server works out the triangle from its top square, adds that many
// shots, and the page stages them; live, they fire at once as a volley.
async function doTriangle(cell) {
  const id = triLoot; triLoot = null;
  const { data, error } = await useLoot(id, G.game.id, null, cell);
  if (error) { renderGame(); cheatError(error); return; }
  await loadGame(G.game.id);
  stamp('🔺 Sierpiński Salvo!', 'purple', 1600); sfx('pop');
  aims = { target: OCEAN, cells: new Set(data.cells) };
  renderGame();
  if (liveBS) fireVolley();
}
async function doSonar(target, cell) {
  const id = sonarLoot; sonarLoot = null;
  const { data, error } = await useLoot(id, G.game.id, target, cell);
  if (error) { renderGame(); cheatError(error); return; }
  await loadGame(G.game.id); renderGame();
  stamp(data.ships.length ? `📡 ${data.ships.length} ship square${data.ships.length > 1 ? 's' : ''}!` : '📡 Just fish', 'blue', 1800); sfx('ping');
}
function wireCheats() {
  app.querySelectorAll('.backpack [data-loot], .packmini [data-loot]').forEach((b) => {
    if (b.dataset.item === 'sonar') b.classList.toggle('on', sonarLoot === +b.dataset.loot);   // armed: tap a square to ping
    if (b.dataset.item === 'sierpinski') b.classList.toggle('on', triLoot === +b.dataset.loot);   // armed: tap the triangle's top
    b.onclick = async () => {
      if (b.dataset.item === 'sonar') { sonarLoot = sonarLoot ? null : +b.dataset.loot; renderGame(); return; }
      if (b.dataset.item === 'sierpinski') { triLoot = triLoot ? null : +b.dataset.loot; renderGame(); if (triLoot) note('🔺 Tap the square for the top of the triangle.'); return; }
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
      danger(false);
      if (game.winner === me.id) { splash(['FLEET DESTROYED', 'VICTORY', 'The seas are yours'], { ms: 2600 }); sfx('fanfare', { delay: 0.8 }); if (!reduceMotion) setTimeout(() => fx.fireworks(10), 900); }
      else { splash(['ALL SHIPS LOST', 'DEFEATED', `${nm(game.winner).replace(/<[^>]+>/g, '')} rules the waves`], { tone: 'red', ms: 2600 }); sfx('lose', { delay: 0.8 }); }
      jumpToNext('battleship', game, me.id, (p) => (bots.has(p) ? '🤖 ' : '') + (names[p] ?? 'someone'), 3200);
    } else if (G.prevStatus === null && game.status === 'over') {
      // Opened a game that just finished: straight on to the next one (jumpToNext skips old results).
      jumpToNext('battleship', game, me.id, (p) => (bots.has(p) ? '🤖 ' : '') + (names[p] ?? 'someone'), 1500);
    } else if (G.prevStatus === 'setup' && game.status === 'playing') {
      banner(nowMine ? 'Battle stations! You fire first' : 'Battle stations!');
    } else if (!liveBS && nowMine && (G.prevTurnMine === false || fresh.some((s) => s.shooter !== me.id))) banner('Your turn');
    lastShipDrama(fresh);
    announceChaos({ gameId: game.id });
  }, wait);
}
// Down to one ship: a MAYDAY for you (plus a heartbeat while it lasts), a heads-up when a rival is.
const shipsLeft = (p) => MODES[G.game.mode].ships.length - new Set(G.shots.filter((s) => s.target === p && s.sunk_ship != null).map((s) => s.sunk_ship)).size;
function lastShipDrama(fresh) {
  const { game } = G, playing = game.status === 'playing';
  const mineLeft = shipsLeft(me.id), imOut = game.eliminated.includes(me.id);
  danger(playing && !imOut && mineLeft === 1);
  const once = (k) => { try { if (localStorage.getItem(k)) return false; localStorage.setItem(k, '1'); } catch { return false; } return true; };
  if (!playing) return;
  if (!imOut && mineLeft === 1 && once(`drama.last.${game.id}.${me.id}`)) splash(['MAYDAY', 'LAST SHIP', 'One more hit and you sink'], { tone: 'red', sound: 'alarm', ms: 2400 });
  game.players.filter((p) => p !== me.id && !game.eliminated.includes(p) && shipsLeft(p) === 1 && fresh.some((s) => s.target === p && s.sunk_ship != null))
    .forEach((p) => { if (once(`drama.last.${game.id}.${p}`)) splash(['ONE SHIP LEFT', nm(p).replace(/<[^>]+>/g, '').toUpperCase(), 'Finish them!'], { ms: 2200 }); });
}

boot();
