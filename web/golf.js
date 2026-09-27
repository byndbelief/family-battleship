// Putt Post, live: turns and scores are saved on the server; putts replay for everyone.
import { sb, me, bots, signedIn, esc, nm, friendly, notify, ITEMS, backpack, useLoot, announceChaos, backpackBarHTML, sfx, liveGame, nudge } from './common.js';
import {
  LW, LH, HOLES, R, CUP_R, MAX_STROKES, tick, q20, q100, ATTACKS, holeWithAttack, drawHole,
  inPoly, inRect, segDist, reduceMotion,
} from './golf-engine.js';

const $ = (id) => document.getElementById(id);
const cv = $('course'), ctx = cv.getContext('2d');

// ---------------------------------------------------------------- state
let G = null;              // { game, turns, players, acc, secrets, best }
let scene = {}, mode = 'idle', strokes = 0, current = [], skipReplay = false;
let curAttack = 0, curAttacker = null;   // sneak attack in effect for the hole being played
let cheatsUsed = 0, lastStroke = null, drag = null;
let flowing = false;       // a replay, judging, robot or turn flow is running
let afterPanel = false;    // the "plant an attack" panel after my hole is open
let pack = [], magnetOn = false;   // backpack items; Magnet Cup active this hole

const n = () => G.game.players.length;
const curPlayer = () => G.game.players[G.game.t % n()];
const curHole = () => G.game.start + Math.floor(G.game.t / n());
const magnetize = (h, on) => (on ? { ...h, cupR: 13, cupSpeed: 7.5 } : h);
const H = () => magnetize(holeWithAttack(G.game.seed, curHole(), curAttack), magnetOn && mode !== 'bot');
const isBot = (id) => bots.has(id);
const who = (id) => (id === me.id ? 'You' : nm(id));
const seenKey = () => `golf.seen.${G.game.id}`;
const seenT = () => { try { const v = localStorage.getItem(seenKey()); return v === null ? -1 : +v; } catch { return -1; } };
const markSeen = (t) => { try { if (t > seenT()) localStorage.setItem(seenKey(), String(t)); } catch {} };
const WORDS = { '-3': 'albatross', '-2': 'eagle', '-1': 'birdie', 0: 'par', 1: 'bogey', 2: 'double bogey' };
const scoreWord = (s, par) => (s === 1 ? 'hole in one!' : WORDS[s - par] ? `${WORDS[s - par]} (${s})` : `${s} strokes`);
const fmtPar = (v) => (v === 0 ? 'even par' : `${v > 0 ? '+' : ''}${v} to par`);
const CHEAT_NAMES = { 1: '🦶 Foot Wedge', 2: '🔄 Mulligan', 4: '✏️ Pencil Whip' };
const BOT_SKILL = [{ aim: 7, power: 0.18, cheat: 0.3 }, { aim: 3, power: 0.08, cheat: 0.22 }, { aim: 1.2, power: 0.03, cheat: 0.15 }];
const botSkill = () => BOT_SKILL[G.game.bot_level ?? 1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- loading
async function load(id) {
  const [g, t, p, a, s] = await Promise.all([
    sb.from('golf_games').select('*').eq('id', id).maybeSingle(),
    sb.from('golf_turns').select('*').eq('game_id', id).order('t'),
    sb.from('golf_players').select('*').eq('game_id', id),
    sb.from('golf_accusations').select('*').eq('game_id', id),
    sb.from('golf_secrets').select('*').eq('game_id', id),
  ]);
  if (!g.data) return false;
  G = { game: g.data, turns: t.data ?? [], players: p.data ?? [], acc: a.data ?? [], secrets: s.data ?? [], best: G?.best };
  return true;
}
const pl = (id) => G.players.find((x) => x.player === id) || { tokens: 0, away: 0, busted: 0, catches: 0 };

// ---------------------------------------------------------------- drawing loop
function sizeCanvas() {
  const fs = !!document.querySelector('#play.fs-on');   // full screen: the hole gets all the room it can
  const maxW = fs ? cv.parentElement.clientWidth : Math.min(cv.parentElement.clientWidth, 520), maxH = fs ? Math.max(240, innerHeight - 150) : Math.max(360, innerHeight - 230);
  const w = Math.min(maxW, (maxH * LW) / LH), dpr = Math.min(2, devicePixelRatio || 1);
  cv.style.width = w + 'px'; cv.style.height = (w * LH) / LW + 'px';
  cv.width = Math.round(w * dpr); cv.height = Math.round(((w * LH) / LW) * dpr);
}
function loop(t) {
  scene.fx = (scene.fx || []).filter((f) => { f.x += f.vx; f.y += f.vy; f.vy += f.g || 0; f.life -= 0.02; return f.life > 0; });
  if (scene.hole) { const k = cv.width / LW; ctx.setTransform(k, 0, 0, k, 0, 0); drawHole(ctx, scene.hole, t, scene); }
  requestAnimationFrame(loop);
}
function burst(x, y, colors, count = 36, g = 0.05) {
  for (let i = 0; i < count; i++) { const a = Math.random() * 6.283, v = Math.random() * 3 + 0.6; scene.fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, g, life: 1, s: Math.random() * 2.5 + 1, c: colors[i % colors.length] }); }
}
function bigText(html, ms) { const el = $('hio'); el.innerHTML = html; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => { el.hidden = true; }, ms); }
function shake() { if (reduceMotion) return; cv.classList.remove('shake'); void cv.offsetWidth; cv.classList.add('shake'); }
function celebrate(s, par) {
  if (s === 1) {
    bigText('<span>HOLE<br>IN ONE!</span>', 2900); shake(); sfx('fanfare', { delay: 0.25 });
    for (let i = 0; i < 9; i++) sfx('pop', { delay: 0.3 + i * 0.26 });
    const cols = ['#F2C14E', '#E4572E', '#7FD3F7', '#fff', '#B6F09C', '#FF8AD8'];
    for (let i = 0; i < 9; i++) setTimeout(() => { const x = 50 + Math.random() * 260, y = 70 + Math.random() * 260; burst(x, y, cols, 70, 0.03);
      for (let k = 0; k < 24; k++) { const a = (k / 24) * 6.283; scene.fx.push({ x, y, vx: Math.cos(a) * 4.2, vy: Math.sin(a) * 4.2, g: 0.02, life: 1.2, s: 2.2, c: cols[k % cols.length] }); } }, i * 260);
    for (let i = 0; i < 120; i++) scene.fx.push({ x: Math.random() * LW, y: -20 - Math.random() * 200, vx: (Math.random() - 0.5) * 1.2, vy: 1 + Math.random() * 2, g: 0.02, life: 2.2, s: 2 + Math.random() * 2, c: cols[i % cols.length] });
  } else if (s < par) {
    sfx('birdie', { delay: 0.2 });
    bigText(`<span class="small-pop">${{ '-1': 'Birdie!', '-2': 'Eagle!', '-3': 'Albatross!' }[s - par] || 'Amazing!'}</span>`, 1700);
  }
}

// Rolls one stroke from scene.clock; resolves with the result and the ball.
function roll(stroke, h, speed = 2) {
  return new Promise((done) => {
    const b = { x: stroke.x, y: stroke.y, vx: stroke.vx, vy: stroke.vy, ticks: 0, clock: scene.clock || 0 };
    scene.ball = b; scene.trail = []; scene.bumpLit = scene.bumpLit || [];
    const quiet = skipReplay && mode === 'replay';
    if (!quiet) sfx('putt', { power: Math.hypot(b.vx, b.vy) / 8 });
    let lastClack = 0;
    const step = () => {
      const per = skipReplay && mode === 'replay' ? 400 : speed;
      for (let i = 0; i < per; i++) {
        const ev = tick(b, h);
        if (!quiet && ev === 'wall' && performance.now() - lastClack > 70) { lastClack = performance.now(); sfx('clack'); }
        if (!quiet && ev === 'bump') sfx('boing');
        if (ev === 'bump') h.bumpers.forEach(([x, y, r], j) => { const dx = b.x - x, dy = b.y - y; if (dx * dx + dy * dy < (r + R + 2) ** 2) scene.bumpLit[j] = performance.now() + 180; });
        if (ev === 'cup' || ev === 'water' || ev === 'stop') { scene.trail = []; scene.clock = b.clock; return done({ ev, b }); }
      }
      scene.trail.push({ x: b.x, y: b.y }); if (scene.trail.length > 14) scene.trail.shift();
      setTimeout(() => requestAnimationFrame(step), 0);
    };
    requestAnimationFrame(step);
  });
}
function afterStroke(ev, b, h, sx, sy) {
  if (ev === 'cup') { if (!(skipReplay && mode === 'replay')) sfx('cup'); b.hidden = true; scene.flagOut = true; burst(h.cup[0], h.cup[1], ['#F2C14E', '#fff', '#E4572E', '#7FD3F7'], 60, 0.04); return { holed: true, penalty: 0 }; }
  if (ev === 'water') { if (!(skipReplay && mode === 'replay')) sfx('plunk'); burst(b.x, b.y, ['#BFE9FF', '#fff', '#3FA7E0'], 30, 0.08); b.x = sx; b.y = sy; b.vx = b.vy = 0; return { holed: false, penalty: 1 }; }
  b.x = q20(b.x); b.y = q20(b.y); b.vx = b.vy = 0; return { holed: false, penalty: 0 };
}
const toStroke = ([x, y, vx, vy]) => ({ x, y, vx, vy });
const fromStroke = (s) => [s.x, s.y, s.vx, s.vy];

// ---------------------------------------------------------------- header, scorecard
function setHud(hole, player, s, replay) {
  $('holeNo').textContent = `Hole ${hole + 1} of ${G.game.start + G.game.count} · Par ${HOLES[hole].par}`;
  $('holeName').textContent = HOLES[hole].name;
  $('whoPill').innerHTML = `${replay ? '▶' : '⛳'} ${who(player)}`;
  $('strokes').textContent = s;
}
function cellScore(p, hole) {
  const tu = G.turns.find((x) => x.player === p && x.hole === hole);
  if (!tu) return null;
  return tu.skipped ? 'skip' : tu.written + tu.fine;
}
function standings() {
  return G.game.players.map((p) => {
    let s = 0, par = 0, played = 0;
    for (let i = G.game.start; i < G.game.start + G.game.count; i++) { const v = cellScore(p, i); if (typeof v === 'number') { s += v; par += HOLES[i].par; played++; } }
    return { p, strokes: s, toPar: s - par, played };
  });
}
function renderCard() {
  const g = G.game, over = g.status === 'over', cur = over ? null : { p: curPlayer(), h: curHole() };
  const st = standings(), lead = Math.min(...st.map((s) => (s.played ? s.toPar : Infinity)));
  const idx = []; for (let i = g.start; i < g.start + g.count; i++) idx.push(i);
  let h = `<table class="score"><thead><tr><th>Player</th>${idx.map((i) => `<th>${i + 1}</th>`).join('')}<th>Total</th><th>±</th></tr></thead><tbody>`;
  h += `<tr class="par"><td>Par</td>${idx.map((i) => `<td>${HOLES[i].par}</td>`).join('')}<td>${idx.reduce((a, i) => a + HOLES[i].par, 0)}</td><td></td></tr>`;
  g.players.forEach((p, k) => {
    const sb2 = pl(p), badges = sb2.busted ? ` <span class="badge" title="Busted cheating">${'🚨'.repeat(Math.min(3, sb2.busted))}</span>` : '';
    h += `<tr class="${st[k].played && st[k].toPar === lead ? 'lead' : ''}"><td>${who(p)}${badges}</td>`;
    idx.forEach((i) => {
      const v = cellScore(p, i), cls = [];
      if (cur && cur.p === p && cur.h === i) cls.push('now');
      if (v === 'skip') cls.push('skip'); else if (v) cls.push(v < HOLES[i].par ? 'under' : v > HOLES[i].par ? 'over' : '');
      h += `<td class="${cls.join(' ')}">${v === 'skip' ? '–' : v ?? ''}</td>`;
    });
    h += `<td class="tot">${st[k].strokes || ''}</td><td>${st[k].played ? (st[k].toPar > 0 ? '+' : '') + st[k].toPar : ''}</td></tr>`;
  });
  $('scorecard').innerHTML = h + '</tbody></table>';
  $('del').hidden = g.created_by !== me.id;
  // Skip ahead, only while it's your turn and nothing is rolling.
  const canJump = !over && curPlayer() === me.id && mode === 'aim' && curHole() < g.start + g.count - 1;
  $('jumpRow').hidden = !canJump;
  if (canJump) { let o = ''; for (let i = curHole() + 1; i < g.start + g.count; i++) o += `<option value="${i}">Hole ${i + 1}: ${esc(HOLES[i].name)}</option>`; $('jumpTo').innerHTML = o; }
}

// ---------------------------------------------------------------- what happens next
async function decide() {
  if (flowing) return;
  const g = G.game;
  renderCard();
  const prev = G.turns.find((x) => x.t === g.t - 1);
  if (g.status === 'over') {
    const last = [...G.turns].reverse().find((x) => !x.skipped);
    if (last && last.player !== me.id && last.t > seenT()) { await replayTurn(last); markSeen(last.t); }
    return showFinal();
  }
  // Watch the last player's hole if you haven't yet.
  if (prev && !prev.skipped && prev.player !== me.id && prev.t > seenT()) { await replayTurn(prev); markSeen(prev.t); if (G.game.t !== g.t) return decide(); }
  const cur = curPlayer();
  if (cur === me.id) return myTurn();
  if (isBot(cur)) {
    const stale = Date.now() - new Date(g.updated_at).getTime() > 20000;
    if (prev?.player === me.id || stale || !prev) {
      if (afterPanel) return;   // they click "Let the robot play" once they've planted (or not)
      return robotTurn();
    }
  }
  waiting(cur);
}
function waiting(cur) {
  mode = 'idle';
  scene = { hole: holeWithAttack(G.game.seed, curHole(), 0), fx: [], clock: 0 };
  setHud(curHole(), cur, 0, false);
  $('tip').textContent = `Waiting for ${who(cur).replace(/<[^>]+>/g, '')} to play hole ${curHole() + 1}. This page updates when they do.`;
  $('cheats').hidden = true; $('pack').innerHTML = '';
  renderCard();
}

// Plays back a saved turn.
async function replayTurn(tu) {
  flowing = true;
  const h = magnetize(holeWithAttack(G.game.seed, tu.hole, tu.attack), tu.boost === 1);
  mode = 'replay'; skipReplay = false; scene = { hole: h, fx: [], clock: 0, ball: { x: h.tee[0], y: h.tee[1] } };
  setHud(tu.hole, tu.player, 0, true);
  const atk = (tu.attack ? `, while hit by ${ATTACKS[tu.attack].name}` : '') + (tu.boost ? ' (with a 🧲 Magnet Cup)' : '');
  $('tip').textContent = `Watching ${who(tu.player).replace(/<[^>]+>/g, '')} on hole ${tu.hole + 1}: ${tu.written} on the card${atk}.`;
  $('skip').hidden = false;
  let count = 0;
  for (const raw of tu.strokes) {
    const s = toStroke(raw);
    scene.ball = { x: s.x, y: s.y, clock: scene.clock }; scene.flagOut = false;
    if (!skipReplay) await sleep(350);
    const { ev, b } = await roll(s, h);
    const r = afterStroke(ev, b, h, s.x, s.y); count += 1 + r.penalty; $('strokes').textContent = count;
    if (r.holed && !skipReplay) celebrate(count, HOLES[tu.hole].par);
    if (!skipReplay) await sleep(r.holed && count === 1 ? 2600 : 500);
  }
  $('skip').hidden = true;
  if (!skipReplay) await sleep(700);
  flowing = false;
}
$('skip').onclick = () => { skipReplay = true; $('skip').hidden = true; };

// ---------------------------------------------------------------- my turn
async function myTurn() {
  flowing = true;
  const prev = G.turns.find((x) => x.t === G.game.t - 1);
  if (n() > 1 && prev && !prev.skipped && prev.player !== me.id && !G.acc.some((a) => a.t === prev.t)) await judge(prev);
  const { data: atk } = await sb.rpc('golf_my_attack', { p_game: G.game.id });
  curAttack = atk?.type || 0; curAttacker = atk?.attacker || null;
  flowing = false;
  startTurn();
}
function modal(html) { $('gate').hidden = false; $('gateCard').innerHTML = html; }
function closeModal() { $('gate').hidden = true; }
function judge(prev) {
  return new Promise((resolve) => {
    mode = 'judge';
    modal(`<div style="font-size:44px;line-height:1">🔍</div><h2>Did ${who(prev.player)} cheat?</h2>
      <p class="small muted">Hole ${prev.hole + 1}: they wrote down <strong>${prev.written}</strong>. Watch for a ball that jumps, a missing putt, or a count that doesn't add up.</p>
      <button class="go" id="accuse">🚨 Call cheater!</button><button id="clean">👍 Looks clean</button><button class="link" id="again">Watch the replay again</button>
      <p class="small muted">Right: they get +2 and you win a sneak attack. Wrong: +1 stroke for you.</p>`);
    $('again').onclick = async () => { closeModal(); await replayTurn(prev); resolve(judge(prev)); };
    $('clean').onclick = () => { closeModal(); resolve(); };
    $('accuse').onclick = async () => {
      $('accuse').disabled = true;
      const { data, error } = await sb.rpc('golf_call', { p_game: G.game.id });
      if (error) { closeModal(); resolve(); return; }
      nudge();
      if (data.busted) {
        bigText('<span class="busted">BUSTED!</span>', 2600); shake(); sfx('buzz');
        modal(`<h2 style="color:#FF7A6E">🚨 Busted!</h2><p>${who(prev.player)} used ${[1, 2, 4].filter((k) => data.cheats & k).map((k) => CHEAT_NAMES[k]).join(', ')}.</p>
          <p class="small muted">+${2 + (data.cheats & 4 ? 1 : 0)} strokes for them. You win a sneak attack.</p><button class="go" id="onward">Tee off</button>`);
      } else {
        modal(`<h2>😇 False alarm</h2><p>${who(prev.player)} played it straight.</p><p class="small muted">+1 stroke on your hole for the wild accusation.</p><button class="go" id="onward">Tee off</button>`);
      }
      await load(G.game.id); renderCard();
      $('onward').onclick = () => { closeModal(); resolve(); };
    };
  });
}
function startTurn() {
  magnetOn = false;
  const h = H();
  cheatsUsed = 0; lastStroke = null; strokes = 0; current = [];
  mode = 'aim'; scene = { hole: h, fx: [], clock: 0, ball: { x: h.tee[0], y: h.tee[1] } };
  setHud(curHole(), me.id, 0, false);
  $('tip').textContent = 'Drag back from anywhere on the course, then let go to putt.' + (h.extra ? ' This hole has random obstacles.' : '');
  $('send').hidden = true;
  renderCard();
  if (curAttack) {
    const a = ATTACKS[curAttack];
    mode = 'reveal';
    modal(`<div style="font-size:54px;line-height:1">${a.icon}</div><h2 style="color:#FF9A7A">Sneak attack!</h2>
      <p><strong>${curAttacker ? nm(curAttacker) : '🌀 Chaos'}</strong> hit you with <strong>${a.name}</strong>.</p><p class="muted small">${a.desc}</p><button class="go" id="bring">Bring it on</button>`);
    shake();
    $('bring').onclick = () => { closeModal(); mode = 'aim'; $('tip').textContent = `${a.icon} ${a.name} is on. Drag back and let go.`; renderCheats(); renderCard(); };
  }
  renderCheats();
}
function toLogical(e) { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * LW, y: ((e.clientY - r.top) / r.height) * LH }; }
cv.addEventListener('pointerdown', (e) => {
  if (mode === 'wedge') return wedgeTo(toLogical(e));
  if (mode !== 'aim') return;
  drag = toLogical(e); cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', (e) => {
  if (!drag || mode !== 'aim') return;
  const p = toLogical(e), dx = drag.x - p.x, dy = drag.y - p.y, d = Math.sqrt(dx * dx + dy * dy);
  if (d < 6) { scene.aim = null; return; }
  const pw = Math.min(1, d / 150); scene.aim = { bx: scene.ball.x, by: scene.ball.y, dx: dx / d, dy: dy / d, p: pw };
  $('tip').textContent = `Power ${Math.round(pw * 100)}%`;
});
cv.addEventListener('pointercancel', () => { drag = null; scene.aim = null; });
cv.addEventListener('pointerup', async () => {
  if (!drag) return; drag = null;
  const a = scene.aim; scene.aim = null;
  if (!a || a.p < 0.04 || mode !== 'aim') { if (mode === 'aim') $('tip').textContent = 'Drag back further to putt.'; return; }
  const sp = (0.6 + a.p * 10.4) * (curAttack === 5 ? 0.67 : 1);
  const s = { x: q20(scene.ball.x), y: q20(scene.ball.y), vx: q100(a.dx * sp), vy: q100(a.dy * sp) };
  current.push(s); mode = 'rolling'; $('tip').textContent = ''; renderCheats(); renderCard();
  const clockBefore = scene.clock || 0;
  const { ev, b } = await roll(s, H());
  const r = afterStroke(ev, b, H(), s.x, s.y);
  strokes += 1 + r.penalty; $('strokes').textContent = strokes;
  lastStroke = { s, penalty: r.penalty, clockBefore };
  if (r.holed) return finishTurn(true);
  if (strokes >= MAX_STROKES) return finishTurn(false);
  mode = 'aim';
  $('tip').textContent = r.penalty ? 'Splash! One penalty stroke. Back to where you putted from.' : `Stroke ${strokes + 1}. Drag back and let go.`;
  renderCheats(); renderCard();
});

// ---------------------------------------------------------------- cheating (if you dare)
function clearSpot(h, x, y) {
  return inPoly(x, y, h.outline) && !h.segs.some((sg) => segDist(x, y, sg) < R + 1) && !h.water.some((w) => inRect(x, y, w))
    && !h.bumpers.some(([cx, cy, cr]) => (x - cx) ** 2 + (y - cy) ** 2 < (cr + R + 1) ** 2);
}
function renderPack() {
  const el = $('pack'), on = mode === 'aim';
  el.innerHTML = G.game.status === 'playing' && curPlayer() === me.id ? backpackBarHTML(pack, 'golf', on) : '';
  el.querySelectorAll('[data-loot]').forEach((b) => {
    const item = b.dataset.item;
    if ((item === 'magnet' && magnetOn) || (item === 'golden_tee' && !lastStroke)) b.disabled = true;
    b.onclick = async () => {
      b.disabled = true;
      const { error } = await useLoot(+b.dataset.loot, G.game.id);
      if (error) { $('tip').textContent = friendly(error); return; }
      if (item === 'magnet') { sfx('pop'); magnetOn = true; scene.hole = H(); bigText('<span class="small-pop">🧲 Magnet Cup!</span>', 1500); $('tip').textContent = 'The cup just got huge and hungry.'; }
      else {   // Golden Tee: an honest mulligan
        const L = lastStroke;
        current.pop(); strokes -= 1 + L.penalty; scene.clock = L.clockBefore; scene.flagOut = false;
        scene.ball = { x: L.s.x, y: L.s.y }; lastStroke = null; $('strokes').textContent = strokes;
        sfx('pop'); bigText('<span class="small-pop">🏌️ Golden Tee!</span>', 1500); $('tip').textContent = 'A free do-over. Totally legal.';
      }
      pack = await backpack(); renderCheats();
    };
  });
}
function renderCheats() {
  renderPack();
  const el = $('cheats');
  if (n() === 1 || (mode !== 'aim' && mode !== 'wedge')) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<span class="lbl">Cheat (if you dare)</span>
    <button id="chWedge" ${cheatsUsed & 1 ? 'disabled' : ''} aria-pressed="${mode === 'wedge'}">🦶 Foot wedge</button>
    <button id="chMull" ${cheatsUsed & 2 || !lastStroke ? 'disabled' : ''}>🔄 Mulligan</button>
    <button id="chPencil" ${cheatsUsed & 4 ? 'aria-pressed="true"' : ''}>✏️ Pencil whip${cheatsUsed & 4 ? ' (on)' : ''}</button>`;
  $('chWedge').onclick = () => { mode = mode === 'wedge' ? 'aim' : 'wedge'; $('tip').textContent = mode === 'wedge' ? 'Tap a spot near your ball to kick it there. Nobody saw that.' : 'Foot wedge cancelled.'; renderCheats(); };
  $('chMull').onclick = () => {
    const L = lastStroke; if (!L) return;
    current.pop(); strokes -= 1 + L.penalty; scene.clock = L.clockBefore; scene.flagOut = false;
    scene.ball = { x: L.s.x, y: L.s.y }; lastStroke = null; cheatsUsed |= 2;
    $('strokes').textContent = strokes; $('tip').textContent = 'Mulligan! That putt never happened.'; renderCheats();
  };
  $('chPencil').onclick = () => { cheatsUsed ^= 4; $('tip').textContent = cheatsUsed & 4 ? "Pencil whip on: you'll write down one stroke fewer." : 'Pencil whip off. Honest scoring.'; renderCheats(); };
}
function wedgeTo(pt) {
  const h = H(), b = scene.ball, dx = pt.x - b.x, dy = pt.y - b.y, d = Math.sqrt(dx * dx + dy * dy);
  const k = d > 45 ? 45 / d : 1, x = q20(b.x + dx * k), y = q20(b.y + dy * k);
  if (!clearSpot(h, x, y)) { $('tip').textContent = "Can't kick it there. Pick an open spot."; return; }
  scene.ball = { x, y }; cheatsUsed |= 1; mode = 'aim'; lastStroke = null;
  $('tip').textContent = '*whistles innocently* Drag back and let go.'; renderCheats();
}

// ---------------------------------------------------------------- finishing a hole
async function finishTurn(holed) {
  mode = 'done'; $('cheats').hidden = true; $('pack').innerHTML = '';
  const par = HOLES[curHole()].par, t = G.game.t;
  if (holed) celebrate(strokes, par);
  const { data, error } = await sb.rpc('golf_submit_turn', { p_game: G.game.id, p_strokes: current.map(fromStroke), p_actual: strokes, p_cheats: cheatsUsed, p_holed: holed });
  if (error) { $('tip').textContent = `Couldn't save that hole: ${friendly(error)}`; return; }
  markSeen(t);
  $('tip').textContent = (holed ? `In the cup: ${scoreWord(strokes, par)}.` : `Picked up after ${MAX_STROKES} strokes.`)
    + (data.earned ? ` You earned ${data.earned} sneak attack${data.earned > 1 ? 's' : ''}!` : '')
    + (cheatsUsed & 4 ? ` You wrote down ${data.written}. 🤫` : '') + (data.penalty ? ` (+${data.penalty} for the false accusation.)` : '');
  notify('golf', G.game.id);
  announceChaos({ gameId: G.game.id }); pack = await backpack();
  await sleep(holed && strokes === 1 && !reduceMotion ? 1800 : 300);
  await load(G.game.id);
  if (G.game.status === 'over' || n() === 1) { afterPanel = false; return decide(); }
  afterPanel = true; renderAfter(); decide();
}
// After your hole: plant a sneak attack, then hand over.
let pick = { target: null, type: 0 }, planted = null;
function renderAfter() {
  const el = $('send'); el.hidden = false;
  const tokens = pl(me.id).tokens, next = curPlayer();
  const targets = G.game.players.filter((p) => p !== me.id);
  let h = '<div class="attack">';
  if (planted) h += `<h3>🤫 Planted</h3><p class="small">${ATTACKS[planted.type].icon} ${ATTACKS[planted.type].name} is waiting for ${nm(planted.target)} on their next hole.</p>`;
  else if (!tokens) h += '<h3>Sneak attack</h3><p class="small muted">You have none left. Birdie or better earns one, and a hole in one earns two.</p>';
  else {
    h += `<div class="row between"><h3>Sneak attack</h3><span class="tokens small">${'🎯'.repeat(tokens)} ${tokens} left</span></div>
      <p class="small muted">It hits that player's next hole, and they only find out when they tee off.</p>
      <div class="choice">${targets.map((p) => `<label><input type="radio" name="atkT" value="${p}" ${pick.target === p ? 'checked' : ''}>${nm(p)}</label>`).join('')}</div>
      <div class="atk-list">${ATTACKS.slice(1).map((a, k) => `<button type="button" data-atk="${k + 1}" aria-pressed="${pick.type === k + 1}"><b>${a.icon} ${a.name}</b><span class="small muted">${a.desc}</span></button>`).join('')}</div>
      <div class="row"><button class="go" id="plant" ${pick.target && pick.type ? '' : 'disabled'}>Plant it</button><span class="small muted" id="plantErr"></span></div>`;
  }
  h += '</div>';
  h += isBot(next) ? `<div class="row between"><strong>${nm(next)} is up next.</strong><button class="go" id="botGo">Let it play</button></div>`
    : `<div class="row between"><strong>${nm(next)} is up next. They'll get an alert.</strong><button id="doneAfter">Done</button></div>`;
  el.innerHTML = h;
  el.querySelectorAll('input[name=atkT]').forEach((r) => { r.onchange = () => { pick.target = r.value; renderAfter(); }; });
  el.querySelectorAll('[data-atk]').forEach((b) => { b.onclick = () => { pick.type = +b.dataset.atk; renderAfter(); }; });
  const plant = $('plant');
  if (plant) plant.onclick = async () => {
    plant.disabled = true;
    const { error } = await sb.rpc('golf_plant', { p_game: G.game.id, p_target: pick.target, p_type: pick.type });
    if (error) { $('plantErr').textContent = friendly(error); return; }
    sfx('sneaky'); nudge(); planted = { ...pick }; pick = { target: null, type: 0 }; await load(G.game.id); renderAfter();
  };
  const close = () => { el.hidden = true; afterPanel = false; planted = null; pick = { target: null, type: 0 }; };
  const bg = $('botGo'); if (bg) bg.onclick = () => { close(); window.scrollTo(0, 0); decide(); };
  const dn = $('doneAfter'); if (dn) dn.onclick = close;
}

// ---------------------------------------------------------------- the robot (played out on this device)
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
// Test-rolls about a thousand putts through the real physics and keeps the best, then wobbles it by skill.
function botAim() {
  const h = H(), bx = q20(scene.ball.x), by = q20(scene.ball.y), clock = scene.clock || 0, [cx, cy] = h.cup;
  const weak = curAttack === 5 ? 0.67 : 1;
  let best = null;
  const trial = (ang, p) => {
    const sp = (0.6 + p * 10.4) * weak, b = { x: bx, y: by, vx: q100(Math.cos(ang) * sp), vy: q100(Math.sin(ang) * sp), ticks: 0, clock };
    let ev; do { ev = tick(b, h); } while (ev !== 'cup' && ev !== 'water' && ev !== 'stop');
    const sc = ev === 'cup' ? -1000 + p : ev === 'water' ? 1000 : Math.sqrt((b.x - cx) ** 2 + (b.y - cy) ** 2) + (h.sand.some((r) => inRect(b.x, b.y, r)) ? 20 : 0);
    if (!best || sc < best.sc) best = { sc, ang, p };
  };
  for (let a = 0; a < 360; a += 5) for (let p = 0.06; p <= 1.0001; p += 0.08) trial((a * Math.PI) / 180, p);
  const a0 = best.ang, p0 = best.p;
  for (let da = -4; da <= 4; da++) for (let dp = -0.06; dp <= 0.0601; dp += 0.02) trial(a0 + (da * Math.PI) / 180, Math.min(1, Math.max(0.04, p0 + dp)));
  const sk = botSkill(), ang = best.ang + (gauss() * sk.aim * Math.PI) / 180, p = Math.min(1, Math.max(0.04, best.p * (1 + gauss() * sk.power)));
  const sp = (0.6 + p * 10.4) * weak;
  return { ang, p, vx: q100(Math.cos(ang) * sp), vy: q100(Math.sin(ang) * sp) };
}
async function robotTurn() {
  flowing = true;
  const bot = curPlayer(), t = G.game.t, sk = botSkill();
  const { data: atk } = await sb.rpc('golf_bot_attack', { p_game: G.game.id });
  curAttack = atk?.type || 0; curAttacker = atk?.attacker || null;
  const h = H();
  cheatsUsed = 0; strokes = 0; current = []; mode = 'bot'; $('pack').innerHTML = '';
  scene = { hole: h, fx: [], clock: 0, ball: { x: h.tee[0], y: h.tee[1] } };
  setHud(curHole(), bot, 0, false); renderCard();
  if (curAttack) { sfx('sneaky'); bigText(`<span class="small-pop">${ATTACKS[curAttack].icon} ${ATTACKS[curAttack].name}!</span>`, 1700); $('tip').textContent = `${nm(bot).replace(/<[^>]+>/g, '')} got hit with ${ATTACKS[curAttack].name}. Heh.`; await sleep(1500); }
  let holed = false;
  while (strokes < MAX_STROKES) {
    // Foot wedge when nobody's looking.
    if (!(cheatsUsed & 1) && Math.random() < sk.cheat * 0.5) {
      const b = scene.ball, [cx, cy] = h.cup, d = Math.sqrt((cx - b.x) ** 2 + (cy - b.y) ** 2);
      if (d > 70) { const x = q20(b.x + ((cx - b.x) * 45) / d), y = q20(b.y + ((cy - b.y) * 45) / d); if (clearSpot(h, x, y)) { scene.ball = { x, y }; cheatsUsed |= 1; } }
    }
    $('tip').textContent = `${nm(bot).replace(/<[^>]+>/g, '')} is lining up a putt…`;
    await sleep(350);
    const shot = botAim();
    scene.aim = { bx: scene.ball.x, by: scene.ball.y, dx: Math.cos(shot.ang), dy: Math.sin(shot.ang), p: shot.p };
    await sleep(reduceMotion ? 0 : 650);
    scene.aim = null;
    const s = { x: q20(scene.ball.x), y: q20(scene.ball.y), vx: shot.vx, vy: shot.vy }, clockBefore = scene.clock || 0;
    current.push(s); $('tip').textContent = '';
    const { ev, b } = await roll(s, h);
    const r = afterStroke(ev, b, h, s.x, s.y);
    strokes += 1 + r.penalty; $('strokes').textContent = strokes;
    if (r.holed) { holed = true; break; }
    const far = Math.sqrt((b.x - h.cup[0]) ** 2 + (b.y - h.cup[1]) ** 2);
    if (!(cheatsUsed & 2) && (far > 90 || r.penalty) && Math.random() < sk.cheat) {   // mulligan
      current.pop(); strokes -= 1 + r.penalty; scene.clock = clockBefore; scene.ball = { x: s.x, y: s.y }; cheatsUsed |= 2; $('strokes').textContent = strokes;
    }
    await sleep(450);
  }
  if (holed && strokes > 1 && Math.random() < sk.cheat) cheatsUsed |= 4;   // pencil whip
  if (holed) celebrate(strokes, HOLES[curHole()].par);
  const { error } = await sb.rpc('golf_submit_bot_turn', { p_game: G.game.id, p_strokes: current.map(fromStroke), p_actual: strokes, p_cheats: cheatsUsed, p_holed: holed });
  curAttack = 0;
  markSeen(t);
  if (!error) { notify('golf', G.game.id); announceChaos({ gameId: G.game.id }); }
  $('tip').textContent = holed ? `${nm(bot).replace(/<[^>]+>/g, '')}: ${scoreWord(strokes, HOLES[curHole()].par)}.` : '';
  await sleep(1200);
  // Did it call cheater on the hole before?
  await load(G.game.id);
  const call = G.acc.find((a) => a.t === t - 1 && a.accuser === bot);
  if (call) {
    await new Promise((resolve) => {
      if (call.busted) { bigText('<span class="busted">BUSTED!</span>', 2600); shake(); sfx('buzz'); }
      modal(`<div style="font-size:44px;line-height:1">🤖</div><h2 ${call.busted ? 'style="color:#FF7A6E"' : ''}>"CHEATER DETECTED."</h2>
        <p>${call.busted ? `It caught ${who(call.accused)}: ${[1, 2, 4].filter((k) => call.cheats & k).map((k) => CHEAT_NAMES[k]).join(', ')}.` : `…except ${who(call.accused)} played it straight. False alarm!`}</p>
        <p class="small muted">${call.busted ? `+${2 + (call.cheats & 4 ? 1 : 0)} strokes on that hole.` : 'The robot takes +1 stroke on its next hole.'}</p><button class="go" id="onward">${call.busted ? 'Fine…' : 'Ha!'}</button>`);
      $('onward').onclick = () => { closeModal(); resolve(); };
    });
  }
  flowing = false;
  decide();
}

// ---------------------------------------------------------------- the end
async function showFinal() {
  mode = 'over';
  $('cheats').hidden = true; $('send').hidden = true;
  renderCard();
  const st = standings().filter((s) => s.played);
  if (!st.length) return;
  const best = Math.min(...st.map((s) => s.toPar)), winners = st.filter((s) => s.toPar === best).map((s) => s.p);
  let h;
  if (n() === 1) {
    const { data: b } = await sb.from('golf_best').select('best').eq('player', me.id).eq('start', G.game.start).eq('count', G.game.count).maybeSingle();
    const full = !G.turns.some((x) => x.skipped), isBest = full && b && b.best === st[0].toPar;
    h = `<h2>⛳ Round complete!</h2><p><strong>${st[0].strokes}</strong> strokes, ${fmtPar(st[0].toPar)}</p>
      ${isBest ? '<p>🏆 Your personal best on this course!</p>' : b ? `<p class="muted small">Personal best: ${fmtPar(b.best)}</p>` : ''}
      ${full ? '' : '<p class="muted small">Some holes were skipped, so this round doesn\'t count for a personal best.</p>'}`;
  } else {
    const award = (k, label) => { const m = Math.max(...G.players.map((x) => x[k])); return m ? `<p class="small">${label}: <strong>${G.players.filter((x) => x[k] === m).map((x) => who(x.player)).join(' & ')}</strong> (${m})</p>` : ''; };
    const log = G.secrets.filter((s) => s.cheats).map((s) => { const tu = G.turns.find((x) => x.t === s.t); return `${who(s.player)}: ${[1, 2, 4].filter((k) => s.cheats & k).map((k) => CHEAT_NAMES[k]).join(', ')} on hole ${tu ? tu.hole + 1 : '?'}`; });
    h = `<h2>🏆 ${winners.map(who).join(' & ')} ${winners.length > 1 ? 'tie' : winners[0] === me.id ? 'win!' : 'wins!'}</h2><p class="muted">${fmtPar(best)}</p>
      ${award('away', '🦊 Sneakiest, cheats that got away')}${award('catches', '🔍 Sharpest eye')}${award('busted', '🚨 Most busted')}
      ${log.length ? `<details><summary class="small">The truth comes out</summary><ul class="small" style="text-align:left;margin:6px 0 0;padding-left:18px">${log.map((l) => `<li>${l}</li>`).join('')}</ul></details>` : '<p class="small muted">Nobody cheated. Allegedly.</p>'}`;
  }
  modal(`${h}<a class="go" href="./" style="text-decoration:none;display:inline-block;border-radius:12px;padding:10px 22px;background:var(--flag);color:#fff;font-family:var(--display)">Back to all games</a>`);
  for (let i = 0; i < 4; i++) setTimeout(() => burst(60 + Math.random() * 240, 80 + Math.random() * 200, ['#F2C14E', '#E4572E', '#7FD3F7', '#fff'], 50, 0.05), i * 350);
}

// ---------------------------------------------------------------- skip ahead, delete
$('jumpGo').onclick = async () => {
  const btn = $('jumpGo'), target = +$('jumpTo').value;
  if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Tap again to skip for everyone'; $('jumpNote').textContent = `Unplayed holes before ${target + 1} are marked skipped and left out of scores.`; return; }
  delete btn.dataset.armed; btn.textContent = 'Skip';
  const { error } = await sb.rpc('golf_skip_to', { p_game: G.game.id, p_hole: target });
  if (error) { $('jumpNote').textContent = friendly(error); return; }
  mode = 'idle'; await load(G.game.id); notify('golf', G.game.id); decide();
};
$('del').onclick = async () => {
  const b = $('del');
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to delete the game for everyone'; return; }
  const { error } = await sb.rpc('golf_delete', { p_game: G.game.id });
  if (error) { b.textContent = friendly(error); return; }
  location.href = './';
};

// ---------------------------------------------------------------- start
(async () => {
  if (!(await signedIn())) return;
  const id = (location.hash.match(/game=([0-9a-f-]{36})/) || [])[1];
  if (!id || !(await load(id))) { $('holeName').textContent = 'Game not found'; $('holeNo').textContent = 'It may have been deleted.'; return; }
  sizeCanvas(); addEventListener('resize', sizeCanvas);
  pack = await backpack();
  announceChaos({ gameId: id });
  requestAnimationFrame(loop);
  let pending = false;
  const refresh = () => { if (pending) return; pending = true; setTimeout(async () => { pending = false; await load(id); renderCard(); announceChaos({ gameId: id }); if (mode === 'idle' && !flowing) decide(); }, 200); };
  liveGame(`golf-${id}`, [
    { event: '*', table: 'golf_games', filter: `id=eq.${id}` },
    { event: 'INSERT', table: 'golf_turns', filter: `game_id=eq.${id}` },
    { event: 'INSERT', table: 'golf_accusations', filter: `game_id=eq.${id}` },
  ], refresh, async () => {
    if (!G) return;
    const { data } = await sb.from('golf_games').select('updated_at').eq('id', id).maybeSingle();
    if (data && data.updated_at !== G.game.updated_at) refresh();
  });
  navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.url) location.href = e.data.url; });
  decide();
})();
