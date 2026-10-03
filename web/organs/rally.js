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
const CAR_Y = 0.66;   // the car sits low on the screen: the road ahead is what you see
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
  for (let i = 0; i < 3 + g.course; i++) { const s = hash(g.seed + 10 + i), side = i % 2 ? 1 : -1; put('box', s, side * (g.track.w / 2 + 16), { w: 26, h: 18 }); }
  host.banner(`🏁 COURSE ${g.course}`, `${3} laps · ${g.rivals.length} rivals · hold a side to steer`);
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
    if (isMe && !c.bumpT) { c.bumpT = 0.5; if (g.bumper) { g.bumper = 0; } else { c.spin = 0.3; sfx('clack'); } } } });
  if (c.bumpT > 0) c.bumpT = Math.max(0, c.bumpT - dt);
  const n2 = nearest(c.x, c.y); c.prevS = c.s; c.s = n2.s; c.off = n2.d;
  if (n2.d > g.track.w / 2 + 90) { c.x += (n2.px - c.x) * 0.5; c.y += (n2.py - c.y) * 0.5; c.v *= 0.5; if (isMe) { c.spin = 0.6; host.cue?.('near', c.x, c.y); if (host.hurt('off the table')) return; host.banner('OFF THE TABLE', `${S.hearts} ${S.hearts === 1 ? 'heart' : 'hearts'} left`); } }   // 🫳 off the table edge
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
  g.obs = g.obs.filter((o) => { o.life -= dt; if (o.kind === 'soldier' && Math.hypot(o.x - me.x, o.y - me.y) < R + 10 && me.air <= 0) { if (g.bumper) { g.bumper = 0; } else { me.spin = 0.8; S.combo = 0; } g.fx.push({ kind: 'text', x: o.x, y: o.y - 20, text: '🪖 BONK', life: 0.8 }); sfx('thud'); return false; } return o.life > 0; });
  g.items.forEach((i) => { const d = Math.hypot(i.x - me.x, i.y - me.y);
    if (i.kind === 'hole' && d < i.r && me.air <= 0) { me.spin = 0; me.v = 0; const p = at(me.s - g.dir * 0.03); me.x = p.x; me.y = p.y; me.a = p.a + (g.dir < 0 ? Math.PI : 0); S.combo = 0; host.cue?.('near', i.x, i.y); sfx('plunk');
      if (g.course >= 3) { if (!host.hurt('fell in the pocket')) host.banner('🕳️ THE POCKET', `${S.hearts} ${S.hearts === 1 ? 'heart' : 'hearts'} left`); } else { me.spin = 0.9; host.banner('🕳️ THE POCKET', 'fished out · from course 3 it costs a life'); } }
    if (i.kind === 'toaster' && d < 20 && me.air <= 0 && me.v > 60) { me.air = 0.7; me.v = Math.max(me.v, topSpeed() * 1.2); sfx('whistle', { dur: 0.3 }); g.fx.push({ kind: 'text', x: me.x, y: me.y - 24, text: '🍞 POP!', life: 0.8 }); } });
  g.pennies = g.pennies.filter((p) => { if (Math.hypot(p.x - me.x, p.y - me.y) < R + 8) { host.add(20); host.cue?.('score', p.x, p.y); g.fx.push({ kind: 'text', x: p.x, y: p.y - 14, text: '+20', life: 0.7 }); sfx('chime', { hi: true }); return false; } return true; });   // flat: the combo is for laps and rivals
  // 🐈 the paw sweeps along the track and swats whatever it meets
  if (g.paw) { g.paw.t += dt; g.paw.s = (g.paw.s + g.dir * 0.06 * dt + 1) % 1; const p = at(g.paw.s); [me, ...g.rivals].forEach((c) => { if (Math.hypot(c.x - p.x, c.y - p.y) < 34 && c.spin <= 0) { c.spin = 0.7; c.x += Math.cos(p.a + Math.PI / 2) * 30; c.y += Math.sin(p.a + Math.PI / 2) * 30; if (c === me) { S.combo = 0; sfx('thud'); } } }); }
  // checkpoints and laps
  const ds = (me.s - me.prevS + 1.5) % 1 - 0.5; if (g.dir * ds > 0) { const q = Math.floor((g.dir > 0 ? me.s : 1 - me.s) * 4); if (q === g.cps + 1 && g.cps < 3) g.cps += 1; }
  if (g.cps >= 3 && ((g.dir > 0 && me.prevS > 0.9 && me.s < 0.1) || (g.dir < 0 && me.prevS < 0.1 && me.s > 0.9))) lapDone();
  // rivals: they follow the tape, rubber-banded to you; pushed far enough behind the camera they're out of the lap
  g.rivals.forEach((r) => { r.spin = r.spin || 0; if (r.out > 0) { r.out -= dt; if (r.out <= 0) { const p = at(me.s + g.dir * 0.1); r.x = p.x; r.y = p.y; r.a = p.a + (g.dir < 0 ? Math.PI : 0); r.v = 0; } return; }   // back on the tape a little ahead of you
    const gap = ((r.s - me.s) * g.dir + 1.5) % 1 - 0.5, look = at(r.s + g.dir * 0.03 + (gap < -0.2 ? 0.01 : 0)), want = Math.atan2(look.y - r.y, look.x - r.x); let da = ((want - r.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    r.skillNow = r.skill * (gap < -0.15 ? 1.18 : gap > 0.12 ? 0.9 : 1); const sk = r.skill; r.skill = r.skillNow; drive(r, dt, Math.max(-1, Math.min(1, da * 2.5)), false, false); r.skill = sk;
    if (gap < -0.2 && r.off < 40 && r.outLap !== g.lap) { r.out = 4; r.outLap = g.lap; outsN += 1; const pts = 150; host.add(pts); host.cue?.('kill', r.x, r.y); g.fx.push({ kind: 'text', x: me.x, y: me.y - 34, text: `🏁 LEFT BEHIND +${pts}`, life: 1.1, big: true }); sfx('cheer', { delay: 0.05 }); }   // once a lap per rival, flat
    // bumping
    const dx = r.x - me.x, dy = r.y - me.y, d = Math.hypot(dx, dy); if (d < R * 2 && d > 0) { const push = (R * 2 - d) / 2, nx = dx / d, ny = dy / d; r.x += nx * push; r.y += ny * push; me.x -= nx * push; me.y -= ny * push; if (g.bumper) { r.spin = 0.5; g.bumper = 0; } } });
  for (let i = 0; i < g.rivals.length; i++) for (let j = i + 1; j < g.rivals.length; j++) { const a = g.rivals[i], b = g.rivals[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy); if (d < R * 2 && d > 0) { const push = (R * 2 - d) / 2; a.x -= dx / d * push; a.y -= dy / d * push; b.x += dx / d * push; b.y += dy / d * push; } }
  g.fx.forEach((f) => { f.life -= dt; f.y -= 24 * dt; }); g.fx = g.fx.filter((f) => f.life > 0);
}
function lapDone() {
  g.lap += 1; lapsN += 1; g.cps = 0;
  const behind = g.rivals.filter((r) => r.out > 0 || ((r.s - g.me.s) * g.dir + 1.5) % 1 - 0.5 < 0).length; S.combo = S.comboT > 0 ? S.combo + 1 : 1; S.comboT = 4; const pts = (200 + 60 * behind) * fibMult(Math.min(S.combo, 6));   // laps combo, capped
  host.add(pts); host.cue?.('kill', g.me.x, g.me.y); g.fx.push({ kind: 'text', x: g.me.x, y: g.me.y - 34, text: `🏁 LAP ${g.lap} +${pts}`, life: 1.2, big: true }); sfx('birdie');
  if (g.lap >= 3) { g.course += 1; host.add(300 * (g.course - 1)); host.banner(`🏆 COURSE ${g.course - 1} WON`, `+${300 * (g.course - 1)} · up to course ${g.course}`); sfx('fanfare'); host.heal(1); newCourse(); }
}

// ---------------------------------------------------------------- drawing
function draw(t) {
  W = host?.W || W;
  const k = host.k, Hh = H(), me = g?.me;
  ctx.setTransform(k, 0, 0, k, host.ox || 0, host.oy || 0);
  ctx.fillStyle = '#6B4A2B'; ctx.fillRect(0, 0, W, Hh);
  if (!g) return;
  // the camera: on you, the table turning under the window
  g.zoom = g.zoom ? g.zoom + (camZoom() - g.zoom) * 0.02 : camZoom();
  // 🎥 the chase camera: top-down, but turned so the car always points up the screen, following it from behind (eased, so a
  // spin doesn't whirl the whole table); the window's table spin adds its own turn on top
  { const want = -(me.a + Math.PI / 2); if (g.camA == null) g.camA = want; const da = ((want - g.camA + Math.PI * 3) % (Math.PI * 2)) - Math.PI; g.camA += da * Math.min(1, 0.12); }
  ctx.save(); ctx.translate(W / 2, Hh * CAR_Y); ctx.scale(g.zoom, g.zoom); ctx.rotate(g.camA + (g.turn || 0)); ctx.translate(-me.x, -me.y);
  // the table: wood grain, and a faint Sierpiński-carpet tablecloth (the fractal on the table)
  const Rv = Math.hypot(W, Hh) / g.zoom, gx0 = Math.floor((me.x - Rv) / 60) * 60, gy0 = Math.floor((me.y - Rv) / 60) * 60;   // the table under a turning camera: a disc's worth of grain
  for (let y = gy0; y < me.y + Rv; y += 60) { ctx.fillStyle = ((y / 60) | 0) % 2 ? '#6E4C2D' : '#67472A'; ctx.fillRect(gx0, y, Rv * 2 + 60, 60); }
  ctx.fillStyle = '#ffffff0a'; for (let y = gy0; y < me.y + Rv; y += 60) for (let x = gx0; x < me.x + Rv; x += 60) { ctx.fillRect(x + 20, y + 20, 20, 20); for (let i = 0; i < 9; i++) if (i !== 4) ctx.fillRect(x + (i % 3) * 20 + 7, y + Math.floor(i / 3) * 20 + 7, 6, 6); }
  // the tape: shadow, tape, edges, the dashed centre, the finish line
  const way = () => { ctx.beginPath(); g.track.pts.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x, p.y)); ctx.closePath(); };
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = '#00000033'; ctx.lineWidth = g.track.w + 10; ctx.save(); ctx.translate(3, 5); way(); ctx.stroke(); ctx.restore();
  ctx.strokeStyle = '#E8D9A8'; ctx.lineWidth = g.track.w; way(); ctx.stroke();
  ctx.strokeStyle = '#B9A36E'; ctx.lineWidth = 2; ctx.setLineDash([10, 8]); way(); ctx.stroke(); ctx.setLineDash([]);
  { const p = at(0), n = { x: Math.cos(p.a + Math.PI / 2), y: Math.sin(p.a + Math.PI / 2) }; for (let i = -4; i < 4; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? '#fff' : '#222'; const w2 = g.track.w / 8; ctx.save(); ctx.translate(p.x + n.x * (i + 0.5) * w2 + Math.cos(p.a) * (j - 0.5) * 6, p.y + n.y * (i + 0.5) * w2 + Math.sin(p.a) * (j - 0.5) * 6); ctx.rotate(p.a); ctx.fillRect(-3, -w2 / 2, 6, w2); ctx.restore(); } }
  // hazards
  g.items.forEach((i) => { if (i.kind === 'milk') { ctx.fillStyle = '#F4F4F0'; ctx.beginPath(); ctx.ellipse(i.x, i.y, i.r, i.r * 0.7, 0.3, 0, 7); ctx.fill(); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(i.x - 6, i.y - 4, i.r * 0.4, i.r * 0.25, 0.3, 0, 7); ctx.fill(); }
    else if (i.kind === 'hole') { ctx.fillStyle = '#0A0806'; ctx.beginPath(); ctx.arc(i.x, i.y, i.r, 0, 7); ctx.fill(); ctx.strokeStyle = '#3A2A1A'; ctx.lineWidth = 3; ctx.stroke(); }
    else if (i.kind === 'toaster') { ctx.save(); ctx.translate(i.x, i.y); ctx.rotate(i.a); ctx.fillStyle = '#C0C4CC'; ctx.fillRect(-16, -14, 32, 28); ctx.fillStyle = '#2B2B33'; ctx.fillRect(-12, -10, 24, 5); ctx.fillRect(-12, 5, 24, 5); ctx.fillStyle = '#E4572E'; ctx.fillRect(10, -3, 5, 6); ctx.restore(); }
    else if (i.kind === 'box') { ctx.fillStyle = '#E4A33A'; ctx.fillRect(i.x - i.w / 2, i.y - i.h / 2, i.w, i.h); ctx.strokeStyle = '#8A5A2B'; ctx.lineWidth = 2; ctx.strokeRect(i.x - i.w / 2, i.y - i.h / 2, i.w, i.h); ctx.fillStyle = '#fff'; ctx.fillRect(i.x - 8, i.y - 4, 16, 8); } });
  g.obs.forEach((o) => { if (o.kind === 'box') { ctx.fillStyle = '#E4A33A'; ctx.fillRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h); ctx.strokeStyle = '#8A5A2B'; ctx.lineWidth = 2; ctx.strokeRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h); } else { ctx.fillStyle = '#3E7A3E'; ctx.beginPath(); ctx.arc(o.x, o.y - 8, 5, 0, 7); ctx.fill(); ctx.fillRect(o.x - 4, o.y - 4, 8, 12); ctx.fillRect(o.x - 8, o.y + 8, 16, 3); } });
  g.pennies.forEach((p) => { ctx.fillStyle = '#C8772C'; ctx.beginPath(); ctx.arc(p.x, p.y, 5 + Math.sin(t / 150 + p.t) * 1, 0, 7); ctx.fill(); ctx.strokeStyle = '#F5C542'; ctx.lineWidth = 1.5; ctx.stroke(); });
  if (g.paw) { const p = at(g.paw.s); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a + Math.PI / 2); ctx.fillStyle = '#4A4A52'; ctx.beginPath(); ctx.ellipse(0, 0, 30, 22, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#F2B8C6'; ctx.beginPath(); ctx.ellipse(0, 4, 12, 9, 0, 0, 7); ctx.fill(); for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(i * 11, -10, 5, 0, 7); ctx.fill(); } ctx.fillStyle = '#4A4A52'; ctx.fillRect(-30, 0, 60, 300); ctx.restore(); }
  // the cars
  const car = (c, hue, mine) => { ctx.save(); ctx.translate(c.x, c.y - (c.air > 0 ? 14 * Math.sin((0.7 - c.air) / 0.7 * Math.PI) : 0)); ctx.rotate(c.a); ctx.scale(CAR, CAR);
    if (g.glitch && !mine) { drawPal(g.glitchPal || 'fig', ctx, { x: 0, y: 0, s: 9, t: t / 1000, r: 4, face: 1 }); ctx.restore(); return; }
    ctx.fillStyle = '#00000044'; ctx.fillRect(-10, -6, 22, 14); ctx.fillStyle = mine ? '#3DD6C6' : `hsl(${hue} 70% 50%)`; ctx.beginPath(); ctx.roundRect(-11, -7, 22, 14, 4); ctx.fill(); ctx.fillStyle = '#1B1B22'; [[-7, -8], [-7, 6], [5, -8], [5, 6]].forEach(([x, y]) => ctx.fillRect(x, y, 5, 2)); ctx.fillStyle = '#FFE08A'; ctx.fillRect(9, -5, 2, 3); ctx.fillRect(9, 2, 2, 3);
    if (mine) drawPal(g.glitch ? (g.glitchPal || 'fig') : (S.curve.mood || 'calm'), ctx, { x: -1, y: 0, s: 6, t: t / 1000, r: S.curve.r, face: 1, hurt: c.spin > 0 }); else { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-1, 0, 3, 0, 7); ctx.fill(); }
    if (mine && g.bumper) { ctx.strokeStyle = '#C9B8FF'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 15, 0, 7); ctx.stroke(); } if (mine && g.nitro > 0) { ctx.fillStyle = '#FF8A3D'; ctx.beginPath(); ctx.moveTo(-11, -3); ctx.lineTo(-22 - Math.random() * 8, 0); ctx.lineTo(-11, 3); ctx.fill(); }
    ctx.restore(); };
  g.rivals.forEach((r) => { if (r.out <= 0) car(r, r.hue, false); }); car(me, 0, true);
  g.fx.forEach((f) => { ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(-(g.camA + (g.turn || 0))); ctx.translate(-f.x, -f.y); ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.5)); ctx.font = f.big ? '400 18px Bungee, Impact, sans-serif' : '900 13px Nunito, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = f.col || '#FFE08A'; ctx.strokeStyle = '#2A1A0A'; ctx.lineWidth = 4; ctx.strokeText(f.text, f.x, f.y); ctx.fillText(f.text, f.x, f.y); ctx.restore(); }); ctx.globalAlpha = 1;
  ctx.restore();
  // 🔦 lights out: only the headlights
  if (g.dark > 0.02) { const dg = ctx.createRadialGradient(W / 2, Hh * CAR_Y, 20 * g.zoom, W / 2, Hh * CAR_Y, 130 * g.zoom); dg.addColorStop(0, '#0000'); dg.addColorStop(1, `rgba(4,3,8,${0.96 * g.dark})`); ctx.fillStyle = dg; ctx.fillRect(0, 0, W, Hh); }
  // the steer zones, faint, and the position
  ctx.fillStyle = held.left ? '#ffffff22' : '#ffffff08'; ctx.fillRect(0, Hh * 0.5, W / 2, Hh * 0.5); ctx.fillStyle = held.right ? '#ffffff22' : '#ffffff08'; ctx.fillRect(W / 2, Hh * 0.5, W / 2, Hh * 0.5);
  ctx.fillStyle = '#FFE08A'; ctx.font = '900 13px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`lap ${Math.min(3, g.lap + 1)} of 3 · ${position()}${g.rivals.length + 1}`, W / 2, Hh - 16);
}
const position = () => { const me = g.me; let ahead = 0; g.rivals.forEach((r) => { if (r.out <= 0 && (r.laps > g.lap || ((r.s - me.s) * g.dir + 1.5) % 1 - 0.5 > 0)) ahead += 1; }); return `${ahead + 1}/`; };
const side = (p) => (p.x < W / 2 ? 'left' : 'right');
const organ = {
  key: 'rally', name: 'Rally', icon: '🏎️', verb: 'hold a side to steer · both to brake', beat: 1.0,
  theme: { bg: '#6B4A2B', gold: '#F5C542', bannerc: '#FFE08A' },
  glitch(on, pal) { if (g) { g.glitch = on; g.glitchPal = pal; } },
  init(h) { host = h; ctx = h.ctx; S = h.S; sfx = h.sfx; window.__rl = organ.debug; },
  start() { newGame(); },
  enter(from) { if (!g) newGame(); host.ui(''); held = {}; },
  leave() { held = {}; return g?.me ? { x: W / 2, y: H() / 2 } : null; },
  update, draw, onBeat,
  pointer(type, p, e) { const id = e?.pointerId ?? 0; if (type === 'down') { held[side(p)] = true; held['id' + id] = side(p); } else if (type === 'move') { const s = held['id' + id]; if (s && side(p) !== s) { held[s] = false; held[side(p)] = true; held['id' + id] = side(p); } } else { const s = held['id' + id]; if (s) { held[s] = false; delete held['id' + id]; } else { held = {}; } } },
  hudLine: () => (g ? `🏎️ course ${g.course} · lap ${Math.min(3, g.lap + 1)}/3` : ''),
  level: () => g?.course || 1,
  overText: (how) => (how === 'fell in the pocket' ? ['🕳️ POCKETED', 'Too many trips down the pocket.'] : how === 'off the table' ? ['🫳 OFF THE TABLE', 'The table is only so big.'] : ['RUN OVER', '']),
  endStats: () => (g ? `🏎️ ${lapsN} laps · ${outsN} rivals left behind` : ''),
  debug: () => g && ({ auto: (on) => { g.auto = on; }, fx: g.fx.map((f) => f.text), me: { x: g.me.x, y: g.me.y, s: g.me.s, v: g.me.v, off: g.me.off }, lap: g.lap, cps: g.cps, course: g.course, rivals: g.rivals.map((r) => ({ s: r.s, out: r.out, off: r.off })), items: g.items.length, obs: g.obs.length, twist: g.twist?.kind || null, held: { ...held }, W, H: H(), track: { w: g.track.w, len: Math.round(g.track.len) }, zoom: g.zoom, camA: g.camA, top: Math.round(topSpeed()) }),
};
export default organ;
