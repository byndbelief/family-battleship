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

let W = 400, G = 620, TANK_W = 22;
const TWISTS = [
  ['💨 GALE', 'the wind howls: lead your shots', 'gale'],
  ['☄️ METEOR SHOWER', 'watch the sky', 'meteors'],
  ['🌱 REGROWTH', 'the hill heals its craters', 'regrow'],
  ['🌙 NIGHT', 'they only show when they fire', 'night'],
];
let host, ctx, S, sfx, g = null, killsN = 0, shotsN = 0, drag = null;
const H = () => host.H;
const rng = (seed) => { let x = (seed >>> 0) || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; };
// The ridge: 101 samples across the world, W/100 apart (the world widens with the stage; the ridge stretches with it).
function ridge(seed) {
  const r = rng(seed), n = 101, h = new Array(n).fill(0), base = H() * 0.66;
  h[0] = base + 40; h[n - 1] = base - 60 + r() * 40; h[50] = base - 20 + r() * 60;
  const sub = (a, b, amp) => { if (b - a < 2) return; const m = (a + b) >> 1; h[m] = (h[a] + h[b]) / 2 + (r() - 0.5) * amp; sub(a, m, amp * 0.55); sub(m, b, amp * 0.55); };
  sub(0, 50, 90); sub(50, n - 1, 90);
  return h.map((v) => Math.max(H() * 0.3, Math.min(H() - 30, v)));
}
const SP = () => W / 100;
const hAt = (x) => { const i = Math.max(0, Math.min(99, x / SP())), a = Math.floor(i), t = i - a; return g.h[a] + (g.h[Math.min(100, a + 1)] - g.h[a]) * t; };
const stage = () => host.stage?.() || 1;   // 🎚️ the run's stage: the world grows and fills around you
function newGame() { g = { h: [], tanks: [], shells: [], fx: [], meteors: [], moles: [], lakes: [], balloons: [], worms: [], drones: [], drops: [], arty: null, droneT: 8, bolts: [], wormT: 4, moleT: 4, serpT: 3, balloonT: 5, centred: false, me: { x: 44 }, wind: 0, twist: null, time: 0, fireT: 3, shield: 0, split: 0, big: 0, seed: Math.floor(Math.random() * 1e6), night: 0 }; g.h = ridge(g.seed); killsN = 0; shotsN = 0; addTank(); }
function addTank(gold = false, quiet = false) {
  if (g.tanks.length >= (stage() === 1 ? 2 : 5 + Math.min(3, stage() - 1))) return;   // Stage 1: two at most
  // Stage 1: they line up on the right. From Stage 2 they come from both sides, never within 70 of you.
  let x = 200 + Math.random() * 170;
  if (stage() >= 2) { const left = Math.random() < 0.5 && g.me.x > 110; x = left ? 30 + Math.random() * (g.me.x - 100) : g.me.x + 70 + Math.random() * (W - 30 - g.me.x - 70); }
  g.tanks.push({ x: Math.max(20, Math.min(W - 20, x)), gold, hp: gold ? 2 : 1, quiet, flash: 0, hue: [0, 210, 280, 30][Math.floor(Math.random() * 4)] });
}
// 🕳️ moles (Stage 2+): one surfaces from the hill, lobs a shell at you and sinks back. 🌊 lakes (Stage 3+): a dip
// becomes water, and a serpent rises to spit. 🎈 balloons (Stage 3+): drift over and drop a bomb when above you.
function mole() { let x; for (let i = 0; i < 8; i++) { x = 30 + Math.random() * (W - 60); if (Math.abs(x - g.me.x) > 56 && !inLake(x)) break; } g.moles.push({ x, t: 0, hp: 1, fired: false }); }
const inLake = (x) => g.lakes.some((l) => x > l.x0 && x < l.x1);
function carveLake() {
  if (g.lakes.length >= 2) return;
  const fresh = g.fresh || (g.fresh = ridge(g.seed)); let best = -1, bi = 20;
  for (let i = 20; i < 81; i++) { if (Math.abs(i * SP() - g.me.x) < 70) continue; const v = fresh[i]; if (v > best && !inLake(i * SP())) { best = v; bi = i; } }   // the lowest ground that isn't under you
  const i0 = Math.max(0, bi - 9), i1 = Math.min(100, bi + 9), x0 = i0 * SP(), x1 = i1 * SP(), y = Math.min(H() - 36, best + 6);
  for (let i = i0; i <= i1; i++) { fresh[i] = Math.max(fresh[i], y); g.h[i] = Math.max(g.h[i], y); }
  g.lakes.push({ x0, x1, y, serpent: null }); g.fx.push({ kind: 'text', x: (x0 + x1) / 2, y: y - 30, text: '🌊 a lake', life: 1.2 });
}
function serpent() { const l = g.lakes[Math.floor(Math.random() * g.lakes.length)]; if (!l || l.serpent) return; l.serpent = { x: l.x0 + 20 + Math.random() * (l.x1 - l.x0 - 40), t: 0, hp: 1, fired: false }; sfx('splash'); }
// ⚡🎯 TAPS: a tap on an enemy is a weapon of its own, unlimited. Lightning strikes what is on or under the ground
// (moles, serpents, magma worms, even one still tunnelling), a target locks what flies (balloons, meteors) and it
// drops. The cannon (drag) still works on everything.
// 📦 ARTILLERY: from Stage 2 an ally drone crosses now and then and drops a crate near you; tap the crate to pick up
// a few rounds of a heavier shell the cannon then fires: 🧨 cluster (three), 💣 heavy (a bigger crater), 🔥 napalm
// (a wide burn), 🎯 guided (steers to the nearest tank). The bar bottom-right shows what's loaded.
const ARTY = { cluster: { icon: '🧨', name: 'Cluster', n: 4, desc: 'three shells a shot' }, heavy: { icon: '💣', name: 'Heavy', n: 3, desc: 'a bigger crater' }, napalm: { icon: '🔥', name: 'Napalm', n: 3, desc: 'a wide burn' }, guided: { icon: '🎯', name: 'Guided', n: 4, desc: 'steers to the nearest tank' } };
let bar = null;
function renderBar() { if (!bar || !g) return; const a = g.arty && ARTY[g.arty.kind]; bar.innerHTML = a ? `<button type="button" class="on" aria-label="${a.name}, ${g.arty.n} rounds" title="${a.desc}">${a.icon}<b>${g.arty.n}</b></button>` : ''; }
function allyDrone() { const fromLeft = Math.random() < 0.5; g.drones.push({ x: fromLeft ? -30 : W + 30, y: 60 + Math.random() * 30, vx: (fromLeft ? 1 : -1) * 90, dropped: false }); }
function dropCrate(x) { const kinds = Object.keys(ARTY), kind = kinds[Math.floor(Math.random() * kinds.length)]; g.drops.push({ x: Math.max(30, Math.min(W - 30, x)), y: 70, kind, down: true, life: 20 }); }
function pickUp(c) { g.drops.splice(g.drops.indexOf(c), 1); const a = ARTY[c.kind]; g.arty = { kind: c.kind, n: a.n }; host.cue?.('pickup', c.x, c.y); host.banner(`${a.icon} ${a.name.toUpperCase()} · ${a.n} ROUNDS`, a.desc); sfx('chime'); renderBar(); g.fx.push({ kind: 'ring', x: c.x, y: c.y, r: 4, R: 30, life: 0.35 }); }
// 🪱 magma worms (Stage 3+), up from the earth's core: one starts at the very bottom of the world and tunnels up
// through the dirt (the zoom-out is what lets you watch it coming), breaks the surface, rears up and spits lava.
function worm() { let x; for (let i = 0; i < 8; i++) { x = 40 + Math.random() * (W - 80); if (Math.abs(x - g.me.x) > 70 && !inLake(x)) break; } g.worms.push({ x, y: H() + 10, phase: 'dig', t: 0, hp: 1, fired: false, spd: 60 + 14 * stage() }); }
const wormHead = (w) => (w.phase === 'dig' ? { x: w.x, y: w.y } : { x: w.x, y: hAt(w.x) - 24 });
function balloon() { const fromLeft = Math.random() < 0.5; g.balloons.push({ x: fromLeft ? -20 : W + 20, y: 50 + Math.random() * 60, vx: (fromLeft ? 1 : -1) * (30 + Math.random() * 25 + 8 * stage()), hp: 1, dropped: false }); }
const enemyShell = (x, y, tx, speed = 240) => { const dx = tx - x; const a = -1.9 - Math.random() * 0.5; g.shells.push({ x, y, vx: Math.cos(a) * speed * Math.sign(dx || 1), vy: Math.sin(a) * speed, mine: false }); };
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
// a tap: a crate picks up; an enemy in the air takes a 🎯 target, one on or under the ground takes ⚡ lightning
function tap(x, y) {
  if (!g || S.over) return false; const near = (ex, ey, r) => Math.hypot(ex - x, ey - y) < r;
  const crate = g.drops.find((c) => near(c.x, c.y, 34)); if (crate) { pickUp(crate); return true; }
  const kill = (icon, ex, ey, pts, what, bolt) => { S.combo = S.comboT > 0 ? S.combo + 1 : 1; S.comboT = 3; const p = pts * fibMult(S.combo); host.add(p); killsN += 1; host.cue?.('kill', ex, ey);
    g.fx.push({ kind: 'text', x: ex, y: ey - 22, text: `${icon} ${what} +${p}`, life: 1.1, big: true, col: '#C9FFF8' }); g.fx.push({ kind: 'ring', x: ex, y: ey, r: 4, R: 36, life: 0.4 });
    if (bolt) { const pts2 = [[ex + (Math.random() - 0.5) * 40, -20]]; let yy = -20; while (yy < ey - 16) { yy += 28; pts2.push([ex + (Math.random() - 0.5) * 26, yy]); } pts2.push([ex, ey]); g.bolts.push({ pts: pts2, life: 0.3 }); sfx('flash'); } else sfx('boom', { size: 0.7 }); return true; };
  const b = g.balloons.find((q) => near(q.x, q.y + 6, 38)); if (b) { kill('🎯', b.x, b.y, 150, 'BALLOON'); b.hp = 0; return true; }
  const m = g.meteors.find((q) => near(q.x, q.y, 38)); if (m) { kill('🎯', m.x, m.y, 120, 'METEOR'); g.meteors.splice(g.meteors.indexOf(m), 1); return true; }
  const es = g.shells.find((q) => !q.mine && near(q.x, q.y, 34)); if (es) { kill('🎯', es.x, es.y, 60, 'INTERCEPTED'); g.shells.splice(g.shells.indexOf(es), 1); return true; }   // 🎯 a falling bomb or shell under your finger
  const w = g.worms.find((q) => { const h = wormHead(q); return near(h.x, h.y, 40); }); if (w) { const h = wormHead(w); kill('⚡', h.x, h.y, w.phase === 'dig' ? 300 : 250, w.phase === 'dig' ? 'WORM, UNDERGROUND' : 'WORM', true); w.hp = 0; return true; }
  const mo = g.moles.find((q) => q.t > 0.3 && near(q.x, hAt(q.x) - 8, 36)); if (mo) { kill('⚡', mo.x, hAt(mo.x) - 6, 200, 'MOLE', true); mo.hp = 0; return true; }
  const l = g.lakes.find((q) => q.serpent && near(q.serpent.x, q.y - 26, 38)); if (l) { kill('⚡', l.serpent.x, l.y - 26, 220, 'SERPENT', true); l.serpent.hp = 0; return true; }
  return false;
}
function fire(dx, dy) {
  if (!g || S.over) return;
  const d = Math.min(160, Math.hypot(dx, dy)); if (d < 10) return;
  const a = Math.atan2(-dy, -dx), p = 240 + d * 2.9, my = hAt(g.me.x) - 10;
  const kind = g.arty?.n > 0 ? g.arty.kind : null;   // 📦 a loaded artillery round, if any
  const shots = g.split || kind === 'cluster' ? [-0.12, 0, 0.12] : [0];
  shots.forEach((da) => g.shells.push({ x: g.me.x, y: my, vx: Math.cos(a + da) * p, vy: Math.sin(a + da) * p, mine: true, big: !!g.big || kind === 'heavy', napalm: kind === 'napalm', homing: kind === 'guided' }));
  if (g.split) { g.split = 0; g.fx.push({ kind: 'text', x: g.me.x, y: my - 24, text: '✨ FRACTAL SHELL', life: 1 }); }
  if (kind) { g.arty.n -= 1; g.fx.push({ kind: 'text', x: g.me.x, y: my - 24, text: `${ARTY[kind].icon} ${ARTY[kind].name.toUpperCase()}`, life: 0.9 }); if (g.arty.n <= 0) g.arty = null; renderBar(); }
  g.big = 0; shotsN += 1; sfx('cannon');
}
// a crater digs the hill, but never more than 70 below where it stood fresh: you keep a hill to stand on
function crater(x, y, r) { const fresh = g.fresh || (g.fresh = ridge(g.seed)); for (let i = 0; i < 101; i++) { const px = i * SP(), dx = px - x; if (Math.abs(dx) < r) { const depth = Math.sqrt(r * r - dx * dx); g.h[i] = Math.max(g.h[i], Math.min(H() - 30, fresh[i] + 70, y + depth)); } } }
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
    g.hurtT = 1.2; host.cue?.('near', g.me.x, hAt(g.me.x) - 10); host.hurt('shelled') || host.banner('DIRECT HIT', `${S.hearts} ${S.hearts === 1 ? 'heart' : 'hearts'} left`);
  }
}
function update(dt) {
  W = host?.W || W;   // 🎚️ the world widens with the stage
  g.time += dt;
  if (g.twist && g.time > g.twist.until) { if (g.twist.kind === 'gale') g.wind *= 0.3; g.twist = null; }
  g.night += ((g.twist?.kind === 'night' ? 1 : 0) - g.night) * Math.min(1, dt * 3);
  if (g.twist?.kind === 'meteors' && Math.random() < dt * 1.2) meteor(40 + Math.random() * (W - 80));
  // 🎚️ the stage: you drive to the middle from Stage 2 (they come from both sides), and the world fills
  const st = stage(), target = st >= 2 ? W / 2 : 44;
  if (Math.abs(g.me.x - target) > 1) { g.me.x += Math.sign(target - g.me.x) * Math.min(Math.abs(target - g.me.x), 46 * dt); if (!g.centred && st >= 2) { g.centred = true; host.banner('🎯 TO THE MIDDLE', 'they come from all sides now'); } }
  if (st >= 2) { g.moleT -= dt; if (g.moleT <= 0) { g.moleT = 7 - st + Math.random() * 3; mole(); } }
  if (st >= 3 && g.lakes.length < Math.min(2, st - 2)) carveLake();
  if (g.lakes.length) { g.serpT -= dt; if (g.serpT <= 0) { g.serpT = 6.5 - st + Math.random() * 3; serpent(); } }
  if (st >= 3) { g.balloonT -= dt; if (g.balloonT <= 0 && g.balloons.length < st - 1) { g.balloonT = 8 - st + Math.random() * 4; balloon(); } }
  if (st >= 3) { g.wormT -= dt; if (g.wormT <= 0 && g.worms.length < st - 2) { g.wormT = 9 - st + Math.random() * 4; worm(); } }
  g.worms = g.worms.filter((w) => { w.t += dt;
    if (w.phase === 'dig') { w.y -= w.spd * dt; if (Math.random() < dt * 10) g.fx.push({ kind: 'dot', x: w.x + (Math.random() - 0.5) * 18, y: w.y - 6, vx: (Math.random() - 0.5) * 50, vy: -40 - Math.random() * 40, c: ['#5A3B1F', '#FF5A3A'][Math.floor(Math.random() * 2)], life: 0.5, r: 2 });
      if (w.y <= hAt(w.x)) { w.phase = 'up'; w.t = 0; sfx('thud'); for (let i = 0; i < 12; i++) g.fx.push({ kind: 'dot', x: w.x + (Math.random() - 0.5) * 24, y: hAt(w.x), vx: (Math.random() - 0.5) * 80, vy: -120 - Math.random() * 100, c: ['#FF5A3A', '#FFB347', '#5A3B1F'][i % 3], life: 0.6, r: 2.5 }); } return w.hp > 0; }
    if (w.t > 1 && !w.fired && w.t < 2.4) { w.fired = true; enemyShell(w.x, hAt(w.x) - 34, g.me.x, 260 + 20 * st); sfx('thud'); } return w.t < 3.2 && w.hp > 0; });
  // 📦 ally drones (Stage 2+): across the sky, a crate near you; the crate floats down to the ridge and waits
  if (st >= 2) { g.droneT -= dt; if (g.droneT <= 0 && !g.drones.length) { g.droneT = 14 - st + Math.random() * 8; allyDrone(); } }
  g.drones = g.drones.filter((d) => { d.x += d.vx * dt; if (!d.dropped && Math.abs(d.x - g.me.x) < 70) { d.dropped = true; dropCrate(g.me.x + (Math.random() - 0.5) * 140); sfx('tick'); } return d.x > -40 && d.x < W + 40; });
  g.drops = g.drops.filter((c) => { if (c.down) { c.y += 110 * dt; if (c.y >= hAt(c.x) - 10) { c.y = hAt(c.x) - 10; c.down = false; } } else { c.y = hAt(c.x) - 10; c.life -= dt; } return c.life > 0; });
  g.bolts = g.bolts.filter((bl) => { bl.life -= dt; return bl.life > 0; });
  g.moles = g.moles.filter((m) => { m.t += dt; if (m.t > 0.9 && !m.fired && m.t < 2.4) { m.fired = true; enemyShell(m.x, hAt(m.x) - 6, g.me.x, 220 + 20 * st); } if (m.t < 0.9 && Math.random() < dt * 8) g.fx.push({ kind: 'dot', x: m.x + (Math.random() - 0.5) * 14, y: hAt(m.x), vx: (Math.random() - 0.5) * 60, vy: -90 - Math.random() * 60, c: '#5A3B1F', life: 0.5, r: 2 }); return m.t < 3 && m.hp > 0; });
  g.lakes.forEach((l) => { const s = l.serpent; if (!s) return; s.t += dt; if (s.t > 0.7 && !s.fired) { s.fired = true; enemyShell(s.x, l.y - 26, g.me.x, 200 + 20 * st); } if (s.t > 2.2 || s.hp <= 0) l.serpent = null; });
  g.balloons = g.balloons.filter((b) => { b.x += b.vx * dt; if (!b.dropped && Math.abs(b.x - g.me.x) < 16 + st * 4) { b.dropped = true; g.shells.push({ x: b.x, y: b.y + 14, vx: 0, vy: 40, mine: false }); } return b.x > -30 && b.x < W + 30 && b.hp > 0; });
  // 🌱 the hill always heals, slowly (a crater is half gone in ~4 s); the Regrowth twist heals it fast
  { const fresh = g.fresh || (g.fresh = ridge(g.seed)), rate = g.twist?.kind === 'regrow' ? 0.8 : 0.18; g.h = g.h.map((v, i) => v + (fresh[i] - v) * Math.min(1, dt * rate)); }
  // they fire back, more often the wilder the curve; tanks set by the window hold their fire
  if (g.hurtT > 0) g.hurtT -= dt;
  g.fireT -= dt * (1 + Math.max(0, S.curve.r - 2.9)) / (st === 1 ? 1.8 : 1);   // 🎚️ Stage 1: they fire slowly, and there is no wind
  if (st === 1) g.wind *= Math.max(0, 1 - dt * 2);
  if (g.fireT <= 0) { g.fireT = 2.2 + Math.random() * 2; const t = g.tanks.filter((q) => !q.quiet)[Math.floor(Math.random() * g.tanks.filter((q) => !q.quiet).length)];
    if (t) { const dx = g.me.x - t.x, p = 300 + Math.random() * 120, a = -2.2 - Math.random() * 0.5; t.flash = 0.35; g.shells.push({ x: t.x, y: hAt(t.x) - 10, vx: Math.cos(a) * p * Math.sign(dx) * -1 * -1, vy: Math.sin(a) * p, mine: false }); const s = g.shells[g.shells.length - 1]; s.vx = -Math.abs(s.vx) * (0.8 + Math.random() * 0.5); sfx('cannon'); } }
  g.shells = g.shells.filter((s) => { s.vy += G * dt; s.vx += g.wind * dt * 0.6;
    if (s.homing && s.vy > -60) { let best = null, bd = 1e9; g.tanks.forEach((t) => { const d = Math.abs(t.x - s.x); if (d < bd) { bd = d; best = t; } }); if (best) s.vx += Math.sign(best.x - s.x) * 420 * dt; }   // 🎯 guided: it leans toward the nearest tank on the way down
    s.x += s.vx * dt; s.y += s.vy * dt; if (s.x < -20 || s.x > W + 20) return false;
    if (s.mine) {   // your shells against what the world sent: moles, serpents, balloons
      const hit = (x, y, r, pts, what) => { if (Math.hypot(s.x - x, s.y - y) < r) { S.combo = S.comboT > 0 ? S.combo + 1 : 1; S.comboT = 3; const p = pts * fibMult(S.combo); host.add(p); killsN += 1; host.cue?.('kill', x, y); g.fx.push({ kind: 'text', x, y: y - 22, text: `${what} +${p}`, life: 1.1, big: true, col: '#FFE08A' }); g.fx.push({ kind: 'ring', x, y, r: 4, R: 30, life: 0.35 }); sfx('cheer', { delay: 0.05 }); return true; } return false; };
      const m = g.moles.find((q) => q.t > 0.5 && hit(q.x, hAt(q.x) - 6, 26, 120, '🕳️ MOLE'));   // near misses count if (m) { m.hp = 0; return false; }
      const l = g.lakes.find((q) => q.serpent && hit(q.serpent.x, q.y - 26, 28, 200, '🌊 SERPENT')); if (l) { l.serpent.hp = 0; return false; }
      const b = g.balloons.find((q) => hit(q.x, q.y, 28, 150, '🎈 BALLOON')); if (b) { b.hp = 0; return false; }
      const w = g.worms.find((q) => q.phase === 'up' && hit(q.x, hAt(q.x) - 24, 28, 180, '🪱 WORM')); if (w) { w.hp = 0; return false; }
      const mt = g.meteors.find((q) => hit(q.x, q.y, 30, 120, '☄️ METEOR')); if (mt) { g.meteors.splice(g.meteors.indexOf(mt), 1); boom(s.x, s.y, 18, false); return false; }   // ☄️ a shell that meets a meteor breaks it up
      const es = g.shells.find((q) => !q.mine && hit(q.x, q.y, 22, 60, '💣 INTERCEPTED')); if (es) { g.shells.splice(g.shells.indexOf(es), 1); boom(s.x, s.y, 14, false); return false; }   // 💣 and one that meets a falling bomb or shell
    } if (s.y >= hAt(s.x)) { boom(s.x, s.y, s.napalm ? 52 : s.big ? 34 : 22, s.mine); if (s.napalm) for (let i = 0; i < 30; i++) g.fx.push({ kind: 'dot', x: s.x + (Math.random() - 0.5) * 100, y: hAt(s.x + (Math.random() - 0.5) * 100) - 4, vx: (Math.random() - 0.5) * 30, vy: -60 - Math.random() * 90, c: ['#FF5A3A', '#FFB347', '#FFE08A'][i % 3], life: 0.9 + Math.random() * 0.6, r: 3 }); return false; } return true; });
  g.meteors = g.meteors.filter((m) => { m.y += m.vy * dt; m.x += m.vx * dt; m.vy += 120 * dt; if (m.y >= hAt(m.x)) { boom(m.x, m.y, 40, false); g.tanks.filter((t) => Math.abs(t.x - m.x) < 46).forEach((t) => { g.tanks.splice(g.tanks.indexOf(t), 1); killsN += 1; host.add(75); g.fx.push({ kind: 'text', x: t.x, y: m.y - 30, text: 'FLATTENED +75', life: 1 }); }); return false; } return true; });
  g.tanks.forEach((t) => { if (t.flash > 0) t.flash -= dt; });
  g.fx.forEach((f) => { f.life -= dt; if (f.kind === 'dot') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 300 * dt; } else if (f.kind === 'ring') f.r += (f.R - f.r) * Math.min(1, dt * 14); else f.y -= 24 * dt; });
  g.fx = g.fx.filter((f) => f.life > 0);
}
function drawTank(x, hue, flash, mine, gold) {
  const y = hAt(x) - 8;
  ctx.save(); ctx.translate(x, y);
  if (g.glitch && !mine) { drawPal(g.glitchPal || 'fig', ctx, { x: 0, y: -12, s: 10, t: performance.now() / 1000, r: 4, face: -1 }); ctx.restore(); return; }   // ⚡ glitch: Fig on every hill
  ctx.fillStyle = flash > 0 ? '#fff' : gold ? '#F5C542' : mine ? '#3DD6C6' : `hsl(${hue} 55% 50%)`;
  ctx.beginPath(); ctx.roundRect(-TANK_W / 2, -8, TANK_W, 12, 4); ctx.fill();
  if (mine) drawPal(g.glitch ? (g.glitchPal || 'fig') : (S.curve.mood || 'calm'), ctx, { x: 0, y: -17, s: 8, t: performance.now() / 1000, r: S.curve.r, face: 1, hurt: g.hurtT > 0 });   // 🟢 you are Fig, at the wheel
  else { ctx.beginPath(); ctx.arc(0, -8, 7, Math.PI, 0); ctx.fill(); }
  ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(mine ? 12 : -12, -18); ctx.stroke();
  ctx.fillStyle = '#0A0A14'; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(i * 7, 4, 3, 0, 7); ctx.fill(); }
  ctx.restore();
}
function draw(t) {
  W = host?.W || W;
  const k = host.k, Hh = H();
  ctx.setTransform(k, 0, 0, k, host.ox || 0, host.oy || 0);
  const night = g ? g.night : 0;
  const sky = ctx.createLinearGradient(0, 0, 0, Hh); sky.addColorStop(0, night > 0.5 ? '#07071A' : '#1B1646'); sky.addColorStop(0.6, night > 0.5 ? '#12102A' : '#3B2A6E'); sky.addColorStop(1, night > 0.5 ? '#1A0A20' : '#7A3E72');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, Hh);
  ctx.fillStyle = '#FFE9B0'; ctx.beginPath(); ctx.arc(W * 0.78, 70, 22, 0, 7); ctx.fill();
  if (!g) return;
  // the ridge
  ctx.fillStyle = '#2E7D4F'; ctx.beginPath(); ctx.moveTo(0, Hh); g.h.forEach((v, i) => ctx.lineTo(i * SP(), v)); ctx.lineTo(W, Hh); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5A3B1F'; ctx.beginPath(); ctx.moveTo(0, Hh); g.h.forEach((v, i) => ctx.lineTo(i * SP(), v + 14)); ctx.lineTo(W, Hh); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#8FD48F'; ctx.lineWidth = 3; ctx.beginPath(); g.h.forEach((v, i) => ctx[i ? 'lineTo' : 'moveTo'](i * SP(), v)); ctx.stroke();
  // wind
  ctx.fillStyle = '#ffffffaa'; ctx.font = '900 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`${g.wind < -5 ? '←' : g.wind > 5 ? '→' : '·'} wind ${Math.abs(Math.round(g.wind))}`, W / 2, 24);
  // 🌊 lakes, 🕳️ moles, 🎈 balloons
  g.lakes.forEach((l) => { ctx.fillStyle = '#2E6FA8'; ctx.beginPath(); ctx.moveTo(l.x0, l.y); for (let x = l.x0; x <= l.x1; x += 8) ctx.lineTo(x, l.y - 3 + Math.sin(x / 14 + t / 300) * 2); ctx.lineTo(l.x1, l.y + 12); ctx.lineTo(l.x0, l.y + 12); ctx.closePath(); ctx.fill();
    const s = l.serpent; if (s) { const up = Math.min(1, s.t / 0.5) * (s.t > 1.7 ? Math.max(0, (2.2 - s.t) / 0.5) : 1), h = 34 * up; ctx.strokeStyle = '#3FA86B'; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(s.x - 14, l.y + 4); ctx.quadraticCurveTo(s.x - 6, l.y - h * 0.9, s.x, l.y - h); ctx.stroke(); ctx.fillStyle = '#3FA86B'; ctx.beginPath(); ctx.arc(s.x + 2, l.y - h, 7, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x + 4, l.y - h - 2, 2.2, 0, 7); ctx.fill(); } });
  g.moles.forEach((m) => { const up = m.t < 0.9 ? m.t / 0.9 : m.t > 2.4 ? Math.max(0, (3 - m.t) / 0.6) : 1, y = hAt(m.x), rr = 11; ctx.save(); ctx.beginPath(); ctx.rect(m.x - 20, y - 40, 40, 40); ctx.clip(); ctx.fillStyle = '#6B4A2B'; ctx.beginPath(); ctx.arc(m.x, y + rr - rr * 1.6 * up, rr, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#F7B5C8'; ctx.beginPath(); ctx.arc(m.x, y + rr - rr * 1.6 * up - 2, 3, 0, 7); ctx.fill(); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(m.x - 4, y + rr - rr * 1.6 * up - 5, 1.6, 0, 7); ctx.arc(m.x + 4, y + rr - rr * 1.6 * up - 5, 1.6, 0, 7); ctx.fill(); ctx.restore(); });
  g.worms.forEach((w) => { const y = hAt(w.x);
    if (w.phase === 'dig') {   // under the ground: the tunnel it leaves from the bottom of the world, and the worm at its head, glowing
      ctx.strokeStyle = '#2E1A0C'; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(w.x, Hh + 20); ctx.lineTo(w.x, w.y + 10); ctx.stroke();
      const gr = ctx.createLinearGradient(0, w.y + 44, 0, w.y); gr.addColorStop(0, '#7A1F0E'); gr.addColorStop(1, '#FFB347'); ctx.strokeStyle = gr; ctx.lineWidth = 12; ctx.beginPath(); for (let i = 0; i <= 6; i++) { const yy = w.y + 44 - (44 * i) / 6; ctx[i ? 'lineTo' : 'moveTo'](w.x + Math.sin(w.t * 7 + i) * 4, yy); } ctx.stroke();
      ctx.fillStyle = '#FFF3C4'; ctx.beginPath(); ctx.arc(w.x - 3 + Math.sin(w.t * 7 + 6) * 4, w.y - 2, 1.8, 0, 7); ctx.arc(w.x + 3 + Math.sin(w.t * 7 + 6) * 4, w.y - 2, 1.8, 0, 7); ctx.fill();
      const glow = ctx.createRadialGradient(w.x, w.y, 2, w.x, w.y, 40); glow.addColorStop(0, 'rgba(255,120,60,0.35)'); glow.addColorStop(1, 'rgba(255,120,60,0)'); ctx.fillStyle = glow; ctx.fillRect(w.x - 40, w.y - 40, 80, 80);
      ctx.strokeStyle = `rgba(255,90,58,${0.3 + 0.5 * Math.abs(Math.sin(w.t * 9))})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(w.x - 14, y - 1); ctx.lineTo(w.x - 5, y + 3); ctx.lineTo(w.x + 3, y - 2); ctx.lineTo(w.x + 12, y + 2); ctx.stroke();   // the ground above it cracks
      return;
    }
    ctx.strokeStyle = '#2E1A0C'; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(w.x, Hh + 20); ctx.lineTo(w.x, y + 6); ctx.stroke();   // the tunnel it came up
    const up = w.t < 0.8 ? w.t / 0.8 : w.t > 2.4 ? Math.max(0, (3.2 - w.t) / 0.8) : 1, h = 36 * up; ctx.save(); ctx.beginPath(); ctx.rect(w.x - 24, y - 50, 48, 50); ctx.clip();
    const gr = ctx.createLinearGradient(0, y, 0, y - h); gr.addColorStop(0, '#7A1F0E'); gr.addColorStop(1, '#FFB347'); ctx.strokeStyle = gr; ctx.lineWidth = 12; ctx.lineCap = 'round'; ctx.beginPath(); for (let i = 0; i <= 6; i++) { const yy = y - (h * i) / 6; ctx[i ? 'lineTo' : 'moveTo'](w.x + Math.sin(w.t * 6 + i) * 4 * up, yy); } ctx.stroke();
    ctx.strokeStyle = '#FF5A3A88'; ctx.lineWidth = 2; for (let i = 1; i < 6; i++) { const yy = y - (h * i) / 6; ctx.beginPath(); ctx.moveTo(w.x - 6 + Math.sin(w.t * 6 + i) * 4 * up, yy); ctx.lineTo(w.x + 6 + Math.sin(w.t * 6 + i) * 4 * up, yy); ctx.stroke(); }
    ctx.fillStyle = '#FFF3C4'; ctx.beginPath(); ctx.arc(w.x - 3 + Math.sin(w.t * 6 + 6) * 4 * up, y - h - 1, 1.8, 0, 7); ctx.arc(w.x + 3 + Math.sin(w.t * 6 + 6) * 4 * up, y - h - 1, 1.8, 0, 7); ctx.fill(); ctx.restore(); });
  g.balloons.forEach((b) => { ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(b.x, b.y + 12); ctx.lineTo(b.x, b.y + 22); ctx.stroke(); ctx.fillStyle = '#E0453A'; ctx.beginPath(); ctx.ellipse(b.x, b.y, 11, 14, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#5A3B1F'; ctx.fillRect(b.x - 4, b.y + 22, 8, 6); if (!b.dropped) { ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(b.x, b.y + 28, 3, 0, 7); ctx.fill(); } });
  g.tanks.forEach((tk) => { if (night > 0.5 && tk.flash <= 0) return; drawTank(tk.x, tk.hue, tk.flash, false, tk.gold); if (tk.quiet) { ctx.fillStyle = '#C9B8FF'; ctx.font = '11px system-ui'; ctx.fillText('🔁', tk.x, hAt(tk.x) - 28); } });
  drawTank(g.me.x, 0, 0, true, false);
  if (g.shield) { ctx.strokeStyle = '#7FD3F7'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(g.me.x, hAt(g.me.x) - 10, 22, 0, 7); ctx.stroke(); }
  if (drag) { const dx = drag.x - drag.x0, dy = drag.y - drag.y0, d = Math.min(160, Math.hypot(dx, dy)), a = Math.atan2(-dy, -dx), my = hAt(g.me.x) - 10; ctx.strokeStyle = `rgba(255,${230 - d},120,0.9)`; ctx.lineWidth = 3; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(g.me.x, my);
    let px = g.me.x, py = my, vx = Math.cos(a) * (240 + d * 2.9), vy = Math.sin(a) * (240 + d * 2.9); for (let i = 0; i < 26; i++) { vy += G * 0.04; vx += g.wind * 0.04 * 0.6; px += vx * 0.04; py += vy * 0.04; ctx.lineTo(px, py); if (py > hAt(px)) break; } ctx.stroke(); ctx.setLineDash([]); }
  g.shells.forEach((s) => { ctx.fillStyle = s.napalm ? '#FF5A3A' : s.homing ? '#FFE08A' : s.mine ? '#3DD6C6' : '#FF8A3D'; ctx.beginPath(); ctx.arc(s.x, s.y, s.big ? 6 : 4, 0, 7); ctx.fill(); if (s.napalm) { ctx.strokeStyle = '#FFB34788'; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 0.05, s.y - s.vy * 0.05); ctx.stroke(); } });
  g.drones.forEach((d) => { ctx.save(); ctx.translate(d.x, d.y); ctx.scale(Math.sign(d.vx), 1); ctx.fillStyle = '#3DD6C6'; ctx.beginPath(); ctx.roundRect(-12, -5, 24, 10, 4); ctx.fill(); ctx.strokeStyle = '#C9FFF8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-16, -8); ctx.lineTo(16, -8); ctx.stroke(); const sp = (t / 30) % 6.28; ctx.beginPath(); ctx.ellipse(-14, -8, 7 * Math.abs(Math.cos(sp)), 1.5, 0, 0, 7); ctx.ellipse(14, -8, 7 * Math.abs(Math.sin(sp)), 1.5, 0, 0, 7); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = '9px system-ui'; ctx.textAlign = 'center'; ctx.fillText('ALLY', 0, 3); ctx.restore(); });
  g.drops.forEach((c) => { const a = ARTY[c.kind]; if (c.down) { ctx.fillStyle = '#C9FFF8'; ctx.beginPath(); ctx.arc(c.x, c.y - 22, 16, Math.PI, 0); ctx.fill(); ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(c.x - 14, c.y - 22); ctx.lineTo(c.x - 8, c.y - 8); ctx.moveTo(c.x + 14, c.y - 22); ctx.lineTo(c.x + 8, c.y - 8); ctx.stroke(); }
    const blink = !c.down && c.life < 3 && Math.sin(t / 80) > 0; ctx.fillStyle = blink ? '#FFE08A' : '#8A5A2B'; ctx.beginPath(); ctx.roundRect(c.x - 10, c.y - 8, 20, 16, 3); ctx.fill(); ctx.strokeStyle = '#F5C542'; ctx.lineWidth = 1.5; ctx.strokeRect(c.x - 10, c.y - 8, 20, 16); ctx.font = '12px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(a.icon, c.x, c.y); ctx.textBaseline = 'alphabetic';
    if (!c.down) { ctx.fillStyle = '#C9FFF8'; ctx.font = '900 9px system-ui'; ctx.fillText('TAP', c.x, c.y - 14); } });
  g.bolts.forEach((bl) => { ctx.save(); ctx.globalAlpha = Math.min(1, bl.life * 4); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; const path = () => { ctx.beginPath(); bl.pts.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y)); }; ctx.strokeStyle = '#9BE7FF'; ctx.shadowColor = '#9BE7FF'; ctx.shadowBlur = 12; ctx.lineWidth = 4; path(); ctx.stroke(); ctx.shadowBlur = 0; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; path(); ctx.stroke(); ctx.restore(); });
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
  enter(from) { if (!g) newGame(); bar = host.ui('<div class="wbar" id="hbar" aria-label="Artillery"></div>').querySelector('.wbar'); renderBar(); drag = null; if (from) { g.shells = g.shells.filter((s) => s.mine); g.fireT = Math.max(g.fireT, 1.5); if (!g.tanks.length) addTank(); } },
  leave() { bar = null; drag = null; return g ? { x: g.me.x, y: hAt(g.me.x) - 10 } : null; },
  update, draw, onBeat,
  pointer(type, p) { if (type === 'down') drag = { x0: p.x, y0: p.y, x: p.x, y: p.y }; else if (type === 'move') { if (drag) { drag.x = p.x; drag.y = p.y; } } else if (drag) { if (Math.hypot(drag.x - drag.x0, drag.y - drag.y0) < 10) tap(drag.x0, drag.y0); else fire(drag.x - drag.x0, drag.y - drag.y0); drag = null; } },
  hudLine: () => (g ? `💥 ${killsN} K.O. · ${g.tanks.length} dug in` : ''),
  level: () => 1 + Math.floor(killsN / 5),
  overText: (how) => (how === 'shelled' ? ['💥 KNOCKED OUT', 'Too many direct hits.'] : ['RUN OVER', '']),
  endStats: () => (g ? `💥 ${killsN} K.O. from ${shotsN} shells` : ''),
  debug: () => g && ({ ...(() => ({ me: g.me.x, tanks: g.tanks.length, moles: g.moles.length, lakes: g.lakes.length, balloons: g.balloons.length, worms: g.worms.length, wormsAt: g.worms.map((w) => ({ ...wormHead(w), phase: w.phase, t: w.t })), arty: g.arty, drones: g.drones.length, drops: g.drops.map((c) => ({ x: c.x, y: c.y, kind: c.kind, down: c.down })), tap, stage: stage() }))() }),
  debug0: () => g && ({ tanks: g.tanks.map((t) => ({ x: t.x, y: hAt(t.x), gold: t.gold, quiet: t.quiet })), me: { x: g.me.x, y: hAt(g.me.x) }, shells: g.shells.length, kills: killsN, wind: g.wind, twist: g.twist?.kind || null, W, H: H(), fire }),
};
export default organ;
