// ⛳ Putt, an organ of the shell: Putt Post's DNA, one green at a time. Drag back from anywhere and
// let go to putt; sink the cup for 100 × the Fibonacci combo, and the cup moves on across a green
// whose bumps are fractal noise. Five putts a cup, or you pick up (a heart). The box's beats reshape
// the green: a peak drops bumpers, a big hop cuts a water hazard, gift grows the cup, the mirror flips
// the green left for right (and the ball with it), the balance draws your line to the cup, the golden
// cut gilds the cup (500), the window sets three cups (sink any), a Fibonacci beat is a free putt.
// Twists: 💨 wind, 🧊 ice (no friction), 🌊 ripple (the green heaves), 🕳️ tiny cup.
import { fibMult } from '../chaos.js';
import { drawPal } from '../pals.js';

const W = 400, R = 6, CUP_R = 11, PUTTS = 5;
const TWISTS = [
  ['💨 WIND', 'the ball drifts across the green', 'wind'],
  ['🧊 ICE', 'nothing slows down', 'ice'],
  ['🌊 RIPPLE', 'the green heaves', 'ripple'],
  ['🕳️ TINY CUP', 'half the cup for a while', 'tiny'],
];
let host, ctx, S, sfx, g = null, sunkN = 0, puttsN = 0, drag = null;
const H = () => host.H;
const hash = (i) => { let x = (Math.imul(i | 0, 374761393) + 668265263) | 0; x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
const green = () => ({ x: 24, y: 70, w: W - 48, h: H() - 110 });
function newGame() { g = { ball: null, v: { x: 0, y: 0 }, cups: [], bumpers: [], sand: [], water: [], fx: [], putts: 0, hole: 0, twist: null, time: 0, seed: Math.floor(Math.random() * 1e6), wind: 0, guide: 0, free: 0, gold: false }; sunkN = 0; puttsN = 0; newCup(); }
function spot(margin = 40) { const G = green(); return { x: G.x + margin + Math.random() * (G.w - 2 * margin), y: G.y + margin + Math.random() * (G.h - 2 * margin) }; }
function newCup(three = false) {
  const G = green();
  g.cups = three ? [0, 1, 2].map(() => spot(30)) : [spot(36)];
  if (!g.ball) g.ball = { x: G.x + G.w / 2, y: G.y + G.h - 40 };
  g.putts = 0; g.hole += 1; g.seed = (g.seed * 16807 + g.hole) % 2147483647; g.gold = false; g.guide = 0;
  g.bumpers = g.bumpers.filter(() => Math.random() < 0.4); g.sand = g.sand.filter(() => Math.random() < 0.5); g.water = [];
}
function onBeat(ev) {
  const x = ev.x;
  if (ev.window && g.cups.length < 3) { newCup(true); host.banner('🔁 THREE CUPS', 'sink any of them'); }
  if (ev.peak && !ev.window) { const p = spot(30); g.bumpers.push({ x: p.x, y: p.y, r: 12 + Math.floor((x - 0.75) * 40) }); if (g.bumpers.length > 6) g.bumpers.shift(); }
  else if (ev.hop > 0.3 && !ev.window) { const p = spot(50); g.water.push({ x: p.x, y: p.y, rx: 30 + ev.hop * 60, ry: 18 + ev.hop * 30 }); if (g.water.length > 2) g.water.shift(); }
  else if (x > 0.4 && x < 0.6 && Math.random() < 0.5) { const p = spot(40); g.sand.push({ x: p.x, y: p.y, rx: 34, ry: 22 }); if (g.sand.length > 3) g.sand.shift(); }
  if (ev.gift) g.cups.forEach((c) => { c.big = 1.6; });
  if (ev.mirror) { const G = green(); const flip = (o) => { o.x = 2 * (G.x + G.w / 2) - o.x; }; g.cups.forEach(flip); g.bumpers.forEach(flip); g.sand.forEach(flip); g.water.forEach(flip); flip(g.ball); sfx('chime'); }
  if (ev.balance) { g.guide = 4; sfx('chime'); }
  if (ev.golden) { g.gold = true; g.cups.forEach((c) => { c.gold = true; }); sfx('chime', { hi: true }); }
  if (ev.fib) g.free += 1;
  if (ev.big && !g.twist) twist();
}
function twist() {
  const [title, sub, kind] = TWISTS[Math.floor(Math.random() * TWISTS.length)];
  g.twist = { kind, until: g.time + 6, wind: (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 40) }; host.banner(title, sub); sfx('twist');
}
const moving = () => Math.hypot(g.v.x, g.v.y) > 6;   // a crawl under 6 px/s counts as stopped: the next putt is yours sooner
function putt(dx, dy) {
  if (!g || S.over || moving()) return;
  const d = Math.min(150, Math.hypot(dx, dy)); if (d < 8) return;
  const a = Math.atan2(dy, dx), p = d * 5.2;
  g.v = { x: -Math.cos(a) * p, y: -Math.sin(a) * p };
  if (g.free > 0) { g.free -= 1; g.fx.push({ kind: 'text', x: g.ball.x, y: g.ball.y - 16, text: '🌻 free putt', life: 0.9 }); } else g.putts += 1;
  puttsN += 1; sfx('putt', { power: d / 150 });
}
function pickUp() {
  S.combo = 0; sfx('buzz');
  const dead = host.hurt('picked up'); if (dead) return;
  host.banner('PICKED UP', `${PUTTS} putts and no cup · ${S.hearts} ${S.hearts === 1 ? 'heart' : 'hearts'} left`);
  g.v = { x: 0, y: 0 }; g.ball = null; newCup();
}
function sink(c) {
  S.combo = S.comboT > 0 ? S.combo + 1 : 1; S.comboT = 3;
  const base = c.gold ? 500 : g.putts <= 1 ? 200 : 100, pts = base * fibMult(S.combo); host.add(pts); sunkN += 1;
  g.fx.push({ kind: 'text', x: c.x, y: c.y - 18, text: `${g.putts <= 1 ? 'ACE! ' : c.gold ? 'GOLDEN ' : ''}+${pts}`, life: 1.2, big: true, col: c.gold ? '#F5C542' : '#FFE08A' });
  for (let i = 0; i < 18; i++) { const a = Math.random() * 6.28, v = 40 + Math.random() * 120; g.fx.push({ kind: 'dot', x: c.x, y: c.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, c: ['#F2C14E', '#fff', '#7FD3F7'][i % 3], life: 0.8, r: 2 }); }
  sfx('cup'); sfx('cheer', { delay: 0.15 });
  g.v = { x: 0, y: 0 }; g.ball = { x: c.x, y: c.y }; newCup();
}
function update(dt) {
  g.time += dt;
  if (g.twist && g.time > g.twist.until) g.twist = null;
  if (g.guide > 0) g.guide -= dt;
  const G = green(), b = g.ball; if (!b) { g.ball = { x: G.x + G.w / 2, y: G.y + G.h - 40 }; return; }
  g.cups.forEach((c) => { if (c.big) c.big = Math.max(1, c.big - dt * 0.15); });
  const ice = g.twist?.kind === 'ice', wind = g.twist?.kind === 'wind' ? g.twist.wind : 0, ripple = g.twist?.kind === 'ripple';
  if (moving()) {
    const inSand = g.sand.some((s) => ((b.x - s.x) / s.rx) ** 2 + ((b.y - s.y) / s.ry) ** 2 < 1);
    const fr = ice ? 0.995 : inSand ? 0.93 : 0.975;   // more drag than Putt Post's green: a solo bite of golf, so the ball settles fast
    g.v.x = g.v.x * Math.pow(fr, dt * 60) + wind * dt; g.v.y *= Math.pow(fr, dt * 60);
    if (!ice && Math.hypot(g.v.x, g.v.y) < 40) { const k = Math.pow(0.9, dt * 60); g.v.x *= k; g.v.y *= k; }   // the last crawl dies quickly
    if (ripple) { g.v.x += Math.sin(g.time * 4 + b.y / 30) * 60 * dt; g.v.y += Math.cos(g.time * 3 + b.x / 30) * 60 * dt; }
    // 🌱 the fractal bumps of the green: a slope from two octaves of hash noise
    const sl = (x, y) => (hash(Math.floor(x / 60) * 131 + Math.floor(y / 60) * 7 + g.seed) - 0.5) * 30 + (hash(Math.floor(x / 22) * 17 + Math.floor(y / 22) * 3 + g.seed) - 0.5) * 12;
    g.v.x += (sl(b.x + 4, b.y) - sl(b.x - 4, b.y)) * dt * 6; g.v.y += (sl(b.x, b.y + 4) - sl(b.x, b.y - 4)) * dt * 6;
    if (!ice && !ripple && Math.hypot(g.v.x, g.v.y) < 6) { g.v.x = 0; g.v.y = 0; }   // at rest, the bumps can't set it creeping again
    b.x += g.v.x * dt; b.y += g.v.y * dt;
    if (b.x < G.x + R) { b.x = G.x + R; g.v.x *= -0.8; sfx('clack'); } if (b.x > G.x + G.w - R) { b.x = G.x + G.w - R; g.v.x *= -0.8; sfx('clack'); }
    if (b.y < G.y + R) { b.y = G.y + R; g.v.y *= -0.8; sfx('clack'); } if (b.y > G.y + G.h - R) { b.y = G.y + G.h - R; g.v.y *= -0.8; sfx('clack'); }
    g.bumpers.forEach((bp) => { const dx = b.x - bp.x, dy = b.y - bp.y, d = Math.hypot(dx, dy); if (d < bp.r + R) { const nx = dx / d, ny = dy / d, dot = g.v.x * nx + g.v.y * ny; g.v.x -= 2 * dot * nx; g.v.y -= 2 * dot * ny; g.v.x *= 1.15; g.v.y *= 1.15; b.x = bp.x + nx * (bp.r + R + 1); b.y = bp.y + ny * (bp.r + R + 1); bp.hit = 0.3; sfx('boing'); } });
    if (g.water.some((w) => ((b.x - w.x) / w.rx) ** 2 + ((b.y - w.y) / w.ry) ** 2 < 1)) { g.v = { x: 0, y: 0 }; sfx('plunk'); S.combo = 0; g.fx.push({ kind: 'text', x: b.x, y: b.y - 12, text: 'SPLASH · +1 putt', life: 1 }); g.putts += 1; b.x = G.x + G.w / 2; b.y = G.y + G.h - 40; }
    const cupR = (c) => CUP_R * (c.big || 1) * (g.twist?.kind === 'tiny' ? 0.5 : 1);
    const cup = g.cups.find((c) => Math.hypot(b.x - c.x, b.y - c.y) < cupR(c) && Math.hypot(g.v.x, g.v.y) < 260);
    if (cup) return sink(cup);
    if (!moving()) { g.v = { x: 0, y: 0 }; if (g.putts >= PUTTS) pickUp(); }
  }
  g.bumpers.forEach((bp) => { if (bp.hit > 0) bp.hit -= dt; });
  g.fx.forEach((f) => { f.life -= dt; if (f.kind === 'dot') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 300 * dt; } else f.y -= 24 * dt; });
  g.fx = g.fx.filter((f) => f.life > 0);
}
function draw(t) {
  const k = host.k, Hh = H(), G = green();
  ctx.setTransform(k, 0, 0, k, host.ox || 0, 0);
  ctx.fillStyle = '#1E3A1A'; ctx.fillRect(0, 0, W, Hh);
  ctx.fillStyle = '#4C9A3F'; ctx.beginPath(); ctx.roundRect(G.x, G.y, G.w, G.h, 26); ctx.fill();
  ctx.strokeStyle = '#2F6B2A'; ctx.lineWidth = 6; ctx.stroke();
  if (!g) return;
  // mowing stripes, and the bumps as faint contour rings
  ctx.save(); ctx.beginPath(); ctx.roundRect(G.x, G.y, G.w, G.h, 26); ctx.clip();
  ctx.fillStyle = '#ffffff0c'; for (let i = 0; i < 10; i++) ctx.fillRect(G.x, G.y + i * (G.h / 5), G.w, G.h / 10);
  ctx.strokeStyle = '#00000018'; ctx.lineWidth = 1; for (let i = 0; i < 6; i++) { const cx = G.x + hash(i * 3 + g.seed) * G.w, cy = G.y + hash(i * 5 + g.seed + 1) * G.h; for (let r = 12; r < 60; r += 14) { ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.3, r, 0, 0, 7); ctx.stroke(); } }
  g.sand.forEach((s) => { ctx.fillStyle = '#E4C77A'; ctx.beginPath(); ctx.ellipse(s.x, s.y, s.rx, s.ry, 0, 0, 7); ctx.fill(); });
  g.water.forEach((w) => { ctx.fillStyle = '#3FA7E0'; ctx.beginPath(); ctx.ellipse(w.x, w.y, w.rx, w.ry, 0, 0, 7); ctx.fill(); ctx.strokeStyle = '#BFE9FF88'; ctx.beginPath(); ctx.ellipse(w.x, w.y + 4, w.rx * 0.7, w.ry * 0.5, 0, 0, 7); ctx.stroke(); });
  g.bumpers.forEach((b) => { ctx.fillStyle = b.hit > 0 ? '#FFE08A' : '#E4572E'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); ctx.strokeStyle = '#7A2A14'; ctx.lineWidth = 3; ctx.stroke(); });
  const cupR = (c) => CUP_R * (c.big || 1) * (g.twist?.kind === 'tiny' ? 0.5 : 1);
  g.cups.forEach((c) => { const r = cupR(c); ctx.fillStyle = '#0F2A0F'; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, 7); ctx.fill(); ctx.strokeStyle = c.gold ? '#F5C542' : '#A8E08A'; ctx.lineWidth = c.gold ? 3 : 1.5; ctx.stroke();
    ctx.strokeStyle = '#EEE'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x, c.y - 34); ctx.stroke(); ctx.fillStyle = c.gold ? '#F5C542' : '#E4572E'; ctx.beginPath(); ctx.moveTo(c.x, c.y - 34); ctx.lineTo(c.x + 16, c.y - 28); ctx.lineTo(c.x, c.y - 22); ctx.closePath(); ctx.fill(); });
  const b = g.ball;
  if (b) {
    if (g.guide > 0 && g.cups[0]) { ctx.strokeStyle = '#FFE08Acc'; ctx.setLineDash([6, 6]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(g.cups[0].x, g.cups[0].y); ctx.stroke(); ctx.setLineDash([]); }
    if (drag && !moving()) { const dx = drag.x - drag.x0, dy = drag.y - drag.y0, d = Math.min(150, Math.hypot(dx, dy)), a = Math.atan2(dy, dx); ctx.strokeStyle = `rgba(255,${230 - d},120,0.9)`; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - Math.cos(a) * d * 0.8, b.y - Math.sin(a) * d * 0.8); ctx.stroke(); }
    if (g.glitch) { drawPal(g.glitchPal || 'fig', ctx, { x: b.x, y: b.y, s: R * 1.1, t: performance.now() / 1000, r: 4 }); }   // ⚡ glitch: the ball is your companion
    else { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, 7); ctx.fill(); ctx.fillStyle = '#00000033'; ctx.beginPath(); ctx.arc(b.x + 2, b.y + 2, R - 2, 0, 7); ctx.fill(); }
  }
  ctx.restore();
  if (g.twist?.kind === 'wind') { ctx.strokeStyle = '#ffffff55'; ctx.lineWidth = 2; for (let i = 0; i < 10; i++) { const y = 80 + i * (Hh / 11), x = ((t / 5) * Math.sign(g.twist.wind) + i * 97) % (W + 60); ctx.beginPath(); ctx.moveTo(x - 30, y); ctx.lineTo(x, y); ctx.stroke(); } }
  ctx.fillStyle = '#FFE08A'; ctx.font = '900 13px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`putt ${Math.min(PUTTS, g.putts + 1)} of ${PUTTS}${g.free ? ` · 🌻 ${g.free} free` : ''}`, W / 2, Hh - 16);
  g.fx.forEach((f) => { ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.5)); if (f.kind === 'dot') { ctx.fillStyle = f.c; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill(); } else { ctx.font = f.big ? '400 20px Bungee, Impact, sans-serif' : '900 14px Nunito, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = f.col || '#FFE08A'; ctx.strokeStyle = '#102010'; ctx.lineWidth = 4; ctx.strokeText(f.text, f.x, f.y); ctx.fillText(f.text, f.x, f.y); } });
  ctx.globalAlpha = 1;
}
const organ = {
  key: 'putt', name: 'Putt', icon: '⛳', verb: 'drag back and let go to putt', beat: 1.0,
  theme: { bg: '#1E3A1A', gold: '#F5C542', bannerc: '#FFE08A' },
  glitch(on, pal) { if (g) { g.glitch = on; g.glitchPal = pal; } },
  init(h) { host = h; ctx = h.ctx; S = h.S; sfx = h.sfx; window.__pt = organ.debug; },
  start() { newGame(); },
  enter(from) { if (!g) newGame(); host.ui(''); drag = null; if (from) { g.v = { x: 0, y: 0 }; } },
  leave() { drag = null; return g?.ball ? { x: g.ball.x, y: g.ball.y } : null; },
  update, draw, onBeat,
  pointer(type, p) { if (type === 'down') drag = { x0: p.x, y0: p.y, x: p.x, y: p.y }; else if (type === 'move') { if (drag) { drag.x = p.x; drag.y = p.y; } } else if (drag) { putt(drag.x - drag.x0, drag.y - drag.y0); drag = null; } },
  hudLine: () => (g ? `⛳ ${sunkN} sunk · cup ${g.hole}` : ''),
  level: () => 1 + Math.floor(sunkN / 5),
  overText: (how) => (how === 'picked up' ? ['⛳ PICKED UP', 'Too many cups walked away from.'] : ['RUN OVER', '']),
  endStats: () => (g ? `⛳ ${sunkN} cups in ${puttsN} putts` : ''),
  debug: () => g && ({ ball: g.ball, v: g.v, cups: g.cups, putts: g.putts, sunk: sunkN, twist: g.twist?.kind || null, bumpers: g.bumpers.length, W, H: H(), putt }),
};
export default organ;
