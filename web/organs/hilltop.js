// 💥 Hilltop, an organ of the shell: Hilltop Duel's DNA, you against the hill. Your tank sits on the
// left of a fractal ridge (midpoint displacement); enemy tanks dig in on the right. Drag to aim (the
// drag's angle and length), let go to fire: shells arc on gravity and wind, crater the hill, and a hit
// is 150 × the Fibonacci combo. They fire back. The box's beats run the war: a peak digs in a new tank
// (a meteor at x > 0.9), the window sets three tanks that hold their fire, the mirror splits your next
// shell in three (a fractal shell), the balance stills the wind, the golden cut sends a golden tank
// (500), gift is a shield, a Fibonacci beat is a bigger blast. Twists: 💨 gale, ☄️ meteor shower,
// 🌱 regrowth (the hill heals), 🌙 night (tanks only show when they fire).
import { fibMult } from '../chaos.js';
import { drawPal } from '../pals.js';

const W = 400, G = 620, TANK_W = 22;
const TWISTS = [
  ['💨 GALE', 'the wind howls: lead your shots', 'gale'],
  ['☄️ METEOR SHOWER', 'watch the sky', 'meteors'],
  ['🌱 REGROWTH', 'the hill heals its craters', 'regrow'],
  ['🌙 NIGHT', 'they only show when they fire', 'night'],
];
let host, ctx, S, sfx, g = null, killsN = 0, shotsN = 0, drag = null;
const H = () => host.H;
const rng = (seed) => { let x = (seed >>> 0) || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; };
// The ridge: midpoint displacement, 0..W in 4 px steps.
function ridge(seed) {
  const r = rng(seed), n = 101, h = new Array(n).fill(0), base = H() * 0.66;
  h[0] = base + 40; h[n - 1] = base - 60 + r() * 40; h[50] = base - 20 + r() * 60;
  const sub = (a, b, amp) => { if (b - a < 2) return; const m = (a + b) >> 1; h[m] = (h[a] + h[b]) / 2 + (r() - 0.5) * amp; sub(a, m, amp * 0.55); sub(m, b, amp * 0.55); };
  sub(0, 50, 90); sub(50, n - 1, 90);
  return h.map((v) => Math.max(H() * 0.3, Math.min(H() - 30, v)));
}
const hAt = (x) => { const i = Math.max(0, Math.min(99, x / 4)), a = Math.floor(i), t = i - a; return g.h[a] + (g.h[Math.min(100, a + 1)] - g.h[a]) * t; };
function newGame() { g = { h: [], tanks: [], shells: [], fx: [], meteors: [], me: { x: 44 }, wind: 0, twist: null, time: 0, fireT: 3, shield: 0, split: 0, big: 0, seed: Math.floor(Math.random() * 1e6), night: 0 }; g.h = ridge(g.seed); killsN = 0; shotsN = 0; addTank(); }
function addTank(gold = false, quiet = false) {
  if (g.tanks.length >= 5) return;
  g.tanks.push({ x: 200 + Math.random() * 170, gold, hp: gold ? 2 : 1, quiet, flash: 0, hue: [0, 210, 280, 30][Math.floor(Math.random() * 4)] });
}
function onBeat(ev) {
  const x = ev.x;
  if (ev.window) { g.tanks = g.tanks.filter((t) => !t.quiet); for (let i = 0; i < 3; i++) addTank(false, true); }
  else if (x > 0.9) meteor(60 + Math.random() * (W - 120));
  else if (ev.peak) addTank();
  else if (x > 0.5 && g.tanks.length < 2) addTank();
  if (ev.gift) { g.shield = 1; host.banner('🛡️ SHIELD', 'the next hit bounces off'); }
  if (ev.mirror) { g.split = 1; sfx('chime'); }
  if (ev.balance) { g.wind = 0; sfx('chime'); }
  if (ev.golden) addTank(true);
  if (ev.fib) g.big = 1;
  if (!ev.balance && Math.random() < 0.5) g.wind = Math.max(-60, Math.min(60, g.wind + (Math.random() - 0.5) * 40));
  if (ev.big && !g.twist) twist();
}
function twist() {
  const [title, sub, kind] = TWISTS[Math.floor(Math.random() * TWISTS.length)];
  g.twist = { kind, until: g.time + 6 }; host.banner(title, sub); sfx('twist');
  if (kind === 'gale') g.wind = (Math.random() < 0.5 ? -1 : 1) * 110;
}
function meteor(x) { g.meteors.push({ x, y: -20, vy: 160 + Math.random() * 80, vx: (Math.random() - 0.5) * 60 }); }
function fire(dx, dy) {
  if (!g || S.over) return;
  const d = Math.min(160, Math.hypot(dx, dy)); if (d < 10) return;
  const a = Math.atan2(-dy, -dx), p = 240 + d * 2.9, my = hAt(g.me.x) - 10;
  const shots = g.split ? [-0.12, 0, 0.12] : [0];
  shots.forEach((da) => g.shells.push({ x: g.me.x, y: my, vx: Math.cos(a + da) * p, vy: Math.sin(a + da) * p, mine: true, big: !!g.big }));
  if (g.split) { g.split = 0; g.fx.push({ kind: 'text', x: g.me.x, y: my - 24, text: '✨ FRACTAL SHELL', life: 1 }); }
  g.big = 0; shotsN += 1; sfx('cannon');
}
// a crater digs the hill, but never more than 70 below where it stood fresh: you keep a hill to stand on
function crater(x, y, r) { const fresh = g.fresh || (g.fresh = ridge(g.seed)); for (let i = 0; i < 101; i++) { const px = i * 4, dx = px - x; if (Math.abs(dx) < r) { const depth = Math.sqrt(r * r - dx * dx); g.h[i] = Math.max(g.h[i], Math.min(H() - 30, fresh[i] + 70, y + depth)); } } }
function boom(x, y, r, mine) {
  crater(x, y, r);
  for (let i = 0; i < 22; i++) { const a = Math.random() * 6.28, v = 40 + Math.random() * 180; g.fx.push({ kind: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, c: ['#FFF4D6', '#FFC857', '#FF8A3D', '#E0453A'][i % 4], life: 0.7, r: 2 + Math.random() * 2 }); }
  g.fx.push({ kind: 'ring', x, y, r: 4, R: r * 1.6, life: 0.4 }); sfx('boom', { size: r / 22 });
  if (mine) {
    g.tanks.filter((t) => Math.abs(t.x - x) < r + TANK_W / 2 && Math.abs(hAt(t.x) - 8 - y) < r + 14).forEach((t) => {
      t.hp -= 1; if (t.hp > 0) { t.flash = 0.4; host.add(50); g.fx.push({ kind: 'text', x: t.x, y: hAt(t.x) - 30, text: 'HIT +50', life: 0.8 }); return; }
      g.tanks.splice(g.tanks.indexOf(t), 1); killsN += 1;
      S.combo = S.comboT > 0 ? S.combo + 1 : 1; S.comboT = 3;
      const pts = (t.gold ? 500 : 150) * fibMult(S.combo); host.add(pts);
      g.fx.push({ kind: 'text', x: t.x, y: hAt(t.x) - 34, text: `${t.gold ? 'GOLDEN ' : ''}KO +${pts}`, life: 1.2, big: true, col: t.gold ? '#F5C542' : '#FFE08A' }); sfx(t.gold ? 'chime' : 'cheer', { delay: 0.1 });
    });
  } else if (Math.abs(g.me.x - x) < r + TANK_W / 2) {
    if (g.shield) { g.shield = 0; g.fx.push({ kind: 'text', x: g.me.x, y: hAt(g.me.x) - 30, text: '🛡️ BOUNCED', life: 1 }); sfx('clack'); return; }
    S.combo = 0; navigator.vibrate?.(100);
    host.hurt('shelled') || host.banner('DIRECT HIT', `${S.hearts} ${S.hearts === 1 ? 'heart' : 'hearts'} left`);
  }
}
function update(dt) {
  g.time += dt;
  if (g.twist && g.time > g.twist.until) { if (g.twist.kind === 'gale') g.wind *= 0.3; g.twist = null; }
  g.night += ((g.twist?.kind === 'night' ? 1 : 0) - g.night) * Math.min(1, dt * 3);
  if (g.twist?.kind === 'meteors' && Math.random() < dt * 1.2) meteor(40 + Math.random() * (W - 80));
  // 🌱 the hill always heals, slowly (a crater is half gone in ~4 s); the Regrowth twist heals it fast
  { const fresh = g.fresh || (g.fresh = ridge(g.seed)), rate = g.twist?.kind === 'regrow' ? 0.8 : 0.18; g.h = g.h.map((v, i) => v + (fresh[i] - v) * Math.min(1, dt * rate)); }
  // they fire back, more often the wilder the curve; tanks set by the window hold their fire
  g.fireT -= dt * (1 + Math.max(0, S.curve.r - 2.9));
  if (g.fireT <= 0) { g.fireT = 2.2 + Math.random() * 2; const t = g.tanks.filter((q) => !q.quiet)[Math.floor(Math.random() * g.tanks.filter((q) => !q.quiet).length)];
    if (t) { const dx = g.me.x - t.x, p = 300 + Math.random() * 120, a = -2.2 - Math.random() * 0.5; t.flash = 0.35; g.shells.push({ x: t.x, y: hAt(t.x) - 10, vx: Math.cos(a) * p * Math.sign(dx) * -1 * -1, vy: Math.sin(a) * p, mine: false }); const s = g.shells[g.shells.length - 1]; s.vx = -Math.abs(s.vx) * (0.8 + Math.random() * 0.5); sfx('cannon'); } }
  g.shells = g.shells.filter((s) => { s.vy += G * dt; s.vx += g.wind * dt * 0.6; s.x += s.vx * dt; s.y += s.vy * dt; if (s.x < -20 || s.x > W + 20) return false; if (s.y >= hAt(s.x)) { boom(s.x, s.y, s.big ? 34 : 22, s.mine); return false; } return true; });
  g.meteors = g.meteors.filter((m) => { m.y += m.vy * dt; m.x += m.vx * dt; m.vy += 120 * dt; if (m.y >= hAt(m.x)) { boom(m.x, m.y, 40, false); g.tanks.filter((t) => Math.abs(t.x - m.x) < 46).forEach((t) => { g.tanks.splice(g.tanks.indexOf(t), 1); killsN += 1; host.add(75); g.fx.push({ kind: 'text', x: t.x, y: m.y - 30, text: 'FLATTENED +75', life: 1 }); }); return false; } return true; });
  g.tanks.forEach((t) => { if (t.flash > 0) t.flash -= dt; });
  g.fx.forEach((f) => { f.life -= dt; if (f.kind === 'dot') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 300 * dt; } else if (f.kind === 'ring') f.r += (f.R - f.r) * Math.min(1, dt * 14); else f.y -= 24 * dt; });
  g.fx = g.fx.filter((f) => f.life > 0);
}
function drawTank(x, hue, flash, mine, gold) {
  const y = hAt(x) - 8;
  ctx.save(); ctx.translate(x, y);
  if (g.glitch) { drawPal(g.glitchPal || 'fig', ctx, { x: 0, y: -12, s: 10, t: performance.now() / 1000, r: 4, face: mine ? 1 : -1 }); ctx.restore(); return; }   // ⚡ glitch: your companion on every hill
  ctx.fillStyle = flash > 0 ? '#fff' : gold ? '#F5C542' : mine ? '#3DD6C6' : `hsl(${hue} 55% 50%)`;
  ctx.beginPath(); ctx.roundRect(-TANK_W / 2, -8, TANK_W, 12, 4); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -8, 7, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(mine ? 12 : -12, -18); ctx.stroke();
  ctx.fillStyle = '#0A0A14'; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(i * 7, 4, 3, 0, 7); ctx.fill(); }
  ctx.restore();
}
function draw(t) {
  const k = host.k, Hh = H();
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const night = g ? g.night : 0;
  const sky = ctx.createLinearGradient(0, 0, 0, Hh); sky.addColorStop(0, night > 0.5 ? '#07071A' : '#1B1646'); sky.addColorStop(0.6, night > 0.5 ? '#12102A' : '#3B2A6E'); sky.addColorStop(1, night > 0.5 ? '#1A0A20' : '#7A3E72');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, Hh);
  ctx.fillStyle = '#FFE9B0'; ctx.beginPath(); ctx.arc(W * 0.78, 70, 22, 0, 7); ctx.fill();
  if (!g) return;
  // the ridge
  ctx.fillStyle = '#2E7D4F'; ctx.beginPath(); ctx.moveTo(0, Hh); g.h.forEach((v, i) => ctx.lineTo(i * 4, v)); ctx.lineTo(W, Hh); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5A3B1F'; ctx.beginPath(); ctx.moveTo(0, Hh); g.h.forEach((v, i) => ctx.lineTo(i * 4, v + 14)); ctx.lineTo(W, Hh); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#8FD48F'; ctx.lineWidth = 3; ctx.beginPath(); g.h.forEach((v, i) => ctx[i ? 'lineTo' : 'moveTo'](i * 4, v)); ctx.stroke();
  // wind
  ctx.fillStyle = '#ffffffaa'; ctx.font = '900 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`${g.wind < -5 ? '←' : g.wind > 5 ? '→' : '·'} wind ${Math.abs(Math.round(g.wind))}`, W / 2, 24);
  g.tanks.forEach((tk) => { if (night > 0.5 && tk.flash <= 0) return; drawTank(tk.x, tk.hue, tk.flash, false, tk.gold); if (tk.quiet) { ctx.fillStyle = '#C9B8FF'; ctx.font = '11px system-ui'; ctx.fillText('🔁', tk.x, hAt(tk.x) - 28); } });
  drawTank(g.me.x, 0, 0, true, false);
  if (g.shield) { ctx.strokeStyle = '#7FD3F7'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(g.me.x, hAt(g.me.x) - 10, 22, 0, 7); ctx.stroke(); }
  if (drag) { const dx = drag.x - drag.x0, dy = drag.y - drag.y0, d = Math.min(160, Math.hypot(dx, dy)), a = Math.atan2(-dy, -dx), my = hAt(g.me.x) - 10; ctx.strokeStyle = `rgba(255,${230 - d},120,0.9)`; ctx.lineWidth = 3; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(g.me.x, my);
    let px = g.me.x, py = my, vx = Math.cos(a) * (240 + d * 2.9), vy = Math.sin(a) * (240 + d * 2.9); for (let i = 0; i < 26; i++) { vy += G * 0.04; vx += g.wind * 0.04 * 0.6; px += vx * 0.04; py += vy * 0.04; ctx.lineTo(px, py); if (py > hAt(px)) break; } ctx.stroke(); ctx.setLineDash([]); }
  g.shells.forEach((s) => { ctx.fillStyle = s.mine ? '#3DD6C6' : '#FF8A3D'; ctx.beginPath(); ctx.arc(s.x, s.y, s.big ? 6 : 4, 0, 7); ctx.fill(); });
  g.meteors.forEach((m) => { ctx.fillStyle = '#FF8A3D'; ctx.beginPath(); ctx.arc(m.x, m.y, 8, 0, 7); ctx.fill(); ctx.strokeStyle = '#FFE08A88'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x - m.vx * 0.15, m.y - m.vy * 0.15); ctx.stroke(); });
  g.fx.forEach((f) => { ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.5)); if (f.kind === 'dot') { ctx.fillStyle = f.c; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill(); } else if (f.kind === 'ring') { ctx.strokeStyle = '#FFC857'; ctx.lineWidth = 5 * f.life * 2; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.stroke(); } else { ctx.font = f.big ? '400 20px Bungee, Impact, sans-serif' : '900 14px Nunito, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = f.col || '#FFE08A'; ctx.strokeStyle = '#1B1030'; ctx.lineWidth = 4; ctx.strokeText(f.text, f.x, f.y); ctx.fillText(f.text, f.x, f.y); } });
  ctx.globalAlpha = 1;
}
const organ = {
  key: 'hilltop', name: 'Hilltop', icon: '💥', verb: 'drag to aim · let go to fire', beat: 1.1,
  theme: { bg: '#1B1646', gold: '#F5C542', bannerc: '#FFE08A' },
  glitch(on, pal) { if (g) { g.glitch = on; g.glitchPal = pal; } },
  init(h) { host = h; ctx = h.ctx; S = h.S; sfx = h.sfx; window.__ht = organ.debug; },
  start() { newGame(); },
  enter(from) { if (!g) newGame(); host.ui(''); drag = null; if (from) { g.shells = g.shells.filter((s) => s.mine); g.fireT = Math.max(g.fireT, 1.5); if (!g.tanks.length) addTank(); } },
  leave() { drag = null; return g ? { x: g.me.x, y: hAt(g.me.x) - 10 } : null; },
  update, draw, onBeat,
  pointer(type, p) { if (type === 'down') drag = { x0: p.x, y0: p.y, x: p.x, y: p.y }; else if (type === 'move') { if (drag) { drag.x = p.x; drag.y = p.y; } } else if (drag) { fire(drag.x - drag.x0, drag.y - drag.y0); drag = null; } },
  hudLine: () => (g ? `💥 ${killsN} K.O. · ${g.tanks.length} dug in` : ''),
  level: () => 1 + Math.floor(killsN / 5),
  overText: (how) => (how === 'shelled' ? ['💥 KNOCKED OUT', 'Too many direct hits.'] : ['RUN OVER', '']),
  endStats: () => (g ? `💥 ${killsN} K.O. from ${shotsN} shells` : ''),
  debug: () => g && ({ tanks: g.tanks.map((t) => ({ x: t.x, y: hAt(t.x), gold: t.gold, quiet: t.quiet })), me: { x: g.me.x, y: hAt(g.me.x) }, shells: g.shells.length, kills: killsN, wind: g.wind, twist: g.twist?.kind || null, W, H: H(), fire }),
};
export default organ;
