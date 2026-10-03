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

let W = 400, R = 9, VMAX = 230, TURN = 3.1;
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
const camZoom = () => 2.4 / (1 + 0.25 * (stage() - 1));
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
  return { pts, cum, len, w: Math.max(90, 150 - 10 * course), n };   // wide tape: 140 on course 1, down to 90
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
// 🎥 The chase camera, tilted: the table is drawn top-down and turned so the car points up (into an offscreen
// canvas), then projected row by row onto the screen like a camera 45° behind and above the car — rows ahead
// shrink toward a horizon, rows behind stay wide — so the road narrows into the distance and the far table fogs.
let off = null, octx = null;
const CAM = { horizon: 0.18, L: 150, fog: '#3A2616' };   // horizon: where the far table fades, as a share of the car's row; L: the depth scale
function drawWorld(t) {
  const Hh = H(), me = g.me, OH = Math.round(Hh * 1.4), OW = Math.round(W * 1.6);
  if (!off || off.width !== OW || off.height !== OH) { off = document.createElement('canvas'); off.width = OW; off.height = OH; octx = off.getContext('2d'); }
  const c = octx, z0 = g.zoom * 0.5, cx = OW / 2, cy = OH * 0.62;
  c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#6B4A2B'; c.fillRect(0, 0, OW, OH);
  c.save(); c.translate(cx, cy); c.scale(z0, z0); c.rotate(g.camA + (g.turn || 0)); c.translate(-me.x, -me.y);
  const Rv = Math.hypot(OW, OH) / z0, gx0 = Math.floor((me.x - Rv) / 60) * 60, gy0 = Math.floor((me.y - Rv) / 60) * 60;
  for (let y = gy0; y < me.y + Rv; y += 60) { c.fillStyle = ((y / 60) | 0) % 2 ? '#6E4C2D' : '#67472A'; c.fillRect(gx0, y, Rv * 2 + 60, 60); }
  c.fillStyle = '#ffffff0a'; for (let y = gy0; y < me.y + Rv; y += 60) for (let x = gx0; x < me.x + Rv; x += 60) { c.fillRect(x + 20, y + 20, 20, 20); for (let i = 0; i < 9; i++) if (i !== 4) c.fillRect(x + (i % 3) * 20 + 7, y + Math.floor(i / 3) * 20 + 7, 6, 6); }
  const way = () => { c.beginPath(); g.track.pts.forEach((p, i) => c[i ? 'lineTo' : 'moveTo'](p.x, p.y)); c.closePath(); };
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.strokeStyle = '#00000033'; c.lineWidth = g.track.w + 10; c.save(); c.translate(3, 5); way(); c.stroke(); c.restore();
  c.strokeStyle = '#E8D9A8'; c.lineWidth = g.track.w; way(); c.stroke();
  c.strokeStyle = '#B9A36E'; c.lineWidth = 2; c.setLineDash([10, 8]); way(); c.stroke(); c.setLineDash([]);
  { const p = at(0), n = { x: Math.cos(p.a + Math.PI / 2), y: Math.sin(p.a + Math.PI / 2) }; for (let i = -4; i < 4; i++) for (let j = 0; j < 2; j++) { c.fillStyle = (i + j) % 2 ? '#fff' : '#222'; const w2 = g.track.w / 8; c.save(); c.translate(p.x + n.x * (i + 0.5) * w2 + Math.cos(p.a) * (j - 0.5) * 6, p.y + n.y * (i + 0.5) * w2 + Math.sin(p.a) * (j - 0.5) * 6); c.rotate(p.a); c.fillRect(-3, -w2 / 2, 6, w2); c.restore(); } }
  g.items.forEach((i) => { if (i.kind === 'milk') { c.fillStyle = '#F4F4F0'; c.beginPath(); c.ellipse(i.x, i.y, i.r, i.r * 0.7, 0.3, 0, 7); c.fill(); c.fillStyle = '#ffffff'; c.beginPath(); c.ellipse(i.x - 6, i.y - 4, i.r * 0.4, i.r * 0.25, 0.3, 0, 7); c.fill(); }
    else if (i.kind === 'hole') { c.fillStyle = '#0A0806'; c.beginPath(); c.arc(i.x, i.y, i.r, 0, 7); c.fill(); c.strokeStyle = '#3A2A1A'; c.lineWidth = 3; c.stroke(); }
    else if (i.kind === 'toaster') { c.save(); c.translate(i.x, i.y); c.rotate(i.a); c.fillStyle = '#C0C4CC'; c.fillRect(-16, -14, 32, 28); c.fillStyle = '#2B2B33'; c.fillRect(-12, -10, 24, 5); c.fillRect(-12, 5, 24, 5); c.fillStyle = '#E4572E'; c.fillRect(10, -3, 5, 6); c.restore(); }
    else if (i.kind === 'box') { c.fillStyle = '#E4A33A'; c.fillRect(i.x - i.w / 2, i.y - i.h / 2, i.w, i.h); c.strokeStyle = '#8A5A2B'; c.lineWidth = 2; c.strokeRect(i.x - i.w / 2, i.y - i.h / 2, i.w, i.h); c.fillStyle = '#fff'; c.fillRect(i.x - 8, i.y - 4, 16, 8); } });
  g.obs.forEach((o) => { if (o.kind === 'box') { c.fillStyle = '#E4A33A'; c.fillRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h); c.strokeStyle = '#8A5A2B'; c.lineWidth = 2; c.strokeRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h); } else { c.fillStyle = '#3E7A3E'; c.beginPath(); c.arc(o.x, o.y - 8, 5, 0, 7); c.fill(); c.fillRect(o.x - 4, o.y - 4, 8, 12); c.fillRect(o.x - 8, o.y + 8, 16, 3); } });
  g.pennies.forEach((p) => { c.fillStyle = '#C8772C'; c.beginPath(); c.arc(p.x, p.y, 5 + Math.sin(t / 150 + p.t) * 1, 0, 7); c.fill(); c.strokeStyle = '#F5C542'; c.lineWidth = 1.5; c.stroke(); });
  if (g.paw) { const p = at(g.paw.s); c.save(); c.translate(p.x, p.y); c.rotate(p.a + Math.PI / 2); c.fillStyle = '#4A4A52'; c.beginPath(); c.ellipse(0, 0, 30, 22, 0, 0, 7); c.fill(); c.fillStyle = '#F2B8C6'; c.beginPath(); c.ellipse(0, 4, 12, 9, 0, 0, 7); c.fill(); for (let i = -1; i <= 1; i++) { c.beginPath(); c.arc(i * 11, -10, 5, 0, 7); c.fill(); } c.fillStyle = '#4A4A52'; c.fillRect(-30, 0, 60, 300); c.restore(); }
  const car = (cr, hue, mine) => { c.save(); c.translate(cr.x, cr.y - (cr.air > 0 ? 14 * Math.sin((0.7 - cr.air) / 0.7 * Math.PI) : 0)); c.rotate(cr.a);
    if (g.glitch && !mine) { drawPal(g.glitchPal || 'fig', c, { x: 0, y: 0, s: 9, t: t / 1000, r: 4, face: 1 }); c.restore(); return; }
    c.fillStyle = '#00000044'; c.fillRect(-10, -6, 22, 14); c.fillStyle = mine ? '#3DD6C6' : `hsl(${hue} 70% 50%)`; c.beginPath(); c.roundRect(-11, -7, 22, 14, 4); c.fill(); c.fillStyle = '#1B1B22'; [[-7, -8], [-7, 6], [5, -8], [5, 6]].forEach(([x, y]) => c.fillRect(x, y, 5, 2)); c.fillStyle = '#FFE08A'; c.fillRect(9, -5, 2, 3); c.fillRect(9, 2, 2, 3);
    if (mine) drawPal(g.glitch ? (g.glitchPal || 'fig') : (S.curve.mood || 'calm'), c, { x: -1, y: 0, s: 6, t: t / 1000, r: S.curve.r, face: 1, hurt: cr.spin > 0 }); else { c.fillStyle = '#fff'; c.beginPath(); c.arc(-1, 0, 3, 0, 7); c.fill(); }
    if (mine && g.bumper) { c.strokeStyle = '#C9B8FF'; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 15, 0, 7); c.stroke(); } if (mine && g.nitro > 0) { c.fillStyle = '#FF8A3D'; c.beginPath(); c.moveTo(-11, -3); c.lineTo(-22 - Math.random() * 8, 0); c.lineTo(-11, 3); c.fill(); }
    c.restore(); };
  g.rivals.forEach((r) => { if (r.out <= 0) car(r, r.hue, false); }); car(me, 0, true);
  g.fx.forEach((f) => { c.save(); c.translate(f.x, f.y); c.rotate(-(g.camA + (g.turn || 0))); c.scale(1 / z0, 1 / z0); c.globalAlpha = Math.max(0, Math.min(1, f.life * 1.5)); c.font = f.big ? '400 18px Bungee, Impact, sans-serif' : '900 13px Nunito, system-ui, sans-serif'; c.textAlign = 'center'; c.fillStyle = f.col || '#FFE08A'; c.strokeStyle = '#2A1A0A'; c.lineWidth = 4; c.strokeText(f.text, 0, 0); c.fillText(f.text, 0, 0); c.restore(); });
  c.restore();
  return { cx, cy, OW, OH };
}
function draw(t) {
  W = host?.W || W;
  const k = host.k, Hh = H(), me = g?.me;
  ctx.setTransform(k, 0, 0, k, host.ox || 0, host.oy || 0);
  ctx.fillStyle = '#6B4A2B'; ctx.fillRect(0, 0, W, Hh);
  if (!g) return;
  g.zoom = g.zoom ? g.zoom + (camZoom() - g.zoom) * 0.02 : camZoom();
  { const want = -(me.a + Math.PI / 2); if (g.camA == null) g.camA = want; const da = ((want - g.camA + Math.PI * 3) % (Math.PI * 2)) - Math.PI; g.camA += da * Math.min(1, 0.12); }
  const { cx, cy, OW } = drawWorld(t);
  // the projection: the car's screen row is CAR_Y; a screen row y above it is depth d = (y − hz) / (carRow − hz), it shows the
  // plane row cy − L (1/d − 1) at horizontal scale S0 · d; rows below the car are the plane behind, at S0
  const carRow = Hh * CAR_Y, hz = carRow * CAM.horizon, S0 = 2, L = CAM.L;
  ctx.fillStyle = CAM.fog; ctx.fillRect(0, 0, W, hz + 2);
  ctx.imageSmoothingEnabled = true;
  for (let y = Math.ceil(hz); y < Hh; y += 2) {
    const d = y <= carRow ? (y - hz) / (carRow - hz) : 1, sy = y <= carRow ? cy - L * (1 / d - 1) : cy + (y - carRow) / S0, sc = S0 * Math.max(d, 0.02), sw = W / sc;
    if (sy < 0 || sy >= off.height - 1) continue;
    ctx.drawImage(off, cx - sw / 2, sy, sw, Math.max(1, 2 / sc), 0, y, W, 2);
  }
  // the far table fogs out toward the horizon
  const fg = ctx.createLinearGradient(0, hz, 0, carRow * 0.6); fg.addColorStop(0, CAM.fog); fg.addColorStop(1, CAM.fog + '00'); ctx.fillStyle = fg; ctx.fillRect(0, hz, W, carRow * 0.6 - hz);
  // 🔦 lights out: only the headlights
  if (g.dark > 0.02) { const dg = ctx.createRadialGradient(W / 2, carRow, 20 * g.zoom, W / 2, carRow, 130 * g.zoom); dg.addColorStop(0, '#0000'); dg.addColorStop(1, `rgba(4,3,8,${0.96 * g.dark})`); ctx.fillStyle = dg; ctx.fillRect(0, 0, W, Hh); }
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
