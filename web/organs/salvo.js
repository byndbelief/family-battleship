// ⚓ Salvo, an organ of the shell: Battleship's DNA in thirty-second bites. Enemy fleets drift across
// the lanes of a shared ocean above your gunboat; tap to fire a shell where they'll be. Every cell of a
// ship must burn to sink it (100 × its length, × the Fibonacci combo). They fire back: torpedoes run
// down at your boat, and a tap on one blows it up. The box's beats decide the sea: a peak sends a big
// ship (a flagship at x > 0.9), the window sends threes in one lane, the mirror is a Sierpiński salvo
// (your next shot is three), the balance reloads, the golden cut sails a golden ship, gift is a free
// shell. Twists: 🌫️ fog, 🐙 the kraken (tap its arms), ⛈️ storm (double speed), 🌀 whirlpool (shells
// drift). Six shells a clip; tap the gunboat (or R) to reload.
import { fibMult } from '../chaos.js';

const W = 400, LANES = 6, AMMO = 6, RELOAD_S = 1.2, CELL = 40;
const laneY = (i) => H() * 0.2 + i * ((H() * 0.5) / (LANES - 1));   // the lanes fill the middle of the sea, clear of the HUD and the boat
const TWISTS = [
  ['🌫️ FOG', 'the sea hides them: fire at the wakes', 'fog'],
  ['🐙 THE KRAKEN', 'tap its arms before they drag a ship to you', 'kraken'],
  ['⛈️ STORM', 'the fleets run at double speed', 'storm'],
  ['🌀 WHIRLPOOL', 'your shells drift with the current', 'whirl'],
];
let host, ctx, S, sfx, g = null, sunkN = 0, shotsN = 0;
const H = () => host.H;
const BOAT = () => ({ x: W / 2, y: H() - 78 });   // above the shell's corner chips

function newGame() { g = { ships: [], shells: [], torps: [], fx: [], arms: [], ammo: AMMO, reloadT: 0, time: 0, twist: null, salvo: 0, wave: 0, fog: 0, spawnT: 0 }; sunkN = 0; shotsN = 0; }
function spawn(len, gold = false, lane = null) {
  if (g.ships.length >= 9) return;
  const l = lane ?? Math.floor(Math.random() * LANES), dir = Math.random() < 0.5 ? 1 : -1;
  const spd = (26 + Math.random() * 18) * (5 - len) / 2 * (gold ? 1.6 : 1);
  g.ships.push({ lane: l, x: dir > 0 ? -len * CELL : W + len * CELL, dir, len, spd, hits: new Array(len).fill(false), gold, hue: gold ? 48 : [0, 200, 280, 120, 25][Math.floor(Math.random() * 5)] });
}
function onBeat(ev) {
  const x = ev.x;
  if (ev.window) { const lane = Math.floor(Math.random() * LANES); for (let i = 0; i < 3; i++) spawn(2, false, lane); }
  else if (x > 0.9) spawn(4);
  else if (x > 0.75) spawn(3);
  else if (x > 0.5) spawn(2 + Math.floor(Math.random() * 2));
  else if (x > 0.3) spawn(2);
  if (ev.gift) { g.ammo = Math.min(AMMO + 2, g.ammo + 1); }
  if (ev.mirror) { g.salvo = 3; g.fx.push({ kind: 'text', x: W / 2, y: H() * 0.5, text: '✨ SIERPIŃSKI SALVO: 3 shells', life: 1.4 }); sfx('chime'); }
  if (ev.balance) { g.ammo = AMMO; g.reloadT = 0; sfx('chime'); }
  if (ev.golden) spawn(3, true);
  if (ev.fib) spawn(2);
  // 🐟 They fire back: the wilder the curve, the more torpedoes.
  if (x > 0.55 && !ev.window && g.torps.length < 2 && g.ships.length && Math.random() < 0.35 + (S.curve.r >= 3.5699 ? 0.2 : 0)) {
    const s = g.ships[Math.floor(Math.random() * g.ships.length)], b = BOAT();
    g.torps.push({ x0: s.x + s.len * CELL / 2 * 0, y0: laneY(s.lane), x1: b.x + (Math.random() - 0.5) * 40, y1: b.y - 8, t: 0, tf: 2.6 - Math.min(0.8, S.curve.r - 2.9) });
    g.torps[g.torps.length - 1].x0 = s.x;
  }
  if (ev.big && !g.twist) twist();
}
function twist() {
  const [title, sub, kind] = TWISTS[Math.floor(Math.random() * TWISTS.length)];
  g.twist = { kind, until: g.time + 6 }; host.banner(title, sub); sfx(kind === 'kraken' ? 'thud' : 'twist');
  if (kind === 'kraken') for (let i = 0; i < 5; i++) g.arms.push({ x: 40 + i * 80 + Math.random() * 30, y: H() + 10, h: 0, hmax: 120 + Math.random() * 120, t: Math.random() * 6, alive: true });
}
const torpPos = (t) => { const e = Math.min(1, t.t / t.tf); return { x: t.x0 + (t.x1 - t.x0) * e, y: t.y0 + (t.y1 - t.y0) * e }; };
function fire(x, y) {
  if (!g || S.over) return;
  const b = BOAT();
  // a torpedo under your finger: blow it up, whatever you're doing
  const tp = g.torps.find((t) => { const q = torpPos(t); return Math.hypot(q.x - x, q.y - y) < 30; });
  if (tp) { const q = torpPos(tp); g.torps.splice(g.torps.indexOf(tp), 1); host.add(25); splash(q.x, q.y, '#FFE08A', 14); g.fx.push({ kind: 'text', x: q.x, y: q.y - 10, text: 'DEFUSED +25', life: 0.9 }); sfx('clack'); return; }
  const arm = g.arms.find((a) => a.alive && Math.abs(a.x - x) < 22 && y > H() - a.h - 10);
  if (arm) { arm.alive = false; host.add(60); splash(arm.x, H() - arm.h / 2, '#C9B8FF', 16); g.fx.push({ kind: 'text', x: arm.x, y: H() - a_h(arm), text: 'ARM OFF +60', life: 0.9 }); sfx('thud'); return; }
  if (Math.hypot(x - b.x, y - b.y) < 36) return reload();
  if (g.reloadT > 0) { sfx('buzz'); return; }
  if (g.ammo <= 0) { reload(); return; }
  g.ammo -= 1; shotsN += 1;
  const shots = g.salvo ? [[0, 0], [-CELL, CELL * 0.6], [CELL, CELL * 0.6]] : [[0, 0]];
  shots.forEach(([dx, dy]) => g.shells.push({ x0: b.x, y0: b.y - 10, x: x + dx, y: y + dy, t: 0, tf: 0.42 + Math.hypot(x - b.x, y - b.y) / 1400 }));
  if (g.salvo) { g.salvo = 0; sfx('cannon'); } else sfx('cannon');
  if (g.ammo === 0) reload();
}
const a_h = (a) => a.h;
function reload() { if (g.reloadT > 0 || g.ammo >= AMMO) return; g.reloadT = RELOAD_S; sfx('tick'); }
function land(x, y) {
  const s = g.ships.find((sh) => Math.abs(laneY(sh.lane) - y) < 18 && x > sh.x - 4 && x < sh.x + sh.len * CELL + 4);
  if (!s) { splash(x, y, '#BFE9FF', 10); S.combo = 0; g.fx.push({ kind: 'text', x, y: y - 8, text: 'SPLASH', life: 0.7, col: '#BFE9FF' }); sfx('splash'); return; }
  const i = Math.max(0, Math.min(s.len - 1, Math.floor((x - s.x) / CELL)));
  if (s.hits[i]) { splash(x, y, '#FFB07A', 6); return; }
  s.hits[i] = true; splash(x, y, '#FF8A3D', 16); sfx('boom', { size: 0.8 });
  if (s.hits.every(Boolean)) {
    g.ships.splice(g.ships.indexOf(s), 1); sunkN += 1;
    S.combo = S.comboT > 0 ? S.combo + 1 : 1; S.comboT = 2;
    const pts = (s.gold ? 500 : 100 * s.len) * fibMult(S.combo); host.add(pts);
    g.fx.push({ kind: 'text', x: s.x + s.len * CELL / 2, y: laneY(s.lane) - 14, text: `${s.gold ? 'GOLDEN ' : ''}SUNK +${pts}`, life: 1.2, big: true, col: s.gold ? '#F5C542' : '#FFE08A' });
    splash(s.x + s.len * CELL / 2, laneY(s.lane), s.gold ? '#F5C542' : '#FF5A3A', 30); sfx(s.gold ? 'chime' : 'boom', { size: 1.2 }); host.S.combo >= 3 && sfx('cheer', { delay: 0.1 });
  } else { host.add(20); g.fx.push({ kind: 'text', x, y: y - 10, text: 'HIT +20', life: 0.8 }); }
}
function splash(x, y, c, n) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, v = 40 + Math.random() * 120; g.fx.push({ kind: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 50, c, life: 0.7, r: 1.5 + Math.random() * 2 }); } }
function update(dt) {
  g.time += dt;
  if (g.twist && g.time > g.twist.until) { g.twist = null; g.arms = []; }
  g.fog += ((g.twist?.kind === 'fog' ? 1 : 0) - g.fog) * Math.min(1, dt * 3);
  const spd = g.twist?.kind === 'storm' ? 2 : 1;
  g.ships.forEach((s) => { s.x += s.dir * s.spd * spd * dt; if ((s.dir > 0 && s.x > W + 20) || (s.dir < 0 && s.x + s.len * CELL < -20)) { s.dir *= -1; s.lane = Math.floor(Math.random() * LANES); } });
  if (g.reloadT > 0) { g.reloadT -= dt; if (g.reloadT <= 0) { g.reloadT = 0; g.ammo = AMMO; } }
  const whirl = g.twist?.kind === 'whirl' ? 1 : 0;
  g.shells = g.shells.filter((s) => { s.t += dt; if (whirl) s.x += Math.sin(g.time * 3 + s.y) * 40 * dt; if (s.t >= s.tf) { land(s.x, s.y); return false; } return true; });
  g.torps = g.torps.filter((t) => { t.t += dt; if (t.t >= t.tf) { const b = BOAT(); splash(b.x, b.y - 10, '#FF5A3A', 24); sfx('boom'); navigator.vibrate?.(100); host.hurt('torpedoed') || host.banner('HIT', `${S.hearts} ${S.hearts === 1 ? 'heart' : 'hearts'} left`); S.combo = 0; return false; } return true; });
  g.arms.forEach((a) => { a.t += dt; if (a.alive) a.h = Math.min(a.hmax, a.h + 60 * dt); else a.h = Math.max(0, a.h - 200 * dt);
    if (a.alive && a.h >= a.hmax && Math.random() < dt * 0.5) { const s = g.ships.find((sh) => Math.abs(sh.x + sh.len * CELL / 2 - a.x) < 60); if (s) { g.ships.splice(g.ships.indexOf(s), 1); g.fx.push({ kind: 'text', x: a.x, y: H() - a.h, text: 'DRAGGED UNDER', life: 1, col: '#C9B8FF' }); } } });
  g.arms = g.arms.filter((a) => a.alive || a.h > 0);
  g.fx.forEach((f) => { f.life -= dt; if (f.kind === 'dot') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 300 * dt; } else f.y -= 24 * dt; });
  g.fx = g.fx.filter((f) => f.life > 0);
  g.wave += dt;
}
function draw(t) {
  const k = host.k, Hh = H();
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const sea = ctx.createLinearGradient(0, 0, 0, Hh); sea.addColorStop(0, '#0B2A44'); sea.addColorStop(1, '#0A1626');
  ctx.fillStyle = sea; ctx.fillRect(0, 0, W, Hh);
  ctx.strokeStyle = '#ffffff10'; ctx.lineWidth = 1; for (let i = 0; i < LANES; i++) { ctx.beginPath(); ctx.moveTo(0, laneY(i) + 20); ctx.lineTo(W, laneY(i) + 20); ctx.stroke(); }
  ctx.strokeStyle = '#ffffff22'; for (let i = 0; i < 14; i++) { const y = 40 + i * (Hh / 14), ph = t / 900 + i; ctx.beginPath(); for (let x = 0; x <= W; x += 10) ctx.lineTo(x, y + Math.sin(x / 30 + ph) * 3); ctx.stroke(); }
  if (!g) return;
  g.ships.forEach((s) => {
    const y = laneY(s.lane), hidden = g.fog > 0.5 && !s.hits.some(Boolean);
    ctx.save(); ctx.globalAlpha = hidden ? 0.12 : 1;
    ctx.fillStyle = s.gold ? '#F5C542' : `hsl(${s.hue} 45% 42%)`; ctx.strokeStyle = s.gold ? '#FFF1B8' : `hsl(${s.hue} 80% 70%)`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(s.x, y - 12, s.len * CELL, 24, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff33'; ctx.fillRect(s.x + 8, y - 6, s.len * CELL - 16, 4);
    ctx.fillStyle = '#0A1626'; ctx.beginPath(); ctx.arc(s.x + (s.dir > 0 ? s.len * CELL - 10 : 10), y, 4, 0, 7); ctx.fill();
    s.hits.forEach((h, i) => { if (!h) return; const cx = s.x + i * CELL + CELL / 2; ctx.fillStyle = `rgba(255,${120 + Math.sin(t / 60 + i) * 60 | 0},40,0.9)`; ctx.beginPath(); ctx.arc(cx, y, 9 + Math.sin(t / 90 + i) * 2, 0, 7); ctx.fill(); ctx.fillStyle = '#ffffff55'; ctx.beginPath(); ctx.arc(cx + 3, y - 14 - (t / 20 + i * 30) % 24, 5, 0, 7); ctx.fill(); });
    ctx.restore();
    if (hidden && Math.random() < 0.06) { ctx.strokeStyle = '#ffffff55'; ctx.beginPath(); ctx.moveTo(s.x - s.dir * 10, y + 6); ctx.lineTo(s.x - s.dir * 30, y + 8); ctx.stroke(); }
  });
  g.torps.forEach(({ t: tt, ...tp }) => { const q = torpPos({ t: tt, ...tp }); ctx.fillStyle = '#1B1B22'; ctx.strokeStyle = '#FF5A3A'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(q.x, q.y, 5, 11, Math.atan2(tp.y1 - tp.y0, tp.x1 - tp.x0) - Math.PI / 2, 0, 7); ctx.fill(); ctx.stroke(); ctx.strokeStyle = '#ffffff44'; ctx.beginPath(); ctx.moveTo(q.x, q.y - 12); ctx.lineTo(q.x + (Math.random() - 0.5) * 6, q.y - 30); ctx.stroke(); });
  g.arms.forEach((a) => { if (a.h <= 0) return; ctx.strokeStyle = a.alive ? '#5A2A7A' : '#3A1A4A'; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(a.x, Hh + 10); ctx.bezierCurveTo(a.x + Math.sin(a.t) * 30, Hh - a.h * 0.5, a.x - Math.sin(a.t * 1.3) * 30, Hh - a.h * 0.8, a.x + Math.sin(a.t * 0.7) * 20, Hh - a.h); ctx.stroke(); ctx.fillStyle = '#C9B8FF'; for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.arc(a.x + Math.sin(a.t + i) * 12, Hh - a.h * i / 4, 3, 0, 7); ctx.fill(); } });
  g.shells.forEach((s) => { const e = s.t / s.tf, x = s.x0 + (s.x - s.x0) * e, y = s.y0 + (s.y - s.y0) * e - Math.sin(e * Math.PI) * 60; ctx.fillStyle = '#FFE08A'; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); ctx.strokeStyle = '#ffffff33'; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(s.x, s.y); ctx.stroke(); ctx.setLineDash([]); ctx.strokeStyle = '#FF5A4A88'; ctx.beginPath(); ctx.arc(s.x, s.y, 8, 0, 7); ctx.stroke(); });
  if (g.fog > 0.02) { ctx.fillStyle = `rgba(200,210,230,${0.35 * g.fog})`; ctx.fillRect(0, 0, W, Hh * 0.8); }
  // your gunboat, shells left, the reload bar
  const b = BOAT();
  ctx.save(); ctx.translate(b.x, b.y);
  ctx.fillStyle = '#2B2B33'; ctx.beginPath(); ctx.roundRect(-34, -10, 68, 20, 8); ctx.fill(); ctx.fillStyle = '#E4572E'; ctx.beginPath(); ctx.roundRect(-14, -22, 28, 14, 4); ctx.fill(); ctx.fillStyle = '#DDE3E8'; ctx.fillRect(-3, -34, 6, 14);
  for (let i = 0; i < AMMO; i++) { ctx.fillStyle = i < g.ammo && !g.reloadT ? '#F2F4F6' : '#ffffff22'; ctx.fillRect(-28 + i * 9, 2, 6, 5); }
  if (g.reloadT > 0) { ctx.fillStyle = '#F5C542'; ctx.fillRect(-34, -30, 68 * (1 - g.reloadT / RELOAD_S), 3); }
  if (g.salvo) { ctx.fillStyle = '#C9B8FF'; ctx.font = '900 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('✨ ×3', 0, -38); }
  ctx.restore();
  g.fx.forEach((f) => { ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.5)); if (f.kind === 'dot') { ctx.fillStyle = f.c; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill(); } else { ctx.font = f.big ? '400 20px Bungee, Impact, sans-serif' : '900 14px Nunito, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = f.col || '#FFE08A'; ctx.strokeStyle = '#001020'; ctx.lineWidth = 4; ctx.strokeText(f.text, f.x, f.y); ctx.fillText(f.text, f.x, f.y); } });
  ctx.globalAlpha = 1;
}
const organ = {
  key: 'salvo', name: 'Salvo', icon: '⚓', verb: 'tap the sea to fire · tap torpedoes', beat: 0.9,
  theme: { bg: '#0A1626', gold: '#F5C542', bannerc: '#BFE9FF' },
  init(h) { host = h; ctx = h.ctx; S = h.S; sfx = h.sfx; window.__sv = organ.debug; },
  start() { newGame(); for (let i = 0; i < 3; i++) spawn(2 + (i % 2)); },
  enter(from) { if (!g) organ.start(); host.ui(''); if (from) { g.torps = []; if (!g.ships.length) for (let i = 0; i < 3; i++) spawn(2); } },
  leave() { return BOAT(); },
  update, draw, onBeat,
  pointer(type, p) { if (type === 'down') fire(p.x, p.y); },
  keydown(e) { if (e.key === 'r' || e.key === 'R') reload(); },
  hudLine: () => (g ? `⚓ ${sunkN} sunk · ${g.ships.length} at sea` : ''),
  level: () => 1 + Math.floor(sunkN / 5),
  overText: (how) => (how === 'torpedoed' ? ['💥 GUNBOAT DOWN', 'Too many torpedoes got through.'] : ['RUN OVER', '']),
  endStats: () => (g ? `⚓ ${sunkN} sunk from ${shotsN} shells` : ''),
  debug: () => g && ({ ships: g.ships.map((s) => ({ x: s.x, y: laneY(s.lane), len: s.len, hits: s.hits.filter(Boolean).length })), torps: g.torps.map(torpPos), ammo: g.ammo, sunk: sunkN, twist: g.twist?.kind || null, arms: g.arms.length, W, H: H() }),
};
export default organ;
