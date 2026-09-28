import { USERNAME_DOMAIN } from './config.js';
import { sb, ITEMS, backpack, useLoot, announceChaos, backpackBarHTML, sfx, fsButton, fsRefresh, fsExit, nextUpChip, isPhone, note, gauntletBar, splash, danger, onHold, onTaps, rumour, shotClock, stopShotClock, chaosClock, chaosIn, gauntletRounds, openSettings, avatar } from './common.js';
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
// Phones show one board at a time: which one (an owner's id), and the turn state it was picked for.
let boardTab = null, boardTabFor = null;
let shotsOpen = null, lastNoteKey = '';   // Latest shots folded or open; the last message popped up on a phone
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
  // Incoming! A drumroll before their shells land on you.
  if (newShots.some((s) => s.target === me.id)) { showBoard(me.id); sfx('drumroll', { dur: 0.9 }); delay += 950; }
  Object.values(byMove).forEach((batch) => {
    batch.forEach((s, k) => {
      setTimeout(() => {
        showBoard(s.target);
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
  const pm = location.hash.match(/player=([0-9a-f-]{36})/);
  if (m) openGame(m[1]); else if (pm) profileView(pm[1]); else if (location.hash === '#stats') statsView(); else lobby();
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


// ---------------------------------------------------------------- lobby
const KIND_ICON = { battleship: '⚓', golf: '⛳', duel: '💥', gauntlet: '🏆' };
const KIND_NAME = { battleship: 'Battleship', golf: 'Putt Post', duel: 'Hilltop Duel', gauntlet: 'The Gauntlet' };
const KIND_BLURB = {
  battleship: 'Hide your fleet, hunt theirs. Peeking is allowed.',
  golf: '18 wild holes, sneak attacks and mulligans.',
  duel: 'Tanks on hills. Mind the wind.',
  gauntlet: 'A best-of series of random games. Winner takes the crown.',
};
const KIND_SHORT = { battleship: 'Battleship', golf: 'Putt Post', duel: 'Duel', gauntlet: 'Gauntlet' };
const KIND_WHO = { battleship: '2–3 players', golf: 'Solo or up to 4', duel: '2 players', gauntlet: '2–4 players · 3, 5 or 7 rounds' };

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
  view(`
    <div class="lobby${quick ? ' quickmode' : ''}">
      <div class="quickhead"><a href="#">← Game Room</a><h1>Quick play</h1><p class="muted">One game on its own, outside the Gauntlet. One of each kind per group of players at a time.</p></div>
      <header class="row between">
        <div class="stack lobhead"><span class="eyebrow">Family Game Room</span><h1>Ahoy, ${esc(me.username)}</h1></div>
      </header>
      <section class="gthero" id="gtSec">
        <div class="gthead"><span class="gtcup" aria-hidden="true">🏆</span><div><h2>The Gauntlet</h2><p class="small">One running Gauntlet per rival: surprise rounds of putts, duels and sea battles. Win the most rounds for the crown, and the next Gauntlet starts on its own.</p></div></div>
        <div class="gtlive" id="gtLive"></div>
        <form class="gtstart" id="gtStart">
          <span class="gtlabel" id="gtLabel">New rival</span>
          <div class="choice">${others.map(([id, u]) => `<button type="button" class="chip" data-gopp="${esc(u)}" data-gid="${id}" aria-pressed="false">${bots.has(id) ? '🤖 ' : ''}${esc(u)}</button>`).join('')}</div>
          <div class="row gtrow">
            <div class="seg" role="radiogroup" aria-label="Rounds">${[3, 5, 7].map((r) => `<label><input type="radio" name="gtRounds" value="${r}" ${r === gauntletRounds() ? 'checked' : ''}>${r} rounds</label>`).join('')}</div>
            <button class="gtbtn" type="submit" id="gtGo" disabled>Start 🏆</button>
          </div>
          <p class="error" id="gtErr" hidden></p>
        </form>
      </section>
      <section class="stack upsec" id="upSec" hidden>
        <div class="row between"><h2>Your move <span class="upcount" id="upCount"></span></h2>
          <span class="row" style="gap:6px"><button type="button" class="upnav" id="upPrev" aria-label="Previous game">‹</button><button type="button" class="upnav" id="upNext" aria-label="Next game">›</button></span></div>
        <div class="upstrip" id="upStrip"></div>
      </section>
      <section class="stack" id="newSec">
        <h2 class="qpick">Pick a game</h2>
        <div class="ncards" role="radiogroup" aria-label="Pick a game">
          ${['battleship', 'golf', 'duel'].map((k) => `
          <button type="button" class="ncard k-${k}" data-kind="${k}" role="radio" aria-checked="false">
            <canvas class="preview" data-kind="${k}" width="320" height="200" aria-hidden="true"></canvas>
            <span class="nbody"><strong><span class="nfull">${KIND_ICON[k]} ${KIND_NAME[k]}</span><span class="nshort">${KIND_ICON[k]} ${KIND_SHORT[k]}</span></strong><span class="muted small">${KIND_BLURB[k]}</span><span class="eyebrow">${KIND_WHO[k]}</span></span>
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
      <a class="quickentry" href="#stats"><span class="qicons" aria-hidden="true">🏅</span><span><strong>Family scoreboard</strong><span class="muted small">All-time titles, wins, streaks and bragging rights</span></span><span class="qgo" aria-hidden="true">›</span></a>
      <a class="quickentry" href="#quick"><span class="qicons" aria-hidden="true">⚓⛳💥</span><span><strong>Quick play</strong><span class="muted small">Battleship, Putt Post or Hilltop Duel on its own</span></span><span class="qgo" aria-hidden="true">›</span></a>
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
    </div>`);
  // Start a Gauntlet: pick 1-3 opponents and a length, go.
  const gchips = [...app.querySelectorAll('[data-gopp]')], gtGo = document.getElementById('gtGo');
  const gPicked = () => gchips.filter((c) => c.getAttribute('aria-pressed') === 'true');
  gchips.forEach((c) => c.addEventListener('click', () => {
    const on = c.getAttribute('aria-pressed') !== 'true';
    if (on && gPicked().length >= 3) return note('Up to three opponents.');
    c.setAttribute('aria-pressed', String(on)); gtGo.disabled = !gPicked().length;
    const ids = gchips.filter((x) => x.getAttribute('aria-pressed') === 'true').map((x) => x.dataset.gid);
    const exists = ids.length && rivalGroups.has([me.id, ...ids].sort().join(','));
    gtGo.textContent = exists ? 'Go to your Gauntlet ›' : 'Start 🏆';
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
    // One game of each kind per group of players: if it's already going, pick it back up.
    const ids = picked().map((x) => x.dataset.id), group = [me.id, ...ids].sort().join(',');
    const table = { battleship: 'games', golf: 'golf_games', duel: 'duel_games' }[k];
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
  // Old links to the alerts card (#alerts) open Settings, where turn alerts live now.
  if (location.hash === '#alerts') { history.replaceState(null, '', './'); openSettings(); }
  // Phones: Backpack, Chaos feed and Turn alerts sit behind one row of small buttons.
  app.querySelectorAll('[data-show]').forEach((b) => { b.onclick = () => {
    const el = document.getElementById(b.dataset.show), on = !el.classList.contains('show');
    app.querySelectorAll('[data-show]').forEach((o) => { document.getElementById(o.dataset.show).classList.remove('show'); o.setAttribute('aria-expanded', 'false'); });
    if (on) { el.classList.add('show'); b.setAttribute('aria-expanded', 'true'); }
  }; });
  const reload = () => { loadGames(); loadChaos(); };
  setChannel(['games', 'golf_games', 'duel_games', 'gauntlets', 'chaos_events'].reduce(
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
  const [bsRes, golfRes, duelRes, gtRes] = await Promise.all([
    sb.from('games').select('*').order('updated_at', { ascending: false }).limit(40),
    sb.from('golf_games').select('*').order('updated_at', { ascending: false }).limit(40),
    sb.from('duel_games').select('*').order('updated_at', { ascending: false }).limit(40),
    sb.from('gauntlets').select('*').order('updated_at', { ascending: false }).limit(200),
  ]);
  const list = document.getElementById('games');
  if (!list) return;
  if (bsRes.error) { list.innerHTML = `<p class="error">Couldn't load games: ${esc(friendly(bsRes.error))}</p>`; return; }
  const bs = bsRes.data ?? [], golf = golfRes.data ?? [], duel = duelRes.data ?? [];
  // A Gauntlet still in progress whose current round is gone (deleted) is dead; don't list it.
  const alive = new Set([...bs, ...golf, ...duel].map((g) => g.id));
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
    return;   // Gauntlets live on the rival cards at the top (running ones, and titles won)
    cards.push({ at: g.updated_at, kind: 'gauntlet', g, href, mine: false, over: g.status === 'over', prog: (g.history || []).length / g.rounds, pill: g.status === 'over' ? `<span class="pill done">Champion decided</span>` : `<span class="pill gt">Round ${g.round} of ${g.rounds}: ${KIND_ICON[g.current_kind]}</span>`, sub: table, vs: vsOf(g.players), extra: '' });
  });
  renderGauntlets(gts, cards);
  if (!cards.length) { renderUpStrip([], [], [], []); list.innerHTML = `<p class="muted">No games yet. Pick one above.</p>`; return; }
  // Your move first, then games waiting on someone else, then finished ones (folded away).
  cards.sort((a, b) => (a.at < b.at ? 1 : -1));
  // Your move gets its own swipeable strip at the top; the list below holds the rest.
  renderUpStrip(cards.filter((c) => c.mine), cards, myFleets ?? [], atMe ?? []);
  const groups = [
    ['Waiting on others', cards.filter((c) => !c.mine && !c.over)],
    ['Finished', cards.filter((c) => c.over)],
  ];
  const row = (c) => `
    <li><a class="grow ${c.mine ? 'mine' : ''} ${c.over ? 'over' : ''} k-${c.kind}" href="${c.href}">
      <canvas class="thumb" data-i="${cards.indexOf(c)}" width="160" height="100" aria-hidden="true"></canvas>
      <span class="gmain">
        <span class="gtitle"><strong>${KIND_ICON[c.kind]} ${KIND_NAME[c.kind]}</strong> <span class="small">${c.vs}</span></span>
        <span class="muted small">${c.sub}${!c.over && !c.mine && c.kind !== 'gauntlet' && c.g.players.length > 1 && chaosIn(c.g.turn_at, c.g.gauntlet_id) ? ` · <span class="clk">${chaosIn(c.g.turn_at, c.g.gauntlet_id)}</span>` : ''}</span>
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

// One card per rival (a group of players): their running Gauntlet, which one it is, and
// how many Gauntlets each of them has won.
const groupKey = (players) => [...players].sort().join(',');
let rivalGroups = new Set();
function renderGauntlets(all, cards) {
  const box = document.getElementById('gtLive');
  if (!box) return;
  const live = all.filter((g) => g.status !== 'over');
  rivalGroups = new Set(live.map((g) => groupKey(g.players)));
  box.innerHTML = live.map((g) => {
    const past = all.filter((x) => x.status === 'over' && groupKey(x.players) === groupKey(g.players));
    const titles = g.players.map((p) => past.filter((x) => { const i = x.players.indexOf(p), top = Math.max(...x.scores); return top > 0 && x.scores[i] === top; }).length);
    const lead = Math.max(...g.scores), done = g.history || [];
    const round = cards.find((c) => c.g.id === g.current_game), myMove = !!round?.mine;
    const href = g.current_kind === 'battleship' ? `#game=${g.current_game}` : `${g.current_kind}.html#game=${g.current_game}`;
    const whoseMove = round ? (myMove ? 'Your move' : round.pill.replace(/<[^>]+>/g, '')) : '';
    const dots = Array.from({ length: g.rounds }, (_, i) => { const h = done[i], cur = !h && i === g.round - 1;
      return `<i class="${h ? 'done' : cur ? 'cur' : ''}">${h ? KIND_ICON[h.kind] : cur ? KIND_ICON[g.current_kind] : i + 1}</i>`; }).join('');
    const rivals = g.players.filter((p) => p !== me.id), others = rivals.map((p) => esc(names[p] ?? 'someone')).join(' & ');
    const faces = rivals.map((p) => avatar({ username: names[p], bot: bots.has(p) }, 'gtav')).join('');
    return `<div class="gtwrap"><a class="gtcard ${myMove ? 'mine' : ''}" href="${href}">
      <span class="gtwho"><span class="gtfaces">${faces}</span><span class="gtrival"><strong>vs ${others}</strong><span>Gauntlet #${past.length + 1}${past.length ? ` · 🏆 ${g.players.map((p, i) => `${p === me.id ? 'You' : nm(p)} ${titles[i]}`).join(' · ')}` : ''}</span></span></span>
      <span class="gtscore">${g.players.map((p, i) => `<span class="${g.scores[i] === lead && lead > 0 ? 'lead' : ''}">${g.scores[i] === lead && lead > 0 ? '👑 ' : ''}${p === me.id ? 'You' : nm(p)} <b>${g.scores[i]}</b></span>`).join('')}</span>
      <span class="gttrack">${dots}</span>
      <span class="gtnow">Round ${g.round} of ${g.rounds}: ${KIND_ICON[g.current_kind]} ${KIND_NAME[g.current_kind]}${whoseMove ? ` · <strong>${whoseMove}</strong>` : ''}${round && chaosIn(round.g.turn_at, g.id) ? ` · <span class="gtclk">${chaosIn(round.g.turn_at, g.id)}</span>` : ''}</span>
      <span class="gtplay">${myMove ? `Play round ${g.round} ›` : 'Watch ›'}</span>
    </a>${g.created_by === me.id ? `<button type="button" class="gtoff" data-off="${g.id}">Call off</button>` : ''}</div>`;
  }).join('');
  // Calling a Gauntlet off ends it for everyone: its round in progress goes, finished rounds and past titles stay.
  box.querySelectorAll('[data-off]').forEach((b) => { b.onclick = async () => {
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap to confirm'; b.classList.add('armed'); setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Call off'; b.classList.remove('armed'); } }, 4000); return; }
    b.disabled = true;
    const { error } = await sb.rpc('gauntlet_delete', { p_gauntlet: b.dataset.off });
    if (error) { note(friendly(error), 'error'); b.disabled = false; return; }
    note('Gauntlet called off.'); loadGames(); loadChaos();
  }; });
  document.getElementById('gtLabel').textContent = live.length ? 'New rival' : 'Start a rivalry';
}

// The Your move strip: one big card per game waiting on you, swipe (or ‹ ›) through them.
function renderUpStrip(mine, cards, myFleets, atMe) {
  const sec = document.getElementById('upSec'), strip = document.getElementById('upStrip');
  if (!sec) return;
  document.title = (mine.length ? `(${mine.length}) ` : '') + 'Family Game Room';
  sec.hidden = !mine.length;
  if (!mine.length) { strip.innerHTML = ''; return; }
  document.getElementById('upCount').textContent = mine.length;
  const keep = strip.scrollLeft;
  strip.innerHTML = mine.map((c) => `
    <a class="upcard k-${c.kind}" href="${c.href}">
      <canvas class="preview" data-i="${cards.indexOf(c)}" width="320" height="200" aria-hidden="true"></canvas>
      <span class="upbody">
        <span class="row between" style="gap:6px"><strong>${KIND_ICON[c.kind]} ${KIND_NAME[c.kind]}</strong>${c.extra}</span>
        <span class="small">${c.vs}</span>
        <span class="muted small">${c.sub}</span>
        ${c.kind !== 'gauntlet' && c.g.players.length > 1 ? `<span class="small clk">${chaosIn(c.g.turn_at, c.g.gauntlet_id)}</span>` : ''}
        <span class="upgo">${c.pill.includes('Place') ? 'Place ships' : 'Play'} ›</span>
      </span>
    </a>`).join('');
  strip.scrollLeft = keep;
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
      const X = g.tank_x || TANK_X, tx = X[p] * sx, ty = top[X[p]] * sy;
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
    <ul class="chaosfeed">${feed.map((e, i) => `<li class="${e.seen_at ? '' : 'new'}" ${i >= 3 && !feedOpen ? 'hidden' : ''}><span class="big">${e.icon}</span><span>${esc(e.message)}<br><span class="muted small">${new Date(e.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></span></li>`).join('')}</ul>`;
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
      <div class="statshead"><a href="#">← Game Room</a><h1>🏅 Family scoreboard</h1><p class="muted" id="since">All-time</p></div>
      <div id="statsBody" class="stack" style="gap:18px"><p class="muted">Counting…</p></div>
    </div>`);
  const { data, error } = await sb.rpc('family_stats');
  const body = document.getElementById('statsBody');
  if (!body) return;
  if (error) { body.innerHTML = `<p class="error">Couldn't load the scoreboard: ${esc(friendly(error))}</p>`; return; }
  const ps = data.players || [];
  const who = (p) => `${p.bot ? '🤖 ' : ''}${p.id === me.id ? 'You' : esc(p.username)}`;
  if (data.since) document.getElementById('since').textContent = `All-time, since ${new Date(data.since).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}`;
  if (!ps.some((p) => p.played || p.gauntlets || p.holes)) { body.innerHTML = '<p class="muted">No finished games yet. The board fills up as you play.</p>'; return; }
  const pct = (w, n) => (n ? `${Math.round((w / n) * 100)}%` : '–');
  const medal = ['🥇', '🥈', '🥉'];
  const ranked = ps.filter((p) => p.played || p.gauntlets);
  const cards = ranked.map((p, i) => `
    <a class="scard ${p.id === me.id ? 'me' : ''}" href="#player=${p.id}">
      <div class="row between"><strong class="sname">${medal[i] || ''} ${p.bot ? '' : avatar(p, 'mini')} ${who(p)}</strong>${p.streak >= 2 ? `<span class="streak">🔥 ${p.streak} in a row</span>` : ''}</div>
      <div class="sbig"><span><b>${p.titles}</b> 👑 Gauntlet${p.titles === 1 ? '' : 's'}</span><span><b>${p.won}</b>–${p.played - p.won} <small>${pct(p.won, p.played)}</small></span></div>
      <div class="skinds">${['battleship', 'golf', 'duel'].map((k) => `<span>${KIND_ICON[k]} ${p.by_kind[k].won}/${p.by_kind[k].played}</span>`).join('')}<span>🏁 ${p.rounds_won} round${p.rounds_won === 1 ? '' : 's'}</span><span class="sgo">🏆 Trophies ›</span></div>
    </a>`).join('');
  const award = (icon, label, key, fmt = (v) => v) => {
    const top = Math.max(0, ...ps.map((p) => p[key] || 0));
    if (!top) return '';
    return `<li><span class="big">${icon}</span><span><strong>${label}</strong><br><span class="muted small">${ps.filter((p) => (p[key] || 0) === top).map(who).join(' & ')} · ${fmt(top)}</span></span></li>`;
  };
  const awards = [
    award('👑', 'Gauntlet champion', 'titles', (v) => `${v} title${v === 1 ? '' : 's'}`),
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
    ['👑 Gauntlet titles', 'titles'], ['🏁 Gauntlet rounds won', 'rounds_won'], ['🏆 Games won', 'won'], ['🎮 Games played', 'played'],
    ['⚓ Ships sunk', 'sunk'], ['⚓ Hit rate', (p) => pct(p.hits, p.bs_shots)], ['⛳ Holes in one', 'hio'], ['⛳ Holes under par', 'under_par'],
    ['⛳ Strokes vs par', (p) => (p.holes ? (p.to_par > 0 ? `+${p.to_par}` : p.to_par === 0 ? 'E' : p.to_par) : '–')],
    ['💥 K.O.s', 'kos'], ['💥 Direct hits', 'direct_hits'], ['🦊 Cheats got away with', 'sneaky'], ['🔍 Cheaters caught', 'catches'], ['🚨 Times busted', 'busted'],
  ];
  const cols = ps.filter((p) => p.played || p.gauntlets || p.holes);
  const table = `<div class="stable-wrap"><table class="stable"><thead><tr><th></th>${cols.map((p) => `<th>${who(p)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(([label, k]) => `<tr><th>${label}</th>${cols.map((p) => `<td>${typeof k === 'function' ? k(p) : p[k]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  body.innerHTML = `
    <section class="stack" style="gap:10px"><h2>Standings</h2><div class="scards">${cards}</div></section>
    ${awards ? `<section class="card"><h2>🏛️ Hall of fame</h2><ul class="pack">${awards}</ul></section>` : ''}
    ${h2h ? `<section class="card"><h2>⚔️ Head to head</h2><ul class="h2h">${h2h}</ul><p class="muted small">One-on-one games, Gauntlet rounds included.</p></section>` : ''}
    <section class="card"><h2>📊 Every stat</h2>${table}</section>`;
}

// ---------------------------------------------------------------- a player's trophy case (#player=<id>)
// The shelf holds a cup for every Gauntlet title; badges light up as the numbers are reached
// (all from player_trophies, over the results log that outlives deleted games).
const BADGES = [
  ['🩸', 'First blood', 'Win your first game', (c) => c.won, 1],
  ['🎩', 'Hat trick', 'Win 3 games in a row', (c) => c.best_streak, 3],
  ['🔥', 'On fire', 'Win 5 games in a row', (c) => c.best_streak, 5],
  ['👑', 'Champion', 'Win a Gauntlet', (c) => c.titles, 1],
  ['💎', 'Flawless', 'Win a Gauntlet without dropping a round', (c, t) => t.filter((x) => x.perfect).length, 1],
  ['🏰', 'Dynasty', 'Win 5 Gauntlets', (c) => c.titles, 5],
  ['🏃', 'Grinder', 'Play 10 Gauntlets', (c) => c.gauntlets, 10],
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
    : `<div class="trophy empty"><span class="cup" aria-hidden="true">🏆</span><span class="tvs">${mine ? 'Win a Gauntlet to put a trophy here' : 'No Gauntlet titles yet'}</span></div>`;
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
  setChannel(sb.channel(`game-${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${id}` }, refresh)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'shots', filter: `game_id=eq.${id}` }, refresh)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'accusations', filter: `game_id=eq.${id}` }, refresh)
    .subscribe((s) => { const l = document.getElementById('live'); if (l) l.classList.toggle('off', s !== 'SUBSCRIBED'); }));
  renderGame();
  upNext();
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
  G.gtHTML = G.game.gauntlet_id ? await gauntletBar(G.game.gauntlet_id, G.game.id, me.id, (p) => (bots.has(p) ? '🤖 ' : '') + (names[p] ?? 'someone')) : '';
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
  if (shotsOpen === null) shotsOpen = !isPhone();   // folded on phones until opened, and remembered while you play
  return `<details class="card mfold" id="feedFold" ${shotsOpen ? 'open' : ''}><summary><h2>Latest shots</h2></summary><ul class="feed">${items}</ul></details>`;
}

// Switch a phone to one board without redrawing (the tabs; also used so a shot is always seen landing).
function showBoard(owner) {
  if (!owner) return;
  boardTab = owner;
  app.querySelectorAll('.bsec').forEach((el) => el.classList.toggle('tab-on', el.dataset.owner === owner));
  app.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === owner)));
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
    // Which board a phone shows: your target on your turn, your fleet otherwise, until you pick one.
    const tabState = `${game.move}|${myTurn}`;
    if (boardTabFor !== tabState || ![...opponents, me.id].includes(boardTab)) {
      boardTabFor = tabState;
      boardTab = myTurn ? (aims.target || opponents.find((p) => !game.eliminated.includes(p)) || opponents[0]) : me.id;
    }
    const left = (p) => MODES[game.mode].ships.length - new Set(G.shots.filter((s) => s.target === p && s.sunk_ship != null).map((s) => s.sunk_ship)).size;
    const tabs = `<div class="boardtabs" role="tablist" aria-label="Boards">${opponents.map((p) => `<button type="button" role="tab" data-tab="${p}" aria-selected="${boardTab === p}">🎯 ${nm(p)} <small>${left(p)} left</small></button>`).join('')}<button type="button" role="tab" data-tab="${me.id}" aria-selected="${boardTab === me.id}">🚢 Your fleet <small>${left(me.id)} left</small></button></div>`;
    const targets = opponents.map((p) => {
      const out = game.eliminated.includes(p);
      const cls = ['card', 'bsec'];
      if (boardTab === p) cls.push('tab-on');
      if (aims.target === p) cls.push('target-active');
      if (out) cls.push('eliminated');
      return `<section class="${cls.join(' ')}" data-owner="${p}">
        <div class="row between"><h2>${nm(p)}'s waters</h2>${out ? '<span class="pill out">Sunk</span>' : ''}</div>
        ${boardHTML({ owner: p, ships: over ? G.fleets[p] : null, clickable: myTurn && !out, fresh: true })}
        ${fleetListHTML(p)}
      </section>`;
    }).join('');
    body = `${callOutHTML()}${sonarLoot && myTurn ? '<p class="status noteline">📡 Tap a square on an opponent\'s board to ping the 3×3 patch around it.</p>' : ''}${peekMode && myTurn ? '<p class="status noteline">👀 Tap a square on an opponent\'s board to peek.</p>' : ''}
      ${tabs}
      <div class="boards">${targets}
        <section class="card bsec ${boardTab === me.id ? 'tab-on' : ''}" data-owner="${me.id}"><div class="row between"><h2>Your fleet</h2>${imOut ? '<span class="pill out">Sunk</span>' : ''}</div>
          ${boardHTML({ owner: me.id, ships: G.fleets[me.id], fresh: true })}
          ${fleetListHTML(me.id)}
          <p class="muted small">Yellow outlines mark the latest shots.</p></section>
      </div>
      ${myTurn ? backpackBarHTML(G.pack || [], 'battleship', !busy) : ''}${over ? cheatLogHTML() : ''}${feedHTML()}
      ${legend}`;
  }

  const canDelete = game.created_by === me.id;
  view(`
    <header class="stack">
      <div class="row between"><button class="link" id="back">← All games</button><span class="row" style="gap:10px"><span class="live" id="live">Live</span>${fsButton('#app')}</span></div>
      <div id="gtbar">${G.gtHTML || ''}</div>
      <h1>${title}</h1>
      ${sub ? `<p class="muted gsub">${sub}</p>` : ''}
      ${playersStrip}
    </header>
    ${body}
    ${canDelete ? `<p><button class="link danger" id="del">Delete this game</button></p>` : ''}
    ${myTurn ? `<div class="firebar">
      <span class="aimwrap"><span class="aimdots" aria-hidden="true">${Array.from({ length: need }, (_, i) => `<i class="${i < aims.cells.size ? 'on' : ''}"></i>`).join('')}</span>
      <span id="aimtext">${aims.target ? (aims.cells.size === need ? `Ready: ${need} at ${nm(aims.target)}` : `Aimed ${aims.cells.size} of ${need}`) : `Tap ${need === 1 ? 'a square' : `${need} squares`} to aim`}</span></span>
      ${aims.cells.size ? '<button class="link" id="clearAim">Clear</button>' : ''}
      <span data-clockslot></span>
      <button class="fire ${aims.target && aims.cells.size === need && !busy ? 'ready' : ''}" id="fire" ${aims.target && aims.cells.size === need && !busy ? '' : 'disabled'}>Fire!</button><span class="error" id="fireerr" hidden></span></div>` : ''}`);
  document.body.classList.toggle('has-firebar', myTurn);
  if (myTurn && G.cheatsOn) rumour(BS_RUMOURS);
  // Shot clock: 45 seconds to fire (not when every opponent is the robot).
  if (myTurn && !busy && opponents.some((p) => !bots.has(p))) shotClock(`bs.${game.id}.${game.move}.${game.turn}`, 45, async () => {
    const { data } = await sb.rpc('shot_clock', { p_kind: 'battleship', p_game: game.id });
    if (data) splash(['TOO SLOW!', '⏱ SHOT CLOCK', data], { tone: 'red', sound: null, ms: 2000 });
    aims = { target: null, cells: new Set() };
    await loadGame(game.id); renderGame();
  });
  else stopShotClock();
  // Phones and full screen: instructions pop up once instead of taking up room on the page.
  const tipNow = sonarLoot && myTurn ? '📡 Tap a square on their board to ping the 3×3 around it.' : peekMode && myTurn ? '👀 Tap a square on their board to peek.' : myTurn || game.status === 'setup' ? sub.replace(/<[^>]+>/g, '') : '';
  const key = `${game.id}|${game.move}|${game.status}|${tipNow}`;
  if ((isPhone() || app.classList.contains('fs-on')) && key !== lastNoteKey && tipNow) note(tipNow);
  lastNoteKey = key;
  const ff = document.getElementById('feedFold'); if (ff) ff.addEventListener('toggle', () => { shotsOpen = ff.open; });
  const fb = app.querySelector('.firebar');   // keep the ▶ Next chip and 🔊 above it, whatever its height
  if (fb) document.documentElement.style.setProperty('--fbh', `${Math.ceil(fb.getBoundingClientRect().height)}px`);
  app.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => showBoard(b.dataset.tab); });
  const clr = document.getElementById('clearAim');
  if (clr) clr.onclick = () => { aims = { target: null, cells: new Set() }; renderGame(); };

  if (channel) { const l = document.getElementById('live'); l.classList.toggle('off', channel.state !== 'joined'); }
  fsRefresh();
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
    navigator.vibrate?.(8);
    renderGame();
  }));

  playEffects();

  const fire = document.getElementById('fire');
  if (fire) fire.onclick = async () => {
    busy = true; fire.disabled = true;
    const { error } = await sb.rpc('fire', { p_game: game.id, p_target: aims.target, p_cells: [...aims.cells] });
    busy = false;
    if (error) { const el = document.getElementById('fireerr'); el.hidden = false; el.textContent = friendly(error); if (isPhone()) note(friendly(error), 'error'); fire.disabled = false; return; }
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
function cheatError(e) { note(friendly(e), 'error'); }
// The cheats have no buttons (see CLAUDE.md for the gestures): hold a rival's square to peek,
// hold one of your own ships to sneak it away, triple-tap "Your turn" for an extra shot.
const canCheat = () => G && !busy && G.cheatsOn && G.game.status === 'playing' && G.game.players[G.game.turn] === me.id && !G.game.eliminated.includes(me.id);
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
      danger(false);
      if (game.winner === me.id) { splash(['FLEET DESTROYED', 'VICTORY', 'The seas are yours'], { ms: 2600 }); sfx('fanfare', { delay: 0.8 }); if (!reduceMotion) setTimeout(() => fx.fireworks(10), 900); }
      else { splash(['ALL SHIPS LOST', 'DEFEATED', `${nm(game.winner).replace(/<[^>]+>/g, '')} rules the waves`], { tone: 'red', ms: 2600 }); sfx('lose', { delay: 0.8 }); }
    } else if (G.prevStatus === 'setup' && game.status === 'playing') {
      banner(nowMine ? 'Battle stations! You fire first' : 'Battle stations!');
    } else if (nowMine && (G.prevTurnMine === false || fresh.some((s) => s.shooter !== me.id))) banner('Your turn');
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
