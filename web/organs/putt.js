// ⛳ Putt, an organ of the shell: Putt Post's DNA, one fairway at a time. Drag back from anywhere and
// let go to putt; sink the cup for 100 × the Fibonacci combo. A fairway is a corridor of straight legs:
// Course 1 is one short leg (a single putt), and each course adds a bend, narrows it and brings hazards.
// You are Fig, rolled up into the ball. Par + 2 putts a cup, or you pick up (a heart). The box's beats reshape
// the green: a peak drops bumpers, a big hop cuts a water hazard, gift grows the cup, the mirror flips
// the green left for right (and the ball with it), the balance draws your line to the cup, the golden
// cut gilds the cup (500), the window sets three cups (sink any), a Fibonacci beat is a free putt.
// Twists: 💨 wind, 🧊 ice (no friction), 🌊 ripple (the green heaves), 🕳️ tiny cup.
import { fibMult } from '../chaos.js';
import { drawPal } from '../pals.js';

let W = 400, R = 6, CUP_R = 11, PUTTS = 5;
const TWISTS = [
  ['💨 WIND', 'the ball drifts across the green', 'wind'],
  ['🧊 ICE', 'nothing slows down', 'ice'],
  ['🌊 RIPPLE', 'the green heaves', 'ripple'],
  ['🕳️ TINY CUP', 'half the cup for a while', 'tiny'],
];
let host, ctx, S, sfx, g = null, sunkN = 0, puttsN = 0, drag = null;
const H = () => host.H;
const hash = (i) => { let x = (Math.imul(i | 0, 374761393) + 668265263) | 0; x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
// ⛳ COURSES: three holes a course. A fairway is a corridor (`g.path`, legs of a polyline, `g.pw` wide) from the
// tee to the cup: Course 1 one short straight leg, Course 2 one bend, Course 3 an S, then more bends, narrower,
// with bumpers (course 3+), sand (2+) and water (5+) on the way. The par is the bends + 1 (+1 for two or more
// bumpers, +1 for water). Make the course's par and you move up; miss it and you play that course again.
const bendsOf = (c) => (c <= 1 ? 0 : c === 2 ? 1 : c === 3 ? 2 : Math.min(4, 2 + Math.floor(Math.random() * 2) + (c >= 5 ? 1 : 0)));
const widthOf = (c) => Math.min(190, 44 + 22 * (c - 1));   // the fairway widens a lot as the courses go on (44, 66, 88 … 190), and the legs get longer
function corridor(bends, c) {   // legs from the bottom middle, turning 60–105° at each bend; retried with shorter legs until it fits the world
  // the map widens with the courses: the walk may use a wider and wider slice of the field, and later courses lean sideways
  const m = widthOf(c) / 2 + 10, span = Math.min(1, 0.4 + 0.12 * c), B = { x0: Math.max(m, W / 2 - (W / 2 - m) * span), x1: Math.min(W - m, W / 2 + (W / 2 - m) * span), y0: 60 + m, y1: H() - 50 - m };   // the bounds keep the whole band inside the field
  for (let tries = 0; tries < 60; tries++) {
    const pts = [{ x: W / 2 + (Math.random() - 0.5) * (bends ? 140 : 20), y: B.y1 - 10 }]; let a = -Math.PI / 2, ok = true, turn = Math.random() < 0.5 ? 1 : -1;
    for (let i = 0; i <= bends; i++) {
      const len = ((bends ? 100 : 130) + 22 * Math.min(c, 8) + Math.random() * 60) * Math.max(0.45, 1 - tries / 60), p = pts[pts.length - 1], q = { x: p.x + Math.cos(a) * len, y: p.y + Math.sin(a) * len };
      if (q.x < B.x0 || q.x > B.x1 || q.y < B.y0 || q.y > B.y1) { ok = false; break; }
      pts.push(q); a += turn * (Math.PI / 3 + Math.random() * Math.PI / 4) * (c >= 4 ? 1.15 : 1); turn = Math.random() < 0.7 ? -turn : turn;
    }
    if (ok) return centred(pts);
  }
  return centred([{ x: W / 2, y: H() - 80 }, { x: W / 2, y: H() - 230 }]);
}
function centred(pts) {   // the fairway sits in the middle of the field, not wherever the walk left it
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y), dx = W / 2 - (Math.min(...xs) + Math.max(...xs)) / 2, dy = (60 + H() - 50) / 2 - (Math.min(...ys) + Math.max(...ys)) / 2;
  return pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}
const nearest = (x, y) => { let best = null; for (let i = 0; i < g.path.length - 1; i++) { const p = g.path[i], q = g.path[i + 1], dx = q.x - p.x, dy = q.y - p.y, L2 = dx * dx + dy * dy || 1; let t = ((x - p.x) * dx + (y - p.y) * dy) / L2; t = Math.max(0, Math.min(1, t)); const nx = p.x + dx * t, ny = p.y + dy * t, d = Math.hypot(x - nx, y - ny); if (!best || d < best.d) best = { x: nx, y: ny, d, i, t }; } return best; };
const tee = () => ({ x: g.path[0].x, y: g.path[0].y });
function parOf() { let p = 1 + (g.path.length - 2) + (g.course >= 4 ? 1 : 0); if (g.bumpers.length >= 2) p += 1; if (g.water.length) p += 1; return Math.max(1, Math.min(6, p)); }
const PUTTS_OF = () => (g?.par || 3) + 2;
function newGame() { g = { ball: null, v: { x: 0, y: 0 }, cups: [], bumpers: [], sand: [], water: [], fx: [], putts: 0, hole: 0, course: 1, courseHole: 0, coursePar: 0, courseStrokes: 0, par: 3, twist: null, time: 0, seed: Math.floor(Math.random() * 1e6), wind: 0, guide: 0, free: 0, gold: false, gopher: null, gopherT: 3, restT: 0, fixes: 0 }; sunkN = 0; puttsN = 0; newCup(); }
function spot(margin = 10) {   // a point on the fairway, `margin` in from its edge, off the tee and the cup
  for (let k = 0; k < 24; k++) { const i = Math.floor(Math.random() * (g.path.length - 1)), p = g.path[i], q = g.path[i + 1], t = 0.15 + Math.random() * 0.7, nx = -(q.y - p.y), ny = q.x - p.x, L = Math.hypot(nx, ny) || 1, off = (Math.random() - 0.5) * Math.max(0, g.pw - 2 * margin); const sp = { x: p.x + (q.x - p.x) * t + nx / L * off, y: p.y + (q.y - p.y) * t + ny / L * off }; if ((!g.ball || Math.hypot(sp.x - g.ball.x, sp.y - g.ball.y) > 40) && (!g.cups[0] || Math.hypot(sp.x - g.cups[0].x, sp.y - g.cups[0].y) > 36)) return sp; }
  const e = g.path[g.path.length - 1]; return { x: e.x, y: e.y };
}
function newCup(three = false) {
  if (three) { g.cups = [0, 1, 2].map(() => spot(12)); return; }   // 🔁 the window: three cups along the fairway, sink any
  g.path = corridor(bendsOf(g.course), g.course); g.pw = widthOf(g.course); const e = g.path[g.path.length - 1];
  g.ball = tee(); g.cups = [{ x: e.x, y: e.y, big: Math.max(0.6, 1 - 0.08 * (g.course - 1)) }];
  g.putts = 0; g.hole += 1; g.seed = (g.seed * 16807 + g.hole) % 2147483647; g.gold = false; g.guide = 0; g.gopher = null;
  g.bumpers = []; for (let i = 0; i < Math.min(4, g.course - 2); i++) { const sp = spot(14); g.bumpers.push({ x: sp.x, y: sp.y, r: 10 }); }
  g.sand = []; if (g.course >= 2 && Math.random() < 0.6) { const sp = spot(8); g.sand.push({ x: sp.x, y: sp.y, rx: 26, ry: 16 }); }
  g.water = []; if (g.course >= 5) { const sp = spot(10); g.water.push({ x: sp.x, y: sp.y, rx: 22, ry: 14 }); }
  g.par = parOf(); g.courseHole += 1; g.coursePar += g.par;
  g.fixes = g.course <= 1 ? 0 : g.course === 2 ? 2 : g.course <= 4 ? 3 : g.course <= 6 ? 4 : 5;   // 🔧 repairs a hole: tap a hazard to fix it
  if (g.courseHole === 1) host.banner(`⛳ COURSE ${g.course}`, `three holes · make par to move up`);
}
// after a cup: the hole's score against par, and the course's
function holeDone(strokes) {
  g.courseStrokes += strokes;
  const vs = strokes - g.par, say = vs <= -2 ? '🦅 EAGLE' : vs === -1 ? '🐦 BIRDIE' : vs === 0 ? 'PAR' : vs === 1 ? 'BOGEY' : `${vs} OVER`;
  if (vs < 0) host.add(100 * -vs);
  if (g.courseHole >= 3) {
    const made = g.courseStrokes <= g.coursePar;
    if (made) { g.course += 1; host.banner(`⛳ COURSE ${g.course - 1} MADE`, `${g.courseStrokes} on a par ${g.coursePar} · up to course ${g.course}`); host.add(300 * (g.course - 1)); sfx('fanfare'); }
    else host.banner('⛳ OVER PAR', `${g.courseStrokes} on a par ${g.coursePar} · course ${g.course} again`);
    g.courseHole = 0; g.coursePar = 0; g.courseStrokes = 0;
  } else g.fx.push({ kind: 'text', x: W / 2, y: 90, text: say, life: 1.2, big: true, col: vs <= 0 ? '#C9FFF8' : '#FFB3A8' });
}
function onBeat(ev) {
  const x = ev.x;
  if (ev.window && g.cups.length < 3) { newCup(true); host.banner('🔁 THREE CUPS', 'sink any of them'); }
  if (ev.peak && !ev.window && g.course >= 2) { const p = spot(14); g.bumpers.push({ x: p.x, y: p.y, r: 9 + Math.floor((x - 0.75) * 24) }); if (g.bumpers.length > 5) g.bumpers.shift(); }
  else if (ev.hop > 0.3 && !ev.window && g.course >= 3) { const p = spot(10); g.water.push({ x: p.x, y: p.y, rx: 18 + ev.hop * 20, ry: 12 + ev.hop * 10 }); if (g.water.length > 2) g.water.shift(); }
  else if (x > 0.4 && x < 0.6 && Math.random() < 0.5 && g.course >= 2) { const p = spot(8); g.sand.push({ x: p.x, y: p.y, rx: 26, ry: 16 }); if (g.sand.length > 3) g.sand.shift(); }
  if (ev.gift) g.cups.forEach((c) => { c.big = 1.6; });
  if (ev.mirror) { const flip = (o) => { o.x = W - o.x; }; g.path.forEach(flip); g.cups.forEach(flip); g.bumpers.forEach(flip); g.sand.forEach(flip); g.water.forEach(flip); flip(g.ball); if (g.gopher) flip(g.gopher); sfx('chime'); }
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
// 🔧 a tap on a bumper, a sand trap or a pond fixes it, while the hole's repairs last
function fix(x, y) {
  if (!g || S.over) return false;
  const bi = g.bumpers.findIndex((b) => Math.hypot(b.x - x, b.y - y) < b.r + 8), si = g.sand.findIndex((s) => ((x - s.x) / (s.rx + 6)) ** 2 + ((y - s.y) / (s.ry + 6)) ** 2 < 1), wi = g.water.findIndex((w) => ((x - w.x) / (w.rx + 6)) ** 2 + ((y - w.y) / (w.ry + 6)) ** 2 < 1);
  if (bi < 0 && si < 0 && wi < 0) return false;
  if (g.fixes <= 0) { host.banner('🔧 NO REPAIRS LEFT', 'this hole is out of fixes'); sfx('buzz'); return true; }
  g.fixes -= 1; let what; host.cue?.('score', x, y);
  if (bi >= 0) { what = g.bumpers.splice(bi, 1)[0]; } else if (si >= 0) { what = g.sand.splice(si, 1)[0]; } else { what = g.water.splice(wi, 1)[0]; }
  g.fx.push({ kind: 'text', x: what.x, y: what.y - 16, text: `🔧 FIXED · ${g.fixes} left`, life: 1 }); for (let i = 0; i < 10; i++) { const a = Math.random() * 6.28, v = 40 + Math.random() * 90; g.fx.push({ kind: 'dot', x: what.x, y: what.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 50, c: '#A8E08A', life: 0.6, r: 2 }); }
  sfx('clack'); g.par = parOf(); return true;
}
function shoo() { const gp = g.gopher; g.gopher = null; host.add(100); host.cue?.('score', gp.x, gp.y); g.fx.push({ kind: 'text', x: gp.x, y: gp.y - 16, text: 'SHOO! +100', life: 0.9 }); sfx('clack'); }
function pickUp() {
  S.combo = 0; sfx('buzz');
  const dead = host.hurt('picked up'); if (dead) return;
  host.banner('PICKED UP', `${PUTTS_OF()} putts on a par ${g.par} and no cup · ${S.hearts} ${S.hearts === 1 ? 'heart' : 'hearts'} left`);
  g.courseStrokes += PUTTS_OF() + 1;
  g.v = { x: 0, y: 0 }; g.ball = null; newCup();
}
function sink(c) {
  S.combo = S.comboT > 0 ? S.combo + 1 : 1; S.comboT = 3; host.cue?.('kill', c.x, c.y);
  const base = c.gold ? 500 : g.putts <= 1 ? 200 : 100, pts = base * fibMult(S.combo); host.add(pts); sunkN += 1;
  g.fx.push({ kind: 'text', x: c.x, y: c.y - 18, text: `${g.putts <= 1 ? 'ACE! ' : c.gold ? 'GOLDEN ' : ''}+${pts}`, life: 1.2, big: true, col: c.gold ? '#F5C542' : '#FFE08A' });
  for (let i = 0; i < 18; i++) { const a = Math.random() * 6.28, v = 40 + Math.random() * 120; g.fx.push({ kind: 'dot', x: c.x, y: c.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, c: ['#F2C14E', '#fff', '#7FD3F7'][i % 3], life: 0.8, r: 2 }); }
  sfx('cup'); sfx('cheer', { delay: 0.15 });
  g.v = { x: 0, y: 0 }; g.ball = { x: c.x, y: c.y }; holeDone(Math.max(1, g.putts)); newCup();
}
function update(dt) {
  W = host?.W || W;   // 🎚️ the world widens with the stage
  g.time += dt;
  if (g.twist && g.time > g.twist.until) g.twist = null;
  if (g.guide > 0) g.guide -= dt;
  const b = g.ball; if (!b) { g.ball = tee(); return; }
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
    { const n = nearest(b.x, b.y), lim = g.pw / 2 - R; if (n.d > lim) { const nx = (b.x - n.x) / n.d, ny = (b.y - n.y) / n.d, dot = g.v.x * nx + g.v.y * ny; if (dot > 0) { g.v.x -= 2 * dot * nx; g.v.y -= 2 * dot * ny; g.v.x *= 0.8; g.v.y *= 0.8; sfx('clack'); } b.x = n.x + nx * lim; b.y = n.y + ny * lim; } }   // the fairway's edge: a bounce off the nearest wall
    g.bumpers.forEach((bp) => { const dx = b.x - bp.x, dy = b.y - bp.y, d = Math.hypot(dx, dy); if (d < bp.r + R) { const nx = dx / d, ny = dy / d, dot = g.v.x * nx + g.v.y * ny; g.v.x -= 2 * dot * nx; g.v.y -= 2 * dot * ny; g.v.x *= 1.15; g.v.y *= 1.15; b.x = bp.x + nx * (bp.r + R + 1); b.y = bp.y + ny * (bp.r + R + 1); bp.hit = 0.3; sfx('boing'); } });
    if (g.water.some((w) => ((b.x - w.x) / w.rx) ** 2 + ((b.y - w.y) / w.ry) ** 2 < 1)) { g.v = { x: 0, y: 0 }; sfx('plunk'); S.combo = 0; g.fx.push({ kind: 'text', x: b.x, y: b.y - 12, text: 'SPLASH · +1 putt', life: 1 }); g.putts += 1; Object.assign(b, tee()); }
    const cupR = (c) => CUP_R * (c.big || 1) * (g.twist?.kind === 'tiny' ? 0.5 : 1);
    const cup = g.cups.find((c) => Math.hypot(b.x - c.x, b.y - c.y) < cupR(c) && Math.hypot(g.v.x, g.v.y) < 260);
    if (cup) return sink(cup);
    if (!moving()) { g.v = { x: 0, y: 0 }; if (g.putts >= PUTTS_OF()) pickUp(); }
  }
  // 🐹 the gopher (Stage 2+): when the ball sits still it pops up, runs over and drags the ball off (+1 putt). Tap it to shoo it.
  { const st = host.stage?.() || 1;
    g.restT = !moving() && g.ball && !drag ? (g.restT || 0) + dt : 0;
    if (st >= 2 && !g.gopher && g.restT > 1.2) { g.gopherT = (g.gopherT ?? 3) - dt; if (g.gopherT <= 0) { g.gopherT = 8 - st * 1.5 + Math.random() * 4; const sp = spot(30); g.gopher = { x: sp.x, y: sp.y, t: 0, v: 40 + st * 20, grab: 0 }; g.fx.push({ kind: 'text', x: sp.x, y: sp.y - 20, text: '🐹 a gopher', life: 1 }); sfx('tick'); } }
    if (g.gopher) { const gp = g.gopher, b = g.ball; gp.t += dt;
      if (!b || moving()) g.gopher = null;
      else if (gp.grab > 0) { gp.grab -= dt; b.x += gp.dx * dt; b.y += gp.dy * dt; gp.x = b.x; gp.y = b.y; if (gp.grab <= 0) { g.gopher = null; const n = nearest(b.x, b.y), lim = g.pw / 2 - R; if (n.d > lim) { b.x = n.x + (b.x - n.x) / n.d * lim; b.y = n.y + (b.y - n.y) / n.d * lim; } } }
      else if (gp.t > 0.6) { const dx = b.x - gp.x, dy = b.y - gp.y, d = Math.hypot(dx, dy); if (d < 10) { gp.grab = 1.2; const a = Math.random() * 6.28; gp.dx = Math.cos(a) * 70; gp.dy = Math.sin(a) * 70; g.putts += 1; S.combo = 0; g.fx.push({ kind: 'text', x: b.x, y: b.y - 16, text: 'STOLEN · +1 putt', life: 1.1 }); sfx('buzz'); } else { gp.x += dx / d * gp.v * dt; gp.y += dy / d * gp.v * dt; } }
    }
  }
  g.bumpers.forEach((bp) => { if (bp.hit > 0) bp.hit -= dt; });
  g.fx.forEach((f) => { f.life -= dt; if (f.kind === 'dot') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 300 * dt; } else f.y -= 24 * dt; });
  g.fx = g.fx.filter((f) => f.life > 0);
}
function draw(t) {
  W = host?.W || W;
  const k = host.k, Hh = H();
  ctx.setTransform(k, 0, 0, k, host.ox || 0, host.oy || 0);
  ctx.fillStyle = '#1E3A1A'; ctx.fillRect(0, 0, W, Hh);
  if (!g) return;
  // the fairway: a corridor of legs, its rough edge, the mowing, the tee
  const way = () => { ctx.beginPath(); g.path.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x, p.y)); };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#2F6B2A'; ctx.lineWidth = g.pw + 12; way(); ctx.stroke();
  ctx.strokeStyle = '#4C9A3F'; ctx.lineWidth = g.pw; way(); ctx.stroke();
  ctx.strokeStyle = '#ffffff10'; ctx.lineWidth = g.pw * 0.45; ctx.setLineDash([18, 18]); way(); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#A8E08A55'; ctx.beginPath(); ctx.arc(g.path[0].x, g.path[0].y, 9, 0, 7); ctx.fill();
  ctx.save();
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
    // 🟢 you are Fig, rolled up into the ball (the glitch's Fig if a glitch is on), facing the way you roll
    g.face = g.v.x ? Math.sign(g.v.x) : (g.face || 1);
    ctx.fillStyle = '#00000033'; ctx.beginPath(); ctx.ellipse(b.x + 1, b.y + R + 2, R * 1.2, R * 0.45, 0, 0, 7); ctx.fill();
    drawPal(g.glitch ? (g.glitchPal || 'fig') : (S.curve.mood || 'calm'), ctx, { x: b.x, y: b.y, s: R * 1.15, t: performance.now() / 1000, r: S.curve.r, face: g.face, hurt: !!(g.gopher && g.gopher.grab > 0) });
  }
  ctx.restore();
  if (g.twist?.kind === 'wind') { ctx.strokeStyle = '#ffffff55'; ctx.lineWidth = 2; for (let i = 0; i < 10; i++) { const y = 80 + i * (Hh / 11), x = ((t / 5) * Math.sign(g.twist.wind) + i * 97) % (W + 60); ctx.beginPath(); ctx.moveTo(x - 30, y); ctx.lineTo(x, y); ctx.stroke(); } }
  if (g.gopher) { const gp = g.gopher, pop = Math.min(1, gp.t / 0.4); ctx.save(); ctx.translate(gp.x, gp.y); ctx.fillStyle = '#3A2A1A'; ctx.beginPath(); ctx.ellipse(0, 6, 13, 5, 0, 0, 7); ctx.fill(); ctx.translate(0, (1 - pop) * 14); ctx.fillStyle = '#A4753E'; ctx.beginPath(); ctx.ellipse(0, -4, 9, 11, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#1B1B22'; ctx.beginPath(); ctx.arc(-3.5, -8, 1.6, 0, 7); ctx.arc(3.5, -8, 1.6, 0, 7); ctx.fill(); ctx.fillStyle = '#FFF'; ctx.fillRect(-2.5, -2, 2, 4); ctx.fillRect(0.5, -2, 2, 4); ctx.restore(); }
  ctx.fillStyle = '#FFE08A'; ctx.font = '900 13px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`par ${g.par} · putt ${Math.min(PUTTS_OF(), g.putts + 1)} of ${PUTTS_OF()}${g.free ? ` · 🌻 ${g.free} free` : ''}`, W / 2, Hh - 16);
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
  pointer(type, p) { if (type === 'down') { if (g?.gopher && Math.hypot(g.gopher.x - p.x, g.gopher.y - p.y) < 30) return shoo(); drag = { x0: p.x, y0: p.y, x: p.x, y: p.y }; } else if (type === 'move') { if (drag) { drag.x = p.x; drag.y = p.y; } } else if (drag) { if (Math.hypot(drag.x - drag.x0, drag.y - drag.y0) < 8) fix(drag.x0, drag.y0); else putt(drag.x - drag.x0, drag.y - drag.y0); drag = null; } },
  hudLine: () => (g ? `⛳ course ${g.course} · ${g.courseHole}/3${g.fixes ? ` · 🔧${g.fixes}` : ''}` : ''),
  level: () => g?.course || 1,
  overText: (how) => (how === 'picked up' ? ['⛳ PICKED UP', 'Too many cups walked away from.'] : ['RUN OVER', '']),
  endStats: () => (g ? `⛳ ${sunkN} cups in ${puttsN} putts` : ''),
  debug: () => g && ({ fix, fixes: g.fixes, bumps: g.bumpers, sand: g.sand, water: g.water, jump: (c) => { g.course = c; g.courseHole = 0; g.coursePar = 0; g.courseStrokes = 0; g.ball = null; newCup(); }, gopher: g.gopher, bends: g.path.length - 2, pw: g.pw, path: g.path, ball: g.ball, v: g.v, cups: g.cups, putts: g.putts, sunk: sunkN, par: g.par, course: g.course, courseHole: g.courseHole, allowed: PUTTS_OF(), twist: g.twist?.kind || null, bumpers: g.bumpers.length, W, H: H(), putt }),
};
export default organ;
