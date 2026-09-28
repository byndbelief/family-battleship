// Hilltop Duel engine: the hills, wind, shell flight and damage. Shared by the duel page and the lobby previews.
export const TANK_X = [90, 710], GRAV = 0.12, CRATER_R = 28, BERTHA_R = 44;
// The battlefield (031): 800 × 440 for two tanks, wider (and taller, same shape) for more, so the
// page zooms out: 1000 for three, 1200 for four (duel_games.world). The page sets it for the duel
// it shows; the numbers everywhere else follow (these are live bindings for importers too).
export let W = 800, H = 440;
export function setWorld(w = 800) { W = w || 800; H = Math.round((440 * W) / 800); }
function rng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
// 3-4 player duels (023): tanks start spread along the ridge and each drives within its own
// stretch. Two players keep the old spots and halves (and aim facing each other, 5-85°); with more,
// the angle is absolute, 5-175°, and past 90° fires to the left.
// Spread across the battlefield's width (the same spots as _duel_start_x / _duel_zone, 031).
const startXs = (n) => (n === 3 ? [90, Math.floor(W / 2), W - 90] : n === 4 ? [90, Math.round(W * 0.375), Math.round(W * 0.625), W - 90] : [90, W - 90]);
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
  for (let x = 0; x < W; x++) { let y = H - 140; waves.forEach((w) => { y += Math.sin(x * w.f + w.ph) * w.amp; }); a.push(Math.max(H - 270, Math.min(H - 40, y))); }
  startXs(n).forEach((tx) => { const py = a[tx]; for (let x = tx - 22; x <= tx + 22; x++) a[x] = py; });
  return a;
}
// A crater [x, y, r] digs a round hole; a mound [x, y, r, 1] (the Dirt Bomb) piles a round hill.
// Digging (029) is relative to the ground as it stands, so every page gets the same result.
// Tunnels: top.under[x] is the floor of a hollow TUN px tall under a roof of hill (top[x] is still
// the surface). A tank there stands on the floor, covered: shells hit the roof above it instead,
// and blasts do half (railgun beams go through hills, so they don't care). A crater that bites
// down into the hollow opens it up.
//   a cut [a, b, from, 2]  (⛏️ Dig mode): from the tank's footing at x=from the tunnel slopes down
//                          0.8 px a px toward the stop, flat for the last 12 px (the tank's length).
//                          Where there's hill enough above, it's a covered tunnel; else a trench.
//   a pit [x, depth, r, 3] (🕳️ Foxhole): x±r comes down to depth below the footing at x.
const TUN = 22, ROOF = 6;
const clampX = (x) => Math.max(0, Math.min(W - 1, Math.round(x)));
const standY = (top, x) => top.under?.[x] ?? top[x];
const coveredAt = (top, x) => x != null && top.under?.[clampX(x)] != null;
function lowerAt(top, x, y) {   // deepen whatever you'd stand on at x
  if (top.under?.[x] != null) top.under[x] = Math.min(H - 8, Math.max(top.under[x], y));
  else top[x] = Math.max(top[x], y);
}
function applyCrater(top, [cx, cy, r, mound]) {
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
  for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) {
    const dy = Math.sqrt(r * r - (x - cx) ** 2);
    if (mound) top[x] = Math.max(24, Math.min(top[x], cy - dy));
    else if (cy - dy <= top[x]) {
      top[x] = Math.min(H - 8, Math.max(top[x], cy + dy));
      // Bit into a tunnel: the roof's gone here and the hollow is open down to its floor.
      if (top.under?.[x] != null && top[x] > top.under[x] - TUN) { top[x] = Math.max(top[x], top.under[x]); delete top.under[x]; }
    }
  }
}
function buildTop(seed, craters, n = 2) { const t = baseTerrain(seed, n); craters.forEach((c) => applyCrater(t, c)); return t; }
const windFor = (seed, move, x = 1) => { const r = rng(seed * 31 + move * 977 + 7); return Math.round((r() * 2 - 1) * 10) * x; };
// xs: where each tank stands (they can drive a little each turn); the starting spots by default.
// A null in xs is a tank that's out: shells fly straight through where it was, and it takes no damage.
const tankPos = (p, top, xs = TANK_X) => (xs[p] == null ? null : { x: xs[p], y: standY(top, xs[p]) });
// Did a shell at (x, y) reach any tank but the shooter's?
const hitTank = (x, y, shooter, top, xs, r = 13) => xs.some((tx, p) => { if (p === shooter || tx == null) return false; return Math.hypot(x - tx, y - (standY(top, tx) - 8)) < r; });
// How far a blast is from a tank. Under a roof it's measured along the ground, however thick the
// hill: a hit on the roof right above always hurts (halved, in the damage below), never nothing.
const blastD = (top, im, t) => (coveredAt(top, t.x) ? Math.abs(im.x - t.x) : Math.hypot(im.x - t.x, im.y - (t.y - 8)));
// Where a shell leaves the barrel: from a tunnel it comes up through the roof above the tank.
const muzzleY = (top, t, x) => (coveredAt(top, t.x) ? top[clampX(x)] - 4 : t.y - 18);
// The tank a homing missile chases: the nearest one that isn't the shooter's.
const nearestFoe = (x, shooter, top, xs) => { let best = null; xs.forEach((tx, p) => { if (p !== shooter && tx != null && (!best || Math.abs(tx - x) < Math.abs(best.x - x))) best = tankPos(p, top, xs); }); return best; };
function simulate(seed, move, top, shooter, angle, power, windX = 1, xs = TANK_X) {
  const { dir, a } = aimDir(shooter, angle, xs), t = tankPos(shooter, top, xs), wind = windFor(seed, move, windX) * 0.004;
  let x = t.x + dir * 14, y = muzzleY(top, t, t.x + dir * 14); const v = power * 0.12;
  let vx = Math.cos((a * Math.PI) / 180) * v * dir, vy = -Math.sin((a * Math.PI) / 180) * v;
  const path = [];
  for (let i = 0; i < 3000; i++) {
    vx += wind; vy += GRAV; x += vx; y += vy; path.push({ x, y });
    if (x < 0 || x >= W) return { path, impact: null };
    if (y >= top[Math.floor(x)]) return { path, impact: { x, y: top[Math.floor(x)] } };
    if (hitTank(x, y, shooter, top, xs)) return { path, impact: { x, y } };
    if (y > H + 50) return { path, impact: null };
  }
  return { path, impact: null };
}
// ---------------------------------------------------------------- special shells (loot)
// Each flies differently; all are deterministic, so every device replays them the same.
//   cluster: bursts at the top of its arc into three bomblets
//   homing:  after the top of its arc it steers toward the enemy tank
//   railgun: a straight beam through hills, no gravity, no wind (power doesn't matter)
//   dirt:    flies like a shell, but piles up a hill where it lands
const WEAPONS = {
  cluster: { icon: '🎆', name: 'Cluster Bomb', r: 18 },
  homing: { icon: '🚀', name: 'Homing Missile', r: 22 },
  railgun: { icon: '⚡', name: 'Railgun', r: 12 },
  dirt: { icon: '🪨', name: 'Dirt Bomb', r: 34 },
};
const railAngle = (angle) => angle - 45;
// Flies a shell from a given state; returns its path and where it hit (null = off the map).
function flyFrom(state, seed, move, top, shooter, windX, xs, steer) {
  const wind = windFor(seed, move, windX) * 0.004, path = [];
  let { x, y, vx, vy } = state;
  for (let i = 0; i < 3000; i++) {
    const e = steer && vy > 0 ? nearestFoe(x, shooter, top, xs) : null;
    if (e) { vx += Math.max(-0.16, Math.min(0.16, (e.x - x) * 0.004)); vx *= 0.99; }
    vx += wind; vy += GRAV; x += vx; y += vy; path.push({ x, y });
    if (x < 0 || x >= W) return { path, impact: null };
    if (y >= top[Math.floor(x)]) return { path, impact: { x, y: top[Math.floor(x)] } };
    if (hitTank(x, y, shooter, top, xs)) return { path, impact: { x, y } };
    if (y > H + 50) return { path, impact: null };
  }
  return { path, impact: null };
}
// Every shell a shot makes: [{ path, impact }] (three for a cluster bomb, one otherwise).
function simulateWeapon(seed, move, top, shooter, angle, power, windX = 1, xs = TANK_X, weapon = null) {
  if (!weapon || weapon === 'dirt') { const s = simulate(seed, move, top, shooter, angle, power, windX, xs); return [s]; }
  const { dir, a: deg } = aimDir(shooter, angle, xs), t = tankPos(shooter, top, xs), a = (deg * Math.PI) / 180;
  const start = { x: t.x + dir * 14, y: muzzleY(top, t, t.x + dir * 14), vx: Math.cos(a) * power * 0.12 * dir, vy: -Math.sin(a) * power * 0.12 };
  if (weapon === 'railgun') {
    // The railgun aims level-ish: the angle setting (5-85) maps to -40° to +40°.
    const path = [], ra = railAngle(deg) * Math.PI / 180;
    let { x, y } = start; const vx = Math.cos(ra) * 9 * dir, vy = -Math.sin(ra) * 9;
    // The beam goes straight through hills; it stops at the enemy tank or the edge of the map.
    for (let i = 0; i < 400; i++) {
      x += vx; y += vy; path.push({ x, y });
      if (x < 0 || x >= W || y < -200 || y > H) return [{ path, impact: null }];
      if (hitTank(x, y, shooter, top, xs, 16)) return [{ path, impact: { x, y } }];
    }
    return [{ path, impact: null }];
  }
  if (weapon === 'homing') return [flyFrom(start, seed, move, top, shooter, windX, xs, true)];
  // cluster: fly to the top of the arc (or impact), then split into three
  const wind = windFor(seed, move, windX) * 0.004, pre = [];
  let { x, y, vx, vy } = start;
  for (let i = 0; i < 3000; i++) {
    vx += wind; vy += GRAV; x += vx; y += vy; pre.push({ x, y });
    if (x < 0 || x >= W) return [{ path: pre, impact: null }];
    if (y >= top[Math.floor(x)]) return [{ path: pre, impact: { x, y: top[Math.floor(x)] } }];
    if (hitTank(x, y, shooter, top, xs)) return [{ path: pre, impact: { x, y } }];
    if (vy >= 0) break;
  }
  return [-1.3, 0, 1.3].map((d) => { const s = flyFrom({ x, y, vx: vx + d, vy: vy - Math.abs(d) * 0.4 }, seed, move, top, shooter, windX, xs, false); return { path: pre.concat(s.path), impact: s.impact }; });
}
// The craters a shot leaves: [x, y, r] each (a mound gets a 4th element, 1).
function weaponCraters(impacts, weapon, big = false) {
  const r = weapon ? WEAPONS[weapon].r : big ? BERTHA_R : CRATER_R;
  return impacts.filter(Boolean).map((i) => (weapon === 'dirt' ? [Math.round(i.x), Math.round(i.y), r, 1] : [Math.round(i.x), Math.round(i.y), r]));
}
// How many craters a saved shot added (a cluster bomb saves a list of them).
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
      else if (weapon === 'homing') dmg += d < 32 ? Math.round(38 - d * 1.1) : 0;
      else if (weapon === 'railgun') dmg += d < 16 ? 45 : 0;
    });
    dmg = Math.round(Math.min(60, dmg) * guardOf(shielded[p]) * (weapon !== 'railgun' && coveredAt(top, t.x) ? 0.5 : 1));
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
    dmg = Math.round(dmg * guardOf(shielded[p]) * (coveredAt(top, t.x) ? 0.5 : 1));
    out[p] = Math.max(0, out[p] - dmg);
  });
  return out;
}
// shielded[p]: true (a Shield: half) or a number (what's left after Shield and Foxhole: 0.5 × 0.6).
const guardOf = (v) => (v === true ? 0.5 : typeof v === 'number' ? v : 1);
// Where a dig from x0 to x1 cuts (the same cut the server saves, _duel_cut in 029): 12 px past the
// tank's stop so the whole tank fits.
const digCut = (x0, x1) => (x0 == null || x1 == null || x1 === x0 ? null : x1 > x0 ? [x0, x1 + 12, x0, 2] : [x1 - 12, x0, x0, 2]);

export { startXs, zones, aimDir, hitTank, rng, baseTerrain, applyCrater, buildTop, windFor, tankPos, simulate, damage, WEAPONS, simulateWeapon, weaponCraters, weaponDamage, craterCount, railAngle, digCut, coveredAt, TUN };
