// 🐿️ Squirrel Chaos, as an organ of the shell (shell.js). Squirrels race along the branches of fractal
// trees; tap to fire the stapler. A big squirrel splits in two when you staple it (and a middle one
// splits again): only the littlest get pinned, and score. The box's beats decide how many come (and the
// window sends threes), the mirror drops a crate, the balance reloads and heals, the golden cut stops
// them all for a moment, a Fibonacci beat may drop a crate, a golden beat sends a golden squirrel.
// Each day ends by diving into the knothole of the middle tree, into a deeper, darker forest: the
// pinned ones stay, eyes open in the trees, the picture tears, and on day 4 the knothole wakes.
import { fibMult } from '../chaos.js';

const W = 400, LEVELS = 4, LEVEL_S = 30, AMMO = 12, RELOAD_S = 1.1, MAX_SQ = 16;
const dark = () => Math.min(1, (level - 1) / 3);   // 0 on day 1, 1 on day 4
const WHISPERS = ['they remember', 'the stapler was never yours', 'it counts them too', 'do not look at the knot', 'one more day',
  'the little ones do not split. they multiply', 'you are inside the knot already', 'it likes the sound', 'the trees grew around something',
  'every staple is a promise', 'they are not running from you', 'r → 4. then what', 'it has your face', 'keep going. it wants you to'];
const rng = (seed) => { let x = (seed >>> 0) || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; };
const RAD = [0, 10, 15, 21];
const WEAPONS = {
  staple: { icon: '📎', name: 'Stapler' },
  nail: { icon: '🔩', name: 'Nail Gun', ammo: 40, desc: 'hold to fire full auto' },
  shotgun: { icon: '💥', name: 'Staple Shotgun', ammo: 8, desc: 'five staples in a spread' },
  bomb: { icon: '🧨', name: 'Tack Bomb', ammo: 4, desc: 'lob it: everything nearby gets tacked' },
  chain: { icon: '⚡', name: 'Chain Stapler', ammo: 6, desc: 'the bolt forks from squirrel to squirrel' },
  chaos: { icon: '🌀', name: 'Chaos Cannon', ammo: 3, desc: 'one shot bursts into a fractal of 15' },
};
const CRATE_ODDS = [['nail', 0.26], ['shotgun', 0.24], ['bomb', 0.2], ['chain', 0.18], ['chaos', 0.12]];
const TWISTS = [
  ['🌪️ GUST', 'staples drift in the wind', 'gust'],
  ['🐿️ STAMPEDE', 'here come the little ones', 'stampede'],
  ['⚡ FRENZY', 'squirrels at double speed', 'frenzy'],
  ['🍂 LEAF STORM', 'can you see them?', 'leaves'],
];
const DARK_TWISTS = [   // from day 2 on, and more likely the darker it gets
  ['👁️ THEY STARE', 'do not move', 'stare'],
  ['🌑 BLACKOUT', 'only their eyes', 'blackout'],
  ['📻 STATIC', 'the picture tears', 'static'],
];
const WORDS = ['KA-CHUNK!', 'THWACK!', 'SHUNK!', 'PINNED!', 'CLICK-CLACK!', 'YOINK!', 'TAGGED!'];

let host, ctx, S, sfx, forest = null, game = null, level = 1, hold = null, bar = null;
const H = () => host.H;
const STAPLER = () => ({ x: W / 2, y: H() - 14 });

// ---------------------------------------------------------------- the fractal forest
// Three trees, each a trunk that forks and forks again (2, now and then 3 ways, each branch 0.618 as
// long: the golden ratio). Every branch is a segment the squirrels run along; a branch knows its parent
// and its children, so they climb up and down the tree like a graph.
function grow(seed, lvl) {
  const r = rng(seed * 2654435761), segs = [], ground = H() - 30, depth = 4 + Math.min(2, lvl);
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
        add(x2, y2, a + f * spread + (r() - 0.5) * 0.25, len * (0.58 + r() * 0.08), Math.max(2, w * 0.618), d + 1, s);
      }
    }
    return s;
  };
  const trunks = [];
  for (let t = 0; t < 3; t++) {
    const x = W * (t + 0.5) / 3 + (r() - 0.5) * 40;
    trunks.push(add(x, ground, -Math.PI / 2 + (r() - 0.5) * 0.12, (H() - 110) * (0.26 + r() * 0.06), 15, 0, null));
  }
  const tips = segs.filter((s) => !s.kids.length);
  const mid = trunks[1];
  const knot = { x: mid.x1 + (mid.x2 - mid.x1) * 0.55, y: mid.y1 + (mid.y2 - mid.y1) * 0.55 };
  const eyes = []; for (let i = 0; i < (lvl - 1) * 7; i++) eyes.push({ x: 20 + r() * (W - 40), y: 80 + r() * (ground - 160), ph: r() * 6.28, rate: 0.6 + r() * 0.8, gap: 5 + r() * 3 });
  return { seed, H: H(), ground, segs, trunks, tips, knot, eyes, hue: [34, 28, 22, 16][Math.min(3, lvl - 1)] };
}
const posOn = (s, t) => ({ x: s.x1 + (s.x2 - s.x1) * t, y: s.y1 + (s.y2 - s.y1) * t });

// ---------------------------------------------------------------- state
function newGame() {
  level = 1;
  forest = grow((Date.now() & 0xffffff) | 1, level);
  game = { ammo: AMMO, reloadT: 0, time: 0, squirrels: [], staples: [], pins: [], fx: [], stuck: [], leaves: [],
    twist: null, speed: 1, dive: null, hits: 0, shots: 0, weapon: 'staple', arsenal: {}, stun: 0, shake: 0, hitstop: 0, acorns: [], crates: [], crateT: 5, bombs: [], bolts: [],
    kept: [], whisperT: 9, glitch: 0, eye: { open: 0, blink: 0, blinkT: 4 }, stare: 0, ko: false };
}
function onBeat(ev) {
  const g = game, c = S.curve;
  if (g.dive) return;
  const n = ev.window ? 3 : ev.x > 0.8 ? 3 : ev.x > 0.6 ? 2 : ev.x > 0.35 ? 1 : 0;
  for (let i = 0; i < n; i++) spawn(ev.window ? 1 : undefined);
  // 😠 They fight back: the wilder the curve, the more acorns come flying at your stapler.
  if (ev.x > 0.55 && !ev.window && g.acorns.length < 2 && Math.random() < 0.1 + 0.07 * level + (c.r >= 3.5699 ? 0.08 : 0)) throwAcorn();
  // ✨ Symmetry in chaos: the mirror drops a crate and pays; the balance reloads and heals.
  if (ev.mirror) { dropCrate(); add(250, { x: W / 2, y: H() * 0.42 }, '✨ SYMMETRY'); sfx('chime'); }
  if (ev.balance) { g.ammo = AMMO; g.reloadT = 0; host.heal(1); sfx('chime'); }
  // 🌻 Fibonacci: a golden-cut beat stops every squirrel for a moment (+161); a Fibonacci beat may drop a crate.
  if (ev.golden) { g.squirrels.forEach((sq) => { sq.daze = Math.max(sq.daze || 0, 1.6); }); add(161, { x: W / 2, y: H() * 0.5 }, '🌻 φ'); sfx('chime', { hi: true }); }
  if (ev.fib && Math.random() < 0.5) dropCrate();
  if (ev.gold) spawn(1, true);            // ✨ a golden one when x all but touches 1
  else if (ev.big && !g.twist) twist();
}
function twist() {
  const pool = Math.random() < dark() * 0.8 ? DARK_TWISTS : TWISTS;
  const [title, sub, kind] = pool[Math.floor(Math.random() * pool.length)];
  game.twist = { kind, until: game.time + 6, wind: (Math.random() < 0.5 ? -1 : 1) * 70 };
  host.banner(title, sub); sfx(pool === DARK_TWISTS ? 'gasp' : 'twist');
  if (kind === 'stare') { game.stare = 1.6; game.squirrels.forEach((sq) => { sq.angry = 8; }); }
  if (kind === 'static') game.glitch = 6;
  if (kind === 'stampede') for (let i = 0; i < 6; i++) spawn(1);
  dropCrate();   // every twist drops a crate too
  if (kind === 'leaves') for (let i = 0; i < 60; i++) game.leaves.push({ x: Math.random() * W, y: -Math.random() * H(), vx: 20 + Math.random() * 40, vy: 40 + Math.random() * 50, r: 5 + Math.random() * 7, a: Math.random() * 6 });
}

// ---------------------------------------------------------------- squirrels
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
  if (game.stare > 0) return;   // 👁️ frozen, every eye on you
  if (sq.hop) { sq.hop.t += dt; if (sq.hop.t >= sq.hop.dur) sq.hop = null; return; }
  const len = Math.hypot(sq.seg.x2 - sq.seg.x1, sq.seg.y2 - sq.seg.y1) || 1;
  const frenzy = game.twist?.kind === 'frenzy' || game.twist?.kind === 'stare' ? 2 : 1;   // after the stare, they come
  sq.t += (sq.dir * sq.spd * game.speed * frenzy * dt) / len;
  if (sq.t >= 1) {   // top of this branch: on up a child, or back down
    if (sq.seg.kids.length && Math.random() < 0.85) { sq.seg = sq.seg.kids[Math.floor(Math.random() * sq.seg.kids.length)]; sq.t = 0; }
    else { sq.t = 1; sq.dir = -1; }
  } else if (sq.t <= 0) {
    if (sq.seg.parent && Math.random() < 0.7) { sq.seg = sq.seg.parent; sq.t = 1; }
    else { sq.t = 0; sq.dir = 1; }
  }
  sq.face = sq.dir * Math.sign(sq.seg.x2 - sq.seg.x1 || 1);
  if (Math.random() < dt * (0.15 + S.curve.x * 0.35)) hopTo(sq);   // now and then (more in chaos) a leap to a branch nearby
}
function hopTo(sq, from) {
  const p = from || sqPos(sq);
  const near = forest.segs.filter((s) => { const q = posOn(s, 0.5); return Math.hypot(q.x - p.x, q.y - p.y) < 140; });
  const to = near[Math.floor(Math.random() * near.length)] || forest.segs[Math.floor(Math.random() * forest.segs.length)];
  sq.seg = to; sq.t = 0.2 + Math.random() * 0.6; sq.dir = Math.random() < 0.5 ? 1 : -1;
  sq.hop = { x0: p.x, y0: p.y, t: 0, dur: 0.45 };
}

// ---------------------------------------------------------------- the arsenal
function dropCrate() {
  if (game.crates.length >= 2) return;
  let r = Math.random(), w = 'nail'; for (const [k, p] of CRATE_ODDS) { if ((r -= p) < 0) { w = k; break; } }
  game.crates.push({ x: 40 + Math.random() * (W - 80), y: -30, w, life: 9, sway: Math.random() * 6 });
}
function openCrate(c) {
  game.crates.splice(game.crates.indexOf(c), 1);
  game.arsenal[c.w] = (game.arsenal[c.w] || 0) + WEAPONS[c.w].ammo; game.weapon = c.w;
  host.banner(`${WEAPONS[c.w].icon} ${WEAPONS[c.w].name.toUpperCase()}`, WEAPONS[c.w].desc); sfx('chime'); renderBar();
  burst(c.x, c.y, ['#C98B4A', '#F5C542', '#FFF'], 18);
}
function spend() {
  const w = game.weapon; if (w === 'staple') return;
  game.arsenal[w] -= 1; if (game.arsenal[w] <= 0) { delete game.arsenal[w]; game.weapon = 'staple'; }
  renderBar();
}
function throwAcorn() {
  const live = game.squirrels.filter((q) => !q.hop); if (!live.length) return;
  const sq = live[Math.floor(Math.random() * live.length)], p = sqPos(sq), st = STAPLER();
  sq.angry = 1.2;
  game.acorns.push({ x0: p.x, y0: p.y, x1: st.x + (Math.random() - 0.5) * 30, y1: st.y - 10, t: 0, tf: 2.2 - Math.min(0.5, level * 0.12), spin: Math.random() * 6 });
}
const acornPos = (a) => { const e = Math.min(1, a.t / a.tf); return { x: a.x0 + (a.x1 - a.x0) * e, y: a.y0 + (a.y1 - a.y0) * e - Math.sin(e * Math.PI) * 70 }; };
function bonk() {
  game.stun = 0.7; game.shake = 0.45;
  const st = STAPLER(); comic('BONK!', st.x, st.y - 40, '#FF6B5A'); sfx('thud'); sfx('buzz', { delay: 0.1 }); navigator.vibrate?.(120);
  burst(st.x, st.y - 16, ['#8A5A2B', '#C98B4A', '#FFE08A'], 20);
  if (host.hurt('bonked')) game.ko = true;
}

// ---------------------------------------------------------------- the stapler
function fire(x, y) {
  if (!game || S.over || game.dive) return;
  const st = STAPLER(), w = game.weapon;
  const target = game.acorns.some((a) => { const q = acornPos(a); return Math.hypot(q.x - x, q.y - y) < 30; }) || game.crates.some((c) => Math.hypot(c.x - x, c.y - y) < 26);
  if (!target && Math.hypot(x - st.x, y - st.y) < 34) return reload();
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
  if (w === 'nail') {
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
    if (!best) { game.bolts.push({ pts: bolt(st.x, st.y, x, y), life: 0.25 }); S.combo = 0; return; }
    chain(best, st, 2, new Set());
  } else if (w === 'chaos') {
    sfx('twist'); game.shake = Math.max(game.shake, 0.2);
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
function land(s) { if (!hitAt(s.x, s.y, s.nail ? 4 : 7)) { const onTree = forest.segs.some((sg) => segDist(s.x, s.y, sg) < sg.w / 2 + 3); if (onTree) game.stuck.push({ x: s.x, y: s.y, a: Math.random() * 3, life: 4 }); S.combo = 0; burst(s.x, s.y, ['#E9E4D0', '#9AA7B0'], 6); } }
function hitAt(x, y, slack, quiet = false) {
  if (!game || S.over) return false;
  const crate = game.crates.find((c) => Math.hypot(c.x - x, c.y - y) < 22);
  if (crate) { openCrate(crate); return true; }
  const acorn = game.acorns.find((a) => { const q = acornPos(a); return Math.hypot(q.x - x, q.y - y) < 24; });
  if (acorn) { const q = acornPos(acorn); game.acorns.splice(game.acorns.indexOf(acorn), 1); add(25, q, 'CRACK!'); burst(q.x, q.y, ['#8A5A2B', '#C98B4A'], 10); sfx('clack'); return true; }
  let best = null, bd = Infinity;
  game.squirrels.forEach((sq) => { const p = sqPos(sq), d = Math.hypot(p.x - x, p.y - y); if (d < RAD[sq.size] + slack && d < bd) { bd = d; best = sq; } });
  if (!best) return false;
  strike(best, quiet); return true;
}
function chain(sq, from, depth, seen) {
  seen.add(sq); const p = sqPos(sq);
  game.bolts.push({ pts: bolt(from.x, from.y, p.x, p.y), life: 0.3 });
  strike(sq, true);
  if (!depth) return;
  game.squirrels.filter((q) => !seen.has(q)).map((q) => ({ q, d: Math.hypot(sqPos(q).x - p.x, sqPos(q).y - p.y) })).filter((o) => o.d < 130)
    .sort((a, b) => a.d - b.d).slice(0, 2).forEach((o) => chain(o.q, p, depth - 1, seen));
}
function bolt(x1, y1, x2, y2) {   // a jagged bolt: midpoint displacement, 4 levels (fractal lightning)
  let pts = [[x1, y1], [x2, y2]], amp = Math.hypot(x2 - x1, y2 - y1) * 0.25;
  for (let l = 0; l < 4; l++, amp *= 0.5) { const out = [pts[0]]; for (let i = 1; i < pts.length; i++) { const [a, b] = pts[i - 1], [c, d] = pts[i]; out.push([(a + c) / 2 + (Math.random() - 0.5) * amp, (b + d) / 2 + (Math.random() - 0.5) * amp], pts[i]); } pts = out; }
  return pts;
}
function explode(x, y) {
  const R = 58;
  game.fx.push({ kind: 'ring', x, y, r: 6, R, life: 0.45 });
  burst(x, y, ['#FFF4D6', '#FFC857', '#FF8A3D', '#E0453A', '#DDE3E8'], 46);
  comic('KA-BOOM!', x, y - 20, '#FFC857'); game.shake = Math.max(game.shake, 0.5); sfx('boom', { size: 1.3 }); navigator.vibrate?.(90);
  game.acorns = game.acorns.filter((a) => { const q = acornPos(a); if (Math.hypot(q.x - x, q.y - y) < R) { host.add(25); return false; } return true; });
  game.squirrels.filter((sq) => { const p = sqPos(sq); return Math.hypot(p.x - x, p.y - y) < R + RAD[sq.size]; }).forEach((sq) => strike(sq, true));
  game.crates.filter((c) => Math.hypot(c.x - x, c.y - y) < R).forEach(openCrate);
}
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
  S.combo = S.comboT > 0 ? S.combo + 1 : 1; S.comboT = 1.6;
  const pts = (best.gold ? 1000 : 100) * fibMult(S.combo);   // 🌻 combos count in Fibonacci: 1, 2, 3, 5, 8, 13…
  add(pts, p, best.gold ? 'JACKPOT!' : WORDS[Math.floor(Math.random() * WORDS.length)]); game.pins.push({ x: p.x, y: p.y, face: best.face, gold: best.gold, t: 0 });
  tufts(p.x, p.y, 8);
  if (S.combo >= 3) { game.hitstop = 0.07; if (S.combo % 5 === 0) comic(`${S.combo}× COMBO · F = ${fibMult(S.combo)}`, W / 2, H() * 0.35, '#FF8AD8'); }
  if (!quiet || best.gold) sfx(best.gold ? 'chime' : 'pop');
}
function add(pts, p, word) { host.add(pts); game.fx.push({ kind: 'text', x: p.x, y: p.y - 12, text: word ? `${word} +${pts}` : `+${pts}`, life: 1 }); }
function tufts(x, y, n) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, v = 60 + Math.random() * 110; game.fx.push({ kind: 'tuft', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, a: Math.random() * 6, life: 1.1, c: ['#B5703A', '#E9C9A0', '#8A5A2B'][i % 3] }); } }
function segDist(x, y, s) { const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L2 = dx * dx + dy * dy || 1; let t = ((x - s.x1) * dx + (y - s.y1) * dy) / L2; t = Math.max(0, Math.min(1, t)); return Math.hypot(s.x1 + t * dx - x, s.y1 + t * dy - y); }
function burst(x, y, cols, n) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, v = 40 + Math.random() * 120; game.fx.push({ kind: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, c: cols[i % cols.length], life: 0.8, r: 1.5 + Math.random() * 2 }); } }

// ---------------------------------------------------------------- days: dive into the knothole
function endLevel() {
  game.dive = { t: 0, dur: host.reduceMotion ? 0.01 : 1.6, phase: 'in' };
  game.squirrels.forEach((sq) => { if (!sq.hop) hopTo(sq); });
  sfx('whistle', { dur: 1.2 });
}
function nextLevel() {
  level += 1; game.speed *= 1.15;
  game.kept = game.kept.map((p) => ({ ...p, x: 20 + Math.random() * (W - 40), y: 90 + Math.random() * (H() - 200) }));   // they came along
  forest = grow((forest.seed * 16807 + level) >>> 0 || 1, level);
  game.squirrels = []; game.stuck = []; game.pins = []; game.leaves = []; game.twist = null; game.ammo = AMMO; game.reloadT = 0; game.acorns = []; game.crates = []; game.bombs = []; game.bolts = []; game.stun = 0;
  game.dive = { t: 0, dur: host.reduceMotion ? 0.01 : 1.2, phase: 'out' };
  host.heal(1);   // a breather: one heart back
  game.eye = { open: 0, blink: 0, blinkT: 4 }; game.glitch = 0; game.stare = 0;
  const sub = ['', 'deeper in · something is watching · ❤️ +1', 'the eyes are open · ❤️ +1', 'IT WAKES'][Math.min(3, level - 1)] || 'it is still awake';
  host.banner(`DAY ${level}`, sub); if (level >= 4) { sfx('stinger'); sfx('heartbeat'); }
}

// ---------------------------------------------------------------- the loop
function update(dt) {
  const g = game;
  if (g.dive) {
    g.dive.t += dt;
    if (g.dive.t >= g.dive.dur) {
      if (g.dive.phase === 'in') { if (level >= LEVELS && !host.morphs) { g.dive = null; host.over('sleeps'); return; } nextLevel(); }   // in a run the forest goes on: it stays awake
      else g.dive = null;
    }
    return;
  }
  if (g.hitstop > 0) { g.hitstop -= dt; return; }   // a beat of freeze on a big combo
  g.time += dt;
  if (g.time >= level * LEVEL_S) return endLevel();
  if (g.stun > 0) g.stun -= dt;
  if (g.shake > 0) g.shake = Math.max(0, g.shake - dt);
  if (g.stare > 0) g.stare -= dt;
  // 🌘 the dark side: whispers, tears in the picture, and the eye in the knot
  g.whisperT -= dt;
  if (g.whisperT <= 0) { g.whisperT = Math.max(3.5, 15 - level * 3.2) + Math.random() * 4; if (level >= 2) { g.fx.push({ kind: 'whisper', x: 40 + Math.random() * (W - 80), y: 120 + Math.random() * (H() - 260), text: WHISPERS[Math.floor(Math.random() * WHISPERS.length)], life: 4.5, tf: 4.5 }); if (level >= 3) sfx('heartbeat'); } }
  if (g.glitch > 0) g.glitch -= dt;
  else if (Math.random() < dt * (0.02 * level + (S.curve.r >= 3.5699 ? 0.04 : 0) + (level >= 4 ? 0.12 : 0))) g.glitch = 0.12 + Math.random() * 0.25;
  if (level >= 4) { g.eye.open = Math.min(1, g.eye.open + dt / 3); g.eye.blinkT -= dt; if (g.eye.blinkT <= 0) { g.eye.blinkT = 3 + Math.random() * 4; g.eye.blink = 0.22; } if (g.eye.blink > 0) g.eye.blink -= dt; }
  g.kept.forEach((p) => { p.tw = Math.max(0, p.tw - dt); if (Math.random() < dt * (0.05 + dark() * 0.4)) p.tw = 0.4; });
  if (hold && g.weapon === 'nail' && (g.nailT = (g.nailT || 0) - dt) <= 0) { g.nailT = 0.09; fire(hold.x, hold.y); }   // 🔩 hold to fire
  g.crateT -= dt * (1 + S.curve.x); if (g.crateT <= 0) { g.crateT = 7 + Math.random() * 5; dropCrate(); }
  g.crates.forEach((c) => { if (c.y < forest.ground - 16) c.y += 55 * dt; else c.life -= dt; c.sway += dt; });
  g.crates = g.crates.filter((c) => c.life > 0);
  g.acorns.forEach((a) => { a.t += dt; a.spin += dt * 9; });
  g.acorns = g.acorns.filter((a) => { if (a.t >= a.tf) { bonk(); return false; } return true; });
  if (S.over) return;
  g.bombs = g.bombs.filter((b) => { b.t += dt; if (b.t >= b.tf) { explode(b.x, b.y); return false; } return true; });
  g.bolts.forEach((b) => { b.life -= dt; }); g.bolts = g.bolts.filter((b) => b.life > 0);
  g.squirrels.forEach((sq) => { if (sq.daze > 0) sq.daze -= dt; if (sq.angry > 0) sq.angry -= dt; });
  if (g.twist && g.time > g.twist.until) g.twist = null;
  if (g.reloadT > 0) { g.reloadT -= dt; if (g.reloadT <= 0) { g.reloadT = 0; g.ammo = AMMO; } }
  g.squirrels.forEach((sq) => moveSquirrel(sq, sq.daze > 0 ? dt * 0.35 : dt));
  g.staples = g.staples.filter((s) => { s.t += dt; if (s.t >= s.tf) { land(s); return false; } return true; });
  g.pins.forEach((p) => { p.t += dt; }); g.pins = g.pins.filter((p) => { if (p.t > 0.9) { burst(p.x, p.y, p.gold ? ['#F5C542', '#FFF3C4'] : ['#C98B4A', '#8A5A2B', '#F2E3C0'], 16); if (!p.gold) { g.kept.push({ x: p.x, y: p.y, face: p.face, tw: 0 }); if (g.kept.length > 40) g.kept.shift(); } return false; } return true; });
  g.stuck.forEach((s) => { s.life -= dt; }); g.stuck = g.stuck.filter((s) => s.life > 0);
  g.fx.forEach((f) => { f.life -= dt; if (f.kind === 'whisper') return; if (f.kind === 'dot' || f.kind === 'tuft') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += (f.kind === 'tuft' ? 160 : 300) * dt; f.a = (f.a || 0) + dt * 5; } else if (f.kind === 'ring') f.r += (f.R - f.r) * Math.min(1, dt * 14); else f.y -= 30 * dt; });
  g.fx = g.fx.filter((f) => f.life > 0);
  g.leaves.forEach((l) => { l.x += l.vx * dt; l.y += l.vy * dt; l.a += dt * 3; if (l.y > H() + 10) { l.y = -10; l.x = Math.random() * W; } });
  if (g.twist?.kind !== 'leaves') g.leaves = g.leaves.filter((l) => l.y > 0 && l.y < H());
}

// ---------------------------------------------------------------- drawing
function draw(t) {
  const cv = host.cv, k = host.k, Hh = H();
  if (!forest) forest = grow(12345, 1);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  let z = 1, fx = W / 2, fy = Hh / 2, fade = 0;
  if (game?.dive) {   // into the knot (zooming in, the forest around it fading) or out of the new one's knot
    const e = Math.min(1, game.dive.t / game.dive.dur), s = e * e * (3 - 2 * e);
    if (game.dive.phase === 'in') { z = Math.pow(26, s); fx = forest.knot.x; fy = forest.knot.y; fade = s; }
    else { z = 0.04 + 0.96 * s; fade = 1 - s; }
  }
  const sky = ctx.createLinearGradient(0, 0, 0, cv.height);
  const d = game ? dark() : 0;
  sky.addColorStop(0, `hsl(${forest.hue + 190 + d * 150} ${40 - d * 25}% ${18 - d * 14}%)`); sky.addColorStop(0.6, `hsl(${forest.hue - d * 20} ${55 - d * 30}% ${28 - d * 20}%)`); sky.addColorStop(1, d > 0.9 ? '#1A0308' : '#2A1C10');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, cv.width, cv.height);
  const sh = game && !host.reduceMotion ? (game.shake || 0) * 14 : 0, sx = (Math.random() - 0.5) * sh, sy = (Math.random() - 0.5) * sh;
  ctx.setTransform(k * z, 0, 0, k * z, (W / 2) * k - fx * k * z + sx * k, (Hh / 2) * k - fy * k * z + sy * k);
  drawForest(t);
  if (game) {
    if (d > 0) { ctx.fillStyle = `rgba(8,2,6,${d * 0.5})`; ctx.fillRect(-W, -Hh, W * 3, Hh * 3); }   // the day drains
    drawEyes(t);
    game.kept.forEach((p) => { ctx.save(); ctx.globalAlpha = 0.55; if (p.tw > 0 || (level >= 4 && Math.sin(t / 420) > 0.92)) ctx.translate((Math.random() - 0.5) * 3, 0); drawSquirrel(p.x, p.y, 1, p.face, false, 0, true); drawStaple(p.x - p.face * 8, p.y + 4, 0.3, 1); ctx.restore(); });
    if (game.twist?.kind === 'blackout') { ctx.fillStyle = '#020104'; ctx.fillRect(-W, -Hh, W * 3, Hh * 3); const st = STAPLER(), fl = game.staples.length ? 0.9 : 0.25; const gl = ctx.createRadialGradient(st.x, st.y - 10, 4, st.x, st.y - 10, 90); gl.addColorStop(0, `rgba(255,220,160,${fl})`); gl.addColorStop(1, 'rgba(255,220,160,0)'); ctx.fillStyle = gl; ctx.fillRect(0, 0, W, Hh); }
    game.stuck.forEach((s) => drawStaple(s.x, s.y, s.a, Math.min(1, s.life)));
    game.crates.forEach((c) => drawCrate(c, t));
    game.squirrels.forEach((sq) => { const p = sqPos(sq); if (game.twist?.kind !== 'blackout') drawSquirrel(p.x, p.y, sq.size, sq.face, sq.gold, t / 120 + sq.wig, false, sq.angry > 0);
      if (level >= 3 || game.twist?.kind === 'blackout' || game.stare > 0) { const s = RAD[sq.size] / 10; ctx.save(); ctx.fillStyle = game.stare > 0 ? '#FF2A2A' : '#FF5A3A'; ctx.shadowColor = '#FF3A2A'; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(p.x + sq.face * 8.6 * s, p.y - 6 * s, 1.4 * s, 0, 7); ctx.fill(); ctx.restore(); }
      if (sq.daze > 0) { ctx.fillStyle = '#FFE08A'; ctx.font = '10px system-ui'; ctx.textAlign = 'center'; for (let i = 0; i < 3; i++) { const a = t / 180 + i * 2.1; ctx.fillText('✦', p.x + Math.cos(a) * RAD[sq.size], p.y - RAD[sq.size] - 4 + Math.sin(a) * 3); } } });
    game.acorns.forEach((a) => drawAcorn(acornPos(a), a.spin));
    game.bombs.forEach((b) => { const e = b.t / b.tf, x = b.x0 + (b.x - b.x0) * e, y = b.y0 + (b.y - b.y0) * e - Math.sin(e * Math.PI) * 90; ctx.font = '20px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🧨', x, y); ctx.textBaseline = 'alphabetic'; });
    game.bolts.forEach((b) => { ctx.save(); ctx.globalAlpha = Math.min(1, b.life * 4); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const col = b.col || '#9BE7FF', path = () => { ctx.beginPath(); if (b.pts) b.pts.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y)); else b.lines.forEach(([a, c, dd, e]) => { ctx.moveTo(a, c); ctx.lineTo(dd, e); }); };
      ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 12; ctx.lineWidth = 4; path(); ctx.stroke(); ctx.shadowBlur = 0; ctx.strokeStyle = '#FFF'; ctx.lineWidth = 1.5; path(); ctx.stroke(); ctx.restore(); });
    game.pins.forEach((p) => { drawSquirrel(p.x, p.y, 1, p.face, p.gold, t / 40, true); drawStaple(p.x - p.face * 8, p.y + 4, 0.3, 1); });
    game.staples.forEach((s) => { const e = s.t / s.tf; drawStaple(s.x0 + (s.x - s.x0) * e, s.y0 + (s.y - s.y0) * e, 0, 1); });
    game.fx.forEach((f) => {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.5));
      if (f.kind === 'dot') { ctx.fillStyle = f.c; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill(); }
      else if (f.kind === 'tuft') { ctx.strokeStyle = f.c; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(f.x, f.y, 4, f.a, f.a + 2.4); ctx.stroke(); }
      else if (f.kind === 'ring') { ctx.strokeStyle = '#FFC857'; ctx.lineWidth = 6 * f.life * 2; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.stroke(); ctx.fillStyle = '#FF8A3D44'; ctx.fill(); }
      else if (f.kind === 'whisper') { const e = 1 - f.life / f.tf, a = Math.sin(Math.min(1, e) * Math.PI) * (0.35 + dark() * 0.4); ctx.globalAlpha = a; ctx.font = 'italic 600 13px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#E8D8FF'; ctx.letterSpacing = '3px'; ctx.fillText(f.text, f.x + (game.glitch > 0 ? (Math.random() - 0.5) * 6 : 0), f.y); ctx.letterSpacing = '0px'; }
      else { ctx.font = f.big ? '400 22px Bungee, Impact, sans-serif' : '900 15px Nunito, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = f.col || '#FFE08A'; ctx.strokeStyle = '#3A1D00'; ctx.lineWidth = f.big ? 5 : 3; ctx.strokeText(f.text, f.x, f.y); ctx.fillText(f.text, f.x, f.y); }
    });
    ctx.globalAlpha = 1;
    game.leaves.forEach((l) => { ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.a); ctx.fillStyle = '#D9822B'; ctx.beginPath(); ctx.ellipse(0, 0, l.r, l.r * 0.55, 0, 0, 7); ctx.fill(); ctx.restore(); });
    if (game.twist?.kind === 'gust') { ctx.strokeStyle = '#ffffff44'; ctx.lineWidth = 2; for (let i = 0; i < 12; i++) { const y = (i * 57) % Hh, x = ((t / 4) * Math.sign(game.twist.wind) + i * 97) % (W + 60); ctx.beginPath(); ctx.moveTo(x - 30, y); ctx.lineTo(x, y); ctx.stroke(); } }
    drawStapler();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (d > 0.3) { const vg = ctx.createRadialGradient(cv.width / 2, cv.height / 2, cv.height * 0.35, cv.width / 2, cv.height / 2, cv.height * 0.75); vg.addColorStop(0, 'rgba(60,0,10,0)'); vg.addColorStop(1, `rgba(40,0,8,${(d - 0.3) * 0.9 + (level >= 4 ? 0.2 * Math.sin(t / 500) : 0)})`); ctx.fillStyle = vg; ctx.fillRect(0, 0, cv.width, cv.height); }
    if (game.glitch > 0 && !host.reduceMotion) drawGlitch();
  }
  if (fade > 0) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = `rgba(20,12,6,${fade * 0.9})`; ctx.fillRect(0, 0, cv.width, cv.height); }
}
function drawForest(t) {
  const f = forest, Hh = H();
  ctx.fillStyle = '#3B2A16'; ctx.fillRect(-W, f.ground, W * 3, Hh);   // the forest floor
  ctx.fillStyle = '#4E3A1E'; for (let i = 0; i < 26; i++) { ctx.beginPath(); ctx.ellipse((i * 67) % W, f.ground + 4 + (i % 3) * 6, 14, 3, 0, 0, 7); ctx.fill(); }
  ctx.lineCap = 'round';
  f.segs.forEach((s) => { ctx.strokeStyle = s.d < 2 ? '#5A3B1F' : '#6B4726'; ctx.lineWidth = s.w; ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke(); });
  f.tips.forEach((s, i) => {   // leaves at every tip: little clusters that sway
    const sway = host.reduceMotion ? 0 : Math.sin(t / 900 + i) * 2;
    for (let j = 0; j < 3; j++) { ctx.fillStyle = `hsl(${f.hue + j * 8 + (i % 3) * 5} 70% ${38 + j * 7}%)`; ctx.beginPath(); ctx.arc(s.x2 + sway + (j - 1) * 5, s.y2 - j * 3, 9 - j * 2, 0, 7); ctx.fill(); }
  });
  // the knothole in the middle trunk: where the next forest is. Day 4: it's an eye, and it's open.
  const kn = f.knot, big = game && level >= 4 ? game.eye.open : 0;
  if (big > 0) {
    const op = big * (game.eye.blink > 0 ? Math.max(0.05, game.eye.blink / 0.22 < 0.5 ? game.eye.blink / 0.11 : 2 - game.eye.blink / 0.11) : 1);
    const rx = 6 + 30 * big, ry = (9 + 14 * big) * op;
    const look = hold || STAPLER(), dx = Math.max(-1, Math.min(1, (look.x - kn.x) / 200)), dy = Math.max(-1, Math.min(1, (look.y - kn.y) / 300));
    ctx.fillStyle = '#EDE6DA'; ctx.beginPath(); ctx.ellipse(kn.x, kn.y, rx, ry, 0, 0, 7); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.ellipse(kn.x, kn.y, rx, ry, 0, 0, 7); ctx.clip();
    ctx.fillStyle = '#7A1A1A'; ctx.beginPath(); ctx.arc(kn.x + dx * rx * 0.45, kn.y + dy * ry * 0.4, 11 * big, 0, 7); ctx.fill();
    ctx.fillStyle = '#0A0204'; ctx.beginPath(); ctx.arc(kn.x + dx * rx * 0.45, kn.y + dy * ry * 0.4, 5.5 * big, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffffffaa'; ctx.beginPath(); ctx.arc(kn.x + dx * rx * 0.45 - 3, kn.y + dy * ry * 0.4 - 3, 1.8, 0, 7); ctx.fill();
    for (let i = 0; i < 7; i++) { ctx.strokeStyle = '#B23A3A66'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(kn.x + (i - 3) * 9, kn.y - ry); ctx.lineTo(kn.x + (i - 3) * 12 + (i % 2) * 4, kn.y + ry); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = '#3A1A10'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(kn.x, kn.y, rx + 1, ry + 1, 0, 0, 7); ctx.stroke();
  } else {
    ctx.fillStyle = '#1B1109'; ctx.beginPath(); ctx.ellipse(kn.x, kn.y, 6, 9, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = '#8A6238'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(kn.x, kn.y, 7.5, 10.5, 0, 0, 7); ctx.stroke();
    if (game && level >= 2 && Math.sin(t / 1300) > 0.85) { ctx.fillStyle = '#FF3A2A'; ctx.beginPath(); ctx.arc(kn.x + 1.5, kn.y - 1, 1.6, 0, 7); ctx.fill(); }   // something peeks
  }
}
function drawEyes(t) {
  if (!forest.eyes.length) return;
  forest.eyes.forEach((e) => {
    const c = Math.sin(t / 1000 * e.rate + e.ph); if (c < 0.35) return;
    const op = Math.min(1, (c - 0.35) / 0.2);
    ctx.save(); ctx.globalAlpha = op * (0.5 + dark() * 0.5); ctx.fillStyle = level >= 4 ? '#FF3A2A' : '#FFE08A'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.ellipse(e.x - e.gap / 2, e.y, 2.2, 1.4 * op, 0, 0, 7); ctx.ellipse(e.x + e.gap / 2, e.y, 2.2, 1.4 * op, 0, 0, 7); ctx.fill(); ctx.restore();
  });
}
function drawGlitch() {   // 📻 a tear in the picture: slices slip sideways, colours split, static crackles
  const cv = host.cv, dpr = host.dpr, w = cv.width, h = cv.height, n = 3 + Math.floor(Math.random() * 5);
  for (let i = 0; i < n; i++) { const y = Math.floor(Math.random() * h), sh = 4 + Math.floor(Math.random() * h * 0.08), dx = Math.floor((Math.random() - 0.5) * w * 0.12); ctx.drawImage(cv, 0, y, w, sh, dx, y, w, sh); }
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.25; ctx.drawImage(cv, 6 * dpr, 0); ctx.restore();
  ctx.fillStyle = '#ffffff'; for (let i = 0; i < 120; i++) { ctx.globalAlpha = Math.random() * 0.35; ctx.fillRect(Math.random() * w, Math.random() * h, 2 * dpr, 2 * dpr); }
  ctx.globalAlpha = 1;
  if (Math.random() < 0.08) { ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over'; }
}
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
  ctx.fillStyle = fur; for (let i = 0; i < 6; i++) { const a = -0.6 - i * 0.55, r = 7 - i * 0.8; ctx.beginPath(); ctx.arc(-9 + Math.cos(a) * (4 + i), -6 + Math.sin(a) * (4 + i) - i, r, 0, 7); ctx.fill(); }   // tail: a curl
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
  for (let i = 0; i < AMMO; i++) { ctx.fillStyle = i < g.ammo && !g.reloadT ? '#F2F4F6' : '#ffffff22'; ctx.fillRect(-27 + i * 4.6, -12, 3, 7); }
  if (g.reloadT > 0) { ctx.fillStyle = '#F5C542'; ctx.fillRect(-30, -24, 60 * (1 - g.reloadT / RELOAD_S), 3); }
  ctx.restore();
}
// The weapon bar: the stapler and whatever you've picked up, with rounds left. Tap to load.
function renderBar() {
  if (!bar || !game) return;
  bar.innerHTML = Object.entries(WEAPONS).filter(([k]) => k === 'staple' || game.arsenal[k]).map(([k, w]) =>
    `<button type="button" data-w="${k}" class="${game.weapon === k ? 'on' : ''}" aria-label="${w.name}${k === 'staple' ? '' : `, ${game.arsenal[k]} left`}">${w.icon}${k === 'staple' ? '' : `<b>${game.arsenal[k]}</b>`}</button>`).join('');
  bar.querySelectorAll('[data-w]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); game.weapon = b.dataset.w; renderBar(); sfx('click'); }; });
}

// ---------------------------------------------------------------- the organ
const organ = {
  key: 'squirrel', name: 'Squirrel Chaos', icon: '🐿️', verb: 'tap to staple · tap the stapler to reload', beat: 1.2,
  theme: { bg: '#14200E', gold: '#F5C542', bannerc: '#FFE08A' },
  init(h) { host = h; ctx = h.ctx; S = h.S; sfx = h.sfx; window.__sq = organ.debug; },
  start() { newGame(); },
  enter(from) {
    if (!game) newGame();
    bar = host.ui('<div class="wbar" id="wbar" aria-label="Weapons"></div>').querySelector('.wbar'); renderBar();
    if (from) { game.stun = 0; game.acorns = []; }   // a morph lands you mid-forest: nothing already in the air at your head
  },
  leave() { hold = null; bar = null; return game ? STAPLER() : null; },
  update, draw, onBeat,
  resize() { if (forest && Math.abs(forest.H - H()) > 1) forest = grow(forest.seed, level); },   // the trees stand on the new ground
  pointer(type, p) { if (type === 'down') { hold = p; if (game) game.nailT = 0.09; fire(p.x, p.y); } else if (type === 'move') { if (hold) hold = p; } else hold = null; },
  keydown(e) { if ((e.key === 'r' || e.key === 'R') && game) reload(); },
  hudLine: () => (game ? `Day ${level}${host.morphs ? '' : ` of ${LEVELS}`} · ${Math.max(0, Math.ceil(level * LEVEL_S - game.time))}s${game.kept.length ? ` · 📎 ${game.kept.length} kept` : ''}` : ''),
  level: () => level,
  overText: (how) => (how === 'sleeps' ? ['🌘 IT SLEEPS AGAIN', 'For now. It counted every one.'] : how === 'bonked' ? ['💫 KNOCKED OUT', 'Too many acorns to the head. The forest keeps your staples.'] : ['RUN OVER', '']),
  endStats: () => (game ? `🐿️ ${game.hits} hits from ${game.shots} staples${game.shots ? ` (${Math.round((100 * game.hits) / game.shots)}%)` : ''}, day ${level}` : ''),
  debug: () => game && ({ score: S.score, level, kept: game.kept.length, glitch: game.glitch, eye: game.eye.open, twist: game.twist?.kind || null, stare: game.stare, whispers: game.fx.filter((f) => f.kind === 'whisper').length,
    skipTo: (l) => { level = l - 1; game.time = level * LEVEL_S; }, forceTwist: (k) => { game.twist = { kind: k, until: game.time + 6, wind: 70 }; if (k === 'stare') game.stare = 1.6; if (k === 'static') game.glitch = 6; },
    hearts: S.hearts, weapon: game.weapon, arsenal: { ...game.arsenal }, crates: game.crates.map((c) => ({ x: c.x, y: c.y, w: c.w })), acorns: game.acorns.map(acornPos), ammo: game.ammo, dive: !!game.dive, over: S.over, r: S.curve.r,
    squirrels: game.squirrels.map((sq) => ({ ...sqPos(sq), size: sq.size, hop: !!sq.hop })), W, H: H() }),
};
export default organ;
