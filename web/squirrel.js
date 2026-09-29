// 🐿️ Squirrel Chaos: a solo arcade game. Squirrels race along the branches of fractal trees; tap to
// fire the stapler. A big squirrel splits in two when you staple it (and a middle one splits again):
// only the littlest get pinned, and score. How many come, and when, follows the chaos curve
// x → r·x·(1−x): calm at first, then a rhythm of 2, then 4, then chaos, with twists at its peaks.
// Each level ends by diving into the knothole of the middle tree, into a deeper, wilder forest.
// Everything is played on this page; the score is saved with solo_submit (063).
import { sb, me, signedIn, sfx, setGameTools, esc, names } from './common.js';

const $ = (id) => document.getElementById(id);
const cv = $('sq'), ctx = cv.getContext('2d'), stage = $('stage');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const W = 400;                    // the forest is 400 across; its height follows the screen's shape
let H = 640, k = 1, dpr = 1;
const LEVELS = 3, LEVEL_S = 30, AMMO = 12, RELOAD_S = 1.1, MAX_SQ = 16;
const rng = (seed) => { let x = (seed >>> 0) || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; };

// ---------------------------------------------------------------- sizing
function size() {
  const fs = !!document.querySelector('#play.fs-on');
  const r = stage.getBoundingClientRect();
  const w = r.width, h = fs ? innerHeight : Math.max(420, innerHeight - r.top - 12);
  dpr = Math.min(2, devicePixelRatio || 1);
  cv.style.height = `${h}px`; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  k = cv.width / W; H = cv.height / k;
  if (forest && Math.abs(forest.H - H) > 1) forest = grow(forest.seed, level);   // the trees stand on the new ground
}

// ---------------------------------------------------------------- the fractal forest
// Three trees, each a trunk that forks and forks again (2, now and then 3 ways, each branch 0.72 as
// long, 5 levels, 6 in a deeper forest). Every branch is a segment the squirrels run along; a branch
// knows its parent and its children, so they climb up and down the tree like a graph.
let forest = null;
function grow(seed, lvl) {
  const r = rng(seed * 2654435761), segs = [], ground = H - 30, depth = 4 + Math.min(2, lvl);
  const add = (x1, y1, a, len, w, d, parent) => {
    const x2 = x1 + Math.cos(a) * len, y2 = y1 + Math.sin(a) * len;
    if (x2 < 8 || x2 > W - 8 || y2 < 70) return null;
    const s = { x1, y1, x2, y2, w, d, parent, kids: [], a };
    s.i = segs.push(s) - 1;
    if (parent) parent.kids.push(s);
    if (d < depth) {
      const n = r() < 0.3 ? 3 : 2, spread = 0.38 + r() * 0.22;
      for (let j = 0; j < n; j++) {
        const f = n === 1 ? 0 : (j / (n - 1)) * 2 - 1;
        add(x2, y2, a + f * spread + (r() - 0.5) * 0.25, len * (0.66 + r() * 0.12), Math.max(2, w * 0.66), d + 1, s);
      }
    }
    return s;
  };
  const trunks = [];
  for (let t = 0; t < 3; t++) {
    const x = W * (t + 0.5) / 3 + (r() - 0.5) * 40;
    trunks.push(add(x, ground, -Math.PI / 2 + (r() - 0.5) * 0.12, (H - 110) * (0.26 + r() * 0.06), 15, 0, null));
  }
  const tips = segs.filter((s) => !s.kids.length);
  const mid = trunks[1];
  const knot = { x: mid.x1 + (mid.x2 - mid.x1) * 0.55, y: mid.y1 + (mid.y2 - mid.y1) * 0.55 };
  return { seed, H, ground, segs, trunks, tips, knot, hue: [34, 28, 22, 16][Math.min(3, lvl - 1)] };
}
const posOn = (s, t) => ({ x: s.x1 + (s.x2 - s.x1) * t, y: s.y1 + (s.y2 - s.y1) * t });

// ---------------------------------------------------------------- state
let game = null;   // { score, combo, comboT, ammo, reloadT, level, time, squirrels, staples, pins, fx, stuck, curve, twist, over }
let level = 1;
function newGame() {
  level = 1;
  forest = grow((Date.now() & 0xffffff) | 1, level);
  game = { score: 0, combo: 0, comboT: 0, ammo: AMMO, reloadT: 0, time: 0, stepT: 0, squirrels: [], staples: [], pins: [], fx: [], stuck: [], leaves: [],
    curve: { r: 2.85, x: 0.2 + Math.random() * 0.6, n: 0, hist: [] }, twist: null, speed: 1, over: false, dive: null, hits: 0, shots: 0,
    weapon: 'staple', arsenal: {}, hearts: 3, stun: 0, shake: 0, hitstop: 0, acorns: [], crates: [], crateT: 5, bombs: [], bolts: [] };
  renderBar();
  banner('LEVEL 1', 'Staple the littlest ones. The big ones split!');
}

// ---------------------------------------------------------------- the chaos curve
// Every 1.2 s the curve takes a step (r climbs 0.03 a step, from 2.85 to 4 by the middle of level 2):
// the new x decides how many squirrels come, and above 0.93 a twist strikes.
const phaseOf = (r) => (r < 3 ? 'calm' : r < 3.449 ? 'rhythm ×2' : r < 3.5699 ? 'rhythm ×4…' : 'CHAOS');
function chaosStep() {
  const c = game.curve;
  c.n += 1; const was = c.r; c.r = Math.min(4, 2.85 + 0.03 * c.n);
  c.x = c.r * c.x * (1 - c.x); if (c.x <= 1e-6 || c.x >= 1 - 1e-6) c.x = 0.5 + (Math.random() - 0.5) * 1e-3;
  c.hist.push(c.x); if (c.hist.length > 24) c.hist.shift();
  if (was < 3 && c.r >= 3) banner('RHYTHM ×2', 'the curve split in two');
  else if (was < 3.449 && c.r >= 3.449) banner('RHYTHM ×4', 'period doubling…');
  else if (was < 3.5699 && c.r >= 3.5699) banner('CHAOS', 'no rhythm left');
  const n = c.x > 0.8 ? 3 : c.x > 0.6 ? 2 : c.x > 0.35 ? 1 : 0;
  for (let i = 0; i < n; i++) spawn();
  // 😠 They fight back: the wilder the curve, the more acorns come flying at your stapler.
  if (c.x > 0.55 && game.acorns.length < 2 && Math.random() < 0.1 + 0.07 * level + (c.r >= 3.5699 ? 0.08 : 0)) throwAcorn();
  if (c.x > 0.97) spawn(1, true);            // ✨ a golden one when x all but touches 1
  else if (c.x > 0.93 && !game.twist) twist();
}
const TWISTS = [
  ['🌪️ GUST', 'staples drift in the wind', 'gust'],
  ['🐿️ STAMPEDE', 'here come the little ones', 'stampede'],
  ['⚡ FRENZY', 'squirrels at double speed', 'frenzy'],
  ['🍂 LEAF STORM', 'can you see them?', 'leaves'],
];
function twist() {
  const [title, sub, kind] = TWISTS[Math.floor(Math.random() * TWISTS.length)];
  game.twist = { kind, until: game.time + 6, wind: (Math.random() < 0.5 ? -1 : 1) * 70 };
  banner(title, sub); sfx('twist');
  if (kind === 'stampede') for (let i = 0; i < 6; i++) spawn(1);
  dropCrate();   // every twist drops a crate too
  if (kind === 'leaves') for (let i = 0; i < 60; i++) game.leaves.push({ x: Math.random() * W, y: -Math.random() * H, vx: 20 + Math.random() * 40, vy: 40 + Math.random() * 50, r: 5 + Math.random() * 7, a: Math.random() * 6 });
}

// ---------------------------------------------------------------- squirrels
const RAD = [0, 10, 15, 21];
function spawn(sz, gold = false) {
  if (game.squirrels.length >= MAX_SQ || game.dive) return;
  const size = sz || (Math.random() < 0.35 ? 3 : Math.random() < 0.55 ? 2 : 1);
  const trunk = forest.trunks[Math.floor(Math.random() * forest.trunks.length)];
  const sq = { seg: trunk, t: 0, dir: 1, size, gold, face: Math.random() < 0.5 ? -1 : 1, spd: (70 + Math.random() * 40) * (gold ? 1.6 : 1) / (0.7 + size * 0.15), hop: null, wig: Math.random() * 6 };
  if (Math.random() < 0.4) {   // in from the side, with a leap onto a branch
    const to = forest.segs[Math.floor(Math.random() * forest.segs.length)], p = posOn(to, 0.5);
    sq.seg = to; sq.t = 0.5; sq.hop = { x0: Math.random() < 0.5 ? -20 : W + 20, y0: p.y - 60, t: 0, dur: 0.7 };
  }
  game.squirrels.push(sq);
}
const sqPos = (sq) => {
  const p = posOn(sq.seg, sq.t), n = { x: -(sq.seg.y2 - sq.seg.y1), y: sq.seg.x2 - sq.seg.x1 }, l = Math.hypot(n.x, n.y) || 1, up = n.y < 0 ? 1 : -1;
  const off = RAD[sq.size] * 0.8 + sq.seg.w * 0.4;
  let x = p.x + (n.x / l) * off * up, y = p.y + (n.y / l) * off * up;
  if (sq.hop) { const e = Math.min(1, sq.hop.t / sq.hop.dur); x = sq.hop.x0 + (x - sq.hop.x0) * e; y = sq.hop.y0 + (y - sq.hop.y0) * e - Math.sin(e * Math.PI) * 50; }
  return { x, y };
};
function moveSquirrel(sq, dt) {
  if (sq.hop) { sq.hop.t += dt; if (sq.hop.t >= sq.hop.dur) sq.hop = null; return; }
  const len = Math.hypot(sq.seg.x2 - sq.seg.x1, sq.seg.y2 - sq.seg.y1) || 1;
  const frenzy = game.twist?.kind === 'frenzy' ? 2 : 1;
  sq.t += (sq.dir * sq.spd * game.speed * frenzy * dt) / len;
  if (sq.t >= 1) {   // top of this branch: on up a child, or back down
    if (sq.seg.kids.length && Math.random() < 0.85) { sq.seg = sq.seg.kids[Math.floor(Math.random() * sq.seg.kids.length)]; sq.t = 0; }
    else { sq.t = 1; sq.dir = -1; }
  } else if (sq.t <= 0) {
    if (sq.seg.parent && Math.random() < 0.7) { sq.seg = sq.seg.parent; sq.t = 1; }
    else { sq.t = 0; sq.dir = 1; }
  }
  sq.face = sq.dir * Math.sign(sq.seg.x2 - sq.seg.x1 || 1);
  // Now and then (more in chaos) a squirrel leaps to another branch nearby.
  if (Math.random() < dt * (0.15 + game.curve.x * 0.35)) hopTo(sq);
}
function hopTo(sq, from) {
  const p = from || sqPos(sq);
  const near = forest.segs.filter((s) => { const q = posOn(s, 0.5); return Math.hypot(q.x - p.x, q.y - p.y) < 140; });
  const to = near[Math.floor(Math.random() * near.length)] || forest.segs[Math.floor(Math.random() * forest.segs.length)];
  sq.seg = to; sq.t = 0.2 + Math.random() * 0.6; sq.dir = Math.random() < 0.5 ? 1 : -1;
  sq.hop = { x0: p.x, y0: p.y, t: 0, dur: 0.45 };
}

// ---------------------------------------------------------------- the arsenal
// The stapler never runs out (12 a clip, then a reload). Everything else comes in 📦 crates that
// parachute in (more of them in chaos): shoot a crate to grab what's inside, then pick it on the bar.
const WEAPONS = {
  staple: { icon: '📎', name: 'Stapler' },
  nail: { icon: '🔩', name: 'Nail Gun', ammo: 40, desc: 'hold to fire full auto' },
  shotgun: { icon: '💥', name: 'Staple Shotgun', ammo: 8, desc: 'five staples in a spread' },
  bomb: { icon: '🧨', name: 'Tack Bomb', ammo: 4, desc: 'lob it: everything nearby gets tacked' },
  chain: { icon: '⚡', name: 'Chain Stapler', ammo: 6, desc: 'the bolt forks from squirrel to squirrel' },
  chaos: { icon: '🌀', name: 'Chaos Cannon', ammo: 3, desc: 'one shot bursts into a fractal of 15' },
};
const CRATE_ODDS = [['nail', 0.26], ['shotgun', 0.24], ['bomb', 0.2], ['chain', 0.18], ['chaos', 0.12]];
function dropCrate() {
  if (game.crates.length >= 2) return;
  let r = Math.random(), w = 'nail'; for (const [k, p] of CRATE_ODDS) { if ((r -= p) < 0) { w = k; break; } }
  game.crates.push({ x: 40 + Math.random() * (W - 80), y: -30, w, life: 9, sway: Math.random() * 6 });
}
function openCrate(c) {
  game.crates.splice(game.crates.indexOf(c), 1);
  game.arsenal[c.w] = (game.arsenal[c.w] || 0) + WEAPONS[c.w].ammo; game.weapon = c.w;
  banner(`${WEAPONS[c.w].icon} ${WEAPONS[c.w].name.toUpperCase()}`, WEAPONS[c.w].desc); sfx('chime'); renderBar();
  burst(c.x, c.y, ['#C98B4A', '#F5C542', '#FFF'], 18);
}
function spend() {   // one round of the loaded weapon; back to the stapler when it's empty
  const w = game.weapon; if (w === 'staple') return;
  game.arsenal[w] -= 1; if (game.arsenal[w] <= 0) { delete game.arsenal[w]; game.weapon = 'staple'; }
  renderBar();
}
// 🌰 An acorn, lobbed by an angry squirrel at your stapler: shoot it down, or BONK.
function throwAcorn() {
  const live = game.squirrels.filter((q) => !q.hop); if (!live.length) return;
  const sq = live[Math.floor(Math.random() * live.length)], p = sqPos(sq), st = STAPLER();
  sq.angry = 1.2;
  game.acorns.push({ x0: p.x, y0: p.y, x1: st.x + (Math.random() - 0.5) * 30, y1: st.y - 10, t: 0, tf: 2.2 - Math.min(0.5, level * 0.12), spin: Math.random() * 6 });
}
const acornPos = (a) => { const e = Math.min(1, a.t / a.tf); return { x: a.x0 + (a.x1 - a.x0) * e, y: a.y0 + (a.y1 - a.y0) * e - Math.sin(e * Math.PI) * 70 }; };
function bonk() {
  game.hearts -= 1; game.stun = 0.7; game.shake = 0.45; game.combo = 0;
  const st = STAPLER(); comic('BONK!', st.x, st.y - 40, '#FF6B5A'); sfx('thud'); sfx('buzz', { delay: 0.1 }); navigator.vibrate?.(120);
  burst(st.x, st.y - 16, ['#8A5A2B', '#C98B4A', '#FFE08A'], 20);
  if (game.hearts <= 0) { game.ko = true; finish(); }
}

// ---------------------------------------------------------------- the stapler
const STAPLER = () => ({ x: W / 2, y: H - 14 });
function fire(x, y) {
  if (!game || game.over || game.dive) return;
  const st = STAPLER(), w = game.weapon;
  // A tap on the stapler reloads, unless an acorn or a crate is right there: then it's a shot.
  const target = game.acorns.some((a) => { const q = acornPos(a); return Math.hypot(q.x - x, q.y - y) < 30; }) || game.crates.some((c) => Math.hypot(c.x - x, c.y - y) < 26);
  if (!target && Math.hypot(x - st.x, y - st.y) < 34) return reload();
  // 🌰 Tap an acorn to swat it, whatever you're holding (a stapler shot costs a staple).
  const acorn = game.acorns.find((a) => { const q = acornPos(a); return Math.hypot(q.x - x, q.y - y) < 30; });
  if (acorn && game.stun <= 0) {
    if (w === 'staple') { if (game.reloadT > 0 || game.ammo <= 0) { sfx('buzz'); return; } game.ammo -= 1; if (game.ammo === 0) reload(); }
    const q = acornPos(acorn); game.acorns.splice(game.acorns.indexOf(acorn), 1); add(25, q, 'SWAT!'); burst(q.x, q.y, ['#8A5A2B', '#C98B4A'], 10); sfx('clack');
    return;
  }
  if (game.stun > 0) { sfx('buzz'); return; }
  const wind = game.twist?.kind === 'gust' ? game.twist.wind : 0;
  if (w === 'staple') {
    if (game.reloadT > 0) { sfx('buzz'); return; }
    if (game.ammo <= 0) { reload(); return; }
    game.ammo -= 1; game.shots += 1;
    const tf = Math.hypot(x - st.x, y - st.y) / 1500;
    game.staples.push({ x0: st.x, y0: st.y, x: x + wind * tf * 3, y, t: 0, tf });
    sfx('clack');
    if (game.ammo === 0) reload();
    return;
  }
  game.shots += 1; spend();
  if (w === 'nail') {   // fast and small
    const tf = Math.hypot(x - st.x, y - st.y) / 2400;
    game.staples.push({ x0: st.x, y0: st.y, x: x + wind * tf * 3 + (Math.random() - 0.5) * 8, y: y + (Math.random() - 0.5) * 8, t: 0, tf, nail: true });
    sfx('click');
  } else if (w === 'shotgun') {
    const a = Math.atan2(y - st.y, x - st.x), d = Math.hypot(x - st.x, y - st.y);
    for (let i = -2; i <= 2; i++) { const b = a + i * 0.11, tf = d / 1500; game.staples.push({ x0: st.x, y0: st.y, x: st.x + Math.cos(b) * d + wind * tf * 3, y: st.y + Math.sin(b) * d, t: 0, tf }); }
    game.shake = Math.max(game.shake, 0.15); sfx('cannon');
  } else if (w === 'bomb') {
    game.bombs.push({ x0: st.x, y0: st.y - 10, x, y, t: 0, tf: 0.6 }); sfx('whistle', { dur: 0.5 });
  } else if (w === 'chain') {
    let best = null, bd = 40;
    game.squirrels.forEach((sq) => { const p = sqPos(sq), d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = sq; } });
    sfx('flash');
    if (!best) { game.bolts.push({ pts: bolt(st.x, st.y, x, y), life: 0.25 }); game.combo = 0; return; }
    chain(best, st, 2, new Set());
  } else if (w === 'chaos') {
    sfx('twist'); game.shake = Math.max(game.shake, 0.2);
    // the fractal: the burst point, then 2, 4, 8 more, each branch 0.62 of the last, splitting ±0.55
    const pts = [], lines = [];
    const branchOut = (px, py, a, len, g) => { pts.push([px, py]); if (g === 3) return;
      for (const d of [-0.55, 0.55]) { const qx = px + Math.cos(a + d) * len, qy = py + Math.sin(a + d) * len; lines.push([px, py, qx, qy]); branchOut(qx, qy, a + d, len * 0.62, g + 1); } };
    branchOut(x, y, Math.atan2(y - st.y, x - st.x), 46, 0);
    lines.unshift([st.x, st.y, x, y]);
    game.bolts.push({ lines, life: 0.4, col: '#3DD6C6' });
    pts.forEach(([px, py], i) => setTimeout(() => hitAt(px, py, 9, true), 40 + i * 12));
  }
}
function reload() { if (game.reloadT > 0 || game.ammo === AMMO) return; game.reloadT = RELOAD_S; sfx('tick'); }
function land(s) { if (!hitAt(s.x, s.y, s.nail ? 4 : 7)) { const onTree = forest.segs.some((sg) => segDist(s.x, s.y, sg) < sg.w / 2 + 3); if (onTree) game.stuck.push({ x: s.x, y: s.y, a: Math.random() * 3, life: 4 }); game.combo = 0; burst(s.x, s.y, ['#E9E4D0', '#9AA7B0'], 6); } }
// Whatever's at (x, y) when a shot arrives: a crate, an acorn, a squirrel (you lead a running one).
function hitAt(x, y, slack, quiet = false) {
  if (!game || game.over) return false;
  const crate = game.crates.find((c) => Math.hypot(c.x - x, c.y - y) < 22);
  if (crate) { openCrate(crate); return true; }
  const acorn = game.acorns.find((a) => { const q = acornPos(a); return Math.hypot(q.x - x, q.y - y) < 24; });
  if (acorn) { const q = acornPos(acorn); game.acorns.splice(game.acorns.indexOf(acorn), 1); add(25, q, 'CRACK!'); burst(q.x, q.y, ['#8A5A2B', '#C98B4A'], 10); sfx('clack'); return true; }
  let best = null, bd = Infinity;
  game.squirrels.forEach((sq) => { const p = sqPos(sq), d = Math.hypot(p.x - x, p.y - y); if (d < RAD[sq.size] + slack && d < bd) { bd = d; best = sq; } });
  if (!best) return false;
  strike(best, quiet); return true;
}
// ⚡ The chain: hit this one, then fork to the two nearest not yet hit, twice more (up to 7).
function chain(sq, from, depth, seen) {
  seen.add(sq); const p = sqPos(sq);
  game.bolts.push({ pts: bolt(from.x, from.y, p.x, p.y), life: 0.3 });
  strike(sq, true);
  if (!depth) return;
  game.squirrels.filter((q) => !seen.has(q)).map((q) => ({ q, d: Math.hypot(sqPos(q).x - p.x, sqPos(q).y - p.y) })).filter((o) => o.d < 130)
    .sort((a, b) => a.d - b.d).slice(0, 2).forEach((o) => chain(o.q, p, depth - 1, seen));
}
// A jagged bolt: midpoint displacement, 4 levels (fractal lightning).
function bolt(x1, y1, x2, y2) {
  let pts = [[x1, y1], [x2, y2]], amp = Math.hypot(x2 - x1, y2 - y1) * 0.25;
  for (let l = 0; l < 4; l++, amp *= 0.5) { const out = [pts[0]]; for (let i = 1; i < pts.length; i++) { const [a, b] = pts[i - 1], [c, d] = pts[i]; out.push([(a + c) / 2 + (Math.random() - 0.5) * amp, (b + d) / 2 + (Math.random() - 0.5) * amp], pts[i]); } pts = out; }
  return pts;
}
// 🧨 A tack bomb goes off: everything within 58 gets tacked, acorns too, and the screen shakes.
function explode(x, y) {
  const R = 58;
  game.fx.push({ kind: 'ring', x, y, r: 6, R, life: 0.45 });
  burst(x, y, ['#FFF4D6', '#FFC857', '#FF8A3D', '#E0453A', '#DDE3E8'], 46);
  comic('KA-BOOM!', x, y - 20, '#FFC857'); game.shake = Math.max(game.shake, 0.5); sfx('boom', { size: 1.3 }); navigator.vibrate?.(90);
  game.acorns = game.acorns.filter((a) => { const q = acornPos(a); if (Math.hypot(q.x - x, q.y - y) < R) { game.score += 25; return false; } return true; });
  game.squirrels.filter((sq) => { const p = sqPos(sq); return Math.hypot(p.x - x, p.y - y) < R + RAD[sq.size]; }).forEach((sq) => strike(sq, true));
  game.crates.filter((c) => Math.hypot(c.x - x, c.y - y) < R).forEach(openCrate);
}
const WORDS = ['KA-CHUNK!', 'THWACK!', 'SHUNK!', 'PINNED!', 'CLICK-CLACK!', 'YOINK!', 'TAGGED!'];
function comic(text, x, y, col = '#FFE08A') { game.fx.push({ kind: 'text', x, y, text, life: 1.1, col, big: true }); }
function strike(best, quiet) {
  if (!game.squirrels.includes(best)) return;
  const p = sqPos(best);
  game.hits += 1;
  if (best.size > 1) {   // 🐿️🐿️ it splits: two smaller ones leap away
    game.squirrels.splice(game.squirrels.indexOf(best), 1);
    for (const d of [-1, 1]) { const kid = { ...best, size: best.size - 1, hop: null, daze: 1.4, angry: 0 }; hopTo(kid, p); kid.hop.x0 = p.x + d * 8; game.squirrels.push(kid); }
    add(20 * best.size, p, best.size === 3 ? 'SPLIT!' : 'SPLAT-TER!'); if (!quiet) sfx('boing'); tufts(p.x, p.y, 10);
    return;
  }
  game.squirrels.splice(game.squirrels.indexOf(best), 1);
  game.combo = game.comboT > 0 ? game.combo + 1 : 1; game.comboT = 1.6;
  const pts = (best.gold ? 1000 : 100) * game.combo;
  add(pts, p, best.gold ? 'JACKPOT!' : WORDS[Math.floor(Math.random() * WORDS.length)]); game.pins.push({ x: p.x, y: p.y, face: best.face, gold: best.gold, t: 0 });
  tufts(p.x, p.y, 8);
  if (game.combo >= 3) { game.hitstop = 0.07; if (game.combo % 5 === 0) comic(`${game.combo}× COMBO!`, W / 2, H * 0.35, '#FF8AD8'); }
  if (!quiet || best.gold) sfx(best.gold ? 'chime' : 'pop');
}
function add(pts, p, word) { game.score += pts; game.fx.push({ kind: 'text', x: p.x, y: p.y - 12, text: word ? `${word} +${pts}` : `+${pts}`, life: 1 }); }
// Fur flying: little curled tufts that tumble down.
function tufts(x, y, n) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, v = 60 + Math.random() * 110; game.fx.push({ kind: 'tuft', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, a: Math.random() * 6, life: 1.1, c: ['#B5703A', '#E9C9A0', '#8A5A2B'][i % 3] }); } }
function segDist(x, y, s) { const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L2 = dx * dx + dy * dy || 1; let t = ((x - s.x1) * dx + (y - s.y1) * dy) / L2; t = Math.max(0, Math.min(1, t)); return Math.hypot(s.x1 + t * dx - x, s.y1 + t * dy - y); }
function burst(x, y, cols, n) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, v = 40 + Math.random() * 120; game.fx.push({ kind: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, c: cols[i % cols.length], life: 0.8, r: 1.5 + Math.random() * 2 }); } }

// ---------------------------------------------------------------- levels: dive into the knothole
function endLevel() {
  game.dive = { t: 0, dur: reduceMotion ? 0.01 : 1.6, phase: 'in' };
  game.squirrels.forEach((sq) => { if (!sq.hop) hopTo(sq); });
  sfx('whistle', { dur: 1.2 });
}
function nextLevel() {
  level += 1; game.speed *= 1.15;
  forest = grow((forest.seed * 16807 + level) >>> 0 || 1, level);
  game.squirrels = []; game.stuck = []; game.pins = []; game.leaves = []; game.twist = null; game.ammo = AMMO; game.reloadT = 0; game.acorns = []; game.crates = []; game.bombs = []; game.bolts = []; game.stun = 0;
  game.dive = { t: 0, dur: reduceMotion ? 0.01 : 1.2, phase: 'out' };
  game.hearts = Math.min(3, game.hearts + 1);   // a breather: one heart back
  banner(`LEVEL ${level}`, 'deeper in: a forest inside the knot · ❤️ +1');
}
async function finish() {
  game.over = true; sfx('fanfare');
  const acc = game.shots ? Math.round((100 * game.hits) / game.shots) : 0;
  showOver(`<h2>🐿️ ${game.score.toLocaleString()} points</h2><p class="muted">${game.hits} hits from ${game.shots} staples (${acc}%) · chaos reached r = ${game.curve.r.toFixed(2)}</p><p class="muted small">Saving…</p>`, true);
  const { data, error } = await sb.rpc('solo_submit', { p_game: 'squirrel', p_score: game.score, p_level: level });
  const board = data?.top?.length ? `<ol class="board">${data.top.map((r, i) => `<li class="${r.player === me.id ? 'me' : ''}"><span>${i + 1}. ${esc(r.name)}</span><b>${r.score.toLocaleString()}</b></li>`).join('')}</ol>` : '';
  showOver(`${game.ko ? '<h2 style="color:#FF7A6E">💫 KNOCKED OUT</h2><p class="muted small">Too many acorns to the head.</p>' : ''}<h2>🐿️ ${game.score.toLocaleString()} points</h2>${data?.record ? '<p style="color:var(--gold);font-weight:900">🏆 Your new best!</p>' : data ? `<p class="muted">Your best: ${data.best.toLocaleString()}</p>` : ''}
    <p class="muted small">${game.hits} hits from ${game.shots} staples (${acc}%) · chaos reached r = ${game.curve.r.toFixed(2)}</p>
    ${error ? `<p class="small" style="color:#FF9A7A">Couldn't save: ${esc(error.message || '')}</p>` : ''}${board}
    <button class="go" id="again">Play again</button>`, true);
}

// ---------------------------------------------------------------- the loop
let last = 0;
function loop(t) {
  const dt = Math.min(0.05, last ? (t - last) / 1000 : 0); last = t;
  if (game && !game.over) update(dt);
  draw(t);
  requestAnimationFrame(loop);
}
function update(dt) {
  const g = game;
  if (g.dive) {
    g.dive.t += dt;
    if (g.dive.t >= g.dive.dur) {
      if (g.dive.phase === 'in') { if (level >= LEVELS) { g.dive = null; finish(); return; } nextLevel(); }
      else g.dive = null;
    }
    return;
  }
  if (g.hitstop > 0) { g.hitstop -= dt; return; }   // a beat of freeze on a big combo
  g.time += dt;
  if (g.time >= level * LEVEL_S) return endLevel();
  if (g.stun > 0) g.stun -= dt;
  if (g.shake > 0) g.shake = Math.max(0, g.shake - dt);
  // 🔩 hold to fire (the nail gun)
  if (hold && g.weapon === 'nail' && (g.nailT = (g.nailT || 0) - dt) <= 0) { g.nailT = 0.09; fire(hold.x, hold.y); }
  g.crateT -= dt * (1 + g.curve.x); if (g.crateT <= 0) { g.crateT = 7 + Math.random() * 5; dropCrate(); }
  g.crates.forEach((c) => { if (c.y < forest.ground - 16) c.y += 55 * dt; else c.life -= dt; c.sway += dt; });
  g.crates = g.crates.filter((c) => c.life > 0);
  g.acorns.forEach((a) => { a.t += dt; a.spin += dt * 9; });
  g.acorns = g.acorns.filter((a) => { if (a.t >= a.tf) { bonk(); return false; } return true; });
  if (g.over) return;
  g.bombs = g.bombs.filter((b) => { b.t += dt; if (b.t >= b.tf) { explode(b.x, b.y); return false; } return true; });
  g.bolts.forEach((b) => { b.life -= dt; }); g.bolts = g.bolts.filter((b) => b.life > 0);
  g.squirrels.forEach((sq) => { if (sq.daze > 0) sq.daze -= dt; if (sq.angry > 0) sq.angry -= dt; });
  g.stepT += dt; while (g.stepT >= 1.2) { g.stepT -= 1.2; chaosStep(); }
  if (g.twist && g.time > g.twist.until) g.twist = null;
  if (g.reloadT > 0) { g.reloadT -= dt; if (g.reloadT <= 0) { g.reloadT = 0; g.ammo = AMMO; } }
  if (g.comboT > 0) g.comboT -= dt;
  g.squirrels.forEach((sq) => moveSquirrel(sq, sq.daze > 0 ? dt * 0.35 : dt));
  g.staples = g.staples.filter((s) => { s.t += dt; if (s.t >= s.tf) { land(s); return false; } return true; });
  g.pins.forEach((p) => { p.t += dt; }); g.pins = g.pins.filter((p) => { if (p.t > 0.9) { burst(p.x, p.y, p.gold ? ['#F5C542', '#FFF3C4'] : ['#C98B4A', '#8A5A2B', '#F2E3C0'], 16); return false; } return true; });
  g.stuck.forEach((s) => { s.life -= dt; }); g.stuck = g.stuck.filter((s) => s.life > 0);
  g.fx.forEach((f) => { f.life -= dt; if (f.kind === 'dot' || f.kind === 'tuft') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += (f.kind === 'tuft' ? 160 : 300) * dt; f.a = (f.a || 0) + dt * 5; } else if (f.kind === 'ring') f.r += (f.R - f.r) * Math.min(1, dt * 14); else f.y -= 30 * dt; });
  g.fx = g.fx.filter((f) => f.life > 0);
  g.leaves.forEach((l) => { l.x += l.vx * dt; l.y += l.vy * dt; l.a += dt * 3; if (l.y > H + 10) { l.y = -10; l.x = Math.random() * W; } });
  if (g.twist?.kind !== 'leaves') g.leaves = g.leaves.filter((l) => l.y > 0 && l.y < H);
  hud();
}

// ---------------------------------------------------------------- drawing
function draw(t) {
  if (!forest) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // The dive: into the knot (zooming in, the forest around it fading) or out of the new one's knot.
  let z = 1, fx = W / 2, fy = H / 2, fade = 0;
  if (game?.dive) {
    const e = Math.min(1, game.dive.t / game.dive.dur), s = e * e * (3 - 2 * e);
    if (game.dive.phase === 'in') { z = Math.pow(26, s); fx = forest.knot.x; fy = forest.knot.y; fade = s; }
    else { z = 0.04 + 0.96 * s; fade = 1 - s; }   // the new forest grows out of a dot: the knot's inside
  }
  const sky = ctx.createLinearGradient(0, 0, 0, cv.height);
  sky.addColorStop(0, `hsl(${forest.hue + 190} 40% 18%)`); sky.addColorStop(0.6, `hsl(${forest.hue} 55% 28%)`); sky.addColorStop(1, '#2A1C10');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, cv.width, cv.height);
  const sh = game && !reduceMotion ? (game.shake || 0) * 14 : 0, sx = (Math.random() - 0.5) * sh, sy = (Math.random() - 0.5) * sh;
  ctx.setTransform(k * z, 0, 0, k * z, (W / 2) * k - fx * k * z + sx * k, (H / 2) * k - fy * k * z + sy * k);
  drawForest(t);
  if (game) {
    game.stuck.forEach((s) => drawStaple(s.x, s.y, s.a, Math.min(1, s.life)));
    game.crates.forEach((c) => drawCrate(c, t));
    game.squirrels.forEach((sq) => { const p = sqPos(sq); drawSquirrel(p.x, p.y, sq.size, sq.face, sq.gold, t / 120 + sq.wig, false, sq.angry > 0);
      if (sq.daze > 0) { ctx.fillStyle = '#FFE08A'; ctx.font = '10px system-ui'; ctx.textAlign = 'center'; for (let i = 0; i < 3; i++) { const a = t / 180 + i * 2.1; ctx.fillText('✦', p.x + Math.cos(a) * RAD[sq.size], p.y - RAD[sq.size] - 4 + Math.sin(a) * 3); } } });
    game.acorns.forEach((a) => drawAcorn(acornPos(a), a.spin));
    game.bombs.forEach((b) => { const e = b.t / b.tf, x = b.x0 + (b.x - b.x0) * e, y = b.y0 + (b.y - b.y0) * e - Math.sin(e * Math.PI) * 90; ctx.font = '20px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🧨', x, y); ctx.textBaseline = 'alphabetic'; });
    game.bolts.forEach((b) => { ctx.save(); ctx.globalAlpha = Math.min(1, b.life * 4); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const col = b.col || '#9BE7FF', path = () => { ctx.beginPath(); if (b.pts) b.pts.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y)); else b.lines.forEach(([a, c, d, e]) => { ctx.moveTo(a, c); ctx.lineTo(d, e); }); };
      ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 12; ctx.lineWidth = 4; path(); ctx.stroke(); ctx.shadowBlur = 0; ctx.strokeStyle = '#FFF'; ctx.lineWidth = 1.5; path(); ctx.stroke(); ctx.restore(); });
    game.pins.forEach((p) => { drawSquirrel(p.x, p.y, 1, p.face, p.gold, t / 40, true); drawStaple(p.x - p.face * 8, p.y + 4, 0.3, 1); });
    game.staples.forEach((s) => { const e = s.t / s.tf; drawStaple(s.x0 + (s.x - s.x0) * e, s.y0 + (s.y - s.y0) * e, 0, 1); });
    game.fx.forEach((f) => {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.5));
      if (f.kind === 'dot') { ctx.fillStyle = f.c; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill(); }
      else if (f.kind === 'tuft') { ctx.strokeStyle = f.c; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(f.x, f.y, 4, f.a, f.a + 2.4); ctx.stroke(); }
      else if (f.kind === 'ring') { ctx.strokeStyle = '#FFC857'; ctx.lineWidth = 6 * f.life * 2; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.stroke(); ctx.fillStyle = '#FF8A3D44'; ctx.fill(); }
      else { ctx.font = f.big ? '400 22px Bungee, Impact, sans-serif' : '900 15px Nunito, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = f.col || '#FFE08A'; ctx.strokeStyle = '#3A1D00'; ctx.lineWidth = f.big ? 5 : 3; ctx.strokeText(f.text, f.x, f.y); ctx.fillText(f.text, f.x, f.y); }
    });
    ctx.globalAlpha = 1;
    game.leaves.forEach((l) => { ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.a); ctx.fillStyle = '#D9822B'; ctx.beginPath(); ctx.ellipse(0, 0, l.r, l.r * 0.55, 0, 0, 7); ctx.fill(); ctx.restore(); });
    if (game.twist?.kind === 'gust') { ctx.strokeStyle = '#ffffff44'; ctx.lineWidth = 2; for (let i = 0; i < 12; i++) { const y = (i * 57) % H, x = ((t / 4) * Math.sign(game.twist.wind) + i * 97) % (W + 60); ctx.beginPath(); ctx.moveTo(x - 30, y); ctx.lineTo(x, y); ctx.stroke(); } }
    drawStapler();
  }
  if (fade > 0) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = `rgba(20,12,6,${fade * 0.9})`; ctx.fillRect(0, 0, cv.width, cv.height); }
}
function drawForest(t) {
  const f = forest;
  ctx.fillStyle = '#3B2A16'; ctx.fillRect(-W, f.ground, W * 3, H);   // the forest floor
  ctx.fillStyle = '#4E3A1E'; for (let i = 0; i < 26; i++) { ctx.beginPath(); ctx.ellipse((i * 67) % W, f.ground + 4 + (i % 3) * 6, 14, 3, 0, 0, 7); ctx.fill(); }
  ctx.lineCap = 'round';
  f.segs.forEach((s) => { ctx.strokeStyle = s.d < 2 ? '#5A3B1F' : '#6B4726'; ctx.lineWidth = s.w; ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke(); });
  // leaves at every tip: little clusters that sway
  f.tips.forEach((s, i) => {
    const sway = reduceMotion ? 0 : Math.sin(t / 900 + i) * 2;
    for (let j = 0; j < 3; j++) { ctx.fillStyle = `hsl(${f.hue + j * 8 + (i % 3) * 5} 70% ${38 + j * 7}%)`; ctx.beginPath(); ctx.arc(s.x2 + sway + (j - 1) * 5, s.y2 - j * 3, 9 - j * 2, 0, 7); ctx.fill(); }
  });
  // the knothole in the middle trunk: where the next forest is
  const kn = f.knot; ctx.fillStyle = '#1B1109'; ctx.beginPath(); ctx.ellipse(kn.x, kn.y, 6, 9, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = '#8A6238'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(kn.x, kn.y, 7.5, 10.5, 0, 0, 7); ctx.stroke();
}
// A cartoon squirrel: body, head, a bushy curled tail (a spiral), sized 1-3. Pinned: flailing, 📎.
function drawCrate(c, t) {
  const sw = Math.sin(c.sway * 2) * (c.y < forest.ground - 16 ? 6 : 0), blink = c.life < 3 && Math.sin(t / 80) > 0;
  ctx.save(); ctx.translate(c.x + sw, c.y); if (blink) ctx.globalAlpha = 0.5;
  if (c.y < forest.ground - 16) { ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-10, -8); ctx.lineTo(-16, -30); ctx.moveTo(10, -8); ctx.lineTo(16, -30); ctx.stroke();
    ctx.fillStyle = '#E4572E'; ctx.beginPath(); ctx.arc(0, -30, 18, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#FFF'; ctx.beginPath(); ctx.arc(0, -30, 18, Math.PI * 1.35, Math.PI * 1.65); ctx.lineTo(0, -30); ctx.fill(); }
  ctx.fillStyle = '#A06A35'; ctx.fillRect(-11, -9, 22, 18); ctx.strokeStyle = '#6B4423'; ctx.lineWidth = 2; ctx.strokeRect(-11, -9, 22, 18);
  ctx.beginPath(); ctx.moveTo(-11, -9); ctx.lineTo(11, 9); ctx.moveTo(11, -9); ctx.lineTo(-11, 9); ctx.stroke();
  ctx.font = '12px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(WEAPONS[c.w].icon, 0, -18 + (c.y < forest.ground - 16 ? 36 : 0)); ctx.textBaseline = 'alphabetic';
  ctx.restore();
}
function drawAcorn(p, spin) {
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(spin);
  ctx.fillStyle = '#A0632F'; ctx.beginPath(); ctx.ellipse(0, 2, 4.5, 5.5, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#5A3B1F'; ctx.beginPath(); ctx.ellipse(0, -2.5, 5.5, 3, 0, 0, 7); ctx.fill(); ctx.fillRect(-0.8, -7, 1.6, 3);
  ctx.restore();
}
function drawSquirrel(x, y, size, face, gold, ph, pinned, angry = false) {
  const s = RAD[size] / 10;
  ctx.save(); ctx.translate(x, y); ctx.scale(face * s, s);
  if (pinned) ctx.rotate(Math.sin(ph) * 0.35);
  const fur = gold ? '#F5C542' : '#B5703A', light = gold ? '#FFF1B8' : '#E9C9A0';
  // tail: a curl of shrinking arcs
  ctx.fillStyle = fur; for (let i = 0; i < 6; i++) { const a = -0.6 - i * 0.55, r = 7 - i * 0.8; ctx.beginPath(); ctx.arc(-9 + Math.cos(a) * (4 + i), -6 + Math.sin(a) * (4 + i) - i, r, 0, 7); ctx.fill(); }
  ctx.fillStyle = fur; ctx.beginPath(); ctx.ellipse(0, 0, 8, 6, 0, 0, 7); ctx.fill();   // body
  ctx.fillStyle = light; ctx.beginPath(); ctx.ellipse(2, 2, 4, 3.5, 0, 0, 7); ctx.fill();
  ctx.fillStyle = fur; ctx.beginPath(); ctx.arc(7, -5, 4.6, 0, 7); ctx.fill();            // head
  ctx.beginPath(); ctx.moveTo(5, -9); ctx.lineTo(6.5, -12.5); ctx.lineTo(8, -8.5); ctx.fill();   // ear
  ctx.fillStyle = '#1B1109';
  if (pinned) { ctx.strokeStyle = '#1B1109'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(7.5, -7); ctx.lineTo(9.5, -5); ctx.moveTo(9.5, -7); ctx.lineTo(7.5, -5); ctx.stroke(); }
  else if (angry) { ctx.fillStyle = '#E0453A'; ctx.beginPath(); ctx.arc(8.6, -6, 1.5, 0, 7); ctx.fill(); ctx.strokeStyle = '#1B1109'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(6.5, -8.8); ctx.lineTo(10.4, -7.4); ctx.stroke(); ctx.fillStyle = '#1B1109'; }
  else { ctx.beginPath(); ctx.arc(8.6, -6, 1.1, 0, 7); ctx.fill(); }
  ctx.beginPath(); ctx.arc(11.4, -4.6, 0.9, 0, 7); ctx.fill();                                 // nose
  if (gold && !pinned) { ctx.fillStyle = '#FFF'; ctx.globalAlpha = 0.6 + 0.4 * Math.sin(ph * 3); ctx.beginPath(); ctx.arc(-2, -9, 1.5, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
  ctx.restore();
}
function drawStaple(x, y, a, alpha) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(a);
  ctx.strokeStyle = '#DDE3E8'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-5, 3); ctx.lineTo(-5, -2); ctx.lineTo(5, -2); ctx.lineTo(5, 3); ctx.stroke();
  ctx.restore(); ctx.globalAlpha = 1;
}
function drawStapler() {
  const st = STAPLER(), g = game;
  ctx.save(); ctx.translate(st.x, st.y); if (g.stun > 0) ctx.rotate(Math.sin(g.stun * 40) * 0.12);
  if (g.weapon !== 'staple') { ctx.font = '18px serif'; ctx.textAlign = 'center'; ctx.fillText(WEAPONS[g.weapon].icon, 0, -26); }
  ctx.fillStyle = '#C0392B'; ctx.beginPath(); ctx.roundRect(-30, -14, 60, 12, 5); ctx.fill();
  ctx.fillStyle = '#2B2B33'; ctx.beginPath(); ctx.roundRect(-32, -3, 64, 8, 4); ctx.fill();
  ctx.fillStyle = '#E74C3C'; ctx.beginPath(); ctx.roundRect(-26, -18, 50, 6, 3); ctx.fill();
  // staples left, as little ticks; a reload bar while it refills
  for (let i = 0; i < AMMO; i++) { ctx.fillStyle = i < g.ammo && !g.reloadT ? '#F2F4F6' : '#ffffff22'; ctx.fillRect(-27 + i * 4.6, -12, 3, 7); }
  if (g.reloadT > 0) { ctx.fillStyle = '#F5C542'; ctx.fillRect(-30, -24, 60 * (1 - g.reloadT / RELOAD_S), 3); }
  ctx.restore();
}

// ---------------------------------------------------------------- HUD, banners, panels
const meter = $('meter'), mc = meter.getContext('2d');
function hud() {
  const g = game;
  $('score').textContent = g.score.toLocaleString();
  const hearts = '❤️'.repeat(Math.max(0, g.hearts)) + '🖤'.repeat(Math.max(0, 3 - g.hearts)); if ($('hearts').textContent !== hearts) $('hearts').textContent = hearts;
  $('combo').textContent = g.combo > 1 && g.comboT > 0 ? `COMBO ×${g.combo}` : '';
  $('lvl').textContent = `Level ${level} of ${LEVELS} · ${Math.max(0, Math.ceil(level * LEVEL_S - g.time))}s`;
  $('phase').textContent = `${phaseOf(g.curve.r)} · r ${g.curve.r.toFixed(2)}`;
  const hs = g.curve.hist, w = meter.width, h = meter.height;
  mc.clearRect(0, 0, w, h);
  mc.strokeStyle = '#FF5A4A99'; mc.setLineDash([5, 5]); mc.lineWidth = 2; mc.beginPath(); mc.moveTo(0, h - 0.93 * h); mc.lineTo(w, h - 0.93 * h); mc.stroke(); mc.setLineDash([]);
  mc.strokeStyle = g.curve.r >= 3.5699 ? '#FF8A3D' : '#3DD6C6'; mc.lineWidth = 3; mc.beginPath();
  hs.forEach((v, i) => mc[i ? 'lineTo' : 'moveTo']((i / 23) * (w - 8) + 4, h - 4 - v * (h - 8))); mc.stroke();
}
let bannerT = null;
function banner(title, sub) {
  const b = $('banner'); b.innerHTML = `${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}`; b.hidden = false;
  b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
  clearTimeout(bannerT); bannerT = setTimeout(() => { b.hidden = true; }, 1700);
}
function showOver(html, withAgain) {
  $('overCard').innerHTML = html; $('over').hidden = false;
  const again = $('again'); if (again) again.onclick = start;
}
function start() { $('over').hidden = true; newGame(); sfx('click'); }
// The weapon bar: the stapler and whatever you've picked up, with rounds left. Tap to load.
function renderBar() {
  const bar = $('wbar'); if (!game) { bar.innerHTML = ''; return; }
  bar.innerHTML = Object.entries(WEAPONS).filter(([k]) => k === 'staple' || game.arsenal[k]).map(([k, w]) =>
    `<button type="button" data-w="${k}" class="${game.weapon === k ? 'on' : ''}" aria-label="${w.name}${k === 'staple' ? '' : `, ${game.arsenal[k]} left`}">${w.icon}${k === 'staple' ? '' : `<b>${game.arsenal[k]}</b>`}</button>`).join('');
  bar.querySelectorAll('[data-w]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); game.weapon = b.dataset.w; renderBar(); sfx('click'); }; });
}

// ---------------------------------------------------------------- input
function toWorld(e) { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; }
let hold = null;   // a finger held down (the nail gun fires while it's there)
cv.addEventListener('pointerdown', (e) => { e.preventDefault(); const p = toWorld(e); hold = p; if (game) game.nailT = 0.09; fire(p.x, p.y); });
cv.addEventListener('pointermove', (e) => { if (hold) hold = toWorld(e); });
['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => cv.addEventListener(ev, () => { hold = null; }));
addEventListener('keydown', (e) => { if ((e.key === 'r' || e.key === 'R') && game && !game.over) reload(); });

window.__sq = () => game && ({ score: game.score, level, hearts: game.hearts, weapon: game.weapon, arsenal: { ...game.arsenal }, crates: game.crates.map((c) => ({ x: c.x, y: c.y, w: c.w })), acorns: game.acorns.map(acornPos), ammo: game.ammo, dive: !!game.dive, over: game.over, r: game.curve.r,
  squirrels: game.squirrels.map((sq) => ({ ...sqPos(sq), size: sq.size, hop: !!sq.hop })), W, H });   // for tests: read-only
// ---------------------------------------------------------------- start
(async () => {
  if (!(await signedIn())) return;
  setGameTools({ fs: '#play' });
  size(); addEventListener('resize', size);
  new MutationObserver(() => requestAnimationFrame(size)).observe($('play'), { attributes: true, attributeFilter: ['class'] });
  forest = grow(12345, 1);
  const { data: top } = await sb.from('solo_scores').select('player, score').eq('game', 'squirrel').order('score', { ascending: false }).limit(40);
  const best = {}; (top || []).forEach((r) => { if (!(r.player in best)) best[r.player] = r.score; });
  const board = Object.entries(best).slice(0, 5);
  showOver(`<h2>🐿️ Squirrel Chaos</h2>
    <p>Tap to fire the stapler. Staple a big squirrel and it <b>splits in two</b>; only the littlest ones get pinned, and score (more for a quick combo).</p>
    <p class="muted small">They come to the beat of the chaos curve, x → r·x·(1−x): calm, then a rhythm, then chaos, with twists at its peaks and a ✨ golden squirrel when x nearly touches 1. Three levels, each deeper inside the last tree's knothole. Tap the stapler (or R) to reload.</p>
    ${board.length ? `<ol class="board">${board.map(([p, s], i) => `<li class="${p === me.id ? 'me' : ''}"><span>${i + 1}. ${esc(names[p] ?? '?')}</span><b>${s.toLocaleString()}</b></li>`).join('')}</ol>` : ''}
    <p class="muted small">📦 Shoot the crates for a 🔩 nail gun, 💥 shotgun, 🧨 tack bombs, ⚡ a chain stapler or the 🌀 chaos cannon. And watch out: angry squirrels throw acorns. Shoot them down, or three bonks and you're out.</p>
    <button class="go" id="again">Start 🐿️</button>`, true);
  requestAnimationFrame(loop);
})();
