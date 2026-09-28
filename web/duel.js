// Hilltop Duel, live. The shooter's browser flies the shell; the server records where it
// landed and the damage, and the other player watches it replay.
import { sb, me, bots, signedIn, esc, nm, friendly, notify, ITEMS, backpack, useLoot, announceChaos, backpackBarHTML, sfx, liveGame, nudge, nextUpChip, names, gauntletBar, isPhone, note, noteMirror, splash, danger, shotClock, stopShotClock, chaosClock, dramaOn, face, jumpToNext } from './common.js';
import { W, H, TANK_X, CRATER_R, BERTHA_R, rng, buildTop, applyCrater, windFor, tankPos, simulate, damage } from './duel-engine.js';

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- state and drawing
let G = null;     // { game, shots }
let top = null, shot = null, particles = [], busy = false, pack = [];
let live = null;          // the live channel: send('aim' | 'shot', …) to the other player's page
let oppAim = null;        // { move, angle, power, x } streamed from the other player while they aim
// Tanks can drive a little each turn (40 px of fuel, own side only). myX is where I've driven to
// this turn before firing; it's sent with the shot.
let myX = null, myXMove = -1;
let botDrive = null;      // { move, x } while the robot rolls to its firing spot
// Dodging: while someone aims at you, you may shift up to 20 px (from where their turn began).
// dodgeX is my dodge this turn; oppDodge is the other player's, streamed live while I aim.
let dodgeX = null, dodgeMove = -1, oppDodge = null;
const DODGE = 20;
// Live battle: while both players have the duel open (each page checks in with duel_here every
// few seconds), there are no turns. Fire whenever the cannon has reloaded, drive anywhere on your
// side. Shells can be in the air at the same time (shells); `shot` is only a turn-based shell.
let liveOn = false, reloadAt = 0, liveMyX = null, oppLiveX = null, liveSave = null, seenHp = null, shells = [];
const RELOAD = 3000;
const FUEL = 40, SIDE = [[30, 330], [470, 770]];
const baseXs = () => G.game.tank_x || TANK_X;
function xs() {
  const t = [...baseXs()], g = G.game;
  if (g.status === 'playing' && liveOn) {
    const mi = myIdx();
    if (mi >= 0 && liveMyX != null) t[mi] = liveMyX;
    if (mi >= 0 && oppLiveX != null) t[1 - mi] = oppLiveX;
    return t;
  }
  if (g.status === 'playing') {
    if (turnId() === me.id && myXMove === g.move && myX != null) t[g.turn] = myX;
    else if (turnId() !== me.id && oppAim?.move === g.move && oppAim.x != null) t[g.turn] = oppAim.x;
    if (botDrive?.move === g.move) t[g.turn] = botDrive.x;
    const di = 1 - g.turn;   // the tank being aimed at
    if (turnId() !== me.id && myIdx() === di && dodgeMove === g.move && dodgeX != null) t[di] = dodgeX;
    if (turnId() === me.id && oppDodge?.move === g.move) t[di] = oppDodge.x;
  }
  return t;
}
const cv = $('cv'), ctx = cv.getContext('2d');
const stars = Array.from({ length: 90 }, (_, i) => { const r = rng(i * 7919 + 3); return { x: r() * W, y: r() * 240, s: r() * 1.4 + 0.3, t: r() * 6 }; });
const myIdx = () => G.game.players.indexOf(me.id);
const turnId = () => G.game.players[G.game.turn];
const isBot = (id) => bots.has(id);
const who = (id) => (id === me.id ? 'You' : nm(id));
const seenKey = () => `duel.seen.${G.game.id}`;
const seenMove = () => { try { return +(localStorage.getItem(seenKey()) || 0); } catch { return 0; } };
const markSeen = (m) => { try { if (m > seenMove()) localStorage.setItem(seenKey(), String(m)); } catch {} };

function draw(t) {
  if (!G || !top) return;
  const g = G.game, k = cv.width / W; ctx.setTransform(k, 0, 0, k, 0, 0);
  const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#1B1646'); sky.addColorStop(0.6, '#3B2A6E'); sky.addColorStop(1, '#7A3E72');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  stars.forEach((s) => { ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t / 900 + s.t); ctx.fillStyle = '#fff'; ctx.fillRect(s.x, s.y, s.s, s.s); }); ctx.globalAlpha = 1;
  const mg = ctx.createRadialGradient(610, 90, 10, 610, 90, 120); mg.addColorStop(0, '#FFF4D6'); mg.addColorStop(0.28, '#FFE3A3'); mg.addColorStop(0.3, '#FFC85733'); mg.addColorStop(1, '#FFC85700');
  ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(610, 90, 120, 0, 7); ctx.fill();
  ctx.fillStyle = '#2A2158'; ctx.beginPath(); ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 10) ctx.lineTo(x, 250 + Math.sin(x * 0.011 + g.seed) * 30 + Math.sin(x * 0.027) * 14);
  ctx.lineTo(W, H); ctx.fill();
  const tg = ctx.createLinearGradient(0, 170, 0, H); tg.addColorStop(0, '#3DD6C6'); tg.addColorStop(0.08, '#1F8C8A'); tg.addColorStop(1, '#0F2E3F');
  ctx.fillStyle = tg; ctx.beginPath(); ctx.moveTo(0, H); for (let x = 0; x < W; x++) ctx.lineTo(x, top[x]); ctx.lineTo(W, H); ctx.fill();
  ctx.strokeStyle = '#9BF5EA'; ctx.lineWidth = 2; ctx.beginPath(); for (let x = 0; x < W; x++) ctx[x ? 'lineTo' : 'moveTo'](x, top[x]); ctx.stroke();
  const X = shot?.xs || xs();
  [0, 1].forEach((p) => {
    const { x, y } = tankPos(p, top, X), col = p ? '#3DD6C6' : '#FF6B5A', dir = p ? -1 : 1;
    const aiming = g.status === 'playing' && (liveOn || (!shot && g.turn === p));
    const ang = aiming && p === myIdx() ? +$('angle').value : aiming && oppAim && (liveOn || oppAim.move === g.move) ? oppAim.angle : (shot && shot.p === p ? shot.angle : 45);
    ctx.save(); ctx.translate(x, y); if (g.hp[p] <= 0) ctx.globalAlpha = 0.45;
    ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(Math.cos((ang * Math.PI) / 180) * 20 * dir, -14 - Math.sin((ang * Math.PI) / 180) * 20); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, -12, 8, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.roundRect(-16, -10, 32, 10, 4); ctx.fill();
    ctx.fillStyle = '#0008'; for (let i = -12; i <= 12; i += 8) { ctx.beginPath(); ctx.arc(i, 0, 3, 0, 7); ctx.fill(); }
    ctx.restore();
    if (aiming && !liveOn) { ctx.fillStyle = col; const bob = Math.sin(t / 250) * 3; ctx.beginPath(); ctx.moveTo(x - 6, y - 44 + bob); ctx.lineTo(x + 6, y - 44 + bob); ctx.lineTo(x, y - 36 + bob); ctx.fill(); }
  });
  if (canAim()) {
    if (drag) {
      const tp = tankPos(myIdx(), top, X);
      ctx.strokeStyle = '#FFF4D688'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(tp.x, tp.y - 14); ctx.lineTo(drag.x, drag.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#FFC85755'; ctx.beginPath(); ctx.arc(drag.x, drag.y, 16, 0, 7); ctx.fill();
    }
    drawHint(t);
  }
  shells.forEach((sh) => {
    const n = sh.i, pts = sh.path;
    for (let j = Math.max(0, n - 40); j < n; j++) { ctx.globalAlpha = (j - (n - 40)) / 40; ctx.fillStyle = '#FFC857'; ctx.beginPath(); ctx.arc(pts[j].x, pts[j].y, 2, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
    if (n < pts.length) { const q = pts[n]; ctx.shadowColor = '#FFC857'; ctx.shadowBlur = 18; ctx.fillStyle = '#FFF4D6'; ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, 7); ctx.fill(); ctx.shadowBlur = 0; }
  });
  particles.forEach((q) => { ctx.globalAlpha = Math.max(0, q.life); ctx.fillStyle = q.c; ctx.beginPath(); ctx.arc(q.x, q.y, q.s, 0, 7); ctx.fill(); });
  ctx.globalAlpha = 1;
}
// Aim hint: a rough guide, not a solution. Each turn it carries a small hidden error (a few
// degrees and a bit of power, different every turn), it wobbles a little even in calm air, sways
// with the wind, and only shows the first 65% of the flight. Reduced motion: a still band.
const hintCache = new Map();
function hintPath(angle, power, windX) {
  const g = G.game, X = xs(), key = `${g.move}|${X[myIdx()]}|${angle.toFixed(1)}|${power.toFixed(1)}|${windX.toFixed(2)}`;
  if (!hintCache.has(key)) {
    if (hintCache.size > 300) hintCache.clear();
    const { path } = simulate(g.seed, g.move, top, myIdx(), angle, power, windX, X);
    hintCache.set(key, path.slice(0, Math.ceil(path.length * 0.65)));
  }
  return hintCache.get(key);
}
function drawDots(pts, alpha, t, still) {
  const n = pts.length, drift = still ? 0 : (t / 60) % 6;
  for (let j = Math.floor(drift) % 6; j < n; j += 6) {
    const q = pts[j], f = 1 - j / n;
    ctx.globalAlpha = alpha * (0.15 + 0.85 * f * f); ctx.fillStyle = '#FFC857'; ctx.shadowColor = '#FFC857'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(q.x, Math.max(4, q.y), 2.2 + 2 * f, 0, 7); ctx.fill();
  }
}
function drawHint(t) {
  const g = G.game, base = g.gust === g.move ? 3 : 1, windy = windFor(g.seed, g.move, base) !== 0;
  const r = rng(g.seed * 7919 + g.move * 131 + 17), aBias = (r() * 2 - 1) * 3.5, pBias = (r() * 2 - 1) * 6;   // this turn's hidden error
  const q = (v, s) => Math.round(v / s) * s;
  const A = (w) => Math.max(5, Math.min(85, q(+$('angle').value + aBias + w, 0.5))), P = (w) => Math.max(20, Math.min(100, q(+$('power').value + pBias + w, 0.5)));
  if (reduceMotion) {
    drawDots(hintPath(A(-1.5), P(-2), windy ? base * 0.6 : base), 0.55, t, true);
    drawDots(hintPath(A(1.5), P(2), windy ? base * 1.4 : base), 0.55, t, true);
  } else {
    const gust = windy ? 1 + 0.3 * Math.sin(t / 700) + 0.15 * Math.sin(t / 260 + 1.3) : 1;
    drawDots(hintPath(A(1.4 * Math.sin(t / 900)), P(2 * Math.sin(t / 640 + 1)), Math.round(base * gust * 50) / 50), 1, t, false);
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}
function loop(t) { particles.forEach((q) => { q.x += q.vx; q.y += q.vy; q.vy += 0.12; q.life -= 0.018; }); particles = particles.filter((q) => q.life > 0); draw(t); requestAnimationFrame(loop); }
function boom(x, y, big = 1) {
  sfx('boom', { size: big });
  navigator.vibrate?.(Math.round(60 * big));
  const cols = ['#FFF4D6', '#FFC857', '#FF6B5A', '#B79CFF'];
  for (let i = 0; i < 70 * big; i++) { const a = Math.random() * 6.28, v = Math.random() * 5 * big + 1; particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, life: 1, s: Math.random() * 3 + 1, c: cols[i % 4] }); }
}
// A hit: small ones get a number, big ones a flash and DIRECT HIT!; a knockout waits for the K.O. screen.
function hitDrama(before, after) {
  if (after.some((h) => h <= 0)) return;
  const mi = myIdx(), drops = [0, 1].map((p) => before[p] - after[p]), big = Math.max(...drops);
  if (big <= 0) return;
  if (big >= 25) {
    stamp('DIRECT<br>HIT!', drops[mi] === big ? 'red' : '', 1600); sfx('flash', { delay: 0.05 });
    navigator.vibrate?.([60, 40, 140]);
    if (!reduceMotion) { const f = document.createElement('div'); f.style.cssText = 'position:fixed;inset:0;z-index:58;background:#fff;pointer-events:none;opacity:.85;transition:opacity .35s'; document.body.appendChild(f); requestAnimationFrame(() => { f.style.opacity = '0'; }); setTimeout(() => f.remove(), 400); }
  } else if (drops[mi] > 0) stamp(`−${drops[mi]}`, 'red', 1400);
  else stamp(`Hit! −${big}`, '', 1400);
}
// The end: a K.O. screen the first time you see it, then just the result panel.
function endDrama(g) {
  danger(false);
  const key = `drama.end.${g.id}`; let seen = false;
  try { seen = !!localStorage.getItem(key); localStorage.setItem(key, '1'); } catch {}
  if (seen) return;
  const won = g.winner === me.id;
  splash(['K.O.!', won ? 'VICTORY' : 'DEFEATED', won ? 'You hold the hill' : `${nm(g.winner).replace(/<[^>]+>/g, '')} takes the hill`], { tone: won ? 'gold' : 'red', ms: 2800 });
  sfx(won ? 'fanfare' : 'lose', { delay: 0.9 });
  jumpToNext(g, me.id, (p) => (bots.has(p) ? '🤖 ' : '') + (names[p] ?? G?.names?.[p] ?? 'someone'), 3200);
}
function stamp(text, tone = '', ms = 2400) { const el = document.createElement('div'); el.className = `stamp ${tone}`; el.innerHTML = `<span>${text}</span>`; document.body.appendChild(el); setTimeout(() => el.remove(), ms); }

// Flies a shell along its path, then blows up where the server says it landed.
function flyShell(p, angle, power, beforeCraters, move, crater, windX = 1, X = xs()) {
  return new Promise((done) => {
    if (!liveOn) top = buildTop(G.game.seed, beforeCraters);   // live: the ground is already current
    const sim = simulate(G.game.seed, move, top, p, angle, power, windX, X);
    const s = { p, angle, path: sim.path, xs: X, i: reduceMotion ? sim.path.length : 0 };
    shells.push(s); if (!liveOn) shot = s;
    sfx('cannon'); if (!reduceMotion) sfx('whistle', { delay: 0.15, dur: Math.max(0.3, sim.path.length / 3 / 60 - 0.15) });
    const step = () => {
      // Slow motion as the shell closes in on a tank.
      const q = s.path[Math.min(s.i, s.path.length - 1)], near = !reduceMotion && dramaOn() && [0, 1].some((t) => { const k = tankPos(t, top, X); return Math.hypot(q.x - k.x, q.y - (k.y - 8)) < 90; });
      s.i = Math.min(s.path.length, s.i + (near ? 1 : 3));
      if (s.i < s.path.length) return requestAnimationFrame(step);
      shells = shells.filter((x) => x !== s); if (shot === s) shot = null;
      if (crater) { boom(crater[0], crater[1]); if (!reduceMotion && cv.animate) cv.animate([{ transform: 'translate(-6px,3px)' }, { transform: 'translate(5px,-3px)' }, { transform: 'none' }], { duration: 350 }); }
      done(sim);
    };
    requestAnimationFrame(step);
  });
}

// ---------------------------------------------------------------- screen
function render() {
  const g = G.game, mi = myIdx();
  top = top || buildTop(g.seed, g.craters);
  const tag = (p) => (g.shields.includes(p) ? ' 🛡️' : '') + (g.bertha.includes(p) ? ' 💣' : '');
  // Face, name (the part that gives way on a narrow screen, with …), then the HP, which always shows.
  const label = (p) => `${face(g.players[p])}<span class="nm">${who(g.players[p])}</span><span>&nbsp;· ${g.hp[p]}${tag(g.players[p])}</span>`;
  $('n0').innerHTML = `<span style="color:var(--coral)">●&nbsp;</span>${label(0)}`;
  $('n1').innerHTML = `${label(1)}<span style="color:var(--teal)">&nbsp;●</span>`;
  $('hp0').style.width = g.hp[0] + '%'; $('hp1').style.width = g.hp[1] + '%';
  const gusty = g.gust === g.move, w = windFor(g.seed, g.move, gusty ? 3 : 1);
  $('wind').textContent = (gusty ? '🌪️ ' : '') + (w === 0 ? 'No wind' : `Wind ${w < 0 ? '←' : '→'} ${Math.abs(w)}${gusty ? ' (hurricane!)' : ''}`);
  const over = g.status === 'over', liveNow = liveOn && !over && mi >= 0, mine = !over && (liveNow || turnId() === me.id);
  $('title').innerHTML = over ? (g.winner === me.id ? 'You win!' : `${nm(g.winner)} wins!`) : liveNow ? '⚔️ Live battle' : mine ? 'Your shot' : `${nm(turnId())}'s shot`;
  $('status').textContent = over ? '' : liveNow ? 'Fire at will!' : mine ? `Move ${g.move + 1}` : busy ? '' : 'Waiting…';
  $('controls').hidden = !mine || (busy && !liveNow);
  if (mine) showFuel();
  // Dodge row: on their turn, against a person (the robot fires too fast to dodge). Live: just drive.
  $('dodge').hidden = !(g.status === 'playing' && !mine && mi >= 0 && !busy && !isBot(turnId()));
  if (!$('dodge').hidden) showDodge();
  // Shot clock: 30 seconds to fire (not against the robot, where nobody is waiting on you).
  if (mine && !liveNow && !busy && !g.players.some(isBot)) shotClock(`duel.${g.id}.${g.move}`, 30, async () => {
    const { data } = await sb.rpc('shot_clock', { p_kind: 'duel', p_game: g.id });
    if (data) splash(['TOO SLOW!', '⏱ SHOT CLOCK', data], { tone: 'red', sound: null, ms: 2000 });
    await load(g.id); render();
  });
  else stopShotClock();
  danger(g.status === 'playing' && mi >= 0 && g.hp[mi] > 0 && g.hp[mi] <= 25);   // nearly out: red pulse and a heartbeat
  if (mine && !busy && isPhone()) { try { if (!sessionStorage.getItem('duel.tip')) { sessionStorage.setItem('duel.tip', '1'); note('Drag on the battlefield to aim: direction sets the angle, distance the power.'); } } catch {} }
  cv.style.touchAction = canAim() ? 'none' : 'manipulation';   // dragging aims on your turn instead of scrolling
  cv.style.cursor = canAim() ? 'crosshair' : '';
  $('pack').innerHTML = over ? '' : backpackBarHTML(pack, 'duel', !busy);
  $('pack').querySelectorAll('[data-loot]').forEach((b) => {
    const item = b.dataset.item;
    if ((item === 'bertha' && (!mine || g.bertha.includes(me.id))) || (item === 'shield' && g.shields.includes(me.id))) b.disabled = true;
    b.onclick = async () => {
      b.disabled = true;
      const { error } = await useLoot(+b.dataset.loot, g.id);
      if (error) { $('err').textContent = friendly(error); return; }
      stamp(`${ITEMS[item].icon} ${ITEMS[item].name}!`, '', 1500); sfx('pop');
      pack = await backpack(); await load(g.id); render();
    };
  });
  $('del').hidden = g.created_by !== me.id;
  $('feed').innerHTML = [...G.shots].reverse().slice(0, 6).map((s) => {
    const before = s.move > 1 ? G.shots.find((x) => x.move === s.move - 1)?.hp_after || [100, 100] : [100, 100];
    const hurt = [0, 1].map((p) => before[p] - s.hp_after[p]).map((d, p) => (d ? `${who(g.players[p])} −${d}` : '')).filter(Boolean).join(', ');
    return `<li><strong>${who(s.shooter)}</strong> fired at ${s.angle}°, power ${s.power}: ${s.crater ? hurt || 'a miss, but a nice crater' : 'the shell flew off the map'}.</li>`;
  }).join('') || '<li class="muted">No shots yet.</li>';
  if (over) {
    $('endPanel').hidden = false;
    const opp = g.players[1 - mi];
    $('endPanel').innerHTML = `<h2>${g.winner === me.id ? '🏆 Victory!' : `${nm(g.winner)} took the hill`}</h2><p class="muted">${g.move} shots fired.</p>
      <div class="row"><button class="go" id="rematch">Rematch</button><a href="./">Back to all games</a></div><p class="small" id="rmErr"></p>`;
    $('rematch').onclick = async () => {
      const { data, error } = await sb.rpc('duel_create', { p_opponent: G.names[opp] ?? '', p_bot_level: g.bot_level });
      if (error) { $('rmErr').textContent = friendly(error); return; }
      notify('duel', data); location.hash = `game=${data}`; location.reload();
    };
  }
}

async function load(id) {
  const [g, s] = await Promise.all([
    sb.from('duel_games').select('*').eq('id', id).maybeSingle(),
    sb.from('duel_shots').select('*').eq('game_id', id).order('move'),
  ]);
  if (!g.data) return false;
  const { data: prof } = await sb.from('profiles').select('id, username').in('id', g.data.players);
  G = { game: g.data, shots: s.data ?? [], names: Object.fromEntries((prof ?? []).map((p) => [p.id, p.username])) };
  if (G.game.gauntlet_id) gauntletBar(G.game.gauntlet_id, G.game.id, me.id, (p) => G.names[p] ?? names[p] ?? 'someone');
  return true;
}

async function decide() {
  if (busy) return;
  const g = G.game, last = G.shots[G.shots.length - 1];
  // Live: shells were already flown as they were fired; just show what they did.
  if (liveOn && last) {
    if (last.shooter !== me.id && seenHp && g.hp.some((h, k) => h < seenHp[k])) hitDrama(seenHp, g.hp);
    markSeen(last.move);
  }
  seenHp = [...g.hp];
  // Watch the last shot if it's new to you.
  if (last && last.shooter !== me.id && last.move > seenMove()) {
    busy = true; render();
    const before = g.craters.slice(0, g.craters.length - (last.crater ? 1 : 0));
    const lp = g.players.indexOf(last.shooter), LX = [...baseXs()]; if (last.from_x != null) LX[lp] = last.from_x; if (last.target_x != null) LX[1 - lp] = last.target_x;
    await flyShell(lp, last.angle, last.power, before, last.wind_move ?? last.move - 1, last.crater, last.wind_x || 1, LX);
    markSeen(last.move); top = buildTop(g.seed, g.craters); busy = false;
    hitDrama(G.shots[G.shots.length - 2]?.hp_after || [100, 100], last.hp_after);
  }
  top = buildTop(g.seed, g.craters);
  render();
  if (g.status === 'over') { if (liveOn) setLive(false); endDrama(g); return; }
  const cur = turnId();
  if (isBot(cur)) {
    const stale = Date.now() - new Date(g.updated_at).getTime() > 15000;
    if ((last && last.shooter === me.id) || stale) return robotShot();
  }
}

async function fire() {
  const g = G.game, p = myIdx(), angle = +$('angle').value, power = +$('power').value, move = g.move, X = xs();
  const moved = X[p] !== baseXs()[p] ? X[p] : null;
  busy = true; drag = null; render();
  navigator.vibrate?.(40);
  live?.send('shot', { move, angle, power, x: X[p], tx: X[1 - p] });
  const big = g.bertha.includes(me.id);
  const sim = await flyShell(p, angle, power, g.craters, move, null, g.gust === move ? 3 : 1, X);
  const crater = sim.impact ? [Math.round(sim.impact.x), Math.round(sim.impact.y), big ? BERTHA_R : CRATER_R] : null;
  if (crater) boom(crater[0], crater[1], big ? 2 : 1);
  const hp = damage(top, sim.impact, g.hp, big, g.players.map((x) => g.shields.includes(x) && x !== me.id), X);
  const { error } = await sb.rpc('duel_fire', { p_game: g.id, p_angle: angle, p_power: power, p_crater: crater, p_hp: hp, p_target_x: X[1 - p], ...(moved != null ? { p_x: moved } : {}) });
  busy = false; myX = null;
  if (error) { $('err').textContent = friendly(error); render(); return; }
  announceChaos({ gameId: g.id }); pack = await backpack();
  hitDrama(g.hp, hp);
  markSeen(move + 1);
  notify('duel', g.id);
  await sleep(600);
  await load(g.id); decide();
}

// The other player just pulled the trigger: fly their shell here right away, the same way
// their page does, instead of waiting for the database to catch up.
async function watchLiveShot({ move, angle, power, x, tx, live: isLive, wx }, refresh) {
  if (isLive) return watchShellLive({ angle, power, x, move, wx });
  const g = G?.game;
  if (!g || busy || g.status !== 'playing' || move !== g.move || turnId() === me.id) return;
  const p = g.turn, shooter = g.players[p], big = g.bertha.includes(shooter), mi = myIdx(), hpBefore = g.hp[mi];
  busy = true; oppAim = { move, angle, power, x }; render();
  const WX = [...baseXs()]; if (x != null) WX[p] = x; if (tx != null) WX[1 - p] = tx;
  dodgeX = null;   // their shell is already in the air
  const sim = await flyShell(p, angle, power, g.craters, move, null, g.gust === move ? 3 : 1, WX);
  if (sim.impact) boom(Math.round(sim.impact.x), Math.round(sim.impact.y), big ? 2 : 1);
  markSeen(move + 1); oppAim = null;
  // Wait for their shot to land in the database, then show where things stand.
  for (let i = 0; i < 8 && G.game.move === move; i++) { await sleep(500); await load(g.id); }
  busy = false;
  if (G.game.move === move) return refresh();   // still not saved; the regular checks will pick it up
  top = buildTop(G.game.seed, G.game.craters);
  hitDrama(g.hp, G.game.hp);
  pack = await backpack(); announceChaos({ gameId: g.id });
  decide();
}

// ---------------------------------------------------------------- live battle
async function fireLive() {
  const g = G?.game, p = G ? myIdx() : -1;
  if (!g || p < 0 || !liveOn || g.status !== 'playing' || Date.now() < reloadAt) return;
  reloadAt = Date.now() + RELOAD; showReload();
  const angle = +$('angle').value, power = +$('power').value, move = g.move, windX = g.gust === move ? 3 : 1, X = xs();
  navigator.vibrate?.(40); drag = null;
  live?.send('shot', { live: true, move, angle, power, x: X[p], wx: windX });
  const big = g.bertha.includes(me.id);
  const sim = await flyShell(p, angle, power, g.craters, move, null, windX, X);
  // Damage is worked out where the tanks stand when it lands (they may have driven meanwhile).
  const now = G.game, Xi = xs(), crater = sim.impact ? [Math.round(sim.impact.x), Math.round(sim.impact.y), big ? BERTHA_R : CRATER_R] : null;
  const hp = damage(top, sim.impact, now.hp, big, now.players.map((x) => now.shields.includes(x) && x !== me.id), Xi);
  if (crater) { boom(crater[0], crater[1], big ? 2 : 1); applyCrater(top, crater); }
  const { error } = await sb.rpc('duel_fire_live', { p_game: g.id, p_angle: angle, p_power: power, p_crater: crater,
    p_dmg: [0, 1].map((k) => now.hp[k] - hp[k]), p_x: X[p] !== baseXs()[p] ? X[p] : null, p_target_x: Xi[1 - p], p_wind_move: move, p_wind_x: windX });
  if (error) { note(friendly(error), 'error'); if (/live battle is over/i.test(error.message || '')) setLive(false); }
  else { hitDrama(now.hp, hp); seenHp = hp; nudge(); announceChaos({ gameId: g.id }); pack = await backpack(); }
  await load(g.id); decide();
}
// Their live shell: fly it here as it's fired. The damage arrives with the next refresh.
async function watchShellLive({ angle, power, x, move, wx }) {
  const g = G?.game, mi = G ? myIdx() : -1;
  if (!g || !liveOn || mi < 0 || g.status !== 'playing') return;
  const p = 1 - mi, big = g.bertha.includes(g.players[p]), X = xs(); if (x != null) X[p] = x;
  oppAim = { ...(oppAim || {}), angle, power, x };
  const sim = await flyShell(p, angle, power, g.craters, move ?? g.move, null, wx || 1, X);
  if (sim.impact) { const c = [Math.round(sim.impact.x), Math.round(sim.impact.y), big ? BERTHA_R : CRATER_R]; boom(c[0], c[1], big ? 2 : 1); applyCrater(top, c); }
}
function showReload() {
  const b = $('fire'), left = reloadAt - Date.now();
  if (liveOn && left > 0) { b.disabled = true; b.textContent = `Reloading… ${(left / 1000).toFixed(1)}`; setTimeout(showReload, 100); }
  else { b.disabled = false; b.textContent = 'Fire!'; }
}
// Check in with the server; it says whether you're both here.
async function here(on = true) {
  const g = G?.game;
  if (!g || myIdx() < 0) return;
  if (g.status !== 'playing' || g.players.some(isBot)) { if (liveOn) setLive(false); return; }
  const { data, error } = await sb.rpc('duel_here', { p_game: g.id, p_on: on });
  if (on && !error) setLive(!!data);
}
function setLive(v) {
  if (v === liveOn) return;
  liveOn = v; liveMyX = oppLiveX = null; oppAim = null; myX = null; dodgeX = null; drag = null;
  hintCache.clear();
  if (v) {
    live?.send('here', {});
    stopShotClock();
    splash(['⚔️ LIVE BATTLE', "You're both here", 'No turns. Fire at will!'], { tone: 'red', ms: 2200 });
  } else {
    reloadAt = 0; showReload();
    if (G?.game.status === 'playing') note('Live battle over: back to taking turns.');
  }
  if (G) { top = buildTop(G.game.seed, G.game.craters); render(); }
}

// The robot tries every angle and power, keeps the one that lands closest, then wobbles it by skill.
async function robotShot() {
  busy = true; render();
  const g = G.game, p = g.turn, windX = g.gust === g.move ? 3 : 1;
  // The robot drives too: it scouts spots within its fuel with a quick coarse search, takes the
  // one with the best shot (Rookie drives more at random), and never just sits still.
  $('status').textContent = `${nm(g.players[p]).replace(/<[^>]+>/g, '')} is sizing you up…`;
  await sleep(reduceMotion ? 0 : 400);
  const start = baseXs()[p], [lo, hi] = SIDE[p];
  const spots = [-40, -30, -20, -10, 0, 10, 20, 30, 40].map((d) => start + d).filter((x) => x >= lo && x <= hi);
  const coarse = (X) => { const tg = tankPos(1 - p, top, X); let b = 999;
    for (let a = 10; a <= 85; a += 3) for (let pw = 20; pw <= 100; pw += 4) {
      const sim = simulate(g.seed, g.move, top, p, a, pw, windX, X);
      if (sim.impact) b = Math.min(b, Math.hypot(sim.impact.x - tg.x, sim.impact.y - tg.y));
    } return b; };
  // Pro and Ace also dodge: they'd rather not stand where your last shell landed.
  const theirs = [...G.shots].reverse().find((s) => s.shooter !== g.players[p] && s.crater);
  const dodge = (x) => (g.bot_level > 0 && theirs ? 0.35 * Math.min(90, Math.abs(x - theirs.crater[0])) : 0);
  const scored = spots.map((x) => { const X = [...baseXs()]; X[p] = x; return { x, d: coarse(X) - dodge(x) + Math.random() * (g.bot_level === 0 ? 60 : 8) }; }).sort((u, v) => u.d - v.d);
  let goal = scored[0].x;
  if (goal === start) goal = Math.max(lo, Math.min(hi, start + (Math.random() < 0.5 ? -1 : 1) * (6 + Math.round(Math.random() * 10))));
  $('status').textContent = `${nm(g.players[p]).replace(/<[^>]+>/g, '')} is on the move…`;
  botDrive = { move: g.move, x: start };
  if (reduceMotion) botDrive.x = goal;
  else while (botDrive.x !== goal) { botDrive.x += Math.sign(goal - botDrive.x) * Math.min(2, Math.abs(goal - botDrive.x)); if (botDrive.x % 8 === 0) sfx('tick'); await sleep(60); }
  await sleep(reduceMotion ? 0 : 250);
  const X = xs(), target = tankPos(1 - p, top, X);
  let best = null;
  for (let a = 10; a <= 85; a++) for (let pw = 20; pw <= 100; pw += 2) {
    const sim = simulate(g.seed, g.move, top, p, a, pw, g.gust === g.move ? 3 : 1, X);
    const d = sim.impact ? Math.hypot(sim.impact.x - target.x, sim.impact.y - target.y) : 999;
    if (!best || d < best.d) best = { d, a, pw };
  }
  // Rookie stays wobbly. Pro and Ace are tighter, and they learn: every shot they've already
  // taken this duel steadies the next one (down to about a third of the wobble).
  const lvl = g.bot_level ?? 1, taken = G.shots.filter((s) => s.shooter === g.players[p]).length;
  const learn = lvl === 0 ? 1 : Math.max(0.35, 0.82 ** taken);
  const base = [{ a: 6, p: 8 }, { a: 1.7, p: 2.4 }, { a: 0.6, p: 0.8 }][lvl];
  const skill = { a: base.a * learn, p: base.p * learn };
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const angle = Math.max(5, Math.min(85, Math.round(best.a + gauss() * skill.a)));
  const power = Math.max(20, Math.min(100, Math.round(best.pw + gauss() * skill.p)));
  $('status').textContent = `${nm(g.players[p]).replace(/<[^>]+>/g, '')} is aiming…`;
  await sleep(reduceMotion ? 0 : 900);
  const sim = await flyShell(p, angle, power, g.craters, g.move, null, g.gust === g.move ? 3 : 1, X);
  const crater = sim.impact ? [Math.round(sim.impact.x), Math.round(sim.impact.y), CRATER_R] : null;
  if (crater) boom(crater[0], crater[1]);
  const hp = damage(top, sim.impact, g.hp, false, g.players.map((x) => g.shields.includes(x) && x !== g.players[p]), X);
  const { error } = await sb.rpc('duel_fire_bot', { p_game: g.id, p_angle: angle, p_power: power, p_crater: crater, p_hp: hp, ...(goal !== start ? { p_x: goal } : {}) });
  botDrive = null;
  markSeen(g.move + 1);
  busy = false;
  if (error) { $('err').textContent = friendly(error); return render(); }
  nudge();
  hitDrama(g.hp, hp);
  await sleep(600);
  await load(g.id); decide();
}

// ---------------------------------------------------------------- controls
let aimT = 0, aimQueued = false;
const sendAim = () => {
  if (!G || (busy && !liveOn)) return;
  const now = Date.now();
  if (now - aimT < 90) { if (!aimQueued) { aimQueued = true; setTimeout(() => { aimQueued = false; sendAim(); }, 90); } return; }
  aimT = now; live?.send('aim', { move: G.game.move, angle: +$('angle').value, power: +$('power').value, x: xs()[myIdx()] });
};
// Sets the aim from anywhere (sliders, − / + buttons, dragging on the battlefield).
function showAim() {
  $('angleOut').textContent = $('angle').value + '°'; $('powerOut').textContent = $('power').value;
  ['angle', 'power'].forEach((id) => { const el = $(id); el.style.setProperty('--fill', `${((el.value - el.min) / (el.max - el.min)) * 100}%`); });
}
const aimKey = () => `duel.aim.${G.game.id}`;
function setAim(angle, power) {
  $('angle').value = Math.max(5, Math.min(85, Math.round(angle)));
  $('power').value = Math.max(20, Math.min(100, Math.round(power)));
  showAim(); sendAim();
  try { localStorage.setItem(aimKey(), JSON.stringify({ angle: +$('angle').value, power: +$('power').value })); } catch {}
}
['angle', 'power'].forEach((id) => $(id).addEventListener('input', () => setAim(+$('angle').value, +$('power').value)));

// Driving: ◀ ▶ move the tank 2 px a step (hold to keep going), up to 40 px of fuel a turn,
// never past your side of the hill. The other player sees it live; the move goes with the shot.
function driveBy(d) {
  if (liveOn && G && myIdx() >= 0 && G.game.status === 'playing') {
    const p = myIdx(), [lo, hi] = SIDE[p], cur = liveMyX ?? baseXs()[p], nx = Math.max(lo, Math.min(hi, cur + d * 2));
    if (nx === cur) return;
    liveMyX = nx; sendAim();
    if (nx % 8 === 0) sfx('tick');
    clearTimeout(liveSave); liveSave = setTimeout(saveLiveX, 400);
    return;
  }
  const g = G?.game; if (!g || busy || shot || g.status !== 'playing' || turnId() !== me.id) return;
  const p = myIdx(), start = baseXs()[p], [lo, hi] = SIDE[p];
  if (myXMove !== g.move || myX == null) { myXMove = g.move; myX = start; }
  const nx = Math.max(lo, Math.min(hi, Math.max(start - FUEL, Math.min(start + FUEL, myX + d * 2))));
  if (nx === myX) return;
  myX = nx; showFuel(); sendAim();
  if (Math.abs(myX - start) % 8 === 0) sfx('tick');
}
async function saveLiveX() {
  const g = G?.game; if (!g || !liveOn || liveMyX == null) return;
  const { error } = await sb.rpc('duel_dodge', { p_game: g.id, p_move: g.move, p_x: liveMyX });
  if (error) note(friendly(error), 'error');
}
function showFuel() {
  const g = G?.game; if (!g || !$('fuelOut')) return;
  if (liveOn) { $('fuelOut').textContent = '∞'; $('fuelBar').style.width = '100%'; return; }
  const used = myXMove === g.move && myX != null ? Math.abs(myX - baseXs()[myIdx()]) : 0;
  $('fuelOut').textContent = FUEL - used; $('fuelBar').style.width = `${((FUEL - used) / FUEL) * 100}%`;
}
function dodgeBy(d) {
  const g = G?.game; if (!g || busy || shot || g.status !== 'playing' || turnId() === me.id || isBot(turnId())) return;
  const i = myIdx(), start = (g.turn_x || baseXs())[i], [lo, hi] = SIDE[i];
  if (dodgeMove !== g.move || dodgeX == null) { dodgeMove = g.move; dodgeX = baseXs()[i]; }
  const nx = Math.max(Math.max(lo, start - DODGE), Math.min(Math.min(hi, start + DODGE), dodgeX + d * 2));
  if (nx === dodgeX) return;
  dodgeX = nx; showDodge();
  if (Math.abs(nx - start) % 8 === 0) sfx('tick');
  live?.send('dodge', { move: g.move, x: nx });
  clearTimeout(dodgeSave); dodgeSave = setTimeout(saveDodge, 350);
}
let dodgeSave = null;
async function saveDodge() {
  const g = G?.game; if (!g || dodgeX == null || dodgeMove !== g.move) return;
  const x = dodgeX;
  const { error } = await sb.rpc('duel_dodge', { p_game: g.id, p_move: dodgeMove, p_x: x });
  if (error) { note(friendly(error), 'error'); dodgeX = null; await load(g.id); render(); return; }
  live?.send('dodge', { move: g.move, x });
}
function showDodge() {
  const g = G?.game; if (!g || !$('dodgeOut')) return;
  const i = myIdx(), start = (g.turn_x || baseXs())[i], cur = dodgeMove === g.move && dodgeX != null ? dodgeX : baseXs()[i];
  const left = DODGE - Math.abs(cur - start);
  $('dodgeOut').textContent = left; $('dodgeBar').style.width = `${(left / DODGE) * 100}%`;
}
document.querySelectorAll('[data-dv]').forEach((b) => {
  let hold = null, rep = null;
  const stop = () => { clearTimeout(hold); clearInterval(rep); };
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); dodgeBy(+b.dataset.dv); stop(); hold = setTimeout(() => { rep = setInterval(() => dodgeBy(+b.dataset.dv), 50); }, 300); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => b.addEventListener(ev, stop));
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dodgeBy(+b.dataset.dv); } });
});
document.querySelectorAll('[data-mv]').forEach((b) => {
  let hold = null, rep = null;
  const stop = () => { clearTimeout(hold); clearInterval(rep); };
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); driveBy(+b.dataset.mv); stop(); hold = setTimeout(() => { rep = setInterval(() => driveBy(+b.dataset.mv), 50); }, 300); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => b.addEventListener(ev, stop));
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); driveBy(+b.dataset.mv); } });
});

// − / + buttons: one step per tap, and they keep going while held.
document.querySelectorAll('[data-step]').forEach((b) => {
  let hold = null, rep = null;
  const bump = () => { const id = b.dataset.step, d = +b.dataset.d; setAim(id === 'angle' ? +$('angle').value + d : +$('angle').value, id === 'power' ? +$('power').value + d : +$('power').value); };
  const stop = () => { clearTimeout(hold); clearInterval(rep); hold = rep = null; };
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); bump(); stop(); hold = setTimeout(() => { rep = setInterval(bump, 70); }, 380); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => b.addEventListener(ev, stop));
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bump(); } });
});

// Drag on the battlefield to aim: the direction from your tank sets the angle and the
// distance sets the power. The aim hint follows your finger.
let drag = null;
const canAim = () => G && G.game.status === 'playing' && myIdx() >= 0 && (liveOn || (!busy && !shot && turnId() === me.id));
function aimFromPointer(e) {
  const r = cv.getBoundingClientRect(), gx = ((e.clientX - r.left) / r.width) * W, gy = ((e.clientY - r.top) / r.height) * H;
  const p = myIdx(), t = tankPos(p, top, xs()), dir = p === 0 ? 1 : -1;
  const dx = (gx - t.x) * dir, dy = t.y - 14 - gy;
  drag = { x: gx, y: gy };
  const ang = dx <= 0 ? 85 : (Math.atan2(dy, dx) * 180) / Math.PI;
  setAim(ang, Math.hypot(dx, dy) / 3.4);
}
cv.addEventListener('pointerdown', (e) => { if (!canAim()) return; e.preventDefault(); cv.setPointerCapture?.(e.pointerId); aimFromPointer(e); });
cv.addEventListener('pointermove', (e) => { if (drag && canAim()) aimFromPointer(e); });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => cv.addEventListener(ev, () => { drag = null; }));
$('fire').onclick = () => { if (liveOn) fireLive(); else if (!busy) fire(); };
$('del').onclick = async () => {
  const b = $('del');
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to delete the duel for everyone'; return; }
  const { error } = await sb.rpc('duel_delete', { p_game: G.game.id });
  if (error) { b.textContent = friendly(error); return; }
  location.href = './';
};

(async () => {
  if (!(await signedIn())) return;
  const id = (location.hash.match(/game=([0-9a-f-]{36})/) || [])[1];
  if (!id || !(await load(id))) { $('title').textContent = 'Duel not found'; return; }
  try { const a = JSON.parse(localStorage.getItem(`duel.aim.${id}`) || 'null'); if (a) { $('angle').value = a.angle; $('power').value = a.power; } } catch {}
  showAim();
  $('shotsFold').open = !isPhone();
  noteMirror($('err'), 'error');
  pack = await backpack();
  announceChaos({ gameId: id });
  requestAnimationFrame(loop);
  let pending = false;
  const refresh = () => { if (pending) return; pending = true; setTimeout(async () => { pending = false; if (busy) { setTimeout(refresh, 1000); return; } await load(id); pack = await backpack(); announceChaos({ gameId: id }); decide(); }, 200); };
  live = liveGame(`duel-${id}`, [{ event: '*', table: 'duel_games', filter: `id=eq.${id}` }], refresh, async () => {
    if (busy || !G) return;
    if (await chaosClock()) return refresh();   // anything overdue on a stalled turn lands now
    const { data } = await sb.from('duel_games').select('updated_at').eq('id', id).maybeSingle();
    if (data && data.updated_at !== G.game.updated_at) refresh();
  }, {
    dodge: (a) => { if (G && a.move === G.game.move && turnId() === me.id) oppDodge = a; },
    here: () => here(),
    aim: (a) => { if (G && liveOn) { oppAim = a; if (a.x != null) oppLiveX = a.x; return; } if (G && a.move === G.game.move && turnId() !== me.id) { oppAim = a; $('status').textContent = 'Aiming…'; } },
    shot: (s) => watchLiveShot(s, refresh),
  });
  navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.url) location.href = e.data.url; });
  const upNext = () => nextUpChip(me.id, id, (p) => (bots.has(p) ? '🤖 ' : '') + (names[p] ?? G?.names?.[p] ?? 'someone'));
  upNext(); setInterval(() => { if (!document.hidden) upNext(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) upNext(); });
  decide();
  // Live battle: check in every 3 s while the page is showing; leave when it's hidden or closed.
  here(); setInterval(() => { if (!document.hidden) here(); }, 3000);
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) { setLive(false); await here(false); live?.send('here', {}); } else here();
  });
  addEventListener('pagehide', () => { here(false); live?.send('here', {}); });
})();
