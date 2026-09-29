// Hilltop Duel engine: the hills, wind, shell flight and damage. Shared by the duel page and the lobby previews.
export const TANK_X = [90, 710], GRAV = 0.12, CRATER_R = 28, BERTHA_R = 44;
// The battlefield (031): 800 × 440 for two tanks, wider (and taller, same shape) for more, so the
// page zooms out: 1000 for three, 1200 for four (duel_games.world). The page sets it for the duel
// it shows; the numbers everywhere else follow (these are live bindings for importers too).
export let W = 800, H = 440;
export function setWorld(w = 800) { W = w || 800; H = Math.round((440 * W) / 800); }   // 5 tanks: 1400, 6: 1600 (032)
// Fractal hills (059, duel_games.terrain 1): the same ground at every zoom. Games made before keep
// their smooth waves (terrain 0). The page sets it with the world, before building any ground.
let FRACTAL = 0;
export function setTerrain(v = 0) { FRACTAL = v || 0; }
// Midpoint displacement: a line split in half again and again, each midpoint nudged by a random
// amount that shrinks by rough each level. amp is the first nudge's range.
function fractalLine(seed, n, amp, rough = 0.55) {
  let size = 1; while (size < n - 1) size <<= 1;
  const a = new Float64Array(size + 1), r = rng(seed);
  a[0] = 0; a[size] = 0; r(); r();   // level ends: no side of the field starts higher by chance
  for (let step = size, h = amp; step > 1; step >>= 1, h *= rough)
    for (let i = 0; i < size; i += step) a[i + step / 2] = (a[i] + a[i + step]) / 2 + (r() - 0.5) * h;
  return a;
}
function rng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
// 3-4 player duels (023): tanks start spread along the ridge and each drives within its own
// stretch. Two players keep the old spots and halves (and aim facing each other, 5-85°); with more,
// the angle is absolute, 5-175°, and past 90° fires to the left.
// Spread across the battlefield's width (the same spots as _duel_start_x / _duel_zone, 031).
const startXs = (n) => (n === 3 ? [90, Math.floor(W / 2), W - 90] : n === 4 ? [90, Math.round(W * 0.375), Math.round(W * 0.625), W - 90]
  : n > 4 ? Array.from({ length: n }, (_, k) => Math.round(90 + (k * (W - 180)) / (n - 1))) : [90, W - 90]);   // 5-6 (032): evenly
// Shell speed per point of power. Range goes with speed², so on a wider battlefield shells fly
// faster by √(width/800): full power spans any field, and 2 tanks play exactly as always.
const PV = () => 0.12 * Math.sqrt(W / 800);
function zones(n) {
  if (n <= 2) return [[30, Math.floor(W / 2) - 70], [Math.floor(W / 2) + 70, W - 30]];
  const s = startXs(n);
  return s.map((x, i) => [i === 0 ? 30 : Math.floor((s[i - 1] + x) / 2) + 50, i === n - 1 ? W - 30 : Math.floor((x + s[i + 1]) / 2) - 50]);
}
// Which way a shot goes and how steep: { dir: 1 (right) or -1 (left), a: 5-85 }.
const aimDir = (shooter, angle, xs = TANK_X) => (xs.length <= 2 ? { dir: shooter === 0 ? 1 : -1, a: angle } : angle <= 90 ? { dir: 1, a: angle } : { dir: -1, a: 180 - angle });
function baseTerrain(seed, n = 2) {
  const r = rng(seed * 2654435761), a = [], waves = [];
  for (let i = 0; i < 4; i++) waves.push({ amp: 18 + r() * 42, f: (0.004 + r() * 0.012) * (i + 1) * 0.6, ph: r() * 6.28 });
  // The hills sit the same way on any width: the ground 140 up from the bottom, hills up to 270.
  const fr = FRACTAL ? fractalLine((seed * 40503 + 17) >>> 0, W, 200) : null;
  for (let x = 0; x < W; x++) {
    let y = H - 140;
    if (fr) { waves.slice(0, 2).forEach((w) => { y += Math.sin(x * w.f * 0.6 + w.ph) * w.amp * 0.7; }); y += fr[x]; }   // two slow swells, fractal crags on them
    else waves.forEach((w) => { y += Math.sin(x * w.f + w.ph) * w.amp; });
    a.push(Math.max(H - 270, Math.min(H - 40, y)));
  }
  startXs(n).forEach((tx) => { const py = a[tx]; for (let x = tx - 22; x <= tx + 22; x++) a[x] = py; });
  return a;
}
// A crater [x, y, r] digs a round hole; a mound [x, y, r, 1] (the Dirt Bomb) piles a round hill.
// Digging (029) is relative to the ground as it stands, so every page gets the same result.
// Tunnels: top.under[x] is the floor of a hollow TUN px tall under a roof of hill (top[x] is still
// the surface). A tank there stands on the floor, covered: shells hit the roof above it instead,
// and a blast with solid hill between it and the tank does nothing (railgun beams go through hills,
// so they don't care; a Bunker Buster bores down into the hollow). Shells fly inside a hollow, so
// a tank in a tunnel fires out of its mouth, or into its own roof. A crater that bites
// down into the hollow opens it up.
//   a cut [a, b, from, 2]  (⛏️ Dig mode): from the tank's footing at x=from the tunnel slopes down
//                          0.8 px a px toward the stop, flat for the last 12 px (the tank's length).
//                          Where there's hill enough above, it's a covered tunnel; else a trench.
//   a pit [x, depth, r, 3] (🕳️ Foxhole): x±r comes down to depth below the footing at x.
//   a shaft [x, y, r, 4] (🔻 Bunker Buster): x±r dug from the surface down to its blast at depth.
const TUN = 22, ROOF = 6;
const clampX = (x) => Math.max(0, Math.min(W - 1, Math.round(x)));
const standY = (top, x) => top.under?.[x] ?? top[x];
const coveredAt = (top, x) => x != null && top.under?.[clampX(x)] != null;
// The hollow's ceiling: TUN above its floor, higher where a blast inside the hill has hollowed it out.
const ceilAt = (top, x) => top.ceil?.[x] ?? top.under[x] - TUN;
function openUp(top, x) { top[x] = Math.max(top[x], top.under[x]); delete top.under[x]; if (top.ceil) delete top.ceil[x]; }
function lowerAt(top, x, y) {   // deepen whatever you'd stand on at x
  if (top.under?.[x] != null) top.under[x] = Math.min(H - 8, Math.max(top.under[x], y));
  else top[x] = Math.max(top[x], y);
}
function applyCrater(top, [cx, cy, r, mound, fill]) {
  if (mound === 2) {
    const from = clampX(r), y0 = standY(top, from), stop = cy > from ? cy - 12 : cx + 12, reach = Math.abs(stop - from);
    for (let x = clampX(cx); x <= clampX(cy); x++) {
      const f = Math.min(H - 10, y0 + 0.8 * Math.min(Math.abs(x - from), reach));
      if (top.under?.[x] == null && top[x] <= f - TUN - ROOF) (top.under ||= [])[x] = f;   // hill above: a tunnel
      else lowerAt(top, x, f);
    }
    return;
  }
  if (mound === 3) { const y = Math.min(H - 8, standY(top, clampX(cx)) + cy); for (let x = clampX(cx - r); x <= clampX(cx + r); x++) lowerAt(top, x, y); return; }
  if (mound === 4) {   // a Bunker Buster [x, y, r, 4]: a shaft from the surface down through its blast underground
    for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) {
      top[x] = Math.min(H - 8, Math.max(top[x], cy + Math.sqrt(r * r - (x - cx) ** 2)));
      if (top.under?.[x] != null && top[x] > ceilAt(top, x)) openUp(top, x);
    }
    return;
  }
  // Chaos twists (042) are placed relative to the ground, which only the pages know:
  //   a meteor [x, depth, r, 5]: a crater dug where it strikes the surface at x
  //   a heave  [x, dh, r, 6]:    an earthquake lifts the ground dh px at x (a dip if dh < 0), easing out over ±r
  if (mound === 5) { applyCrater(top, [cx, top[clampX(cx)] + cy, r]); return; }
  if (mound === 6 && fill === 1) {
    // 🌱 Regrowth [x, dh, r, 6, 1] (052) fills the hollow, not the hill: the ground within ±r rises
    // toward the line between its two rims (the ground at x - r and x + r) and a little over it (30% of
    // dh), by at most dh, and only where it's below that. A hole silts up level with its edges; a
    // hilltop is left alone.
    const x0 = Math.max(0, Math.round(cx - r)), x1 = Math.min(W - 1, Math.round(cx + r)), y0 = top[x0], y1 = top[x1];
    for (let x = x0; x <= x1; x++) {
      const line = x1 > x0 ? y0 + ((y1 - y0) * (x - x0)) / (x1 - x0) : y0, k = (1 + Math.cos((Math.PI * (x - cx)) / r)) / 2;
      const lvl = line - cy * 0.3 * k;   // a little over the rims, so a whole dug-out stretch slowly builds back too
      if (top[x] > lvl) top[x] = Math.max(lvl, top[x] - cy * (0.35 + 0.65 * k));
    }
    return;
  }
  if (mound === 6) {
    // Heaves ease off above a ceiling 15 px over the tallest hill a field starts with (052): what would
    // rise past it rises a quarter as far (25 px at most), so quakes can't stack mountains into the
    // sky; ground already higher (a Dirt Bomb pile) isn't pulled down.
    const ceil = H - 285, x0 = Math.round(cx - r);
    // On fractal ground (059) a rising mountain gets a crag-line of its own, seeded by where it stands.
    const crag = FRACTAL && cy > 0 ? fractalLine((Math.round(cx) * 131 + Math.round(r) * 7 + 1) >>> 0, Math.round(2 * r) + 2, 0.7) : null;
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, Math.round(cx + r)); x++) {
      const k = ((1 + Math.cos((Math.PI * (x - cx)) / r)) / 2) * (crag ? 1 + crag[x - x0] : 1);
      let y = top[x] - cy * k;
      if (cy > 0 && y < ceil) y = Math.min(top[x], Math.max(ceil - 25, ceil - (ceil - y) * 0.25));   // above the ceiling: squashed to a quarter, rounded off
      top[x] = Math.max(24, Math.min(H - 8, y));
      if (top.under?.[x] != null && top[x] > ceilAt(top, x)) openUp(top, x);   // dropped into a tunnel: it's open now
    }
    return;
  }
  const buried = !mound && cy > top[clampX(cx)] + 2;   // went off inside the hill, not on its surface
  for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) {
    const dy = Math.sqrt(r * r - (x - cx) ** 2);
    if (mound) top[x] = Math.max(24, Math.min(top[x], cy - dy));
    else if (cy - dy > top[x]) {
      if (!buried) continue;
      // Went off inside the hill (a tank in a tunnel firing into its roof): it hollows out a cave,
      // or widens the tunnel it's in; a roof blasted thinner than a crust falls in.
      const lo = Math.min(H - 8, cy + dy);
      if (dy < 2) continue;
      if (top.under?.[x] == null) { if (lo - (cy - dy) < 8) continue; (top.under ||= [])[x] = lo; (top.ceil ||= [])[x] = cy - dy; }
      else if (cy - dy < top.under[x] && lo > ceilAt(top, x) - 2) { (top.ceil ||= [])[x] = Math.min(ceilAt(top, x), cy - dy); top.under[x] = Math.max(top.under[x], lo); }
      else continue;
      if (top.ceil[x] - top[x] < 4) openUp(top, x);
    } else {
      top[x] = Math.min(H - 8, Math.max(top[x], cy + dy));
      // Bit into a tunnel: the roof's gone here and the hollow is open down to its floor.
      if (top.under?.[x] != null && top[x] > ceilAt(top, x)) openUp(top, x);
    }
  }
}
function buildTop(seed, craters, n = 2) { const t = baseTerrain(seed, n); craters.forEach((c) => applyCrater(t, c)); return t; }
// windX is the shot's wind multiplier (1, or 3 in a hurricane), plus 10 in 🌙 low gravity (044):
// the flag rides along with it through shots, replays, the live channel and the robot.
// x % 10 is the multiplier: 1, 3 in a 🌪️ hurricane, 5 in a 🌀 tornado (047), which always blows
// hard (at least 4 before multiplying) so a calm move still gets one.
const windFor = (seed, move, x = 1) => { const r = rng(seed * 31 + move * 977 + 7), w = Math.round((r() * 2 - 1) * 10), m = x % 10;
  return m === 5 ? (w < 0 ? -1 : 1) * Math.max(4, Math.abs(w)) * 5 : w * m; };
const gravOf = (windX) => (windX >= 10 ? GRAV * 0.55 : GRAV);
// xs: where each tank stands (they can drive a little each turn); the starting spots by default.
// A null in xs is a tank that's out: shells fly straight through where it was, and it takes no damage.
const tankPos = (p, top, xs = TANK_X) => (xs[p] == null ? null : { x: xs[p], y: standY(top, xs[p]) });
// Did a shell at (x, y) reach any tank but the shooter's?
const hitTank = (x, y, shooter, top, xs, r = 13) => xs.some((tx, p) => { if (p === shooter || tx == null) return false; return Math.hypot(x - tx, y - (standY(top, tx) - 8)) < r; });
// How far a blast is from a tank. Under a roof it's measured along the ground, however thick the
// hill: a hit on the roof right above always hurts (halved, in the damage below), never nothing.
// Solid ground at (x, y)? Below the surface, except inside a tunnel's hollow (see applyCrater).
function solidAt(top, x, y) {
  const i = Math.floor(x); if (i < 0 || i >= W) return false;
  if (y < top[i]) return false;
  const u = top.under?.[i];
  return !(u != null && y > ceilAt(top, i) && y < u);
}
// Where a shell stops when it runs into the ground: the surface, or a tunnel's roof from inside.
const hitAt = (top, x, y) => { const i = Math.floor(x); return y > top[i] + 2 ? { x, y } : { x, y: top[i] }; };
// Is there solid ground between a blast and a tank (more than a crust at the blast's own spot)?
// A tank under a roof of hill is shielded by it from a blast on the far side: the roof takes it.
function blocked(top, im, t) {
  const tx = t.x, ty = t.y - 8, len = Math.hypot(tx - im.x, ty - im.y), n = Math.ceil(len / 2);
  let solid = 0;
  for (let k = 0; k <= n; k++) { const f = k / Math.max(1, n), d = f * len; if (d < 6) continue; if (solidAt(top, im.x + (tx - im.x) * f, im.y + (ty - im.y) * f)) solid += 2; }
  return solid > 8;
}
const blastD = (top, im, t) => (coveredAt(top, t.x) && blocked(top, im, t) ? Infinity : Math.hypot(im.x - t.x, im.y - (t.y - 8)));

// The tank a homing missile chases: the nearest one that isn't the shooter's.
const nearestFoe = (x, shooter, top, xs) => { let best = null; xs.forEach((tx, p) => { if (p !== shooter && tx != null && (!best || Math.abs(tx - x) < Math.abs(best.x - x))) best = tankPos(p, top, xs); }); return best; };
// 🌙 The moon (049) hangs where the page draws it, and a shell that flies into it shatters it: the
// flight ends there ({ impact: null, moon: true }) and that duel's morning comes. The page says
// whether it's still up for the move being flown (setMoon), so every device flies it the same.
let MOON = true;
function setMoon(on) { MOON = !!on; }
const moonAt = () => ({ x: W * 0.7625, y: 90 + (H - 440) * 0.5, r: 30 });
const hitMoon = (x, y) => { if (!MOON) return false; const m = moonAt(); return (x - m.x) ** 2 + (y - m.y) ** 2 < m.r * m.r; };
function simulate(seed, move, top, shooter, angle, power, windX = 1, xs = TANK_X) {
  const { dir, a } = aimDir(shooter, angle, xs), t = tankPos(shooter, top, xs), wind = windFor(seed, move, windX) * 0.004, G = gravOf(windX);
  let x = t.x + dir * 14, y = t.y - 18; const v = power * PV();   // from a tunnel, it has to get out of the tunnel
  let vx = Math.cos((a * Math.PI) / 180) * v * dir, vy = -Math.sin((a * Math.PI) / 180) * v;
  const path = [];
  for (let i = 0; i < 3000; i++) {
    vx += wind; vy += G; x += vx; y += vy; path.push({ x, y });
    if (x < 0 || x >= W) return { path, impact: null };
    if (hitMoon(x, y)) return { path, impact: null, moon: true };
    if (solidAt(top, x, y)) return { path, impact: hitAt(top, x, y) };
    if (hitTank(x, y, shooter, top, xs)) return { path, impact: { x, y } };
    if (y > H + 50) return { path, impact: null };
  }
  return { path, impact: null };
}
// ---------------------------------------------------------------- special shells (loot)
// Each flies differently; all are deterministic, so every device replays them the same.
//   cluster: bursts at the top of its arc into three bomblets
//   fractal: (059) at the top of its arc it forks in two, and each half forks again every 24 ticks,
//            three times: up to 8 small bomblets, branching like a tree (or a lightning bolt)
//   homing:  after the top of its arc it steers toward the enemy tank
//   railgun: a straight beam through hills, no gravity, no wind (power doesn't matter)
//   dirt:    flies like a shell, but piles up a hill where it lands
//   drone:   no shell from the tank: a drone flies in from the shooter's side and drops a bomb at a
//            spot along the map, which falls straight down, drifting with the wind
const WEAPONS = {
  cluster: { icon: '🎆', name: 'Cluster Bomb', r: 18 },
  fractal: { icon: '❄️', name: 'Fractal Shell', r: 11 },
  homing: { icon: '🚀', name: 'Homing Missile', r: 22 },
  railgun: { icon: '⚡', name: 'Railgun', r: 12 },
  dirt: { icon: '🪨', name: 'Dirt Bomb', r: 34 },
  buster: { icon: '🔻', name: 'Bunker Buster', r: 26 },
  drone: { icon: '🚁', name: 'Drone Strike', r: 26 },
};
const railAngle = (angle) => angle - 45;
// A Drone Strike is saved like any shot, as an angle and a power: together they're the drop spot
// (power the coarse part, angle the fine: 81 × 81 steps across the map). Angle stays 5-85.
const DRONE_STEPS = 81 * 81 - 1, DRONE_STEP = 7;
// The drone flies a fifth of the way down: below the score bar, above every hill (they top out near 40%).
const droneY = () => Math.round(H * 0.2);
const droneX = (angle, power) => Math.round((((power - 20) * 81 + (angle - 5)) / DRONE_STEPS) * (W - 1));
function droneAim(x) {
  const c = Math.round((Math.max(0, Math.min(W - 1, x)) / (W - 1)) * DRONE_STEPS);
  return { angle: 5 + (c % 81), power: 20 + Math.floor(c / 81) };
}
// Flies a shell from a given state; returns its path and where it hit (null = off the map).
function flyFrom(state, seed, move, top, shooter, windX, xs, steer) {
  const wind = windFor(seed, move, windX) * 0.004, path = [], G = gravOf(windX);
  let { x, y, vx, vy } = state;
  for (let i = 0; i < 3000; i++) {
    const e = steer && vy > 0 ? nearestFoe(x, shooter, top, xs) : null;
    if (e) { vx += Math.max(-0.16, Math.min(0.16, (e.x - x) * 0.004)); vx *= 0.99; }
    vx += wind; vy += G; x += vx; y += vy; path.push({ x, y });
    if (x < 0 || x >= W) return { path, impact: null };
    if (hitMoon(x, y)) return { path, impact: null, moon: true };
    if (solidAt(top, x, y)) return { path, impact: hitAt(top, x, y) };
    if (hitTank(x, y, shooter, top, xs)) return { path, impact: { x, y } };
    if (y > H + 50) return { path, impact: null };
  }
  return { path, impact: null };
}
// Every shell a shot makes: [{ path, impact }] (three for a cluster bomb, one otherwise).
function simulateWeapon(seed, move, top, shooter, angle, power, windX = 1, xs = TANK_X, weapon = null) {
  if (!weapon || weapon === 'dirt') { const s = simulate(seed, move, top, shooter, angle, power, windX, xs); return [s]; }
  if (weapon === 'drone') {
    // The drone's flight (lead points, drawn as the drone), then the bomb's fall. It can hit anyone,
    // the shooter too.
    const tx = droneX(angle, power), me = tankPos(shooter, top, xs), from = me && me.x > W / 2 ? W + 30 : -30, d = Math.sign(tx - from) || 1;
    const path = [];
    for (let x = from; (tx - x) * d > 0; x += d * DRONE_STEP) path.push({ x, y: droneY() });
    const lead = path.length, wind = windFor(seed, move, windX) * 0.002, G = gravOf(windX);   // a heavy bomb: half a shell's drift
    let x = tx, y = droneY() + 6, vx = 0, vy = 0;
    for (let i = 0; i < 3000; i++) {
      vx += wind; vy += G; x += vx; y += vy; path.push({ x, y });
      if (x < 0 || x >= W || y > H + 50) return [{ path, lead, impact: null }];
      if (solidAt(top, x, y)) return [{ path, lead, impact: hitAt(top, x, y) }];
      if (hitTank(x, y, -1, top, xs)) return [{ path, lead, impact: { x, y } }];
    }
    return [{ path, lead, impact: null }];
  }
  if (weapon === 'buster') {
    // Flies like a shell; where it hits the ground it keeps boring on (up to 80 px) and goes off at
    // the end, or the moment it breaks into a tunnel's hollow.
    const s = simulate(seed, move, top, shooter, angle, power, windX, xs);
    if (!s.impact) return [s];
    const last = s.path[s.path.length - 2] || s.impact, dx = s.impact.x - last.x, dy = s.impact.y - last.y, l = Math.hypot(dx, dy) || 1;
    const ux = dx / l * 0.35, uy = Math.max(0.94, dy / l);   // mostly straight down, a little along its flight
    let x = s.impact.x, y = s.impact.y; const path = [...s.path];
    for (let d = 0; d < 80; d += 2) {
      const nx = x + ux * 2, ny = y + uy * 2;
      if (nx < 0 || nx >= W || ny > H - 4) break;
      x = nx; y = ny; path.push({ x, y });
      const u = top.under?.[Math.floor(x)];
      if (u != null && y > ceilAt(top, Math.floor(x)) && y < u) break;   // into the tunnel: bang
    }
    return [{ path, impact: { x, y } }];
  }
  const { dir, a: deg } = aimDir(shooter, angle, xs), t = tankPos(shooter, top, xs), a = (deg * Math.PI) / 180;
  const start = { x: t.x + dir * 14, y: t.y - 18, vx: Math.cos(a) * power * PV() * dir, vy: -Math.sin(a) * power * PV() };
  if (weapon === 'railgun') {
    // The railgun aims level-ish: the angle setting (5-85) maps to -40° to +40°.
    const path = [], ra = railAngle(deg) * Math.PI / 180;
    let { x, y } = start; const vx = Math.cos(ra) * 9 * dir, vy = -Math.sin(ra) * 9;
    // The beam goes straight through hills; it stops at the enemy tank or the edge of the map.
    for (let i = 0; i < 400; i++) {
      x += vx; y += vy; path.push({ x, y });
      if (x < 0 || x >= W || y < -200 || y > H) return [{ path, impact: null }];
      if (hitMoon(x, y)) return [{ path, impact: null, moon: true }];
      if (hitTank(x, y, shooter, top, xs, 16)) return [{ path, impact: { x, y } }];
    }
    return [{ path, impact: null }];
  }
  if (weapon === 'homing') return [flyFrom(start, seed, move, top, shooter, windX, xs, true)];
  // cluster: fly to the top of the arc (or impact), then split into three
  const wind = windFor(seed, move, windX) * 0.004, pre = [], G = gravOf(windX);
  let { x, y, vx, vy } = start;
  for (let i = 0; i < 3000; i++) {
    vx += wind; vy += G; x += vx; y += vy; pre.push({ x, y });
    if (x < 0 || x >= W) return [{ path: pre, impact: null }];
    if (hitMoon(x, y)) return [{ path: pre, impact: null, moon: true }];
    if (solidAt(top, x, y)) return [{ path: pre, impact: hitAt(top, x, y) }];
    if (hitTank(x, y, shooter, top, xs)) return [{ path: pre, impact: { x, y } }];
    if (vy >= 0) break;
  }
  if (weapon === 'fractal') {
    // Fork: fly each branch 24 ticks (unless it hits first), then split it in two, each half's
    // kick 0.65 of the last; after the third fork the bomblets fly on until they land.
    const G2 = gravOf(windX), out = [];
    const branch = (st, path, depth, kick) => {
      let { x: bx, y: by, vx: bvx, vy: bvy } = st; const p2 = [...path];
      for (let i = 0; i < (depth ? 24 : 3000); i++) {
        bvx += wind; bvy += G2; bx += bvx; by += bvy; p2.push({ x: bx, y: by });
        if (bx < 0 || bx >= W || by > H + 50) return out.push({ path: p2, impact: null });
        if (hitMoon(bx, by)) return out.push({ path: p2, impact: null, moon: true });
        if (solidAt(top, bx, by)) return out.push({ path: p2, impact: hitAt(top, bx, by) });
        if (hitTank(bx, by, shooter, top, xs)) return out.push({ path: p2, impact: { x: bx, y: by } });
      }
      if (!depth) return out.push({ path: p2, impact: null });
      [-1, 1].forEach((d) => branch({ x: bx, y: by, vx: bvx + d * kick, vy: bvy - kick * 0.35 }, p2, depth - 1, kick * 0.65));
    };
    branch({ x, y, vx, vy }, pre, 3, 1.1);
    return out;
  }
  return [-1.3, 0, 1.3].map((d) => { const s = flyFrom({ x, y, vx: vx + d, vy: vy - Math.abs(d) * 0.4 }, seed, move, top, shooter, windX, xs, false); return { path: pre.concat(s.path), impact: s.impact, moon: s.moon }; });
}
// The craters a shot leaves: [x, y, r] each (a mound gets a 4th element, 1).
function weaponCraters(impacts, weapon, big = false) {
  const r = weapon ? WEAPONS[weapon].r : big ? BERTHA_R : CRATER_R;
  return impacts.filter(Boolean).map((i) => (weapon === 'dirt' ? [Math.round(i.x), Math.round(i.y), r, 1] : weapon === 'buster' ? [Math.round(i.x), Math.round(i.y), r, 4] : [Math.round(i.x), Math.round(i.y), r]));
}
// How many craters a saved shot added (a cluster bomb saves a list of them).
const MULTI = new Set(['cluster', 'fractal']);   // shots that save a list of craters
const craterCount = (c) => (!c ? 0 : Array.isArray(c[0]) ? c.length : 1);
// Damage from every shell of a shot (capped at 60 a tank per shot).
function weaponDamage(top, impacts, hp, weapon, big = false, shielded = [], xs = TANK_X) {
  if (!weapon) return damage(top, impacts[0] || null, hp, big, shielded, xs);
  const out = [...hp];
  xs.forEach((_, p) => {
    const t = tankPos(p, top, xs);
    if (!t) return;
    let dmg = 0;
    impacts.filter(Boolean).forEach((im) => {
      const d = weapon === 'railgun' ? Math.hypot(im.x - t.x, im.y - (t.y - 8)) : blastD(top, im, t);
      if (weapon === 'cluster') dmg += d < 30 ? Math.round(30 - d) : 0;
      else if (weapon === 'fractal') dmg += d < 22 ? Math.round(22 - d) : 0;
      else if (weapon === 'homing') dmg += d < 32 ? Math.round(38 - d * 1.1) : 0;
      else if (weapon === 'railgun') dmg += d < 16 ? 45 : 0;
      else if (weapon === 'buster') dmg += d < 40 ? Math.round(50 - d * 1.1) : 0;
      else if (weapon === 'drone') dmg += d < 44 ? Math.round(52 - d * 1.1) : 0;
    });
    dmg = Math.round(Math.min(60, dmg) * guardOf(shielded[p]));
    out[p] = Math.max(0, out[p] - dmg);
  });
  return out;
}

// Damage to every tank from a blast (you can hit yourself). Big Bertha blasts wider;
// a shield halves the hit.
function damage(top, impact, hp, big = false, shielded = [], xs = TANK_X) {
  const out = [...hp];
  if (!impact) return out;
  xs.forEach((_, p) => {
    const t = tankPos(p, top, xs);
    if (!t) return;
    const d = blastD(top, impact, t);
    let dmg = big ? (d < 62 ? Math.round(60 - d * 0.9) : 0) : (d < 40 ? Math.round(46 - d * 1.1) : 0);
    dmg = Math.round(dmg * guardOf(shielded[p]));
    out[p] = Math.max(0, out[p] - dmg);
  });
  return out;
}
// shielded[p]: true (a Shield: half) or a number (what's left after Shield and Foxhole: 0.5 × 0.6).
const guardOf = (v) => (v === true ? 0.5 : typeof v === 'number' ? v : 1);
// Where a dig from x0 to x1 cuts (the same cut the server saves, _duel_cut in 029): 12 px past the
// tank's stop so the whole tank fits.
const digCut = (x0, x1) => (x0 == null || x1 == null || x1 === x0 ? null : x1 > x0 ? [x0, x1 + 12, x0, 2] : [x1 - 12, x0, x0, 2]);

export { MULTI, setMoon, moonAt, startXs, zones, aimDir, hitTank, rng, baseTerrain, applyCrater, buildTop, windFor, gravOf, tankPos, simulate, damage, WEAPONS, simulateWeapon, weaponCraters, weaponDamage, craterCount, railAngle, digCut, coveredAt, ceilAt, TUN, droneX, droneAim, droneY, DRONE_STEP };
