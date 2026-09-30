// 🎨 FIG — who lives in r4box. One creature with four personalities, one per pillar of the box (chaos,
// symmetry, fractals, geometry); each player picks the Fig they go on chaos adventures with in the
// Design Studio (studio.html): it lives in their lobby's box, rides the loader, sits in every solo
// game's corner reacting to the beat, doubles its pillar's events in their rating (077) and bends the
// curve's edges for them (079). The keys (fig, kit, bit, phi) are the four's old names and stay, for
// the server and the saved picks.
//
// Every pal reads the same nine events as every game (CHAOS.md) and has a face for each:
//   peak: a jump · big: a wobble · gold: goes gold with sparkles · gift: happy eyes
//   mirror: flips to face the other way · balance: perfectly still, a halo · window: three of something
//   golden: the gold bead lights up · fib: a wink · chaos (r ≥ 3.57): spiral eyes, things fray
//   hurt: worried · asleep (game over): zzz
//
// drawPal(key, ctx, opts) draws one frame anywhere. palWidget(canvas, opts) runs a pal on its own
// canvas, on its own beat or driven from outside (the shell's HUD, the lobby's hero).
import { CHAOS, phaseOf, makeCurve, stepCurve } from './chaos.js';

export const C = { teal: '#3DD6C6', deep: '#0B0918', gold: '#F5C542', hot: '#FF5A4A', violet: '#B9A6FF', mint: '#C9FFF8', ink: '#0F1A2A', lilac: '#8B7BFF', moss: '#9BE37A', peach: '#FFB48A' };
const CHAOS_R = CHAOS.PHASES[3][0];
const forks = (r) => (r < 3 ? 0 : r < 3.449 ? 1 : r < 3.544 ? 2 : r < CHAOS_R ? 3 : 4);   // 1, 2, 4, 8 tails, then chaos
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, k) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',')})`; };
const rgba = (h, a) => `rgba(${hex(h).join(',')},${a})`;

// The mood a beat's events put a pal in, and for how long: [mood, seconds] or null.
export function palMood(ev) {
  if (!ev) return null;
  if (ev.golden) return ['golden', 2.2];
  if (ev.gold) return ['gold', 2];
  if (ev.mirror) return ['mirror', 1.6];
  if (ev.balance) return ['balance', 1.8];
  if (ev.window) return ['window', 1.3];
  if (ev.big) return ['big', 1.2];
  if (ev.peak) return ['peak', 0.9];
  if (ev.gift) return ['gift', 1.4];
  if (ev.fib) return ['fib', 1];
  return null;
}

// What every pal shares: the maths of a mood, and a face.
function feel({ t = 0, r = 2.9, mood = null, mp = 0, face = 1, asleep = false, s = 24 }) {
  const chaos = r >= CHAOS_R, ph = phaseOf(r), pulse = Math.sin(Math.PI * mp);
  return {
    chaos, f: forks(r), ph, pulse,
    hop: mood === 'peak' ? pulse * s * 1.3 : mood === 'big' ? Math.abs(Math.sin(mp * Math.PI * 4)) * s * 0.25 : 0,
    bob: asleep ? 0 : Math.sin(t * (ph === 'calm' ? 1.6 : ph === 'RHYTHM ×2' ? 3.2 : ph === 'RHYTHM ×4' ? 6.4 : 9)) * s * (chaos ? 0.05 : 0.09),
    sy: mood === 'peak' ? 1 + 0.25 * pulse : mood === 'big' ? 1 + 0.12 * Math.sin(mp * Math.PI * 8) : 1,
    fc: mood === 'mirror' ? (mp < 0.5 ? face : -face) : face,
    gold: mood === 'gold' ? pulse : mood === 'golden' ? 0.5 * pulse : 0,
    speed: chaos ? 9 : ph === 'calm' ? 1.6 : ph === 'RHYTHM ×2' ? 3.2 : 6.4,
  };
}
const blinking = (t, asleep) => !asleep && ((t * 1000) % 3400) < 130;
// An eye at (ex, ey) of radius rad. k: 0 left, 1 right (for winks).
function eye(ctx, s, ex, ey, rad, k, { t, mood, pulse, chaos, gold, hurt, asleep, ink = C.ink }) {
  const closed = asleep || blinking(t, asleep) || mood === 'gift' || (mood === 'fib' && k === 1) || (mood === 'gold' && pulse > 0.5 && k === 0);
  if (closed) {
    ctx.strokeStyle = ink; ctx.lineWidth = s * 0.09; ctx.beginPath();
    if (mood === 'gift' || asleep) ctx.arc(ex, ey + rad * 0.3, rad * 0.8, Math.PI * 1.15, Math.PI * 1.85);   // ^ ^
    else { ctx.moveTo(ex - rad * 0.7, ey); ctx.lineTo(ex + rad * 0.7, ey); }
    ctx.stroke(); return;
  }
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, rad, 0, 7); ctx.fill();
  if (chaos && !gold) {   // spiral pupils: no rhythm left
    ctx.strokeStyle = ink; ctx.lineWidth = s * 0.06; ctx.beginPath();
    for (let a = 0; a < Math.PI * 5; a += 0.3) { const rr = (a / (Math.PI * 5)) * rad * 0.75; const px = ex + Math.cos(a + t * 6) * rr, py = ey + Math.sin(a + t * 6) * rr; a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
    ctx.stroke();
  } else {
    const look = hurt ? 0 : rad * 0.28;
    ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(ex + look, ey + (hurt ? -rad * 0.1 : rad * 0.08), rad * (mood === 'big' ? 0.62 : hurt ? 0.4 : 0.5), 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + look + rad * 0.2, ey - rad * 0.2, rad * 0.14, 0, 7); ctx.fill();
  }
  if (hurt) { ctx.strokeStyle = ink; ctx.lineWidth = s * 0.08; ctx.beginPath(); ctx.moveTo(ex - rad * 0.8, ey - rad * 1.25 + k * rad * 0.2); ctx.lineTo(ex + rad * 0.8, ey - rad * 1.05 - k * rad * 0.2); ctx.stroke(); }
}
function mouth(ctx, s, mx, my, w, { t, mood, chaos, gold, hurt, asleep, ink = C.ink }) {
  ctx.strokeStyle = ink; ctx.lineWidth = s * 0.09; ctx.beginPath();
  if (asleep) ctx.arc(mx, my + w * 0.4, w * 0.35, 0, 7);
  else if (hurt) ctx.arc(mx, my + w * 0.9, w * 0.7, Math.PI * 1.15, Math.PI * 1.85);
  else if (mood === 'big') ctx.ellipse(mx, my + w * 0.4, w * 0.5, w * 0.75, 0, 0, 7);
  else if (chaos && !gold) { for (let i = 0; i <= 6; i++) ctx.lineTo(mx - w * 0.8 + i * w * 0.27, my + w * 0.4 + Math.sin(i * 2 + t * 12) * w * 0.2); }
  else ctx.arc(mx, my, w, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
}
function sparkles(ctx, s, { mood, mp, pulse, gold, alpha }) {
  if (!gold && mood !== 'mirror') return;
  const n = 6; ctx.fillStyle = mood === 'mirror' ? C.mint : C.gold; ctx.globalAlpha = alpha * (mood === 'mirror' ? pulse : gold);
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + mp * 3, d = s * (1.35 + 0.5 * pulse), px = Math.cos(a) * d, py = Math.sin(a) * d * 0.8, z = s * 0.14;
    ctx.beginPath(); ctx.moveTo(px, py - z); ctx.lineTo(px + z * 0.35, py); ctx.lineTo(px, py + z); ctx.lineTo(px - z * 0.35, py); ctx.closePath(); ctx.fill(); }
  ctx.globalAlpha = alpha;
}
function halo(ctx, s, y, { mood, pulse }) { if (mood !== 'balance') return; ctx.strokeStyle = rgba(C.mint, 0.9 * pulse); ctx.lineWidth = s * 0.08; ctx.beginPath(); ctx.ellipse(0, y, s * 0.55, s * 0.16, 0, 0, 7); ctx.stroke(); }
function zzz(ctx, s, { t, asleep, alpha }) { if (!asleep) return; ctx.globalAlpha = alpha * 0.9; ctx.fillStyle = '#fff'; ctx.font = `800 ${s * 0.5}px system-ui`; ctx.fillText('z', s * 0.9, -s * 0.7 - ((t * 8) % 10)); ctx.font = `800 ${s * 0.35}px system-ui`; ctx.fillText('z', s * 1.25, -s * 1.1 - ((t * 8) % 10)); ctx.globalAlpha = alpha; }
// A gold bead (the golden cut) that glows on golden beats.
function bead(ctx, s, bx, by, { mood, pulse, gold, mp }) {
  const glow = mood === 'golden' ? 0.5 + 0.5 * pulse : 0.25 + (gold ? 0.5 : 0);
  ctx.shadowColor = C.gold; ctx.shadowBlur = s * (0.3 + glow * 1.4);
  ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(bx, by, s * (0.16 + glow * 0.08), 0, 7); ctx.fill(); ctx.shadowBlur = 0;
  if (mood === 'golden') { ctx.strokeStyle = rgba(C.gold, 0.9 * pulse); ctx.lineWidth = s * 0.06; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + mp * 2; ctx.beginPath(); ctx.moveTo(bx + Math.cos(a) * s * 0.3, by + Math.sin(a) * s * 0.3); ctx.lineTo(bx + Math.cos(a) * s * (0.45 + 0.3 * pulse), by + Math.sin(a) * s * (0.45 + 0.3 * pulse)); ctx.stroke(); } }
}
// A forking branch: the bifurcation diagram as a limb. f: how many forks (0..4, 4 = chaos, jittery).
function branch(ctx, s, x0, y0, ang, len, d, f, t, chaos, base) {
  const jit = f >= 4 ? Math.sin(t * 7 + d * 3 + x0) * 0.35 : 0;
  const x1 = x0 + Math.cos(ang + jit) * len, y1 = y0 + Math.sin(ang + jit) * len;
  ctx.lineWidth = Math.max(1, s * 0.22 * Math.pow(0.68, d));
  ctx.strokeStyle = d === 0 ? base : mix(chaos ? C.hot : base, C.violet, Math.min(1, d / 4));
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0 + Math.cos(ang) * len * 0.5, y0 + Math.sin(ang) * len * 0.7, x1, y1); ctx.stroke();
  const more = f >= 4 ? 4 : f;
  if (d < more) { const sp = 0.55 - d * 0.08; branch(ctx, s, x1, y1, ang - sp, len * 0.62, d + 1, f, t, chaos, base); branch(ctx, s, x1, y1, ang + sp, len * 0.62, d + 1, f, t, chaos, base); }
}

// ---------------------------------------------------------------- the four
// ---------------------------------------------------------------- Fig, in four personalities
// One creature, four moods, one per pillar of the box. Fig carries a bit of every one: the forking
// tail (chaos), a pair of mirror wings (symmetry), a box on its back with a box inside (fractals) and a
// golden spiral on its belly (geometry). The personality you go with takes the lead: its feature grows,
// its colour tints the body, its way of moving shows.
const MODE_COL = { calm: C.teal, chaos: C.hot, symmetry: C.violet, fractals: C.lilac, geometry: C.gold };
export const MODE_OF = { calm: 'calm', fig: 'chaos', kit: 'symmetry', bit: 'fractals', phi: 'geometry' };   // mood key → the feature that leads
function drawFig(ctx, o, F, m) {
  const { s, t } = o, { chaos, f, gold, mood, pulse, speed } = F, W = o.w, lead = (k) => (W ? 0.42 + 0.58 * (W[k] || 0) : m === k ? 1 : 0.42);
  const tint = W ? Object.entries(W).sort((a, b) => b[1] - a[1])[0] : null, mk = tint && tint[1] > 0.5 ? tint[0] : m;   // the mood that leads right now
  m = mk === 'calm' ? 'calm' : mk;
  const body = gold > 0.3 ? C.gold : m === 'calm' ? C.teal : mix(C.teal, MODE_COL[m], m === 'chaos' ? 0.18 : 0.3);
  // 🦋 the mirror wings, behind: two halves, each the other's reflection
  const wk = lead('symmetry'), flap = m === 'symmetry' ? 0.55 + 0.45 * Math.cos(t * speed * 1.2) : 0.75 + 0.1 * Math.sin(t * 2);
  for (const dir of [-1, 1]) {
    ctx.save(); ctx.translate(-s * 0.15, -s * 0.25); ctx.scale(dir * flap, 1); ctx.globalAlpha = o.alpha * (m === 'symmetry' ? 0.95 : 0.55);
    const wing = m === 'symmetry' ? C.violet : mix(C.violet, C.teal, 0.45);
    for (const [ang, len] of [[-1.2, 1.3], [-0.7, 1.25], [-0.2, 1.0], [0.25, 0.7]]) branch(ctx, s * (0.6 + 0.5 * wk), s * 0.1, 0, ang, s * len * 0.8 * wk, 0, Math.max(1, Math.min(f, 2)), t, chaos, wing);
    ctx.restore();
  }
  // 🌀 the tail: the bifurcation diagram; the wild one's frays even in calm
  const tails = mood === 'window' ? 3 : 1, fk = m === 'chaos' ? Math.max(f, 2) : f, fray = m === 'chaos' && f >= 2 ? 4 : fk;
  for (let k = 0; k < tails; k++) { ctx.save(); ctx.rotate((k - (tails - 1) / 2) * 0.45); branch(ctx, s * (m === 'chaos' ? 1 : 0.85), -s * 0.7, s * 0.1, Math.PI + 0.25 - Math.sin(t * (m === 'chaos' ? 5 : 2)) * 0.12, s * (m === 'chaos' ? 1.0 : 0.9), 0, fray, t, chaos || m === 'chaos', m === 'chaos' ? mix(body, C.hot, 0.35) : body); ctx.restore(); }
  // the antenna and the gold bead (the golden cut)
  const ax = -s * 0.15, ay = -s * 0.85, bx = ax - s * 0.35 - Math.sin(t * 2.2) * s * 0.05, by = ay - s * 0.8;
  ctx.strokeStyle = body; ctx.lineWidth = s * 0.14; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(ax - s * 0.05, ay - s * 0.55, bx, by); ctx.stroke();
  bead(ctx, s, bx, by, F);
  // 🟪 the box on its back (a box inside the box), over the shoulder
  { const bk = lead('fractals'), bw = s * 0.5 * (0.75 + 0.6 * bk), bx0 = s * 0.45, by0 = -s * 0.92 - (bw - s * 0.43) * 0.5;
    ctx.save(); ctx.translate(bx0, by0); ctx.rotate(0.18 + Math.sin(t * 1.7) * 0.04);
    ctx.fillStyle = m === 'fractals' ? C.lilac : mix(C.lilac, body, 0.5); ctx.shadowColor = C.lilac; ctx.shadowBlur = s * (m === 'fractals' ? 0.7 : 0.15);
    ctx.beginPath(); ctx.roundRect(-bw / 2, -bw / 2, bw, bw, bw * 0.18); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = C.deep; ctx.beginPath(); ctx.roundRect(-bw * 0.36, -bw * 0.36, bw * 0.72, bw * 0.72, bw * 0.12); ctx.fill();   // the box's screen: a box inside
    ctx.strokeStyle = m === 'fractals' ? C.mint : rgba(C.mint, 0.5); ctx.lineWidth = Math.max(1, bw * 0.06); ctx.beginPath(); ctx.roundRect(-bw * 0.2, -bw * 0.2, bw * 0.4, bw * 0.4, bw * 0.06); ctx.stroke();
    if (m === 'fractals') { ctx.beginPath(); ctx.roundRect(-bw * 0.08, -bw * 0.08, bw * 0.16, bw * 0.16, bw * 0.02); ctx.stroke(); }   // …and one inside that
    if (m === 'fractals' && chaos && !gold) { for (let i = 0; i < 14; i++) { ctx.fillStyle = i % 3 ? '#ffffff33' : rgba(C.hot, 0.5); ctx.fillRect(-bw * 0.36 + ((i * 7919 + Math.floor(t * 30) * 104729) % 1000) / 1000 * bw * 0.72, -bw * 0.36 + ((i * 6007 + Math.floor(t * 30) * 15485863) % 1000) / 1000 * bw * 0.72, bw * 0.08, bw * 0.04); } }
    ctx.restore(); }
  // the body
  ctx.fillStyle = body; ctx.shadowColor = chaos ? C.hot : MODE_COL[m]; ctx.shadowBlur = s * (chaos ? 0.6 : 0.45);
  ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.95, 0, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
  if (chaos && !gold) { ctx.strokeStyle = rgba(C.hot, 0.7); ctx.lineWidth = s * 0.08; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.96, s * 0.91, 0, 0, 7); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.beginPath(); ctx.ellipse(-s * 0.3, -s * 0.38, s * 0.32, s * 0.2, -0.6, 0, 7); ctx.fill();
  // 🌻 the golden spiral on its belly: φ every quarter turn
  { const gk = lead('geometry'), cx = -s * 0.2, cy = s * 0.42, spin = m === 'geometry' ? t * speed * 0.25 : 0;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(spin); ctx.strokeStyle = m === 'geometry' ? C.gold : rgba(C.gold, 0.55); ctx.lineWidth = s * (m === 'geometry' ? 0.09 : 0.06);
    ctx.shadowColor = C.gold; ctx.shadowBlur = m === 'geometry' ? s * (0.4 + 0.4 * pulse) : 0; ctx.beginPath();
    for (let th = 0; th <= Math.PI * 4.2; th += 0.14) { const rad = s * 0.03 * gk * Math.pow(CHAOS.PHI, th / (Math.PI / 2)); if (rad > s * 0.5 * gk) break; const px = Math.cos(th) * rad, py = Math.sin(th) * rad; th === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
    ctx.stroke(); ctx.restore(); }
  halo(ctx, s, -s * 1.45, F);
  // the face: the boxy one's eyes are pixels
  if (m === 'fractals' && !o.asleep && !blinking(t, o.asleep) && mood !== 'gift' && !(chaos && !gold)) {
    for (const [ex, k] of [[s * 0.05, 0], [s * 0.55, 1]]) { const closed = (mood === 'fib' && k === 1) || (mood === 'gold' && pulse > 0.5 && k === 0); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, -s * 0.12, s * 0.24, 0, 7); ctx.fill(); ctx.fillStyle = C.ink; if (closed) ctx.fillRect(ex - s * 0.16, -s * 0.15, s * 0.32, s * 0.06); else ctx.fillRect(ex - s * 0.06 + (o.hurt ? 0 : s * 0.05), -s * 0.2, s * 0.17, s * 0.17); if (o.hurt) { ctx.fillRect(ex - s * 0.2, -s * 0.44 + k * s * 0.05, s * 0.4, s * 0.06); } }
  } else { eye(ctx, s, s * 0.05, -s * 0.12, s * 0.24, 0, F); eye(ctx, s, s * 0.55, -s * 0.12, s * 0.24, 1, F); }
  mouth(ctx, s, s * 0.3, s * 0.28, s * 0.28, F);
}
export const PALS = [
  {
    key: 'fig', name: 'Wild Fig', mode: 'chaos', icon: '🌀', colour: C.teal, colour2: C.hot, ink: '#062A26', greet: 'Ready to get wild, {name}?', pillar: 'chaos', pillarIcon: '🌀', boosts: ['peak', 'big', 'gold', 'r4'],
    perk: 'Peaks come sooner for you: x above 0.68 twists, not 0.75. More chaos, and every peak, big beat, golden beat and r = 4 counts double.',
    tag: 'Fig with the wind up: the tail frays, the peaks call.',
    story: 'Fig is made of the chaos curve, and this is Fig with the wind up. Its tail is the bifurcation diagram, and in this mood it frays into the cloud even while the curve is calm. It lives for the peaks: the top of the curve, r = 4, is home. Named for Feigenbaum, whose constant says how fast the tail forks.',
    draw(ctx, o, F) { drawFig(ctx, o, F, 'chaos'); },
  },
  {
    key: 'kit', name: 'Mirror Fig', mode: 'symmetry', icon: '✨', colour: C.violet, colour2: C.mint, ink: '#150F33', greet: 'Mirror, mirror, {name}.', pillar: 'symmetry', pillarIcon: '✨', boosts: ['mirror', 'balance'],
    perk: 'A wide mirror (0.05, not 0.02) and a wide balance (0.03): symmetry finds you more often, and every mirror and balance counts double.',
    tag: 'Fig with its wings out: two halves, each the other’s reflection.',
    story: 'Fig with its wings out. Each wing is the bifurcation diagram, and the other is its mirror image: f(x) = f(1 − x), the symmetry hidden in the chaos. They beat to the curve’s rhythm, twice, four times, then a blur. This Fig notices when a beat lands where the last one would have, reflected.',
    draw(ctx, o, F) { drawFig(ctx, o, F, 'symmetry'); },
  },
  {
    key: 'bit', name: 'Boxy Fig', mode: 'fractals', icon: '🔁', colour: C.lilac, colour2: C.teal, ink: '#150F33', greet: 'Boxes in boxes, {name}.', pillar: 'fractals', pillarIcon: '🔁', boosts: ['window', 'phase'],
    perk: 'The window lasts 7 beats for you, not 3: a longer rhythm of 3 where nothing twists. Every phase crossed and every window beat counts double.',
    tag: 'Fig with the box on its back: a box that holds a box that holds…',
    story: 'Fig with the box on its back. The box is r4box, and its screen shows a smaller box, which shows a smaller one: zoom in anywhere and the whole thing is there again, the way every split of the curve repeats the whole in miniature. This Fig sees in pixels and loves the window, the rhythm of 3 inside the chaos.',
    draw(ctx, o, F) { drawFig(ctx, o, F, 'fractals'); },
  },
  {
    key: 'phi', name: 'Golden Fig', mode: 'geometry', icon: '🌻', colour: C.moss, colour2: C.gold, ink: '#10240A', greet: 'Slow and golden, {name}.', pillar: 'geometry', pillarIcon: '🌻', boosts: ['golden', 'fib'],
    perk: 'A wide golden cut (0.03, not 0.012) and double luck on Fibonacci beats. Every golden cut and Fibonacci beat counts double.',
    tag: 'Fig with the spiral on its belly: φ every quarter turn.',
    story: 'Fig with the spiral on its belly, a golden spiral that grows by φ = 1.618 every quarter turn, the shape the Fibonacci numbers draw. Slow and sure, this Fig turns the spiral as r climbs and waits for the golden cut, x = 0.618, and for the beats that count 1, 1, 2, 3, 5, 8…',
    draw(ctx, o, F) { drawFig(ctx, o, F, 'geometry'); },
  },
];
export const PAL = Object.fromEntries(PALS.map((p) => [p.key, p]));
PAL.calm = { ...PALS[0], key: 'calm', name: 'Fig', mode: 'calm', icon: '🟢', colour: C.teal, colour2: C.hot, tag: 'Fig, settled: a bit of everything.', draw(ctx, o, F) { drawFig(ctx, o, F, 'calm'); } };   // Fig between moods

// One frame of a pal. x, y: its centre. s: its size (a body radius). t: seconds. r: where the curve
// is. mood / mp: the mood and how far through it (0..1). face: 1 looks right, -1 left.
export function drawPal(key, ctx, opts) {
  const o = { s: 24, t: 0, r: 2.9, mood: null, mp: 0, face: 1, hurt: false, asleep: false, alpha: 1, ...opts };
  const pal = PAL[key] || PAL.calm, F = { ...feel(o), hurt: o.hurt, asleep: o.asleep, alpha: o.alpha, mood: o.mood, mp: o.mp, t: o.t };
  ctx.save(); ctx.globalAlpha = o.alpha; ctx.translate(o.x, o.y + F.bob - F.hop); ctx.scale(F.fc, 1); ctx.scale(1 / F.sy, F.sy);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  pal.draw(ctx, o, F);
  sparkles(ctx, o.s, F); zzz(ctx, o.s, F);
  ctx.restore();
}

// A pal living on its own canvas. Own beat (default) or driven from outside (own: false, then call
// set({ r }) and react(ev) yourself). Returns { react, set, hurt, sleep, wake, stop, pal }.
export function palWidget(cv, { pal = 'calm', s = 26, beat = 0.7, own = true, face = 1, r0 = null, lockMood = false, dpr = Math.min(2, devicePixelRatio || 1) } = {}) {
  const ctx = cv.getContext('2d');
  const W = cv.width / dpr, H = cv.height / dpr;
  let curve = makeCurve(), r = r0 ?? curve.r, mood = null, moodT = 0, moodDur = 1, hurtT = 0, asleep = false, acc = 0, last = 0, stopped = false, key = pal, ownB = own;
  // 🟢 the personality: weights per feature, eased toward the mood's (lockMood: stays on `pal`, for the Studio)
  const w = { chaos: 0.42, symmetry: 0.42, fractals: 0.42, geometry: 0.42 }; let target = key;
  const st = { react, set, hurt, sleep, wake, stop, get mood() { return mood; }, get r() { return r; }, get pal() { return key; }, force };
  function react(ev) { const m = palMood(ev); if (m) { [mood, moodDur] = m; moodT = 0; } }
  function force(m, dur = 1.4) { mood = m; moodDur = dur; moodT = 0; }
  function set(o) { if (o.r != null) r = o.r; if (o.face != null) face = o.face; if (o.pal) { key = o.pal; target = o.pal; } if (o.mood && !lockMood) { key = o.mood; target = o.mood; } if (o.own != null) ownB = o.own; }
  function hurt() { hurtT = 1.2; }
  function sleep() { asleep = true; } function wake() { asleep = false; mood = null; }
  function stop() { stopped = true; }
  function frame(t) {
    if (stopped || !cv.isConnected) return;
    const dt = last ? Math.min(0.1, (t - last) / 1000) : 0; last = t;
    if (ownB && !asleep) { acc += dt; while (acc >= beat) { acc -= beat; const ev = stepCurve(curve); r = curve.r; if (curve.r >= 4 - 1e-9 && Math.random() < 0.03) curve = makeCurve(); react(ev); if (!lockMood) { key = curve.mood; target = curve.mood; } } }
    for (const k of Object.keys(w)) { const goal = MODE_OF[target] === k ? 1 : 0; w[k] += (goal - w[k]) * Math.min(1, dt * 3); }
    if (mood) { moodT += dt; if (moodT >= moodDur) mood = null; }
    if (hurtT > 0) hurtT -= dt;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    drawPal(key, ctx, { x: W * 0.5, y: H * 0.56, s, t: t / 1000, r, mood, mp: mood ? moodT / moodDur : 0, face, hurt: hurtT > 0, asleep, w });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return st;
}
