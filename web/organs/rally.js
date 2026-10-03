// 🏎️ Rally, an organ of the shell: Micro Machines' DNA on a kitchen table. Fig drives a toy car around a
// loop of masking tape; hold the left or right half of the screen to steer (the car always goes), hold both
// to brake. Rivals race the same loop, and like the old game, a rival pushed far enough behind the camera is
// out of the lap and pays. The track is a fractal: a loop whose radius is a sum of Fibonacci harmonics
// (3, 5, 8, 13, 21 bumps around), rougher and narrower course by course. Hazards: 🥛 spilled milk (ice),
// 🍞 a toaster (a ramp), 🕳️ the pocket (fall in: a life), 📦 cereal boxes (walls). The box's beats: a peak
// stands a toy soldier on the road, the window spins the table, the mirror reverses the circuit, the balance
// drains the milk, the golden cut lays pennies (161), a big hop drops a cereal box, gift is a bumper, fib a
// nitro. Twists: 🧲 fridge magnet, 🌀 ceiling fan, 🔦 lights out, 🐈 the cat's paw.
import { fibMult } from '../chaos.js';
import { drawPal } from '../pals.js';

let W = 400, R = 13, VMAX = 230, TURN = 3.1, CAR = 1.5;   // R: a car's radius; CAR: how big the cars are drawn
const TWISTS = [
  ['🧲 FRIDGE MAGNET', 'the cars are pulled sideways', 'magnet'],
  ['🌀 CEILING FAN', 'a wind across the table', 'fan'],
  ['🔦 LIGHTS OUT', 'headlights only', 'dark'],
  ['🐈 THE CAT', 'a paw sweeps the track', 'paw'],
];
const FIB = [3, 5, 8, 13, 21];
let host, ctx, S, sfx, g = null, lapsN = 0, outsN = 0, held = {};
const H = () => host.H;
const stage = () => host.stage?.() || 1;
// 🏎️ the cars get faster as the run goes on: by course and by stage (230 at the start, ~1.7× by course 4 at Stage 4)
const topSpeed = () => VMAX * (1 + 0.12 * ((g?.course || 1) - 1) + 0.09 * (stage() - 1));
// 🔍 the camera starts close in and pulls back as the stages come (on top of the shell's own zoom-out)
const camZoom = () => 2.0 / (1 + 0.25 * (stage() - 1));
const GUIDE = { near: 130, far: 340, heading: 0.2 };   // the camera's look-ahead (table units up the tape) and how much it still follows the car's nose
const CAR_Y = 0.8;   // the car sits low on the screen: the road ahead is what you see
const hash = (i) => { let x = (Math.imul(i | 0, 374761393) + 668265263) | 0; x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };

// ---------------------------------------------------------------- the track
// A loop of 120 points. r(θ) = base × (1 + Σ a_k sin(F_k θ + φ_k)), the amplitudes falling off like 1/k^0.8 so the
// bumps are self-similar: big ones with smaller ones on them. Course 1 is nearly an oval; the harmonics grow by course.
function makeTrack(course, seed) {
  const n = 120, pts = [], rx = W * 0.62, ry = H() * 0.46, rough = Math.min(1, 0.05 + 0.1 * (course - 1));
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2; let f = 1;
    FIB.forEach((k, j) => { f += rough * Math.pow(k, -0.8) * 1.6 * Math.sin(k * th + hash(seed + j) * 6.28); });
    pts.push({ x: Math.cos(th) * rx * f, y: Math.sin(th) * ry * f });
  }
  let len = 0; const cum = [0]; for (let i = 1; i <= n; i++) { const a = pts[i - 1], b = pts[i % n]; len += Math.hypot(b.x - a.x, b.y - a.y); cum.push(len); }
  return { pts, cum, len, w: Math.max(120, 190 - 10 * course), n };   // wide tape: 180 on course 1, down to 120
}
const at = (s) => { const t = g.track; s = ((s % 1) + 1) % 1; const L = s * t.len; let i = 0; while (i < t.n && t.cum[i + 1] < L) i++; const a = t.pts[i], b = t.pts[(i + 1) % t.n], u = (L - t.cum[i]) / (t.cum[i + 1] - t.cum[i] || 1); return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, a: Math.atan2(b.y - a.y, b.x - a.x) }; };
function nearest(x, y) {   // the nearest point of the centreline: its progress s (0..1) and the distance d
  const t = g.track; let best = { d: 1e9, s: 0 };
  for (let i = 0; i < t.n; i++) { const a = t.pts[i], b = t.pts[(i + 1) % t.n], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1; let u = ((x - a.x) * dx + (y - a.y) * dy) / L2; u = Math.max(0, Math.min(1, u)); const px = a.x + dx * u, py = a.y + dy * u, d = Math.hypot(x - px, y - py); if (d < best.d) best = { d, s: (t.cum[i] + u * (t.cum[i + 1] - t.cum[i])) / t.len, px, py }; }
  return best;
}
const spotOn = (s, off = 0) => { const p = at(s); return { x: p.x + Math.cos(p.a + Math.PI / 2) * off, y: p.y + Math.sin(p.a + Math.PI / 2) * off }; };

// ---------------------------------------------------------------- a race
function newGame() { g = { course: 1, seed: Math.floor(Math.random() * 1e6), track: null, me: null, rivals: [], items: [], obs: [], fx: [], pennies: [], twist: null, time: 0, lap: 0, cps: 0, dir: 1, dark: 0, spin: 0, nitro: 0, bumper: 0, air: 0, paw: null, soldierT: 6, glitch: false, glitchPal: null, started: false }; lapsN = 0; outsN = 0; newCourse(); }
function newCourse() {
  g.track = makeTrack(g.course, g.seed + g.course * 97); g.dir = 1; g.lap = 0; g.cps = 0; g.obs = []; g.pennies = []; g.items = [];
  const s0 = at(0); g.me = { x: s0.x, y: s0.y, a: s0.a, v: 0, s: 0, prevS: 0 };
  g.rivals = []; const n = 1 + Math.min(4, stage()); for (let i = 0; i < n; i++) { const s = (i + 1) * 0.015; const p = at(s); g.rivals.push({ x: p.x + Math.cos(p.a + Math.PI / 2) * (i % 2 ? 14 : -14), y: p.y + Math.sin(p.a + Math.PI / 2) * (i % 2 ? 14 : -14), a: p.a, v: 0, s, skill: 0.8 + Math.random() * 0.2 + 0.03 * stage(), hue: [0, 40, 200, 280, 120][i % 5], out: 0, laps: 0 }); }
  // the hazards, placed on the tape: milk (ice), a toaster (ramp), the pocket (from course 2), boxes (walls) along the edges
  const put = (kind, s, off, extra) => g.items.push({ kind, ...spotOn(s, off), s, ...extra });
  put('milk', 0.3 + hash(g.seed + 1) * 0.1, 0, { r: 26 }); if (g.course >= 2) put('milk', 0.7 + hash(g.seed + 2) * 0.1, 8, { r: 22 });
  put('toaster', 0.5 + hash(g.seed + 3) * 0.05, 0, { a: at(0.5).a });
  if (g.course >= 2) put('hole', 0.15 + hash(g.seed + 4) * 0.1, (hash(g.seed + 5) - 0.5) * g.track.w * 0.6, { r: 14 });
  if (g.course >= 3) put('hole', 0.85 + hash(g.seed + 6) * 0.08, (hash(g.seed + 7) - 0.5) * g.track.w * 0.6, { r: 14 });
  // 🪂 the table's edge: stretches where the tape runs along the rim, with no kerb on the outside and a drop to the floor
  { let sum = 0; for (let k = 0; k < 24; k++) { const p = at(k / 24); sum += p.x * -Math.sin(p.a) + p.y * Math.cos(p.a); } g.outer = Math.sign(sum) || 1; }   // which side of the tape is the outside of the loop
  g.edges = []; [0.25, 0.68, 0.84].slice(0, Math.min(3, g.course)).forEach((c0, i) => { const c = c0 + hash(g.seed + 20 + i) * 0.05, half = (0.08 + 0.02 * Math.min(3, g.course - 1)) / 2, p = at(c), side = g.outer; g.edges.push({ s0: c - half, s1: c + half, c, side }); });
  for (let i = 0; i < 3 + g.course; i++) { const s = hash(g.seed + 10 + i), side = i % 2 ? 1 : -1; if (edgeAt(s, side)) continue; put('box', s, side * (g.track.w / 2 + 16), { w: 26, h: 18 }); }
  g.rim = buildRim();
  host.banner(`🏁 COURSE ${g.course}`, `${3} laps · ${g.rivals.length} rivals · hold a side to steer`);
}
// an open edge at progress s on that side of the tape (side: +1 / -1, the same sense as spotOn's offset), or null
function edgeAt(s, side) { return (g.edges || []).find((e) => e.side === Math.sign(side) && (((s - e.s0) % 1) + 1) % 1 <= e.s1 - e.s0) || null; }
// 🪂 Fig to the rescue: Fig hops out of the tumbling car, flies down to it on the floor, hauls it back up and sets it
// on the tape. The car is Fig's to carry for RESCUE seconds; the life is taken when it lands.
const RESCUE = 1.3;
function startRescue(c) {
  const p = at(c.s - g.dir * 0.02);
  c.rescue = { t: 0, x0: c.x, y0: c.y, a0: c.a, x1: p.x, y1: p.y, a1: p.a + (g.dir < 0 ? Math.PI : 0) }; c.v = 0; c.spin = 0;
  host.banner('🪂 FIG TO THE RESCUE', 'over the edge: Fig hauls the car back up'); sfx('whistle', { dur: 0.4 });
}
function stepRescue(c, dt) {
  const r = c.rescue; r.t += dt; const e = Math.min(1, r.t / RESCUE), k = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
  c.x = r.x0 + (r.x1 - r.x0) * k; c.y = r.y0 + (r.y1 - r.y0) * k; c.a = r.a0 + ((((r.a1 - r.a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI)) * k;
  if (e >= 1) { c.rescue = null; respawn(c, true); sfx('clack'); }
}
// ---------------------------------------------------------------- the table's edge, all the way round
// Outside the loop the table ends: right at the tape on an open stretch, MARGIN beyond it elsewhere, where it's guarded
// (a railing, a row of books, toy bricks) and a car bounces off. The margin eases in and out by RAMP round each open stretch.
const MARGIN = 46, RAMP = 0.025, GUARDS = ['rail', 'books', 'bricks'];
function marginAt(s) {
  let d = 1; (g.edges || []).forEach((e) => { const into = (((s - e.s0) % 1) + 1) % 1; if (into <= e.s1 - e.s0) d = 0; else d = Math.min(d, (((e.s0 - s) % 1) + 1) % 1, (((s - e.s1) % 1) + 1) % 1); });
  const u = Math.min(1, d / RAMP); return MARGIN * u * u * (3 - 2 * u);
}
function buildRim() {   // 240 points on the table's edge, each with its outward normal and its guard ('open' on an open stretch)
  const N = 240, out = [];
  for (let k = 0; k < N; k++) { const sk = k / N, p = at(sk), nx = -Math.sin(p.a) * g.outer, ny = Math.cos(p.a) * g.outer, m = marginAt(sk), off = g.track.w / 2 + m;
    out.push({ s: sk, x: p.x + nx * off, y: p.y + ny * off, nx, ny, m, guard: edgeAt(sk, g.outer) ? 'open' : GUARDS[Math.floor(hash(g.seed + 50 + Math.floor(sk * 9)) * 3)] }); }
  return out;
}
function respawn(c, isMe) {   // back on the tape a little behind where it went over
  const p = at(c.s - g.dir * 0.02); c.x = p.x; c.y = p.y; c.a = p.a + (g.dir < 0 ? Math.PI : 0); c.v = 0; c.fall = 0; c.spin = 0; c.s = c.prevS = nearest(c.x, c.y).s;
  if (isMe) { S.combo = 0; host.cue?.('pickup', c.x, c.y); host.hurt('fell off the edge'); }
}
function onBeat(ev) {
  const x = ev.x, ahead = (s) => (g.me.s + g.dir * s + 1) % 1;
  if (ev.peak && !ev.window) { const p = spotOn(ahead(0.08), (Math.random() - 0.5) * g.track.w * 0.5); g.obs.push({ kind: 'soldier', ...p, life: 14 }); }   // 🪖 a toy soldier stands on the road
  if (ev.enteredWindow) { g.spinTable = 1; sfx('twist'); }   // 🔁 the window spins the table (the view turns a quarter each beat)
  if (ev.window) g.tableTurn = (g.tableTurn || 0) + Math.PI / 2;
  if (ev.mirror) { g.dir *= -1; g.me.a += Math.PI; g.rivals.forEach((r) => { r.a += Math.PI; }); g.cps = 0; g.fx.push({ kind: 'text', x: g.me.x, y: g.me.y - 30, text: '✨ REVERSED', life: 1 }); sfx('chime'); }
  if (ev.balance) { g.items = g.items.filter((i) => i.kind !== 'milk'); sfx('chime'); }
  if (ev.golden) { host.add(161); if (g.pennies.length < 8) for (let i = 0; i < 8; i++) g.pennies.push({ ...spotOn(ahead(0.03 + i * 0.012), Math.sin(i * 0.9) * g.track.w * 0.3), t: i }); sfx('chime', { hi: true }); }
  if (ev.hop > 0.3 && !ev.window) { const p = spotOn(ahead(0.1), (Math.random() - 0.5) * g.track.w * 0.6); g.obs.push({ kind: 'box', ...p, w: 26, h: 18, life: 12 }); }   // 📦 a cereal box drops on the road
  if (ev.gift) { g.bumper = 1; host.banner('🛡️ BUMPER', 'the next bump bounces off'); }
  if (ev.fib) { g.nitro = 2; sfx('cannon', { size: 0.4 }); }
  if (ev.big && !g.twist) twist();
}
function twist() {
  const [title, sub, kind] = TWISTS[Math.floor(Math.random() * TWISTS.length)];
  g.twist = { kind, until: g.time + 6, dir: Math.random() < 0.5 ? -1 : 1 }; host.banner(title, sub); sfx('twist');
  if (kind === 'paw') g.paw = { s: (g.me.s + g.dir * 0.25) % 1, t: 0 };
}

// ---------------------------------------------------------------- the race
function drive(c, dt, steer, brake, isMe) {
  if (c.fall > 0) { c.fall -= dt; c.x += Math.cos(c.a) * c.v * dt * 0.5; c.y += Math.sin(c.a) * c.v * dt * 0.5; c.a += dt * 5; if (c.fall <= 0) { if (isMe) startRescue(c); else respawn(c, false); } return; }   // 🪂 tumbling off the table
  if (c.rescue) { stepRescue(c, dt); return; }
  const n = nearest(c.x, c.y), onTape = n.d < g.track.w / 2, milk = g.items.find((i) => i.kind === 'milk' && Math.hypot(i.x - c.x, i.y - c.y) < i.r);
  const vmax = topSpeed() * (isMe && g.nitro > 0 ? 1.5 : 1) * (onTape ? 1 : 0.55) * (isMe ? 1 : c.skill);
  if (c.spin > 0) { c.spin -= dt; c.a += dt * 9; c.v *= Math.pow(0.5, dt); } else {
    const grip = milk ? 0.25 : 1; c.a += steer * TURN * grip * dt * Math.min(1, c.v / 80 + 0.3);
    c.v += (brake ? -400 : (vmax - c.v) * 2.4) * dt; if (c.v < 0) c.v = 0; if (milk) c.v = Math.max(c.v, vmax * 0.6);
  }
  if (c.air > 0) c.air -= dt;
  let vx = Math.cos(c.a) * c.v, vy = Math.sin(c.a) * c.v;
  if (g.twist?.kind === 'magnet') { const t = at(c.s + 0.001); vx += Math.cos(t.a + Math.PI / 2) * 70 * g.twist.dir; vy += Math.sin(t.a + Math.PI / 2) * 70 * g.twist.dir; }
  if (g.twist?.kind === 'fan') vx += 60 * g.twist.dir;
  c.x += vx * dt; c.y += vy * dt;
  // walls: the cereal boxes, and the table's edge
  const walls = g.items.filter((i) => i.kind === 'box').concat(g.obs.filter((o) => o.kind === 'box'));
  walls.forEach((b) => { if (Math.abs(c.x - b.x) < b.w / 2 + R && Math.abs(c.y - b.y) < b.h / 2 + R) { const dx = c.x - b.x, dy = c.y - b.y; if (Math.abs(dx) / b.w > Math.abs(dy) / b.h) { c.x = b.x + Math.sign(dx) * (b.w / 2 + R); } else { c.y = b.y + Math.sign(dy) * (b.h / 2 + R); }
    // a bump: you lose some speed and the car is turned back along the tape, so it never sits stalled against a box
    const ta = at(nearest(c.x, c.y).s).a + (g.dir < 0 ? Math.PI : 0); c.a = ta + (((c.a - ta + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 0.4; c.v = Math.max(c.v * 0.6, 50);
    if (isMe) b.hit = true;   // 📦 dented: only a box your car has hit can be smashed by a tap
    if (isMe && !c.bumpT) { c.bumpT = 0.5; if (g.bumper) { g.bumper = 0; } else { c.spin = 0.3; sfx('clack'); } } } });
  if (c.bumpT > 0) c.bumpT = Math.max(0, c.bumpT - dt);
  const n2 = nearest(c.x, c.y); c.prevS = c.s; c.s = n2.s; c.off = n2.d;
  { const ta = at(n2.s).a, lat = (c.x - n2.px) * -Math.sin(ta) + (c.y - n2.py) * Math.cos(ta);   // past the tape's edge where the table ends: over you go
    if (c.air <= 0 && Math.abs(lat) > g.track.w / 2 + 6 && edgeAt(n2.s, lat)) { c.fall = 0.7; if (isMe) { host.cue?.('near', c.x, c.y); sfx('whistle', { dur: 0.5 }); g.fx.push({ kind: 'text', x: c.x, y: c.y - 24, text: '🪂 WHOOPS', life: 1 }); } return; } }
  { const ta = at(n2.s).a, nx = -Math.sin(ta), ny = Math.cos(ta), lat = (c.x - n2.px) * nx + (c.y - n2.py) * ny, lim = g.track.w / 2 + marginAt(n2.s) - R;
    if (Math.sign(lat) === g.outer && Math.abs(lat) > lim && !edgeAt(n2.s, lat)) {   // 🧱 a guard on the table's edge: bounce back along the tape
      c.x = n2.px + nx * g.outer * lim; c.y = n2.py + ny * g.outer * lim; const da = ta + (g.dir < 0 ? Math.PI : 0); c.a = da + (((c.a - da + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 0.4; c.v = Math.max(c.v * 0.7, 40);
      if (isMe && !c.bumpT) { c.bumpT = 0.4; sfx('clack'); } }
    else if (Math.sign(lat) !== g.outer && Math.abs(lat) > g.track.w / 2 + 110) { c.x += (n2.px - c.x) * 0.1; c.y += (n2.py - c.y) * 0.1; c.v *= 0.9; } }   // the infield: eased back toward the tape
}
function update(dt) {
  W = host?.W || W;
  g.time += dt;
  if (g.twist && g.time > g.twist.until) { g.twist = null; g.paw = null; }
  g.dark += ((g.twist?.kind === 'dark' ? 1 : 0) - g.dark) * Math.min(1, dt * 3);
  if (g.nitro > 0) g.nitro -= dt;
  if (g.tableTurn) { g.turn = (g.turn || 0) + (g.tableTurn - (g.turn || 0)) * Math.min(1, dt * 3); if (!S.curve.window && Math.abs(g.tableTurn - g.turn) < 0.01) { g.tableTurn = 0; g.turn = 0; } }
  let steer = (held.left ? -1 : 0) + (held.right ? 1 : 0); const brake = !!(held.left && held.right);
  if (g.auto) { const look = at(g.me.s + g.dir * 0.03), want = Math.atan2(look.y - g.me.y, look.x - g.me.x); steer = Math.max(-1, Math.min(1, (((want - g.me.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 2.5)); }   // a test autopilot
  const me = g.me; me.spin = me.spin || 0;
  drive(me, dt, brake ? 0 : steer, brake, true); if (S.over) return;
  // 🪖 soldiers and 🕳️ the pocket, 🍞 the toaster, the pennies
  g.obs = g.obs.filter((o) => { o.life -= dt; if (o.kind === 'soldier' && Math.hypot(o.x - me.x, o.y - me.y) < R + 10 && me.air <= 0 && !me.fall && !me.rescue) { if (g.bumper) { g.bumper = 0; } else { me.spin = 0.8; S.combo = 0; } g.fx.push({ kind: 'text', x: o.x, y: o.y - 20, text: '🪖 BONK', life: 0.8 }); sfx('thud'); return false; } return o.life > 0; });
  g.items.forEach((i) => { const d = Math.hypot(i.x - me.x, i.y - me.y);
    if (i.kind === 'hole' && d < i.r && me.air <= 0 && !me.fall && !me.rescue) { me.spin = 0; me.v = 0; const p = at(me.s - g.dir * 0.03); me.x = p.x; me.y = p.y; me.a = p.a + (g.dir < 0 ? Math.PI : 0); S.combo = 0; host.cue?.('near', i.x, i.y); sfx('plunk');
      if (g.course >= 3) { if (!host.hurt('fell in the pocket')) host.banner('🕳️ THE POCKET', `${S.hearts} ${S.hearts === 1 ? 'heart' : 'hearts'} left`); } else { me.spin = 0.9; host.banner('🕳️ THE POCKET', 'fished out · from course 3 it costs a life'); } }
    if (i.kind === 'toaster' && d < 20 && me.air <= 0 && me.v > 60) { me.air = 0.7; me.v = Math.max(me.v, topSpeed() * 1.2); sfx('whistle', { dur: 0.3 }); g.fx.push({ kind: 'text', x: me.x, y: me.y - 24, text: '🍞 POP!', life: 0.8 }); } });
  g.pennies = g.pennies.filter((p) => { if (Math.hypot(p.x - me.x, p.y - me.y) < R + 8) { host.add(20); host.cue?.('score', p.x, p.y); g.fx.push({ kind: 'text', x: p.x, y: p.y - 14, text: '+20', life: 0.7 }); sfx('chime', { hi: true }); return false; } return true; });   // flat: the combo is for laps and rivals
  // 🐈 the paw sweeps along the track and swats whatever it meets
  if (g.paw) { g.paw.t += dt; g.paw.s = (g.paw.s + g.dir * 0.06 * dt + 1) % 1; const p = at(g.paw.s); [me, ...g.rivals].forEach((c) => { if (Math.hypot(c.x - p.x, c.y - p.y) < 34 && c.spin <= 0 && !c.fall && !c.rescue) { c.spin = 0.7; c.x += Math.cos(p.a + Math.PI / 2) * 30; c.y += Math.sin(p.a + Math.PI / 2) * 30; if (c === me) { S.combo = 0; sfx('thud'); } } }); }
  // checkpoints and laps
  const ds = (me.s - me.prevS + 1.5) % 1 - 0.5; if (g.dir * ds > 0) { const q = Math.floor((g.dir > 0 ? me.s : 1 - me.s) * 4); if (q === g.cps + 1 && g.cps < 3) g.cps += 1; }
  if (g.cps >= 3 && ((g.dir > 0 && me.prevS > 0.9 && me.s < 0.1) || (g.dir < 0 && me.prevS < 0.1 && me.s > 0.9))) lapDone();
  // rivals: they follow the tape, rubber-banded to you; pushed far enough behind the camera they're out of the lap
  g.rivals.forEach((r) => { r.spin = r.spin || 0; if (r.out > 0) { r.out -= dt; if (r.out <= 0) { const p = at(me.s + g.dir * 0.1); r.x = p.x; r.y = p.y; r.a = p.a + (g.dir < 0 ? Math.PI : 0); r.v = 0; } return; }   // back on the tape a little ahead of you
    const gap = ((r.s - me.s) * g.dir + 1.5) % 1 - 0.5, look = at(r.s + g.dir * 0.03 + (gap < -0.2 ? 0.01 : 0)), want = Math.atan2(look.y - r.y, look.x - r.x); let da = ((want - r.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    r.skillNow = r.skill * (gap < -0.15 ? 1.18 : gap > 0.12 ? 0.9 : 1); const sk = r.skill; r.skill = r.skillNow; drive(r, dt, Math.max(-1, Math.min(1, da * 2.5)), false, false); r.skill = sk;
    if (gap < -0.2 && r.off < 40 && r.outLap !== g.lap) { r.out = 4; r.outLap = g.lap; outsN += 1; const pts = 150; host.add(pts); host.cue?.('kill', r.x, r.y); g.fx.push({ kind: 'text', x: me.x, y: me.y - 34, text: `🏁 LEFT BEHIND +${pts}`, life: 1.1, big: true }); sfx('cheer', { delay: 0.05 }); }   // once a lap per rival, flat
    // bumping
    const dx = r.x - me.x, dy = r.y - me.y, d = Math.hypot(dx, dy); if (d < R * 2 && d > 0 && !me.rescue && !me.fall) { const push = (R * 2 - d) / 2, nx = dx / d, ny = dy / d; r.x += nx * push; r.y += ny * push; me.x -= nx * push; me.y -= ny * push; if (g.bumper) { r.spin = 0.5; g.bumper = 0; } } });
  for (let i = 0; i < g.rivals.length; i++) for (let j = i + 1; j < g.rivals.length; j++) { const a = g.rivals[i], b = g.rivals[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy); if (d < R * 2 && d > 0) { const push = (R * 2 - d) / 2; a.x -= dx / d * push; a.y -= dy / d * push; b.x += dx / d * push; b.y += dy / d * push; } }
  g.fx.forEach((f) => { f.life -= dt; if (f.kind === 'bit') { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= Math.pow(0.08, dt); f.vy *= Math.pow(0.08, dt); f.rot += f.vr * dt; } else f.y -= 24 * dt; }); g.fx = g.fx.filter((f) => f.life > 0);
}
function lapDone() {
  g.lap += 1; lapsN += 1; g.cps = 0;
  const behind = g.rivals.filter((r) => r.out > 0 || ((r.s - g.me.s) * g.dir + 1.5) % 1 - 0.5 < 0).length; S.combo = S.comboT > 0 ? S.combo + 1 : 1; S.comboT = 4; const pts = (200 + 60 * behind) * fibMult(Math.min(S.combo, 6));   // laps combo, capped
  host.add(pts); host.cue?.('kill', g.me.x, g.me.y); g.fx.push({ kind: 'text', x: g.me.x, y: g.me.y - 34, text: `🏁 LAP ${g.lap} +${pts}`, life: 1.2, big: true }); sfx('birdie');
  if (g.lap >= 3) { g.course += 1; host.add(300 * (g.course - 1)); host.banner(`🏆 COURSE ${g.course - 1} WON`, `+${300 * (g.course - 1)} · up to course ${g.course}`); sfx('fanfare'); host.heal(1); newCourse(); }
}

// ---------------------------------------------------------------- 📦 tap a box and it breaks
// A screen point (the organ's world units) back through the chase camera onto the table.
function toTable(p) {
  const th = g.camA + (g.turn || 0), sx = (p.x - W / 2) / g.zoom, sy = (p.y - H() * CAR_Y) / g.zoom;
  return { x: g.me.x + Math.cos(th) * sx + Math.sin(th) * sy, y: g.me.y - Math.sin(th) * sx + Math.cos(th) * sy };
}
function boxAt(p) {   // forgiving: a fat finger's width round the box, the same on screen at any zoom
  if (!g?.me || g.zoom == null || g.camA == null) return null;
  const q = toTable(p), slack = 22 / g.zoom; let best = null, bd = 1e9;
  [...g.items, ...g.obs].forEach((b) => { if (b.kind !== 'box' || !b.hit) return; const dx = Math.max(0, Math.abs(q.x - b.x) - b.w / 2), dy = Math.max(0, Math.abs(q.y - b.y) - b.h / 2), d = Math.hypot(dx, dy); if (d <= slack && d < bd) { bd = d; best = b; } });
  return best;
}
let smashedN = 0;
function smash(b) {
  g.items = g.items.filter((i) => i !== b); g.obs = g.obs.filter((o) => o !== b); smashedN += 1;
  const cols = ['#EE2B3B', '#FFD23F', '#FFFFFF', '#F2C27A', '#E8A33A'];
  for (let i = 0; i < 16; i++) { const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 160; g.fx.push({ kind: 'bit', x: b.x, y: b.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, sz: 3 + Math.random() * 4, col: cols[i % cols.length], life: 0.7 + Math.random() * 0.4 }); }
  host.add(30); host.cue?.('score', b.x, b.y); g.fx.push({ kind: 'text', x: b.x, y: b.y - 18, text: '📦 CRUNCH +30', life: 0.9 }); sfx('thud');
}

// ---------------------------------------------------------------- drawing
function drawGuards(t) {
  const rim = g.rim, N = rim.length, BOOKS = ['#EE2B3B', '#2D7FF9', '#FFD23F', '#22C55E', '#A855F7', '#FF8A3D'], BRICKS = ['#EE2B3B', '#FFD23F', '#2D7FF9', '#22C55E'];
  for (let k = 0; k < N; k++) { const a = rim[k], b = rim[(k + 1) % N]; if (a.guard === 'open' || b.guard === 'open' || a.m < 2) continue;
    if (a.guard === 'books') {   // a row of book spines standing on the edge
      ctx.fillStyle = BOOKS[k % BOOKS.length]; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x - b.nx * 13, b.y - b.ny * 13); ctx.lineTo(a.x - a.nx * 13, a.y - a.ny * 13); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#00000055'; ctx.lineWidth = 1; ctx.stroke(); ctx.fillStyle = '#ffffff99'; const mx = (a.x + b.x) / 2 - a.nx * 6.5, my = (a.y + b.y) / 2 - a.ny * 6.5; ctx.fillRect(mx - 1, my - 1, 2, 2);
    } else if (a.guard === 'bricks') {   // toy bricks, two-stud, in four colours
      const col = BRICKS[(k >> 1) % BRICKS.length]; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x - b.nx * 11, b.y - b.ny * 11); ctx.lineTo(a.x - a.nx * 11, a.y - a.ny * 11); ctx.closePath(); ctx.fill();
      if (k % 2 === 0) { ctx.strokeStyle = '#00000055'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x - a.nx * 11, a.y - a.ny * 11); ctx.stroke(); }
      ctx.fillStyle = '#ffffff66'; ctx.beginPath(); ctx.arc((a.x + b.x) / 2 - a.nx * 5.5, (a.y + b.y) / 2 - a.ny * 5.5, 2.4, 0, 7); ctx.fill();
    } else {   // a white wooden railing: posts and a rail
      ctx.strokeStyle = '#00000044'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(a.x - a.nx * 4 + 2, a.y - a.ny * 4 + 3); ctx.lineTo(b.x - b.nx * 4 + 2, b.y - b.ny * 4 + 3); ctx.stroke();
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(a.x - a.nx * 4, a.y - a.ny * 4); ctx.lineTo(b.x - b.nx * 4, b.y - b.ny * 4); ctx.stroke();
      if (k % 2 === 0) { ctx.fillStyle = '#F4F1EA'; ctx.beginPath(); ctx.arc(a.x - a.nx * 4, a.y - a.ny * 4, 3.6, 0, 7); ctx.fill(); ctx.strokeStyle = '#9A8F7A'; ctx.lineWidth = 1; ctx.stroke(); }
    } }
}
function drawMilk(i, upright) {
  ctx.fillStyle = '#00000022'; ctx.beginPath(); ctx.ellipse(i.x + 2, i.y + 3, i.r, i.r * 0.72, 0.3, 0, 7); ctx.fill();
  ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); for (let k = 0; k <= 12; k++) { const a = (k / 12) * Math.PI * 2, rr = i.r * (0.85 + 0.2 * Math.sin(k * 2.7 + i.x)); ctx[k ? 'lineTo' : 'moveTo'](i.x + Math.cos(a) * rr, i.y + Math.sin(a) * rr * 0.72); } ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#BFE3FF'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#E4F3FF'; ctx.beginPath(); ctx.ellipse(i.x - i.r * 0.25, i.y - i.r * 0.15, i.r * 0.35, i.r * 0.2, 0.3, 0, 7); ctx.fill();
  upright(i.x + i.r * 0.75, i.y - i.r * 0.55, '🥛', 15);
}
function drawHole(i) {
  ctx.fillStyle = '#FFD23F'; ctx.beginPath(); ctx.arc(i.x, i.y, i.r + 5, 0, 7); ctx.fill();
  ctx.strokeStyle = '#111'; ctx.lineWidth = 5; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.arc(i.x, i.y, i.r + 2.5, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  const hg = ctx.createRadialGradient(i.x, i.y, 1, i.x, i.y, i.r); hg.addColorStop(0, '#000'); hg.addColorStop(1, '#2A1A10'); ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(i.x, i.y, i.r, 0, 7); ctx.fill();
}
function drawToaster(i) {
  ctx.save(); ctx.translate(i.x, i.y); ctx.rotate(i.a);
  ctx.fillStyle = '#00000044'; ctx.beginPath(); ctx.roundRect(-16, -13, 36, 32, 7); ctx.fill();
  ctx.fillStyle = '#D9DEE6'; ctx.beginPath(); ctx.roundRect(-18, -16, 36, 32, 7); ctx.fill(); ctx.strokeStyle = '#8A93A3'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#ffffffaa'; ctx.beginPath(); ctx.roundRect(-16, -14, 6, 28, 3); ctx.fill();
  [-8, 3].forEach((y) => { ctx.fillStyle = '#2B2B33'; ctx.fillRect(-12, y, 24, 6); ctx.fillStyle = '#E3A35B'; ctx.fillRect(-11, y + 1, 22, 4); ctx.fillStyle = '#9A5B22'; ctx.fillRect(-11, y + 1, 22, 1); });   // toast in the slots
  ctx.fillStyle = '#EE2B3B'; ctx.beginPath(); ctx.roundRect(15, -4, 6, 8, 2); ctx.fill();   // the lever
  ctx.restore();
}
function drawBox(b, upright, t) {
  const x = b.x - b.w / 2, y = b.y - b.h / 2;
  ctx.fillStyle = '#00000048'; ctx.fillRect(x + 4, y + 5, b.w, b.h);
  ctx.fillStyle = '#EE2B3B'; ctx.fillRect(x, y, b.w, b.h);
  ctx.fillStyle = '#FFD23F'; ctx.fillRect(x, y + b.h * 0.62, b.w, b.h * 0.2);
  ctx.strokeStyle = '#A3121F'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, b.y - 1); ctx.lineTo(x + b.w, b.y - 1); ctx.stroke();   // the lid's flaps
  ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, b.w, b.h);
  upright(b.x, b.y, '🥣', 12);
  if (b.hit) {   // dented by your car: a crack and a pulsing outline say it can be smashed now
    ctx.strokeStyle = '#2A0A0E'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x + b.w * 0.15, y); ctx.lineTo(x + b.w * 0.35, y + b.h * 0.45); ctx.lineTo(x + b.w * 0.25, y + b.h * 0.6); ctx.lineTo(x + b.w * 0.45, y + b.h); ctx.stroke();
    ctx.strokeStyle = `rgba(255, 236, 120, ${0.55 + 0.45 * Math.sin(t / 120)})`; ctx.lineWidth = 2.5; ctx.strokeRect(x - 3, y - 3, b.w + 6, b.h + 6);
  }
}
function drawSoldier(o) {
  ctx.fillStyle = '#00000040'; ctx.beginPath(); ctx.arc(o.x + 2, o.y + 3, 11, 0, 7); ctx.fill();
  ctx.fillStyle = '#3E8E2C'; ctx.beginPath(); ctx.arc(o.x, o.y, 11, 0, 7); ctx.fill(); ctx.strokeStyle = '#24561A'; ctx.lineWidth = 1.5; ctx.stroke();   // the base
  ctx.fillStyle = '#6BCB4A'; ctx.beginPath(); ctx.ellipse(o.x, o.y, 8, 4.5, 0, 0, 7); ctx.fill(); ctx.stroke();   // shoulders
  ctx.strokeStyle = '#24561A'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(o.x + 4, o.y - 2); ctx.lineTo(o.x + 13, o.y - 9); ctx.stroke();   // the rifle
  ctx.fillStyle = '#7FDB5C'; ctx.beginPath(); ctx.arc(o.x, o.y, 4.5, 0, 7); ctx.fill(); ctx.strokeStyle = '#24561A'; ctx.lineWidth = 1.5; ctx.stroke();   // the helmet
}
function draw(t) {
  W = host?.W || W;
  const k = host.k, Hh = H(), me = g?.me;
  ctx.setTransform(k, 0, 0, k, host.ox || 0, host.oy || 0);
  ctx.fillStyle = '#B4662A'; ctx.fillRect(0, 0, W, Hh);
  if (!g) return;
  // the camera: on you, the table turning under the window
  g.zoom = g.zoom ? g.zoom + (camZoom() - g.zoom) * 0.02 : camZoom();
  // 🎥 the chase camera: top-down, but turned so the car always points up the screen, following it from behind (eased, so a
  // spin doesn't whirl the whole table); the window's table spin adds its own turn on top
  // 🧭 the guide: the view turns toward where the road goes, not just where the car points. It aims at a blend of two
  // spots up the tape (near and far, GUIDE) and a share of the car's heading, so a bend ahead already leans the top
  // of the screen into it; a spinning or carried car doesn't whirl the table round.
  { const L = g.track.len, look = (d) => at(me.s + g.dir * d / L), near = look(GUIDE.near), far = look(GUIDE.far), hw = (me.spin > 0 || me.fall > 0 || me.rescue) ? 0 : GUIDE.heading;
    const v1x = near.x - me.x, v1y = near.y - me.y, n1 = Math.hypot(v1x, v1y) || 1, v2x = far.x - me.x, v2y = far.y - me.y, n2 = Math.hypot(v2x, v2y) || 1;
    const vx = (v1x / n1) * 0.45 + (v2x / n2) * 0.55, vy = (v1y / n1) * 0.45 + (v2y / n2) * 0.55, gn = Math.hypot(vx, vy) || 1;
    const bx = (vx / gn) * (1 - hw) + Math.cos(me.a) * hw, by = (vy / gn) * (1 - hw) + Math.sin(me.a) * hw;
    const want = -(Math.atan2(by, bx) + Math.PI / 2); g.guideA = Math.atan2(vy, vx); if (g.camA == null) g.camA = want; const da = ((want - g.camA + Math.PI * 3) % (Math.PI * 2)) - Math.PI; g.camA += da * Math.min(1, 0.07); }
  ctx.save(); ctx.translate(W / 2, Hh * CAR_Y); ctx.scale(g.zoom, g.zoom); ctx.rotate(g.camA + (g.turn || 0)); ctx.translate(-me.x, -me.y);
  // the table: warm planks with seams and grain, and a faint Sierpiński-carpet tablecloth (the fractal on the table)
  const Rv = Math.hypot(W, Hh) / g.zoom, gx0 = Math.floor((me.x - Rv) / 60) * 60, gy0 = Math.floor((me.y - Rv) / 60) * 60;   // the table under a turning camera: a disc's worth of grain
  // the floor, a long way down, then the table clipped to its edge
  ctx.fillStyle = '#1C1226'; ctx.fillRect(gx0, gy0, Rv * 2 + 120, Rv * 2 + 120); ctx.fillStyle = '#251A33'; for (let y = gy0; y < me.y + Rv; y += 80) for (let x = gx0 + (((y / 80) | 0) % 2) * 80; x < me.x + Rv; x += 160) ctx.fillRect(x, y, 80, 80);
  const rimPath = () => { ctx.beginPath(); g.rim.forEach((p, k) => ctx[k ? 'lineTo' : 'moveTo'](p.x, p.y)); ctx.closePath(); };
  ctx.save(); ctx.fillStyle = '#00000066'; ctx.translate(10, 16); rimPath(); ctx.fill(); ctx.restore();   // the table's shadow on the floor
  ctx.save(); rimPath(); ctx.clip();
  for (let y = gy0; y < me.y + Rv; y += 60) { ctx.fillStyle = ((y / 60) | 0) % 2 ? '#C0702F' : '#B4662A'; ctx.fillRect(gx0, y, Rv * 2 + 60, 60); ctx.fillStyle = '#7A3E18'; ctx.fillRect(gx0, y, Rv * 2 + 60, 2); ctx.fillStyle = '#ffffff12'; for (let i = 0; i < 3; i++) ctx.fillRect(gx0, y + 12 + i * 15 + (hash(y + i) * 6 | 0), Rv * 2 + 60, 1.5); }
  ctx.fillStyle = '#ffffff0d'; for (let y = gy0; y < me.y + Rv; y += 60) for (let x = gx0; x < me.x + Rv; x += 60) { ctx.fillRect(x + 20, y + 20, 20, 20); for (let i = 0; i < 9; i++) if (i !== 4) ctx.fillRect(x + (i % 3) * 20 + 7, y + Math.floor(i / 3) * 20 + 7, 6, 6); }
  ctx.restore();
  ctx.lineJoin = 'round'; ctx.strokeStyle = '#5E2E10'; ctx.lineWidth = 7; rimPath(); ctx.stroke(); ctx.strokeStyle = '#E9A060'; ctx.lineWidth = 1.5; rimPath(); ctx.stroke();   // the table's edge
  // the tape: shadow, red-and-white kerbs, the tape, the dashed centre, the finish line
  const way = () => { ctx.beginPath(); g.track.pts.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x, p.y)); ctx.closePath(); };
  ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
  ctx.strokeStyle = '#00000040'; ctx.lineWidth = g.track.w + 18; ctx.save(); ctx.translate(4, 6); way(); ctx.stroke(); ctx.restore();
  ctx.strokeStyle = '#EE2B3B'; ctx.lineWidth = g.track.w + 16; way(); ctx.stroke();
  ctx.strokeStyle = '#FFFFFF'; ctx.setLineDash([14, 14]); way(); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = '#FBE7A6'; ctx.lineWidth = g.track.w; way(); ctx.stroke();
  ctx.strokeStyle = '#ffffff55'; ctx.lineWidth = g.track.w * 0.5; way(); ctx.stroke();
  ctx.strokeStyle = '#E0A93A'; ctx.lineWidth = 3; ctx.setLineDash([16, 12]); way(); ctx.stroke(); ctx.setLineDash([]);
  { const p = at(0), n = { x: Math.cos(p.a + Math.PI / 2), y: Math.sin(p.a + Math.PI / 2) }; for (let i = -4; i < 4; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? '#fff' : '#111'; const w2 = g.track.w / 8; ctx.save(); ctx.translate(p.x + n.x * (i + 0.5) * w2 + Math.cos(p.a) * (j - 0.5) * 8, p.y + n.y * (i + 0.5) * w2 + Math.sin(p.a) * (j - 0.5) * 8); ctx.rotate(p.a); ctx.fillRect(-4, -w2 / 2, 8, w2); ctx.restore(); } }
  const upright = (x, y, ch, size) => { ctx.save(); ctx.translate(x, y); ctx.rotate(-(g.camA + (g.turn || 0))); ctx.font = `${size}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, 0, 0); ctx.restore(); };
  // 🪂 the open stretches: the rim right at the tape (over the kerb), a hazard line and a warning sign
  (g.edges || []).forEach((e) => { const N = 18, line = []; for (let k = 0; k <= N; k++) { const sk = e.s0 + (e.s1 - e.s0) * k / N, p = at(sk), nx = -Math.sin(p.a) * e.side, ny = Math.cos(p.a) * e.side; line.push([p.x + nx * g.track.w / 2, p.y + ny * g.track.w / 2, nx, ny]); }
    const pl = (o) => { ctx.beginPath(); line.forEach(([x, y, nx, ny], k) => ctx[k ? 'lineTo' : 'moveTo'](x + nx * o, y + ny * o)); };
    ctx.lineCap = 'butt'; ctx.strokeStyle = '#5E2E10'; ctx.lineWidth = 10; pl(4); ctx.stroke(); ctx.strokeStyle = '#FFD23F'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]); pl(0); ctx.stroke(); ctx.setLineDash([]);
    const [mx, my, nx, ny] = line[N >> 1]; upright(mx + nx * 30, my + ny * 30, '⚠️', 16); });
  // 🧱 the guards along the rest of the edge
  drawGuards(t);
  // hazards, each drawn as the thing it is (a label stands upright on the milk and the boxes, whichever way the table turns)
  g.items.forEach((i) => { if (i.kind === 'milk') drawMilk(i, upright); else if (i.kind === 'hole') drawHole(i); else if (i.kind === 'toaster') drawToaster(i); else if (i.kind === 'box') drawBox(i, upright, t); });
  g.obs.forEach((o) => { if (o.kind === 'box') drawBox(o, upright, t); else drawSoldier(o); });
  g.pennies.forEach((p) => { const r = 6 + Math.sin(t / 150 + p.t) * 1; ctx.fillStyle = '#00000040'; ctx.beginPath(); ctx.arc(p.x + 1.5, p.y + 2, r, 0, 7); ctx.fill(); ctx.fillStyle = '#E08A3C'; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill(); ctx.strokeStyle = '#FFD27A'; ctx.lineWidth = 1.8; ctx.stroke(); ctx.fillStyle = '#FFF3C4'; ctx.beginPath(); ctx.arc(p.x - r * 0.35, p.y - r * 0.35, r * 0.28, 0, 7); ctx.fill(); });
  if (g.paw) { const p = at(g.paw.s); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a + Math.PI / 2); ctx.fillStyle = '#F29E4C'; ctx.fillRect(-30, 0, 60, 300); ctx.beginPath(); ctx.ellipse(0, 0, 30, 22, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#C4621B'; for (let i = 0; i < 6; i++) ctx.fillRect(-30, 18 + i * 40, 60, 12); ctx.fillStyle = '#FF9EB5'; ctx.beginPath(); ctx.ellipse(0, 4, 12, 9, 0, 0, 7); ctx.fill(); for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(i * 11, -11, 5.5, 0, 7); ctx.fill(); } ctx.fillStyle = '#fff'; for (let i = -1.5; i <= 1.5; i++) { ctx.beginPath(); ctx.moveTo(i * 9 - 2, -20); ctx.lineTo(i * 9, -28); ctx.lineTo(i * 9 + 2, -20); ctx.fill(); } ctx.restore(); }
  // the cars
  const th = g.camA + (g.turn || 0), upX = -Math.sin(th), upY = -Math.cos(th);   // screen-up, on the table
  const car = (c, hue, mine) => { const re = c.rescue ? Math.min(1, c.rescue.t / RESCUE) : -1, lift = re >= 0 ? 34 * Math.sin(re * Math.PI) : 0;
    ctx.save(); ctx.translate(c.x + upX * lift, c.y + upY * lift - (c.air > 0 ? 14 * Math.sin((0.7 - c.air) / 0.7 * Math.PI) : 0)); ctx.rotate(c.a); { const f = c.fall > 0 ? 0.25 + 0.75 * (c.fall / 0.7) : re >= 0 ? 0.25 + 0.75 * Math.min(1, re * 1.6) : 1; ctx.scale(CAR * f, CAR * f); if (c.fall > 0) ctx.globalAlpha = 0.4 + 0.6 * (c.fall / 0.7); }
    if (g.glitch && !mine) { drawPal(g.glitchPal || 'fig', ctx, { x: 0, y: 0, s: 9, t: t / 1000, r: 4, face: 1 }); ctx.restore(); ctx.globalAlpha = 1; return; }
    const body = mine ? '#22E0C8' : `hsl(${hue} 90% 56%)`, dark = mine ? '#0B8C7E' : `hsl(${hue} 80% 32%)`;
    ctx.fillStyle = '#00000050'; ctx.beginPath(); ctx.roundRect(-11, -7, 25, 17, 5); ctx.fill();   // shadow
    ctx.fillStyle = '#15151B'; [[-9, -10], [-9, 7], [4, -10], [4, 7]].forEach(([x, y]) => { ctx.beginPath(); ctx.roundRect(x, y, 7, 3, 1); ctx.fill(); });   // wheels
    ctx.fillStyle = body; ctx.beginPath(); ctx.roundRect(-12, -8, 24, 16, 5); ctx.fill(); ctx.strokeStyle = dark; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#ffffff55'; ctx.beginPath(); ctx.roundRect(-10, -7, 20, 4, 2); ctx.fill();   // a shine down one side
    ctx.fillStyle = mine ? '#FFFFFF' : '#ffffffcc'; ctx.fillRect(-12, -1.5, 24, 3);   // racing stripe
    ctx.fillStyle = '#A8E4FF'; ctx.beginPath(); ctx.roundRect(4, -6, 4, 12, 1.5); ctx.fill();   // windscreen
    ctx.fillStyle = '#FFF2A8'; ctx.fillRect(11, -6, 2, 3); ctx.fillRect(11, 3, 2, 3); ctx.fillStyle = '#FF3B3B'; ctx.fillRect(-13, -6, 2, 3); ctx.fillRect(-13, 3, 2, 3);
    if (mine && re >= 0) { ctx.fillStyle = '#15151B88'; ctx.beginPath(); ctx.arc(-2, 0, 3.5, 0, 7); ctx.fill(); } else if (mine) drawPal(g.glitch ? (g.glitchPal || 'fig') : (S.curve.mood || 'calm'), ctx, { x: -2, y: 0, s: 6, t: t / 1000, r: S.curve.r, face: 1, hurt: c.spin > 0 || c.fall > 0 }); else { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-2, 0, 3.2, 0, 7); ctx.fill(); ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(-2, 0, 1.6, 0, 7); ctx.fill(); }
    if (mine && g.bumper) { ctx.strokeStyle = '#C9B8FF'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 16, 0, 7); ctx.stroke(); } if (mine && g.nitro > 0) { ctx.fillStyle = '#FF8A3D'; ctx.beginPath(); ctx.moveTo(-12, -3); ctx.lineTo(-23 - Math.random() * 8, 0); ctx.lineTo(-12, 3); ctx.fill(); ctx.fillStyle = '#FFE36B'; ctx.beginPath(); ctx.moveTo(-12, -1.5); ctx.lineTo(-18 - Math.random() * 4, 0); ctx.lineTo(-12, 1.5); ctx.fill(); }
    ctx.restore(); ctx.globalAlpha = 1;
    if (mine && re >= 0) {   // Fig, out of the car and big, carrying it: two little arms down to the roof
      const fx = c.x + upX * (lift + 30), fy = c.y + upY * (lift + 30) + Math.sin(t / 70) * 1.5, cx = c.x + upX * lift, cy = c.y + upY * lift;
      ctx.strokeStyle = '#2A1408'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(fx - upY * 8, fy + upX * 8); ctx.lineTo(cx - upY * 10, cy + upX * 10); ctx.moveTo(fx + upY * 8, fy - upX * 8); ctx.lineTo(cx + upY * 10, cy - upX * 10); ctx.stroke();
      ctx.save(); ctx.translate(fx, fy); ctx.rotate(-th); drawPal(g.glitch ? (g.glitchPal || 'fig') : (S.curve.mood || 'calm'), ctx, { x: 0, y: 0, s: 15, t: t / 1000, r: S.curve.r, face: 1 }); ctx.restore();
    } };
  g.rivals.forEach((r) => { if (r.out <= 0) car(r, r.hue, false); }); car(me, 0, true);
  g.fx.forEach((f) => { if (f.kind === 'bit') { ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 2)); ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.fillStyle = f.col; ctx.fillRect(-f.sz / 2, -f.sz / 2, f.sz, f.sz * 0.7); ctx.restore(); return; } ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(-(g.camA + (g.turn || 0))); ctx.translate(-f.x, -f.y); ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.5)); ctx.font = f.big ? '400 18px Bungee, Impact, sans-serif' : '900 13px Nunito, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = f.col || '#FFE08A'; ctx.strokeStyle = '#2A1A0A'; ctx.lineWidth = 4; ctx.strokeText(f.text, f.x, f.y); ctx.fillText(f.text, f.x, f.y); ctx.restore(); }); ctx.globalAlpha = 1;
  ctx.restore();
  // 🔦 lights out: only the headlights
  if (g.dark > 0.02) { const dg = ctx.createRadialGradient(W / 2, Hh * CAR_Y, 20 * g.zoom, W / 2, Hh * CAR_Y, 130 * g.zoom); dg.addColorStop(0, '#0000'); dg.addColorStop(1, `rgba(4,3,8,${0.96 * g.dark})`); ctx.fillStyle = dg; ctx.fillRect(0, 0, W, Hh); }
  // the steer zones, faint, and the position
  ctx.fillStyle = held.left ? '#ffffff22' : '#ffffff08'; ctx.fillRect(0, Hh * 0.5, W / 2, Hh * 0.5); ctx.fillStyle = held.right ? '#ffffff22' : '#ffffff08'; ctx.fillRect(W / 2, Hh * 0.5, W / 2, Hh * 0.5);
  { const lt = `lap ${Math.min(3, g.lap + 1)} of 3 · ${position()}${g.rivals.length + 1}`; ctx.font = '900 14px system-ui'; ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#2A1408'; ctx.lineWidth = 4; ctx.strokeText(lt, W / 2, Hh - 14); ctx.fillStyle = '#FFE36B'; ctx.fillText(lt, W / 2, Hh - 14); }
}
const position = () => { const me = g.me; let ahead = 0; g.rivals.forEach((r) => { if (r.out <= 0 && (r.laps > g.lap || ((r.s - me.s) * g.dir + 1.5) % 1 - 0.5 > 0)) ahead += 1; }); return `${ahead + 1}/`; };
const side = (p) => (p.x < W / 2 ? 'left' : 'right');
const organ = {
  key: 'rally', name: 'Rally', icon: '🏎️', verb: 'hold a side to steer · both to brake', beat: 1.0,
  theme: { bg: '#B4662A', gold: '#F5C542', bannerc: '#FFE08A' },
  glitch(on, pal) { if (g) { g.glitch = on; g.glitchPal = pal; } },
  init(h) { host = h; ctx = h.ctx; S = h.S; sfx = h.sfx; window.__rl = organ.debug; },
  start() { newGame(); },
  enter(from) { if (!g) newGame(); host.ui(''); held = {}; },
  leave() { held = {}; return g?.me ? { x: W / 2, y: H() / 2 } : null; },
  update, draw, onBeat,
  pointer(type, p, e) { const id = e?.pointerId ?? 0; if (type === 'down') { const b = boxAt(p); if (b) smash(b); held[side(p)] = true; held['id' + id] = side(p); } else if (type === 'move') { const s = held['id' + id]; if (s && side(p) !== s) { held[s] = false; held[side(p)] = true; held['id' + id] = side(p); } } else { const s = held['id' + id]; if (s) { held[s] = false; delete held['id' + id]; } else { held = {}; } } },
  hudLine: () => (g ? `🏎️ course ${g.course} · lap ${Math.min(3, g.lap + 1)}/3` : ''),
  level: () => g?.course || 1,
  overText: (how) => (how === 'fell in the pocket' ? ['🕳️ POCKETED', 'Too many trips down the pocket.'] : how === 'off the table' ? ['🫳 OFF THE TABLE', 'The table is only so big.'] : how === 'fell off the edge' ? ['🪂 OVER THE EDGE', 'Mind the open edges.'] : ['RUN OVER', '']),
  endStats: () => (g ? `🏎️ ${lapsN} laps · ${outsN} rivals left behind` : ''),
  debug: () => g && ({ auto: (on) => { g.auto = on; }, fx: g.fx.map((f) => f.text), me: { x: g.me.x, y: g.me.y, s: g.me.s, v: g.me.v, off: g.me.off }, lap: g.lap, cps: g.cps, course: g.course, rivals: g.rivals.map((r) => ({ s: r.s, out: r.out, off: r.off })), items: g.items.length, obs: g.obs.length, twist: g.twist?.kind || null, held: { ...held }, W, H: H(), track: { w: g.track.w, len: Math.round(g.track.len) }, zoom: g.zoom, camA: g.camA, guideA: g.guideA, heading: g.me.a, top: Math.round(topSpeed()), edges: g.edges.map((e) => ({ s0: e.s0, s1: e.s1, side: e.side })), fall: g.me.fall || 0, rescue: g.me.rescue ? g.me.rescue.t : null, guards: g.rim.reduce((o, p) => { o[p.guard] = (o[p.guard] || 0) + 1; return o; }, {}), outer: g.outer, pushOut: (sk = 0.5, d = 80) => { const p = at(sk); g.me.x = p.x - Math.sin(p.a) * g.outer * (g.track.w / 2 + d); g.me.y = p.y + Math.cos(p.a) * g.outer * (g.track.w / 2 + d); g.me.air = 0; }, pushOff: (i = 0) => { const e = g.edges[i], p = spotOn(e.c, e.side * (g.track.w / 2 + 14)); g.me.x = p.x; g.me.y = p.y; g.me.air = 0; }, hitBox: (i = 0) => { const b = [...g.items, ...g.obs].filter((x) => x.kind === 'box')[i]; if (b) b.hit = true; }, boxes: [...g.items, ...g.obs].filter((b) => b.kind === 'box').length, smashed: smashedN, boxScreen: (i = 0) => { const bs = [...g.items, ...g.obs].filter((b) => b.kind === 'box'), b = bs[i]; if (!b) return null; const th = g.camA + (g.turn || 0), dx = (b.x - g.me.x) * g.zoom, dy = (b.y - g.me.y) * g.zoom; return { x: W / 2 + Math.cos(th) * dx - Math.sin(th) * dy, y: H() * CAR_Y + Math.sin(th) * dx + Math.cos(th) * dy }; }, tap: (p) => { organ.pointer('down', p, { pointerId: 99 }); organ.pointer('up', p, { pointerId: 99 }); } }),
};
export default organ;
