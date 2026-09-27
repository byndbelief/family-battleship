// Hilltop Duel, live. The shooter's browser flies the shell; the server records where it
// landed and the damage, and the other player watches it replay.
import { sb, me, bots, signedIn, esc, nm, friendly, notify, ITEMS, backpack, useLoot, announceChaos, backpackBarHTML, sfx, liveGame, nudge } from './common.js';
import { W, H, TANK_X, CRATER_R, BERTHA_R, rng, buildTop, windFor, tankPos, simulate, damage } from './duel-engine.js';

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- state and drawing
let G = null;     // { game, shots }
let top = null, shot = null, particles = [], busy = false, pack = [];
let live = null;          // the live channel: send('aim' | 'shot', …) to the other player's page
let oppAim = null;        // { move, angle, power } streamed from the other player while they aim
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
  [0, 1].forEach((p) => {
    const { x, y } = tankPos(p, top), col = p ? '#3DD6C6' : '#FF6B5A', dir = p ? -1 : 1;
    const aiming = !shot && g.status === 'playing' && g.turn === p;
    const ang = aiming && p === myIdx() ? +$('angle').value : aiming && oppAim && oppAim.move === g.move ? oppAim.angle : (shot && shot.p === p ? shot.angle : 45);
    ctx.save(); ctx.translate(x, y); if (g.hp[p] <= 0) ctx.globalAlpha = 0.45;
    ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(Math.cos((ang * Math.PI) / 180) * 20 * dir, -14 - Math.sin((ang * Math.PI) / 180) * 20); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, -12, 8, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.roundRect(-16, -10, 32, 10, 4); ctx.fill();
    ctx.fillStyle = '#0008'; for (let i = -12; i <= 12; i += 8) { ctx.beginPath(); ctx.arc(i, 0, 3, 0, 7); ctx.fill(); }
    ctx.restore();
    if (aiming) { ctx.fillStyle = col; const bob = Math.sin(t / 250) * 3; ctx.beginPath(); ctx.moveTo(x - 6, y - 44 + bob); ctx.lineTo(x + 6, y - 44 + bob); ctx.lineTo(x, y - 36 + bob); ctx.fill(); }
  });
  if (!shot && !busy && g.status === 'playing' && g.turn === myIdx()) {
    if (drag) {
      const tp = tankPos(myIdx(), top);
      ctx.strokeStyle = '#FFF4D688'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(tp.x, tp.y - 14); ctx.lineTo(drag.x, drag.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#FFC85755'; ctx.beginPath(); ctx.arc(drag.x, drag.y, 16, 0, 7); ctx.fill();
    }
    drawHint(t);
  }
  if (shot) {
    const n = shot.i, pts = shot.path;
    for (let j = Math.max(0, n - 40); j < n; j++) { ctx.globalAlpha = (j - (n - 40)) / 40; ctx.fillStyle = '#FFC857'; ctx.beginPath(); ctx.arc(pts[j].x, pts[j].y, 2, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
    if (n < pts.length) { const q = pts[n]; ctx.shadowColor = '#FFC857'; ctx.shadowBlur = 18; ctx.fillStyle = '#FFF4D6'; ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, 7); ctx.fill(); ctx.shadowBlur = 0; }
  }
  particles.forEach((q) => { ctx.globalAlpha = Math.max(0, q.life); ctx.fillStyle = q.c; ctx.beginPath(); ctx.arc(q.x, q.y, q.s, 0, 7); ctx.fill(); });
  ctx.globalAlpha = 1;
}
// Aim hint: dots along the first stretch of the shell's real flight, wind included, fading out
// before it gets near the other tank. Enough to feel the shot, not enough to skip the aiming.
let hintKey = '', hintPts = [];
function drawHint(t) {
  const g = G.game, angle = +$('angle').value, power = +$('power').value, windX = g.gust === g.move ? 3 : 1;
  const key = `${g.move}|${angle}|${power}|${windX}`;
  if (key !== hintKey) {
    hintKey = key;
    const { path } = simulate(g.seed, g.move, top, myIdx(), angle, power, windX);
    hintPts = path.slice(0, Math.ceil(path.length * 0.4));
  }
  const n = hintPts.length, drift = reduceMotion ? 0 : (t / 60) % 6;
  for (let j = Math.floor(drift) % 6; j < n; j += 6) {
    const q = hintPts[j], f = 1 - j / n;
    ctx.globalAlpha = 0.25 + 0.75 * f; ctx.fillStyle = '#FFC857'; ctx.shadowColor = '#FFC857'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(q.x, Math.max(4, q.y), 2.5 + 2 * f, 0, 7); ctx.fill();
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
function stamp(text, tone = '', ms = 2400) { const el = document.createElement('div'); el.className = `stamp ${tone}`; el.innerHTML = `<span>${text}</span>`; document.body.appendChild(el); setTimeout(() => el.remove(), ms); }

// Flies a shell along its path, then blows up where the server says it landed.
function flyShell(p, angle, power, beforeCraters, move, crater, windX = 1) {
  return new Promise((done) => {
    top = buildTop(G.game.seed, beforeCraters);
    const sim = simulate(G.game.seed, move, top, p, angle, power, windX);
    shot = { p, angle, path: sim.path, i: reduceMotion ? sim.path.length : 0 };
    sfx('cannon'); if (!reduceMotion) sfx('whistle', { delay: 0.15, dur: Math.max(0.3, sim.path.length / 3 / 60 - 0.15) });
    const step = () => {
      shot.i = Math.min(shot.path.length, shot.i + 3);
      if (shot.i < shot.path.length) return requestAnimationFrame(step);
      shot = null;
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
  $('n0').innerHTML = `<span style="color:var(--coral)">●</span> ${who(g.players[0])} · ${g.hp[0]}${tag(g.players[0])}`;
  $('n1').innerHTML = `${who(g.players[1])} · ${g.hp[1]}${tag(g.players[1])} <span style="color:var(--teal)">●</span>`;
  $('hp0').style.width = g.hp[0] + '%'; $('hp1').style.width = g.hp[1] + '%';
  const gusty = g.gust === g.move, w = windFor(g.seed, g.move, gusty ? 3 : 1);
  $('wind').textContent = (gusty ? '🌪️ ' : '') + (w === 0 ? 'No wind' : `Wind ${w < 0 ? '←' : '→'} ${Math.abs(w)}${gusty ? ' (hurricane!)' : ''}`);
  const over = g.status === 'over', mine = !over && turnId() === me.id;
  $('title').innerHTML = over ? (g.winner === me.id ? 'You win!' : `${nm(g.winner)} wins!`) : mine ? 'Your shot' : `${nm(turnId())}'s shot`;
  $('status').textContent = over ? '' : mine ? `Move ${g.move + 1}` : busy ? '' : 'Waiting…';
  $('controls').hidden = !mine || busy;
  cv.style.touchAction = mine && !busy ? 'none' : 'manipulation';   // dragging aims on your turn instead of scrolling
  cv.style.cursor = mine && !busy ? 'crosshair' : '';
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
  return true;
}

async function decide() {
  if (busy) return;
  const g = G.game, last = G.shots[G.shots.length - 1];
  // Watch the last shot if it's new to you.
  if (last && last.shooter !== me.id && last.move > seenMove()) {
    busy = true; render();
    const before = g.craters.slice(0, g.craters.length - (last.crater ? 1 : 0));
    await flyShell(g.players.indexOf(last.shooter), last.angle, last.power, before, last.move - 1, last.crater, last.wind_x || 1);
    markSeen(last.move); top = buildTop(g.seed, g.craters); busy = false;
    const lost = (G.shots[G.shots.length - 2]?.hp_after || [100, 100])[myIdx()] - last.hp_after[myIdx()];
    if (lost > 0) stamp(`−${lost}`, 'red', 1400);
  }
  top = buildTop(g.seed, g.craters);
  render();
  if (g.status === 'over') { stamp(g.winner === me.id ? 'Victory!' : 'Defeated', g.winner === me.id ? '' : 'red', 2800); sfx(g.winner === me.id ? 'fanfare' : 'lose', { delay: 0.3 }); return; }
  const cur = turnId();
  if (isBot(cur)) {
    const stale = Date.now() - new Date(g.updated_at).getTime() > 15000;
    if ((last && last.shooter === me.id) || stale) return robotShot();
  }
}

async function fire() {
  const g = G.game, p = myIdx(), angle = +$('angle').value, power = +$('power').value, move = g.move;
  busy = true; drag = null; render();
  navigator.vibrate?.(40);
  live?.send('shot', { move, angle, power });
  const big = g.bertha.includes(me.id);
  const sim = await flyShell(p, angle, power, g.craters, move, null, g.gust === move ? 3 : 1);
  const crater = sim.impact ? [Math.round(sim.impact.x), Math.round(sim.impact.y), big ? BERTHA_R : CRATER_R] : null;
  if (crater) boom(crater[0], crater[1], big ? 2 : 1);
  const hp = damage(top, sim.impact, g.hp, big, g.players.map((x) => g.shields.includes(x) && x !== me.id));
  const { error } = await sb.rpc('duel_fire', { p_game: g.id, p_angle: angle, p_power: power, p_crater: crater, p_hp: hp });
  busy = false;
  if (error) { $('err').textContent = friendly(error); render(); return; }
  announceChaos({ gameId: g.id }); pack = await backpack();
  if (hp[1 - p] < g.hp[1 - p]) stamp(`Hit! −${g.hp[1 - p] - hp[1 - p]}`, '', 1400);
  markSeen(move + 1);
  notify('duel', g.id);
  await sleep(600);
  await load(g.id); decide();
}

// The other player just pulled the trigger: fly their shell here right away, the same way
// their page does, instead of waiting for the database to catch up.
async function watchLiveShot({ move, angle, power }, refresh) {
  const g = G?.game;
  if (!g || busy || g.status !== 'playing' || move !== g.move || turnId() === me.id) return;
  const p = g.turn, shooter = g.players[p], big = g.bertha.includes(shooter), mi = myIdx(), hpBefore = g.hp[mi];
  busy = true; oppAim = { move, angle, power }; render();
  const sim = await flyShell(p, angle, power, g.craters, move, null, g.gust === move ? 3 : 1);
  if (sim.impact) boom(Math.round(sim.impact.x), Math.round(sim.impact.y), big ? 2 : 1);
  markSeen(move + 1); oppAim = null;
  // Wait for their shot to land in the database, then show where things stand.
  for (let i = 0; i < 8 && G.game.move === move; i++) { await sleep(500); await load(g.id); }
  busy = false;
  if (G.game.move === move) return refresh();   // still not saved; the regular checks will pick it up
  top = buildTop(G.game.seed, G.game.craters);
  const lost = hpBefore - G.game.hp[mi];
  if (lost > 0) stamp(`−${lost}`, 'red', 1400);
  pack = await backpack(); announceChaos({ gameId: g.id });
  decide();
}

// The robot tries every angle and power, keeps the one that lands closest, then wobbles it by skill.
async function robotShot() {
  busy = true; render();
  const g = G.game, p = g.turn, target = tankPos(1 - p, top);
  let best = null;
  for (let a = 10; a <= 85; a++) for (let pw = 20; pw <= 100; pw += 2) {
    const sim = simulate(g.seed, g.move, top, p, a, pw, g.gust === g.move ? 3 : 1);
    const d = sim.impact ? Math.hypot(sim.impact.x - target.x, sim.impact.y - target.y) : 999;
    if (!best || d < best.d) best = { d, a, pw };
  }
  const skill = [{ a: 6, p: 8 }, { a: 2.5, p: 3.5 }, { a: 0.9, p: 1.2 }][g.bot_level ?? 1];
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const angle = Math.max(5, Math.min(85, Math.round(best.a + gauss() * skill.a)));
  const power = Math.max(20, Math.min(100, Math.round(best.pw + gauss() * skill.p)));
  $('status').textContent = `${nm(g.players[p]).replace(/<[^>]+>/g, '')} is aiming…`;
  await sleep(reduceMotion ? 0 : 900);
  const sim = await flyShell(p, angle, power, g.craters, g.move, null, g.gust === g.move ? 3 : 1);
  const crater = sim.impact ? [Math.round(sim.impact.x), Math.round(sim.impact.y), CRATER_R] : null;
  if (crater) boom(crater[0], crater[1]);
  const hp = damage(top, sim.impact, g.hp, false, g.players.map((x) => g.shields.includes(x) && x !== g.players[p]));
  const { error } = await sb.rpc('duel_fire_bot', { p_game: g.id, p_angle: angle, p_power: power, p_crater: crater, p_hp: hp });
  markSeen(g.move + 1);
  busy = false;
  if (error) { $('err').textContent = friendly(error); return render(); }
  nudge();
  const lost = g.hp[myIdx()] - hp[myIdx()];
  if (lost > 0) stamp(`−${lost}`, 'red', 1400);
  await sleep(600);
  await load(g.id); decide();
}

// ---------------------------------------------------------------- controls
let aimT = 0, aimQueued = false;
const sendAim = () => {
  if (!G || busy) return;
  const now = Date.now();
  if (now - aimT < 90) { if (!aimQueued) { aimQueued = true; setTimeout(() => { aimQueued = false; sendAim(); }, 90); } return; }
  aimT = now; live?.send('aim', { move: G.game.move, angle: +$('angle').value, power: +$('power').value });
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
const canAim = () => G && !busy && !shot && G.game.status === 'playing' && turnId() === me.id;
function aimFromPointer(e) {
  const r = cv.getBoundingClientRect(), gx = ((e.clientX - r.left) / r.width) * W, gy = ((e.clientY - r.top) / r.height) * H;
  const p = myIdx(), t = tankPos(p, top), dir = p === 0 ? 1 : -1;
  const dx = (gx - t.x) * dir, dy = t.y - 14 - gy;
  drag = { x: gx, y: gy };
  const ang = dx <= 0 ? 85 : (Math.atan2(dy, dx) * 180) / Math.PI;
  setAim(ang, Math.hypot(dx, dy) / 3.4);
}
cv.addEventListener('pointerdown', (e) => { if (!canAim()) return; e.preventDefault(); cv.setPointerCapture?.(e.pointerId); aimFromPointer(e); });
cv.addEventListener('pointermove', (e) => { if (drag && canAim()) aimFromPointer(e); });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => cv.addEventListener(ev, () => { drag = null; }));
$('fire').onclick = () => { if (!busy) fire(); };
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
  pack = await backpack();
  announceChaos({ gameId: id });
  requestAnimationFrame(loop);
  let pending = false;
  const refresh = () => { if (pending) return; pending = true; setTimeout(async () => { pending = false; if (busy) { setTimeout(refresh, 1000); return; } await load(id); pack = await backpack(); announceChaos({ gameId: id }); decide(); }, 200); };
  live = liveGame(`duel-${id}`, [{ event: '*', table: 'duel_games', filter: `id=eq.${id}` }], refresh, async () => {
    if (busy || !G) return;
    const { data } = await sb.from('duel_games').select('updated_at').eq('id', id).maybeSingle();
    if (data && data.updated_at !== G.game.updated_at) refresh();
  }, {
    aim: (a) => { if (G && a.move === G.game.move && turnId() !== me.id) { oppAim = a; $('status').textContent = 'Aiming…'; } },
    shot: (s) => watchLiveShot(s, refresh),
  });
  navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.url) location.href = e.data.url; });
  decide();
})();
