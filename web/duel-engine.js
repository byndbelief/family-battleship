// Hilltop Duel engine: the hills, wind, shell flight and damage. Shared by the duel page and the lobby previews.
export const W = 800, H = 440, TANK_X = [90, 710], GRAV = 0.12, CRATER_R = 28, BERTHA_R = 44;
function rng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
function baseTerrain(seed) {
  const r = rng(seed * 2654435761), a = [], waves = [];
  for (let i = 0; i < 4; i++) waves.push({ amp: 18 + r() * 42, f: (0.004 + r() * 0.012) * (i + 1) * 0.6, ph: r() * 6.28 });
  for (let x = 0; x < W; x++) { let y = 300; waves.forEach((w) => { y += Math.sin(x * w.f + w.ph) * w.amp; }); a.push(Math.max(170, Math.min(400, y))); }
  TANK_X.forEach((tx) => { const py = a[tx]; for (let x = tx - 22; x <= tx + 22; x++) a[x] = py; });
  return a;
}
function applyCrater(top, [cx, cy, r]) {
  for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) {
    const dy = Math.sqrt(r * r - (x - cx) ** 2);
    if (cy - dy <= top[x]) top[x] = Math.min(H - 8, Math.max(top[x], cy + dy));
  }
}
function buildTop(seed, craters) { const t = baseTerrain(seed); craters.forEach((c) => applyCrater(t, c)); return t; }
const windFor = (seed, move, x = 1) => { const r = rng(seed * 31 + move * 977 + 7); return Math.round((r() * 2 - 1) * 10) * x; };
// xs: where the two tanks stand (they can drive a little each turn); the starting spots by default.
const tankPos = (p, top, xs = TANK_X) => ({ x: xs[p], y: top[xs[p]] });
function simulate(seed, move, top, shooter, angle, power, windX = 1, xs = TANK_X) {
  const dir = shooter === 0 ? 1 : -1, t = tankPos(shooter, top, xs), wind = windFor(seed, move, windX) * 0.004;
  let x = t.x + dir * 14, y = t.y - 18; const v = power * 0.12;
  let vx = Math.cos((angle * Math.PI) / 180) * v * dir, vy = -Math.sin((angle * Math.PI) / 180) * v;
  const path = [];
  for (let i = 0; i < 3000; i++) {
    vx += wind; vy += GRAV; x += vx; y += vy; path.push({ x, y });
    if (x < 0 || x >= W) return { path, impact: null };
    if (y >= top[Math.floor(x)]) return { path, impact: { x, y: top[Math.floor(x)] } };
    const e = tankPos(1 - shooter, top, xs); if (Math.hypot(x - e.x, y - (e.y - 8)) < 13) return { path, impact: { x, y } };
    if (y > H + 50) return { path, impact: null };
  }
  return { path, impact: null };
}
// Damage to both tanks from a blast (you can hit yourself). Big Bertha blasts wider;
// a shield halves the hit.
function damage(top, impact, hp, big = false, shielded = [false, false], xs = TANK_X) {
  const out = [...hp];
  if (!impact) return out;
  [0, 1].forEach((p) => {
    const t = tankPos(p, top, xs), d = Math.hypot(impact.x - t.x, impact.y - (t.y - 8));
    let dmg = big ? (d < 62 ? Math.round(60 - d * 0.9) : 0) : (d < 40 ? Math.round(46 - d * 1.1) : 0);
    if (shielded[p]) dmg = Math.round(dmg / 2);
    out[p] = Math.max(0, out[p] - dmg);
  });
  return out;
}

export { rng, baseTerrain, applyCrater, buildTop, windFor, tankPos, simulate, damage };
