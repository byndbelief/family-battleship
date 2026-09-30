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
// And our friend Fibonacci: 1, 1, 2, 3, 5, 8, 13, 21… Its ratios close on φ = 1.618…, the golden ratio,
// and 1/φ = 0.618 is the golden cut of [0, 1]. So:
//   Fibonacci beats: beat 1, 2, 3, 5, 8, 13, 21, 34, 55 is a 🌀→🌻 Fibonacci beat: luck runs higher.
//   The golden cut:  x within 0.012 of 0.618 is 🌻 golden: a reward, in every game.
//   Combos count in Fibonacci: the k-th hit of a combo pays F(k) times (1, 1, 2, 3, 5, 8, 13, 21).
//   Shapes shrink by φ: a fractal tree's branches, the ranges of mountains (233, 144, 89).

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
  PHI: 1.6180339887, CUT: 0.6180339887, CUT_TOL: 0.012,   // the golden ratio, the golden cut of x, and how close counts
  FIB: [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144],
  PHASES: [   // [r at which it starts, name, what it means]
    [3, 'RHYTHM ×2', 'the curve split in two: x flips between two values'],
    [3.449, 'RHYTHM ×4', 'split again: period doubling has begun'],
    [3.544, '8, 16, 32…', 'the splits come faster and faster: the rhythm is falling apart'],
    [3.5699, 'CHAOS', 'no rhythm left: anything can happen now'],
    [4, 'r = 4', 'the top of the curve: full chaos'],
  ],
});

// 🧘 CALM WITHIN THE CHAOS: the games that need a think. Their curve starts with a HOLD (r doesn't
// climb, nothing twists; x still walks so gifts still land), then: here comes that chaos curve again.
// Server kinds hold HOLD moves (074); run organs hold RUN_HOLD beats (shell.js); WARN beats before
// the end the warning goes up. The between-round jump into a calm game waits BREATH seconds.
// GLITCH: while held, a beat whose x lands above it is a ⚡ glitch: the rules don't change, the world flickers.
export const CALM = Object.freeze({ kinds: ['golf', 'cards', 'duel'], organs: ['putt', 'hilltop'], HOLD: 8, RUN_HOLD: 10, WARN: 3, BREATH: 12, GLITCH: 0.7 });
export const isCalm = (key) => CALM.kinds.includes(key) || CALM.organs.includes(key);
// 🧭 YOUR COMPANION BENDS THE CURVE'S EDGES for you (079; the server's _chaos_edge says the same):
//   Fig (chaos): the peak line sits at 0.68, not 0.75: peaks come sooner, twists come more often.
//   Kit (symmetry): the mirror is wide, 0.05 not 0.02, and balance 0.03 not 0.01.
//   Bit (fractals): the window lasts 7 beats (22–28), not 3: a longer rhythm of 3, nothing twists.
//   Phi (geometry): the golden cut is wide, 0.03 not 0.012, and Fibonacci luck is doubled.
export const EDGES = Object.freeze({
  fig: { PEAK: 0.68, MIRROR: CHAOS.MIRROR, BALANCE: CHAOS.BALANCE, CUT_TOL: CHAOS.CUT_TOL, WINDOW_N: CHAOS.WINDOW_N, FIB_LUCK: 1 },
  kit: { PEAK: CHAOS.PEAK, MIRROR: 0.05, BALANCE: 0.03, CUT_TOL: CHAOS.CUT_TOL, WINDOW_N: CHAOS.WINDOW_N, FIB_LUCK: 1 },
  bit: { PEAK: CHAOS.PEAK, MIRROR: CHAOS.MIRROR, BALANCE: CHAOS.BALANCE, CUT_TOL: CHAOS.CUT_TOL, WINDOW_N: [22, 28], FIB_LUCK: 1 },
  phi: { PEAK: CHAOS.PEAK, MIRROR: CHAOS.MIRROR, BALANCE: CHAOS.BALANCE, CUT_TOL: 0.03, WINDOW_N: CHAOS.WINDOW_N, FIB_LUCK: 2 },
});
export const edgesOf = (pal) => EDGES[pal] || EDGES.fig;
export const EDGE_SAY = Object.freeze({
  fig: 'peaks come sooner: x above 0.68 twists (not 0.75)', kit: 'a wide mirror (0.05) and a wide balance (0.03)',
  bit: 'a long window: the rhythm of 3 lasts 7 beats, nothing twists', phi: 'a wide golden cut (0.03) and double Fibonacci luck',
});
export const phaseOf = (r) => (r < 3 ? 'calm' : r < 3.449 ? 'rhythm ×2' : r < 3.5699 ? 'rhythm ×4…' : 'CHAOS');
export const inWindow = (n, pal = null) => { const w = pal ? edgesOf(pal).WINDOW_N : CHAOS.WINDOW_N; return n >= w[0] && n <= w[1]; };   // by beat, so a 0.04 step can't skip it
export const fixedPoint = (r) => 1 - 1 / r;
export const isFib = (n) => CHAOS.FIB.includes(n);
export const fibMult = (k) => CHAOS.FIB[Math.max(0, Math.min(CHAOS.FIB.length - 1, k))];   // F(k): combo k pays F(k) times (k = 1 → 1, 2 → 2, 3 → 3, 4 → 5 …)

// A curve, `n0` beats along (a Chaos round starts (round − 1)·6 in). x0 random unless given.
export function makeCurve(n0 = 0, x0 = null) {
  return { n: n0, r: Math.min(CHAOS.RMAX, CHAOS.R0 + CHAOS.DR * n0), x: x0 ?? 0.05 + Math.random() * 0.9, hist: [], window: false };
}
// One beat. Returns the events the game acts on.
export function stepCurve(c, { hold = false, pal = null } = {}) {   // hold: 🧘 x walks but r stays (no beat counted); pal: 🧭 whose edges
  const x0 = c.x, r0 = c.r, E = edgesOf(pal || c.pal);
  if (!hold) { c.n += 1; c.r = Math.min(CHAOS.RMAX, CHAOS.R0 + CHAOS.DR * c.n); }
  let x = c.r * x0 * (1 - x0);
  if (x <= 1e-9 || x >= 1 - 1e-9) x = 0.5 + (Math.random() - 0.5) * 1e-3;   // stuck on 0 or 1: a butterfly flaps
  c.x = x; c.hist.push(x); if (c.hist.length > CHAOS.HIST) c.hist.shift();
  const win = inWindow(c.n, pal || c.pal), enteredWindow = win && !c.window; c.window = win;
  const crossed = CHAOS.PHASES.filter(([at]) => r0 < at && c.r >= at).map(([, name, say]) => ({ name, say }));
  return {
    x, r: c.r, n: c.n, hop: Math.abs(x - x0), held: hold, glitch: hold && x > CALM.GLITCH,
    peak: x > E.PEAK && !win && !hold,
    big: x > CHAOS.BIG && !win && !hold,
    gold: x > CHAOS.GOLD,
    gift: x < CHAOS.GIFT,
    mirror: c.n > 1 && Math.abs(x - (1 - x0)) < E.MIRROR,
    balance: c.r > 1 && Math.abs(x - fixedPoint(c.r)) < E.BALANCE,
    window: win, enteredWindow,
    fib: isFib(c.n) && !hold,
    golden: Math.abs(x - CHAOS.CUT) < E.CUT_TOL,
    luck: E.FIB_LUCK,   // 🧭 Phi: Fibonacci beats pay double luck
    crossed,   // phases crossed this beat (usually none, at most a few), newest last
  };
}
export const NEWS = {
  mirror: ['✨ SYMMETRY', 'x landed on the mirror of the beat before: f(x) = f(1−x)'],
  balance: ['⚖️ BALANCE', 'x found the point it would settle on: 1 − 1/r'],
  window: ['🔁 THE WINDOW', 'a rhythm of 3 inside chaos: no twists, things come in threes'],
  gold: ['✨ GOLDEN', 'x all but touched 1'],
  golden: ['🌻 GOLDEN CUT', 'x landed on 1/φ = 0.618: the golden ratio'],
  calm: ['🧘 CALM WITHIN THE CHAOS', 'take your time: r holds and nothing twists'],
  again: ['😎 HERE COMES THAT CHAOS CURVE AGAIN', 'r climbs from the next beat'],
  glitch: ['⚡ GLITCH', 'the chaos leaks through the calm: nothing changed. Probably.'],
  fib: ['🌻 FIBONACCI BEAT', '1, 1, 2, 3, 5, 8, 13…: luck runs higher this beat'],
};

// The same meter in every HUD: the last beats of x, the red line at the peak, teal until chaos.
// the meter's line takes your companion's colours (theme.css --pal / --pal-2), read once a second
let meterC = null, meterAt = 0;
function meterColours() { if (typeof document === 'undefined') return ['#3DD6C6', '#FF8A3D']; if (Date.now() - meterAt > 1000) { const cs = getComputedStyle(document.documentElement); meterC = [cs.getPropertyValue('--pal').trim() || '#3DD6C6', cs.getPropertyValue('--pal-2').trim() || '#FF8A3D']; meterAt = Date.now(); } return meterC; }
const palAttr = () => (typeof document === 'undefined' ? null : document.documentElement.dataset.pal || null);
export function drawMeter(canvas, c) {
  const E = edgesOf(c.pal || palAttr());
  const mc = canvas.getContext('2d'), w = canvas.width, h = canvas.height, hs = c.hist;
  mc.clearRect(0, 0, w, h);
  if (c.window) { mc.fillStyle = '#C9B8FF22'; mc.fillRect(0, 0, w, h); }
  mc.strokeStyle = '#FF5A4A99'; mc.setLineDash([5, 5]); mc.lineWidth = 2; mc.beginPath(); mc.moveTo(0, h - E.PEAK * h); mc.lineTo(w, h - E.PEAK * h); mc.stroke(); mc.setLineDash([]);   // your peak line
  if (E.CUT_TOL > CHAOS.CUT_TOL) { mc.fillStyle = '#F5C54222'; mc.fillRect(0, h - (CHAOS.CUT + E.CUT_TOL) * h, w, 2 * E.CUT_TOL * h); }   // 🧭 Phi: the wide cut
  mc.strokeStyle = '#F5C54266'; mc.setLineDash([2, 6]); mc.lineWidth = 1.5; mc.beginPath(); mc.moveTo(0, h - CHAOS.CUT * h); mc.lineTo(w, h - CHAOS.CUT * h); mc.stroke(); mc.setLineDash([]);   // 🌻 the golden cut
  if (isFib(c.n)) { mc.fillStyle = '#F5C542'; mc.font = '900 11px system-ui'; mc.textAlign = 'right'; mc.fillText('F', w - 4, 12); }
  const [calmC, hotC] = meterColours(); mc.strokeStyle = c.r >= 3.5699 ? hotC : calmC; mc.lineWidth = 3; mc.beginPath();
  hs.forEach((v, i) => mc[i ? 'lineTo' : 'moveTo']((i / (CHAOS.HIST - 1)) * (w - 8) + 4, h - 4 - v * (h - 8))); mc.stroke();
}
// 🌀 The chaos rating (071): keeping score is also about how you play the curve. A game tallies the
// events its beats meet (tally(ev, t)); a solo game hands the tally to solo_submit, the server marks
// its own moves. The weights and ranks here mirror _chaos_weight / _chaos_rank.
export const WEIGHTS = Object.freeze({ peak: 1, gift: 1, fib: 2, phase: 2, big: 3, window: 4, balance: 5, mirror: 8, golden: 8, gold: 10, r4: 10, bond: 1 });   // bond: the companion's bonus (077), in points
export const RANKS = [[1280, 'Strange Attractor'], [640, 'Chaos'], [320, 'Cascade'], [160, 'Rhythm ×4'], [60, 'Rhythm ×2'], [0, 'Calm']];
export const rankOf = (rating) => RANKS.find(([at]) => rating >= at)[1];
export const RANK_ICON = { Calm: '🌱', 'Rhythm ×2': '🎵', 'Rhythm ×4': '🎶', Cascade: '🌊', Chaos: '🌀', 'Strange Attractor': '🦋' };
export function tally(ev, t = {}) {
  ['peak', 'gift', 'fib', 'big', 'window', 'balance', 'mirror', 'golden', 'gold'].forEach((k) => { if (ev[k]) t[k] = (t[k] || 0) + 1; });
  ev.crossed.forEach((p) => { const k = p.name === 'r = 4' ? 'r4' : 'phase'; t[k] = (t[k] || 0) + 1; });
  return t;
}
export const tallyPoints = (t) => Object.entries(t).reduce((a, [k, n]) => a + (WEIGHTS[k] || 0) * n, 0);
// The line under a solo game's score: what the run earned, and where the player stands now.
export const ratingLine = (ch) => (ch ? `🌀 Chaos rating +${ch.gained} → <b>${ch.rating}</b> · ${RANK_ICON[ch.rank] || ''} ${ch.rank}${ch.next ? ` · ${ch.next - ch.rating} to ${rankOf(ch.next)}` : ''}` : '');

export const meterText = (c) => `${c.window ? 'window ×3' : phaseOf(c.r)} · r ${c.r.toFixed(2)}`;
