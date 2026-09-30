// 🎨 THE PALS — who lives in r4box. Four of them, one for each pillar of the box (chaos, symmetry,
// fractals, geometry); each player picks a COMPANION in the Design Studio (studio.html) to go on chaos
// adventures with: it lives in their lobby's box, rides the loader, sits in every solo game's corner
// reacting to the beat, and doubles its pillar's events in their chaos rating (077).
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
export const PALS = [
  {
    key: 'fig', name: 'Fig', icon: '🟢', colour: C.teal, pillar: 'chaos', pillarIcon: '🌀', boosts: ['peak', 'big', 'gold', 'r4'],
    perk: 'Lives for the peaks: every peak, big beat, golden beat and r = 4 you meet counts double.',
    tag: 'A drop of the curve with a forking tail. The wild one.',
    story: 'Fig is made of the chaos curve. Its tail is the bifurcation diagram: one tail while the curve is calm, forking into two, four, eight as r climbs, and a frayed cloud in chaos. The gold bead on its antenna is the golden cut. Named for Feigenbaum, whose constant says how fast the tail forks.',
    draw(ctx, o, F) {
      const { s, t } = o, { chaos, f, gold, mood } = F;
      const body = gold > 0.3 ? C.gold : C.teal;
      const tails = mood === 'window' ? 3 : 1;
      for (let k = 0; k < tails; k++) { ctx.save(); ctx.rotate((k - (tails - 1) / 2) * 0.45); branch(ctx, s, -s * 0.7, s * 0.1, Math.PI + 0.25 - Math.sin(t * 2) * 0.12, s * 1.1, 0, f, t, chaos, body); ctx.restore(); }
      const ax = -s * 0.15, ay = -s * 0.85, bx = ax - s * 0.35 - Math.sin(t * 2.2) * s * 0.05, by = ay - s * 0.8;
      ctx.strokeStyle = body; ctx.lineWidth = s * 0.14; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(ax - s * 0.05, ay - s * 0.55, bx, by); ctx.stroke();
      bead(ctx, s, bx, by, F);
      ctx.fillStyle = body; ctx.shadowColor = chaos ? C.hot : C.teal; ctx.shadowBlur = s * (chaos ? 0.6 : 0.4);
      ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.95, 0, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      if (chaos && !gold) { ctx.strokeStyle = rgba(C.hot, 0.7); ctx.lineWidth = s * 0.08; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.96, s * 0.91, 0, 0, 7); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.beginPath(); ctx.ellipse(-s * 0.3, -s * 0.38, s * 0.32, s * 0.2, -0.6, 0, 7); ctx.fill();
      halo(ctx, s, -s * 1.45, F);
      eye(ctx, s, s * 0.05, -s * 0.12, s * 0.24, 0, F); eye(ctx, s, s * 0.55, -s * 0.12, s * 0.24, 1, F);
      mouth(ctx, s, s * 0.3, s * 0.28, s * 0.28, F);
    },
  },
  {
    key: 'bit', name: 'Bit', icon: '🟪', colour: C.lilac, pillar: 'fractals', pillarIcon: '🔁', boosts: ['window', 'phase'],
    perk: 'A box inside a box inside a box: every phase the curve crosses and every beat of the window counts double.',
    tag: 'The box itself, with a screen for a face. The fractal one.',
    story: 'Bit is r4box: a little box that woke up. Its screen shows its eyes and, for a mouth, the chaos meter: the last few beats of x, live. Its antenna is a spring with a bead on top. In chaos the screen fills with static and the corners burn; in the window it shows ×3.',
    draw(ctx, o, F) {
      const { s, t, r } = o, { chaos, gold, mood, pulse, f } = F, w = s * 1.9, h = s * 1.7, rr = s * 0.3;
      const body = gold > 0.3 ? C.gold : C.lilac;
      // the spring antenna, and the bead
      ctx.strokeStyle = body; ctx.lineWidth = s * 0.1; ctx.beginPath();
      const coils = 5, top = -h / 2 - s * 0.9 + Math.sin(t * 3) * s * 0.06;
      for (let i = 0; i <= coils * 12; i++) { const p = i / (coils * 12); const px = Math.sin(p * coils * Math.PI * 2) * s * 0.16 + Math.sin(t * 2.5) * s * 0.1 * p, py = -h / 2 + (top + h / 2) * p; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.stroke(); bead(ctx, s, Math.sin(t * 2.5) * s * 0.1, top - s * 0.12, F);
      // the box
      ctx.fillStyle = body; ctx.shadowColor = chaos ? C.hot : C.lilac; ctx.shadowBlur = s * (chaos ? 1 : 0.4);
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, rr); ctx.fill(); ctx.shadowBlur = 0;
      if (chaos) { ctx.strokeStyle = rgba(C.hot, 0.5 + 0.4 * Math.abs(Math.sin(t * 9))); ctx.lineWidth = s * 0.1; ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, rr); ctx.stroke(); }
      // feet
      ctx.fillStyle = mix(body, C.deep, 0.35); ctx.beginPath(); ctx.roundRect(-w * 0.36, h / 2 - s * 0.05, s * 0.4, s * 0.22, s * 0.1); ctx.roundRect(w * 0.14, h / 2 - s * 0.05, s * 0.4, s * 0.22, s * 0.1); ctx.fill();
      // the screen
      const sw = w * 0.78, sh = h * 0.66, sx = -sw / 2, sy = -sh / 2 - s * 0.05;
      ctx.fillStyle = C.deep; ctx.beginPath(); ctx.roundRect(sx, sy, sw, sh, s * 0.18); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.roundRect(sx, sy, sw, sh, s * 0.18); ctx.clip();
      if (chaos && !gold) { for (let i = 0; i < 40; i++) { const px = sx + ((i * 7919 + Math.floor(t * 30) * 104729) % 1000) / 1000 * sw, py = sy + ((i * 6007 + Math.floor(t * 30) * 15485863) % 1000) / 1000 * sh; ctx.fillStyle = i % 3 ? '#ffffff22' : rgba(C.hot, 0.5); ctx.fillRect(px, py, s * 0.12, s * 0.06); } }
      if (mood === 'window') { ctx.fillStyle = C.violet; ctx.font = `900 ${s * 0.5}px system-ui`; ctx.textAlign = 'center'; ctx.fillText('×3', 0, sy + sh * 0.85); }
      // eyes as pixels: two blocks, blinking; the mouth is the meter, the last 10 beats of x
      const Fp = { ...F, ink: C.mint };
      const px = (ex, k) => { const closed = o.asleep || blinking(t, o.asleep) || mood === 'gift' || (mood === 'fib' && k === 1); ctx.fillStyle = Fp.ink;
        if (closed) { ctx.fillRect(ex - s * 0.16, sy + sh * 0.36, s * 0.32, s * 0.07); return; }
        if (chaos && !gold) { ctx.strokeStyle = Fp.ink; ctx.lineWidth = s * 0.06; ctx.beginPath(); for (let a = 0; a < Math.PI * 4; a += 0.4) { const q = (a / (Math.PI * 4)) * s * 0.18; a ? ctx.lineTo(ex + Math.cos(a + t * 6) * q, sy + sh * 0.36 + Math.sin(a + t * 6) * q) : ctx.moveTo(ex, sy + sh * 0.36); } ctx.stroke(); return; }
        const big = mood === 'big' ? 1.4 : 1; ctx.fillRect(ex - s * 0.12 * big + (o.hurt ? 0 : s * 0.04), sy + sh * 0.26 - (big - 1) * s * 0.1, s * 0.24 * big, s * 0.24 * big);
        if (o.hurt) { ctx.fillRect(ex - s * 0.18, sy + sh * 0.14 + k * s * 0.05, s * 0.36, s * 0.06); } };
      px(-sw * 0.22, 0); px(sw * 0.22, 1);
      ctx.strokeStyle = gold > 0.3 ? C.gold : chaos ? C.hot : C.teal; ctx.lineWidth = s * 0.07; ctx.beginPath();
      const N = 10; for (let i = 0; i <= N; i++) { const q = i / N; let xv = 0.3; const rr2 = Math.min(4, r + (q - 1) * 0.3); for (let j = 0; j < 8 + i; j++) xv = rr2 * xv * (1 - xv); const mx = sx + sw * 0.15 + q * sw * 0.7, my = o.asleep ? sy + sh * 0.75 : mood === 'big' ? sy + sh * 0.6 + Math.sin(q * Math.PI) * s * 0.3 : sy + sh * 0.85 - xv * sh * 0.32; i ? ctx.lineTo(mx, my) : ctx.moveTo(mx, my); }
      if (o.hurt) { ctx.beginPath(); ctx.arc(0, sy + sh * 0.95, s * 0.22, Math.PI * 1.15, Math.PI * 1.85); }
      ctx.stroke(); ctx.restore();
      halo(ctx, s, -h / 2 - s * 1.35, F);
    },
  },
  {
    key: 'phi', name: 'Phi', icon: '🐌', colour: C.moss, pillar: 'geometry', pillarIcon: '🌻', boosts: ['golden', 'fib'],
    perk: 'Counts in Fibonacci: every golden cut and every Fibonacci beat counts double.',
    tag: 'A snail whose shell is a golden spiral. The geometric one.',
    story: 'Phi carries the golden ratio on its back: a shell that grows by φ = 1.618 every quarter turn, the spiral the Fibonacci numbers draw. Slow and sleepy while the curve is calm, the shell spins as r climbs and blurs in chaos. Eyes on stalks, so it can look both ways at once.',
    draw(ctx, o, F) {
      const { s, t } = o, { chaos, gold, mood, pulse, speed } = F;
      const body = gold > 0.3 ? C.gold : C.moss;
      // the foot
      ctx.fillStyle = body; ctx.shadowColor = chaos ? C.hot : C.moss; ctx.shadowBlur = s * 0.4;
      ctx.beginPath(); ctx.moveTo(-s * 1.2, s * 0.55); ctx.quadraticCurveTo(-s * 1.3, s * 0.1, -s * 0.7, s * 0.05); ctx.lineTo(s * 0.6, -s * 0.15); ctx.quadraticCurveTo(s * 1.25, -s * 0.2, s * 1.2, s * 0.35); ctx.quadraticCurveTo(s * 1.1, s * 0.62, s * 0.6, s * 0.62); ctx.lineTo(-s * 0.9, s * 0.62); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
      // the shell: a golden spiral, spinning faster as r climbs
      const cx = -s * 0.35, cy = -s * 0.35, spin = t * speed * 0.35;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(spin);
      ctx.fillStyle = gold ? C.gold : chaos ? mix(C.peach, C.hot, 0.35) : C.peach; ctx.shadowColor = C.gold; ctx.shadowBlur = s * (0.3 + (mood === 'golden' ? pulse : gold) * 1.2);
      ctx.beginPath(); ctx.arc(0, 0, s * 0.85, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = C.deep; ctx.lineWidth = s * 0.09; ctx.beginPath();
      for (let th = 0; th <= Math.PI * 4.6; th += 0.12) { const rad = s * 0.055 * Math.pow(CHAOS.PHI, th / (Math.PI / 2)); if (rad > s * 0.85) break; const px = Math.cos(th) * rad, py = Math.sin(th) * rad; th === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
      ctx.stroke();
      if (mood === 'window') { ctx.fillStyle = C.violet; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(Math.cos(i * 2.09) * s * 0.55, Math.sin(i * 2.09) * s * 0.55, s * 0.12, 0, 7); ctx.fill(); } }
      ctx.restore();
      // the head and the eye stalks
      const hx = s * 0.75, hy = s * 0.1, wob = chaos ? Math.sin(t * 11) * 0.3 : Math.sin(t * 2) * 0.08;
      ctx.fillStyle = body; ctx.beginPath(); ctx.arc(hx, hy, s * 0.42, 0, 7); ctx.fill();
      const stalk = (dx, lean, k) => { const tx = hx + dx + Math.sin(lean + wob) * s * 0.55, ty = hy - s * 0.3 - Math.cos(lean + wob) * s * 0.75;
        ctx.strokeStyle = body; ctx.lineWidth = s * 0.14; ctx.beginPath(); ctx.moveTo(hx + dx * 0.5, hy - s * 0.2); ctx.quadraticCurveTo(hx + dx, hy - s * 0.6, tx, ty); ctx.stroke();
        ctx.fillStyle = body; ctx.beginPath(); ctx.arc(tx, ty, s * 0.27, 0, 7); ctx.fill(); eye(ctx, s, tx, ty, s * 0.2, k, F); return [tx, ty]; };
      stalk(-s * 0.15, -0.35, 0); const [bx, by] = stalk(s * 0.25, 0.3, 1);
      if (mood === 'golden') bead(ctx, s * 0.6, bx, by - s * 0.4, F);
      mouth(ctx, s * 0.8, hx + s * 0.05, hy + s * 0.15, s * 0.16, F);
      halo(ctx, s, -s * 1.5, F);
    },
  },
  {
    key: 'kit', name: 'Kit', icon: '🦋', colour: C.violet, pillar: 'symmetry', pillarIcon: '✨', boosts: ['mirror', 'balance'],
    perk: 'Sees the mirror in everything: every mirror and every balance counts double.',
    tag: 'A butterfly whose wings are the curve, mirrored. The symmetric one.',
    story: "Kit is the butterfly effect. Its two wings are the bifurcation diagram and its mirror image, the symmetry hidden in the chaos: f(x) = f(1−x). Its wings beat to the curve's rhythm, twice, four times, then a blur, and both antennae carry a gold bead. The Strange Attractor rank is named for it.",
    draw(ctx, o, F) {
      const { s, t } = o, { chaos, f, gold, mood, speed } = F;
      const flap = 0.55 + 0.45 * Math.cos(t * speed * 1.2), body = gold > 0.3 ? C.gold : C.violet;
      const wing = (dir) => { ctx.save(); ctx.scale(dir * flap, 1);
        const base = gold ? C.gold : chaos ? C.hot : C.violet;
        ctx.globalAlpha = o.alpha * 0.9;
        for (const [ang, len] of [[-0.9, 1.5], [-0.35, 1.7], [0.35, 1.4], [0.95, 1.1]]) branch(ctx, s, s * 0.15, 0, ang, s * len * 0.55, 0, Math.max(1, f), t, chaos, base);
        ctx.globalAlpha = o.alpha; ctx.restore(); };
      wing(1); wing(-1);
      if (mood === 'window') { ctx.globalAlpha = o.alpha * 0.35; ctx.save(); ctx.scale(1.35, 1.35); wing(1); wing(-1); ctx.restore(); ctx.globalAlpha = o.alpha; }
      // the body and the antennae
      ctx.fillStyle = body; ctx.shadowColor = chaos ? C.hot : C.violet; ctx.shadowBlur = s * 0.4;
      ctx.beginPath(); ctx.ellipse(0, s * 0.15, s * 0.3, s * 0.95, 0, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = body; ctx.beginPath(); ctx.arc(0, -s * 0.75, s * 0.42, 0, 7); ctx.fill();
      for (const d of [-1, 1]) { const bx = d * s * 0.45 + Math.sin(t * 2.3 + d) * s * 0.05, by = -s * 1.75; ctx.strokeStyle = body; ctx.lineWidth = s * 0.1; ctx.beginPath(); ctx.moveTo(d * s * 0.15, -s * 1.05); ctx.quadraticCurveTo(d * s * 0.2, -s * 1.5, bx, by); ctx.stroke(); bead(ctx, s * 0.8, bx, by, F); }
      eye(ctx, s, -s * 0.16, -s * 0.8, s * 0.15, 0, F); eye(ctx, s, s * 0.16, -s * 0.8, s * 0.15, 1, F);
      mouth(ctx, s * 0.55, 0, -s * 0.55, s * 0.12, F);
      halo(ctx, s, -s * 2.1, F);
    },
  },
];
export const PAL = Object.fromEntries(PALS.map((p) => [p.key, p]));

// One frame of a pal. x, y: its centre. s: its size (a body radius). t: seconds. r: where the curve
// is. mood / mp: the mood and how far through it (0..1). face: 1 looks right, -1 left.
export function drawPal(key, ctx, opts) {
  const o = { s: 24, t: 0, r: 2.9, mood: null, mp: 0, face: 1, hurt: false, asleep: false, alpha: 1, ...opts };
  const pal = PAL[key] || PALS[0], F = { ...feel(o), hurt: o.hurt, asleep: o.asleep, alpha: o.alpha, mood: o.mood, mp: o.mp, t: o.t };
  ctx.save(); ctx.globalAlpha = o.alpha; ctx.translate(o.x, o.y + F.bob - F.hop); ctx.scale(F.fc, 1); ctx.scale(1 / F.sy, F.sy);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  pal.draw(ctx, o, F);
  sparkles(ctx, o.s, F); zzz(ctx, o.s, F);
  ctx.restore();
}

// A pal living on its own canvas. Own beat (default) or driven from outside (own: false, then call
// set({ r }) and react(ev) yourself). Returns { react, set, hurt, sleep, wake, stop, pal }.
export function palWidget(cv, { pal = 'fig', s = 26, beat = 0.7, own = true, face = 1, r0 = null, dpr = Math.min(2, devicePixelRatio || 1) } = {}) {
  const ctx = cv.getContext('2d');
  const W = cv.width / dpr, H = cv.height / dpr;
  let curve = makeCurve(), r = r0 ?? curve.r, mood = null, moodT = 0, moodDur = 1, hurtT = 0, asleep = false, acc = 0, last = 0, stopped = false, key = pal, ownB = own;
  const st = { react, set, hurt, sleep, wake, stop, get mood() { return mood; }, get r() { return r; }, get pal() { return key; }, force };
  function react(ev) { const m = palMood(ev); if (m) { [mood, moodDur] = m; moodT = 0; } }
  function force(m, dur = 1.4) { mood = m; moodDur = dur; moodT = 0; }
  function set(o) { if (o.r != null) r = o.r; if (o.face != null) face = o.face; if (o.pal) key = o.pal; if (o.own != null) ownB = o.own; }
  function hurt() { hurtT = 1.2; }
  function sleep() { asleep = true; } function wake() { asleep = false; mood = null; }
  function stop() { stopped = true; }
  function frame(t) {
    if (stopped || !cv.isConnected) return;
    const dt = last ? Math.min(0.1, (t - last) / 1000) : 0; last = t;
    if (ownB && !asleep) { acc += dt; while (acc >= beat) { acc -= beat; const ev = stepCurve(curve); r = curve.r; if (curve.r >= 4 - 1e-9 && Math.random() < 0.03) curve = makeCurve(); react(ev); } }
    if (mood) { moodT += dt; if (moodT >= moodDur) mood = null; }
    if (hurtT > 0) hurtT -= dt;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    drawPal(key, ctx, { x: W * 0.5, y: H * 0.56, s, t: t / 1000, r, mood, mp: mood ? moodT / moodDur : 0, face, hurt: hurtT > 0, asleep });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return st;
}
