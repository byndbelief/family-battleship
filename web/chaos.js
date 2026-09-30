// 🌀 THE BOX: the chaos standard every game in the room plays by (CHAOS.md has the rules in words).
//
// One curve: x → r·x·(1−x). r starts calm (2.9) and climbs 0.04 a beat to 4. A beat is one move in a
// turn game, or one tick of a solo game's clock. What x lands on decides what the game does, and every
// game reads the same seven events off it, so a player who learns the curve in one game knows it in all.
// The server keeps the very same curve for the multiplayer games (_chaos_curve, 058/062/068); this
// module is the page's copy, and t_chaosbox checks the two agree step for step.
//
// Finding symmetry in chaos: the map has hidden order, and the games reward spotting it.
//   The mirror:   f(x) = f(1−x). A beat that lands at the mirror of the one before (x ≈ 1 − x_prev)
//                 is a ✨ symmetry beat: a gift, in every game.
//   The balance:  x* = 1 − 1/r is the point the curve would settle on. Landing on it is ⚖️ balance:
//                 a calm reward.
//   The window:   inside chaos, at r ∈ [3.8284, 3.8415], the map falls into a rhythm of 3 (the
//                 period-3 window). No twists there; things come in threes.
//   Self-similarity: every dive, depth or Chaos round is the same curve again, further along.

export const CHAOS = Object.freeze({
  R0: 2.9, DR: 0.04, RMAX: 4,
  PEAK: 0.75,     // a wild beat (the server's twist line)
  BIG: 0.93,      // a named twist may start (solo games)
  GOLD: 0.97,     // x all but touches 1: a golden beat
  GIFT: 0.25,     // a calm beat: a small reward
  MIRROR: 0.02,   // |x − (1 − x_prev)| under this: the mirror
  BALANCE: 0.01,  // |x − x*| under this: the balance
  WINDOW: [3.8284, 3.8415],   // the period-3 window on the real map: 1 + √8 to about 3.8415
  WINDOW_N: [24, 26],         // the beats the games spend in it as r passes it (r 3.86 … 3.94): three of them
  FEIGENBAUM: 4.6692,         // each split comes this much sooner than the last
  HIST: 24,
  PHASES: [   // [r at which it starts, name, what it means]
    [3, 'RHYTHM ×2', 'the curve split in two: x flips between two values'],
    [3.449, 'RHYTHM ×4', 'split again: period doubling has begun'],
    [3.544, '8, 16, 32…', 'the splits come faster and faster: the rhythm is falling apart'],
    [3.5699, 'CHAOS', 'no rhythm left: anything can happen now'],
    [4, 'r = 4', 'the top of the curve: full chaos'],
  ],
});

export const phaseOf = (r) => (r < 3 ? 'calm' : r < 3.449 ? 'rhythm ×2' : r < 3.5699 ? 'rhythm ×4…' : 'CHAOS');
export const inWindow = (n) => n >= CHAOS.WINDOW_N[0] && n <= CHAOS.WINDOW_N[1];   // by beat, so a 0.04 step can't skip it
export const fixedPoint = (r) => 1 - 1 / r;

// A curve, `n0` beats along (a Chaos round starts (round − 1)·6 in). x0 random unless given.
export function makeCurve(n0 = 0, x0 = null) {
  return { n: n0, r: Math.min(CHAOS.RMAX, CHAOS.R0 + CHAOS.DR * n0), x: x0 ?? 0.05 + Math.random() * 0.9, hist: [], window: false };
}
// One beat. Returns the events the game acts on.
export function stepCurve(c) {
  const x0 = c.x, r0 = c.r;
  c.n += 1; c.r = Math.min(CHAOS.RMAX, CHAOS.R0 + CHAOS.DR * c.n);
  let x = c.r * x0 * (1 - x0);
  if (x <= 1e-9 || x >= 1 - 1e-9) x = 0.5 + (Math.random() - 0.5) * 1e-3;   // stuck on 0 or 1: a butterfly flaps
  c.x = x; c.hist.push(x); if (c.hist.length > CHAOS.HIST) c.hist.shift();
  const win = inWindow(c.n), enteredWindow = win && !c.window; c.window = win;
  const crossed = CHAOS.PHASES.filter(([at]) => r0 < at && c.r >= at).map(([, name, say]) => ({ name, say }));
  return {
    x, r: c.r, n: c.n, hop: Math.abs(x - x0),
    peak: x > CHAOS.PEAK && !win,
    big: x > CHAOS.BIG && !win,
    gold: x > CHAOS.GOLD,
    gift: x < CHAOS.GIFT,
    mirror: c.n > 1 && Math.abs(x - (1 - x0)) < CHAOS.MIRROR,
    balance: c.r > 1 && Math.abs(x - fixedPoint(c.r)) < CHAOS.BALANCE,
    window: win, enteredWindow,
    crossed,   // phases crossed this beat (usually none, at most a few), newest last
  };
}
export const NEWS = {
  mirror: ['✨ SYMMETRY', 'x landed on the mirror of the beat before: f(x) = f(1−x)'],
  balance: ['⚖️ BALANCE', 'x found the point it would settle on: 1 − 1/r'],
  window: ['🔁 THE WINDOW', 'a rhythm of 3 inside chaos: no twists, things come in threes'],
  gold: ['✨ GOLDEN', 'x all but touched 1'],
};

// The same meter in every HUD: the last beats of x, the red line at the peak, teal until chaos.
export function drawMeter(canvas, c) {
  const mc = canvas.getContext('2d'), w = canvas.width, h = canvas.height, hs = c.hist;
  mc.clearRect(0, 0, w, h);
  if (c.window) { mc.fillStyle = '#C9B8FF22'; mc.fillRect(0, 0, w, h); }
  mc.strokeStyle = '#FF5A4A99'; mc.setLineDash([5, 5]); mc.lineWidth = 2; mc.beginPath(); mc.moveTo(0, h - CHAOS.PEAK * h); mc.lineTo(w, h - CHAOS.PEAK * h); mc.stroke(); mc.setLineDash([]);
  mc.strokeStyle = c.r >= 3.5699 ? '#FF8A3D' : '#3DD6C6'; mc.lineWidth = 3; mc.beginPath();
  hs.forEach((v, i) => mc[i ? 'lineTo' : 'moveTo']((i / (CHAOS.HIST - 1)) * (w - 8) + 4, h - 4 - v * (h - 8))); mc.stroke();
}
export const meterText = (c) => `${c.window ? 'window ×3' : phaseOf(c.r)} · r ${c.r.toFixed(2)}`;
