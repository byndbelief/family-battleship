// 🔺 Fractal Dash: a solo dash across a fractal landscape. You're a little Sierpiński
// triangle, running ever faster over ground made of fractal noise (a ridge that gets rougher as the
// chaos curve climbs). Tap to jump (again in the air for a double jump), hold to dash: a dash phases
// through spikes while its meter lasts. Spikes, chasms and shards come to the beat of the chaos curve
// x → r·x·(1−x): calm at first, then a rhythm of 2, then 4, then chaos, with twists at its peaks.
// Every 25 s the world zooms into a copy of itself, a depth deeper: faster, rougher, another colour.
// Everything is played on this page; the score is saved with solo_submit (063, 066).
import { sb, me, signedIn, sfx, setGameTools, esc, names } from './common.js';

const $ = (id) => document.getElementById(id);
const cv = $('fd'), ctx = cv.getContext('2d'), stage = $('stage');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const W = 400;                    // the world is 400 across; its height follows the screen's shape
let H = 640, k = 1, dpr = 1;
const DEPTH_S = 25, BEAT = 0.8, GRAV = 1500, JUMP = 520, DASH_MAX = 1.4, PX = 96, R = 13;   // PX: where you stand on screen; R: your size
const PALETTES = [   // one per depth, then round again
  { sky: ['#0B0A1F', '#2A1F6A'], far: '#2A2270', near: '#3A2F8F', ground: '#0A0918', edge: '#3DF2E0', spike: '#FF5FB0', shard: '#F5C542' },
  { sky: ['#0A1A1F', '#1A5A66'], far: '#1D5C66', near: '#2A7A85', ground: '#07171B', edge: '#F5C542', spike: '#FF6B5E', shard: '#3DF2E0' },
  { sky: ['#1F0A16', '#5A1A40'], far: '#6B1D4A', near: '#8F2A63', ground: '#160810', edge: '#FF5FB0', spike: '#3DF2E0', shard: '#C9FFF8' },
  { sky: ['#1A1405', '#5A4812'], far: '#6B5A1D', near: '#8F7A2A', ground: '#120F04', edge: '#FFE08A', spike: '#FF5FB0', shard: '#3DF2E0' },
];
const hash = (i) => { let x = (Math.imul(i | 0, 374761393) + 668265263) | 0; x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
const smooth = (t) => t * t * (3 - 2 * t);
// Value noise at x (world units), octave o; seeded per run and per depth so every dive is a new ridge.
const noise = (x, o, seed) => { const i = Math.floor(x), t = smooth(x - i); const a = hash(i * 7919 + o * 104729 + seed), b = hash((i + 1) * 7919 + o * 104729 + seed); return a + (b - a) * t; };

// ---------------------------------------------------------------- sizing
function size() {
  const fs = !!document.querySelector('#play.fs-on');
  const r = stage.getBoundingClientRect();
  const w = r.width, h = fs ? innerHeight : Math.max(420, innerHeight - r.top - 12);
  dpr = Math.min(2, devicePixelRatio || 1);
  cv.style.height = `${h}px`; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  k = cv.width / W; H = cv.height / k;
}

// ---------------------------------------------------------------- the ground
// A fractal ridge: five octaves of value noise, the small ones louder the rougher the world (depth and
// the chaos curve's r both roughen it). Chasms are cut out of it as obstacles.
let game = null, depth = 1;
const rough = () => Math.min(1.6, 0.35 + (depth - 1) * 0.28 + Math.max(0, game.curve.r - 2.9) * 0.6);
function groundY(x) {
  const g = game, s = g.seed + depth * 1000, ro = rough();
  const base = H * 0.68;
  const y = base + (noise(x / 220, 1, s) - 0.5) * 90 + (noise(x / 90, 2, s) - 0.5) * 44 * ro + (noise(x / 38, 3, s) - 0.5) * 22 * ro
    + (noise(x / 16, 4, s) - 0.5) * 10 * ro * ro + (noise(x / 7, 5, s) - 0.5) * 5 * ro * ro;
  return Math.max(H * 0.34, Math.min(H - 40, y));
}
const inGap = (x) => game.obs.find((o) => o.type === 'gap' && x > o.x && x < o.x + o.w);

// ---------------------------------------------------------------- a run
function newGame() {
  depth = 1;
  game = { seed: Math.floor(Math.random() * 1e6), cam: 0, speed: 175, time: 0, dive: null, over: false, ko: false,
    py: 0, vy: 0, onGround: true, jumps: 0, dash: DASH_MAX, dashing: false, inv: 0,
    score: 0, dist: 0, shards: 0, combo: 0, comboT: 0, hearts: 3,
    obs: [], parts: [], twist: null, curve: { x: 0.05 + Math.random() * 0.9, r: 2.85, n: 0, hist: [], beatT: 0 }, phase: 'calm', shake: 0, fog: 0 };
  game.py = groundY(PX) - R;
  hud(); banner('FRACTAL DASH', 'tap to jump · hold to dash');
}
const phaseOf = (r) => (r < 3 ? 'calm' : r < 3.449 ? 'rhythm ×2' : r < 3.5699 ? 'rhythm ×4…' : 'CHAOS');
// One beat of the chaos curve: r climbs, x hops, and what x lands on decides what's coming up the road.
function chaosStep() {
  const c = game.curve, r0 = c.r, x0 = c.x;
  c.n += 1; c.r = Math.min(4, 2.85 + 0.02 * c.n);
  c.x = c.r * c.x * (1 - c.x); if (c.x <= 1e-6 || c.x >= 1 - 1e-6) c.x = 0.5 + (Math.random() - 0.5) * 1e-3;
  c.hist.push(c.x); if (c.hist.length > 24) c.hist.shift();
  const ph = phaseOf(c.r);
  if (ph !== game.phase) { game.phase = ph; banner(ph === 'CHAOS' ? 'CHAOS' : ph.toUpperCase(), ph === 'CHAOS' ? 'no rhythm left: anything can happen' : ph === 'calm' ? '' : 'the curve split: x → r·x·(1−x)'); sfx(ph === 'CHAOS' ? 'stinger' : 'tick'); }
  // What comes: a peak (x > 0.75) is spikes, a big hop of x is a chasm as wide as the hop, a trough is
  // shards. Calm (x settled, no hops) is a warm-up with a few shards; a rhythm is an obstacle a beat.
  const ahead = game.cam + W + 60, x = c.x, d = Math.abs(x - x0);
  if (x > 0.75) { const n = 1 + Math.floor((x - 0.75) * 14); game.obs.push({ type: 'spike', x: ahead, n }); }
  else if (d > 0.08) { const w = Math.min(150, 40 + Math.floor(d * 150) + depth * 8); game.obs.push({ type: 'gap', x: ahead, w }); }
  else if (x < 0.35 || c.n % 3 === 0) { const n = 3 + Math.floor(Math.max(0, 0.35 - x) * 12); for (let i = 0; i < n; i++) game.obs.push({ type: 'shard', x: ahead + i * 22, lift: 40 + Math.sin(i / (n - 1) * Math.PI) * 70, t: i }); }
  // A twist at the curve's peaks, once it's chaotic.
  if (x > 0.96 && c.r >= 3.5699 && !game.twist) twist();
  if (r0 < 4 && c.r >= 4) banner('r = 4', 'the top of the curve: full chaos');
}
const TWISTS = [
  { k: 'gust', name: '💨 TAILWIND', sub: 'twice the speed for a few seconds', dur: 4 },
  { k: 'fog', name: '🌫️ FOG', sub: 'the road hides until the last moment', dur: 7 },
  { k: 'quake', name: '🌋 QUAKE', sub: 'the ground heaves', dur: 5 },
  { k: 'rain', name: '✨ SHARD RAIN', sub: 'catch what you can', dur: 4 },
  { k: 'moon', name: '🌙 LOW GRAVITY', sub: 'long floaty jumps', dur: 6 },
];
function twist() {
  const t = TWISTS[Math.floor(Math.random() * TWISTS.length)];
  game.twist = { ...t, t: 0 }; banner(t.name, t.sub); sfx('whistle');
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
  g.time += dt;
  if (g.dive) { g.dive.t += dt; if (g.dive.t >= g.dive.dur) { g.dive = null; } return; }
  // Depth: every 25 s, a dive into a copy of the world.
  if (g.time >= depth * DEPTH_S) return dive();
  // The chaos curve beats.
  g.curve.beatT += dt; if (g.curve.beatT >= BEAT) { g.curve.beatT -= BEAT; chaosStep(); }
  if (g.twist) { g.twist.t += dt; if (g.twist.k === 'rain' && Math.random() < dt * 9) g.obs.push({ type: 'shard', x: g.cam + PX + 40 + Math.random() * (W - 120), lift: 60 + Math.random() * 120, t: 0, fall: true }); if (g.twist.t >= g.twist.dur) g.twist = null; }
  const gust = g.twist?.k === 'gust' ? 1.9 : 1, moon = g.twist?.k === 'moon' ? 0.45 : 1;
  g.fog += ((g.twist?.k === 'fog' ? 1 : 0) - g.fog) * Math.min(1, dt * 3);
  // Speed climbs with time and depth; a dash nearly doubles it while the meter lasts.
  g.speed = Math.min(560, 175 + (depth - 1) * 45 + g.time * 1.6);
  if (g.dashing && g.dash > 0) { g.dash = Math.max(0, g.dash - dt); if (g.dash === 0) g.dashing = false; }
  else if (g.onGround) g.dash = Math.min(DASH_MAX, g.dash + dt * 0.9);
  const v = g.speed * gust * (g.dashing ? 1.8 : 1);
  g.cam += v * dt; g.dist += v * dt;
  g.score = Math.floor(g.dist / 10) + g.shards;
  // You: gravity, the ground under your feet, the edge of a chasm.
  const px = g.cam + PX, gy = groundY(px), gap = inGap(px);
  const quake = g.twist?.k === 'quake' ? Math.sin(g.time * 9) * 12 : 0;
  g.vy += GRAV * moon * dt; g.py += g.vy * dt;
  const floor = gap ? H + 60 : gy + quake - R;
  if (g.py >= floor && g.vy >= 0 && !gap) { g.py = floor; g.vy = 0; if (!g.onGround) { g.onGround = true; g.jumps = 0; puff(px, g.py + R, 4); } }
  else g.onGround = false;
  if (g.inv > 0) g.inv -= dt;
  if (g.py > H + 40) fall();
  // Obstacles: spikes hurt (unless you're dashing), shards score, and everything behind you is gone.
  g.obs = g.obs.filter((o) => {
    if (o.type === 'shard') {
      if (o.fall) o.lift = Math.max(6, o.lift - dt * 90);
      const sy = groundY(o.x) - o.lift, dx = o.x - px, dy = sy - g.py;
      if (Math.hypot(dx, dy) < R + 12) { collect(o.x, sy); return false; }
    } else if (o.type === 'spike' && g.inv <= 0 && !g.dashing) {
      const w = o.n * 14;
      if (px + R * 0.6 > o.x && px - R * 0.6 < o.x + w && g.py + R > groundY(o.x + w / 2) + quake - 15) hurt('spiked');
    }
    return o.x + (o.w || o.n * 14 || 0) > g.cam - 60;
  });
  g.parts = g.parts.filter((p) => { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 600 * dt; return p.t < p.life; });
  if (g.dashing && Math.random() < dt * 40) g.parts.push({ x: px - R, y: g.py + (Math.random() - 0.5) * R, vx: -v * 0.5, vy: (Math.random() - 0.5) * 60, t: 0, life: 0.35, c: '#3DF2E0' });
  if (g.comboT > 0) { g.comboT -= dt; if (g.comboT <= 0) g.combo = 0; }
  if (g.shake > 0) g.shake = Math.max(0, g.shake - dt * 3);
  hud();
}
function collect(x, y) {
  const g = game;
  g.combo = g.comboT > 0 ? g.combo + 1 : 1; g.comboT = 1.6;
  const pts = 50 * Math.min(8, g.combo); g.shards += pts;
  for (let i = 0; i < 8; i++) g.parts.push({ x, y, vx: (Math.random() - 0.5) * 220, vy: (Math.random() - 0.8) * 220, t: 0, life: 0.5, c: PALETTES[(depth - 1) % PALETTES.length].shard });
  sfx('chime', { hi: g.combo > 3 });
}
function puff(x, y, n) { for (let i = 0; i < n; i++) game.parts.push({ x, y, vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 80, t: 0, life: 0.3, c: '#ffffff88' }); }
function hurt(how) {
  const g = game;
  g.hearts -= 1; g.inv = 1.4; g.combo = 0; g.comboT = 0; g.shake = 1; sfx('thud');
  for (let i = 0; i < 12; i++) g.parts.push({ x: g.cam + PX, y: g.py, vx: (Math.random() - 0.5) * 300, vy: (Math.random() - 0.7) * 300, t: 0, life: 0.6, c: '#FF5FB0' });
  if (g.hearts <= 0) { g.ko = how; finish(); } else banner(how === 'spiked' ? 'OUCH' : 'SPLASH', `${g.hearts} ${g.hearts === 1 ? 'heart' : 'hearts'} left`);
}
function fall() {
  const g = game;
  hurt('fell');
  if (g.over) return;
  // Back on solid ground just past the chasm.
  const gap = inGap(g.cam + PX) || g.obs.filter((o) => o.type === 'gap' && o.x + o.w < g.cam + PX).pop();
  if (gap) g.cam = gap.x + gap.w + 12 - PX;
  g.py = groundY(g.cam + PX) - R - 40; g.vy = 0;
}
function jump() {
  const g = game; if (!g || g.over || g.dive) return;
  if (g.onGround || g.jumps < 2) { g.vy = -JUMP * (g.onGround ? 1 : 0.85); g.jumps = g.onGround ? 1 : 2; g.onGround = false; sfx('putt', { power: 0.6 }); puff(g.cam + PX, g.py + R, 3); }
}
function dive() {
  const g = game;
  depth += 1;
  g.dive = { t: 0, dur: reduceMotion ? 0.01 : 1.1 };
  g.seed = (g.seed * 16807 + depth) % 2147483647;   // a new ridge inside the old
  g.obs = []; g.twist = null; g.py = groundY(g.cam + PX) - R; g.vy = 0; g.onGround = true; g.jumps = 0;
  g.hearts = Math.min(3, g.hearts + 1); g.dash = DASH_MAX;
  banner(`DEPTH ${depth}`, 'a world inside the world · ❤️ +1'); sfx('birdie');
}
async function finish() {
  const g = game; g.over = true; sfx('lose');
  showOver(`<h2>🔺 ${g.score.toLocaleString()} points</h2><p class="muted">saving…</p>`);
  const { data, error } = await sb.rpc('solo_submit', { p_game: 'fractal', p_score: g.score, p_level: Math.min(99, depth) });
  const board = data?.top?.length ? `<ol class="board">${data.top.map((r, i) => `<li class="${r.player === me.id ? 'me' : ''}"><span>${i + 1}. ${esc(r.name)}</span><b>${r.score.toLocaleString()}</b></li>`).join('')}</ol>` : '';
  showOver(`<h2 style="color:#FF7A6E">${g.ko === 'fell' ? '🕳️ INTO THE DEEP' : '💥 SPIKED'}</h2><h2>🔺 ${g.score.toLocaleString()} points</h2>${data?.record ? '<p style="color:var(--gold)">🏆 Your new best!</p>' : data ? `<p class="muted small">Your best: ${data.best.toLocaleString()}</p>` : ''}
    <p class="muted small">${Math.floor(g.dist / 10).toLocaleString()} m at depth ${depth} · ${g.shards.toLocaleString()} from shards · chaos reached r = ${g.curve.r.toFixed(2)}</p>
    ${error ? `<p class="small" style="color:#FF9A7A">Couldn't save: ${esc(error.message || '')}</p>` : ''}${board}
    <button class="go" id="again">Dash again</button>`, true);
}

// ---------------------------------------------------------------- drawing
function sierp(x, y, s, d, up = true) {   // a Sierpiński triangle, point up, s across
  if (d === 0) { const h = s * 0.866; ctx.moveTo(x, up ? y - h / 2 : y + h / 2); ctx.lineTo(x + s / 2, up ? y + h / 2 : y - h / 2); ctx.lineTo(x - s / 2, up ? y + h / 2 : y - h / 2); ctx.closePath(); return; }
  const h = s * 0.866, q = s / 4, hh = h / 4;
  sierp(x, y - hh * (up ? 1 : -1), s / 2, d - 1, up); sierp(x - q, y + hh * (up ? 1 : -1), s / 2, d - 1, up); sierp(x + q, y + hh * (up ? 1 : -1), s / 2, d - 1, up);
}
function draw(t) {
  const g = game, pal = PALETTES[(depth - 1) % PALETTES.length];
  ctx.setTransform(k, 0, 0, k, 0, 0);
  if (g?.shake) { ctx.translate((Math.random() - 0.5) * 10 * g.shake, (Math.random() - 0.5) * 10 * g.shake); }
  // The dive: the world swells around you, into itself.
  if (g?.dive) { const p = g.dive.t / g.dive.dur, z = 1 + p * p * 3; ctx.translate(PX, g.py); ctx.scale(z, z); ctx.translate(-PX, -g.py); ctx.globalAlpha = 1 - p * 0.7; }
  const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, pal.sky[0]); sky.addColorStop(1, pal.sky[1]);
  ctx.fillStyle = sky; ctx.fillRect(-W, -H, W * 3, H * 3);
  const cam = g ? g.cam : t / 40;
  // Far and near ranges of Sierpiński mountains, parallax.
  [[0.25, 0.42, 190, 4, pal.far], [0.5, 0.58, 120, 3, pal.near]].forEach(([par, yy, s, d, col]) => {
    ctx.fillStyle = col; ctx.beginPath();
    const off = (cam * par) % (s * 1.1);
    for (let x = -off - s; x < W + s; x += s * 1.1) { const i = Math.floor((x + off + cam * par) / (s * 1.1)); sierp(x + s / 2, H * yy + (hash(i + 7) - 0.5) * 60 + s * 0.43, s, d); }
    ctx.fill();
  });
  if (!g) { ctx.globalAlpha = 1; return; }
  // The ground: the ridge, with chasms cut out.
  ctx.fillStyle = pal.ground; ctx.strokeStyle = pal.edge; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
  const quake = g.twist?.k === 'quake' ? Math.sin(g.time * 9) * 12 : 0;
  let open = false;
  ctx.beginPath();
  for (let sx = -6; sx <= W + 6; sx += 5) {
    const wx = g.cam + sx, gap = inGap(wx);
    if (gap) { if (open) { ctx.lineTo(sx - 5, H + 10); ctx.closePath(); open = false; } continue; }
    const y = groundY(wx) + quake;
    if (!open) { ctx.moveTo(sx, H + 10); ctx.lineTo(sx, y); open = true; } else ctx.lineTo(sx, y);
  }
  if (open) { ctx.lineTo(W + 6, H + 10); ctx.closePath(); }
  ctx.fill(); ctx.stroke();
  // Chasm glow (the deep is bright).
  g.obs.forEach((o) => { if (o.type !== 'gap') return; const x0 = o.x - g.cam, gr = ctx.createLinearGradient(0, H * 0.7, 0, H); gr.addColorStop(0, '#0000'); gr.addColorStop(1, pal.edge + '66'); ctx.fillStyle = gr; ctx.fillRect(x0, H * 0.5, o.w, H * 0.5); });
  // Spikes and shards.
  const fogA = g.fog;
  g.obs.forEach((o) => {
    const sx = o.x - g.cam;
    if (sx < -60 || sx > W + 60) return;
    const near = fogA ? Math.max(0, Math.min(1, 1 - (sx - PX - 60) / 120)) : 1;
    ctx.globalAlpha = (g.dive ? 1 - g.dive.t / g.dive.dur * 0.7 : 1) * Math.max(0.05, fogA ? near : 1);
    if (o.type === 'spike') {
      ctx.fillStyle = pal.spike; ctx.beginPath();
      for (let i = 0; i < o.n; i++) { const x = sx + i * 14, y = groundY(o.x + i * 14 + 7) + quake; ctx.moveTo(x, y + 2); ctx.lineTo(x + 7, y - 20); ctx.lineTo(x + 14, y + 2); }
      ctx.fill();
    } else if (o.type === 'shard') {
      const y = groundY(o.x) - o.lift, sp = Math.sin(t / 250 + o.t) * 0.5 + 0.5;
      ctx.save(); ctx.translate(sx, y); ctx.rotate(t / 700 + o.t); ctx.fillStyle = pal.shard; ctx.shadowColor = pal.shard; ctx.shadowBlur = 10 + sp * 10;
      ctx.beginPath(); sierp(0, 0, 18, 2); ctx.fill(); ctx.restore();
    }
  });
  ctx.globalAlpha = g.dive ? 1 - g.dive.t / g.dive.dur * 0.7 : 1;
  // Fog rolls in from the right.
  if (fogA > 0.02) { const fg = ctx.createLinearGradient(PX + 40, 0, W, 0); fg.addColorStop(0, '#0000'); fg.addColorStop(1, `rgba(20,18,50,${0.96 * fogA})`); ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H); }
  // Particles.
  g.parts.forEach((p) => { ctx.globalAlpha *= 1; ctx.fillStyle = p.c; const a = 1 - p.t / p.life; ctx.globalAlpha = a; ctx.fillRect(p.x - g.cam - 2, p.y - 2, 4, 4); });
  ctx.globalAlpha = g.dive ? 1 - g.dive.t / g.dive.dur * 0.7 : 1;
  // You: a fractal, leaning into the run, flickering while invulnerable, ablaze while dashing.
  if (g.inv <= 0 || Math.floor(t / 70) % 2 === 0) {
    ctx.save(); ctx.translate(PX, g.py);
    ctx.rotate(Math.max(-0.5, Math.min(0.5, g.vy / 1400)) + (g.onGround ? 0 : t / 300 % 0.3 - 0.15));
    if (g.dashing) { ctx.scale(1.25, 0.85); ctx.shadowColor = '#3DF2E0'; ctx.shadowBlur = 22; }
    ctx.fillStyle = g.dashing ? '#C9FFF8' : '#fff'; ctx.beginPath(); sierp(0, 2, R * 2.2, 2); ctx.fill();
    ctx.fillStyle = pal.edge; ctx.beginPath(); ctx.arc(R * 0.25, -R * 0.1, 2.6, 0, 7); ctx.fill();   // an eye, looking ahead
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  if (g.dive) { ctx.setTransform(k, 0, 0, k, 0, 0); ctx.fillStyle = `rgba(255,255,255,${(g.dive.t / g.dive.dur) ** 3 * 0.9})`; ctx.fillRect(0, 0, W, H); }
}

// ---------------------------------------------------------------- HUD, banners, panels
const meter = $('meter'), mc = meter.getContext('2d');
function hud() {
  const g = game;
  $('score').textContent = g.score.toLocaleString();
  const hearts = '❤️'.repeat(Math.max(0, g.hearts)) + '🖤'.repeat(Math.max(0, 3 - g.hearts)); if ($('hearts').textContent !== hearts) $('hearts').textContent = hearts;
  $('combo').textContent = g.combo > 1 && g.comboT > 0 ? `COMBO ×${g.combo}` : '';
  $('lvl').textContent = `Depth ${depth} · ${Math.floor(g.dist / 10).toLocaleString()} m · ${Math.max(0, Math.ceil(depth * DEPTH_S - g.time))}s to the next dive`;
  $('phase').textContent = `${phaseOf(g.curve.r)} · r ${g.curve.r.toFixed(2)}`;
  $('dashfill').style.width = `${(g.dash / DASH_MAX) * 100}%`;
  const hs = g.curve.hist, w = meter.width, h = meter.height;
  mc.clearRect(0, 0, w, h);
  mc.strokeStyle = '#FF5A4A99'; mc.setLineDash([5, 5]); mc.lineWidth = 2; mc.beginPath(); mc.moveTo(0, h - 0.75 * h); mc.lineTo(w, h - 0.75 * h); mc.stroke(); mc.setLineDash([]);
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

// ---------------------------------------------------------------- input: tap to jump, hold to dash
let downAt = 0, holdT = null;
const press = () => { if (!game || game.over) return; downAt = performance.now(); jump(); clearTimeout(holdT); holdT = setTimeout(() => { if (game && !game.over && game.dash > 0.15) game.dashing = true; }, 170); };
const release = () => { clearTimeout(holdT); if (game) game.dashing = false; };
cv.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => cv.addEventListener(ev, release));
addEventListener('keydown', (e) => { if (e.repeat) return; if (e.code === 'Space' || e.code === 'ArrowUp' || e.key === 'w') { e.preventDefault(); jump(); } if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'ArrowRight') { if (game && game.dash > 0.15) game.dashing = true; } });
addEventListener('keyup', (e) => { if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'ArrowRight') release(); });

window.__fd = () => game && ({ score: game.score, depth, hearts: game.hearts, dist: game.dist, speed: game.speed, py: game.py, onGround: game.onGround, dashing: game.dashing, dash: game.dash, r: game.curve.r, phase: game.phase, over: game.over,
  obs: game.obs.map((o) => ({ ...o, sx: o.x - game.cam })), twist: game.twist?.k || null, W, H, PX, groundY: groundY(game.cam + PX), gyAt: (sx) => groundY(game.cam + sx), jump, hurt: () => hurt('spiked') });   // for tests
// ---------------------------------------------------------------- start
(async () => {
  if (!(await signedIn())) return;
  setGameTools({ fs: '#play' });
  size(); addEventListener('resize', size);
  new MutationObserver(() => requestAnimationFrame(size)).observe($('play'), { attributes: true, attributeFilter: ['class'] });
  const { data: top } = await sb.from('solo_scores').select('player, score').eq('game', 'fractal').order('score', { ascending: false }).limit(40);
  const best = {}; (top || []).forEach((r) => { if (!(r.player in best)) best[r.player] = r.score; });
  const board = Object.entries(best).slice(0, 5);
  showOver(`<h2>🔺 Fractal Dash</h2>
    <p><b>Tap to jump</b> (tap again in the air for a double jump). <b>Hold to dash</b>: a dash phases through spikes while the meter lasts.</p>
    <p class="muted small">You're a fractal: a Sierpiński triangle, dashing over a fractal ridge that grows rougher as the chaos curve x → r·x·(1−x) climbs: calm, then a rhythm, then chaos, with twists at its peaks. Spikes hurt, chasms swallow, ✨ shards score (more in a quick combo). Every 25 s the world zooms into a copy of itself: a depth deeper, faster, and one heart back.</p>
    ${board.length ? `<ol class="board">${board.map(([p, s], i) => `<li class="${p === me.id ? 'me' : ''}"><span>${i + 1}. ${esc(names[p] ?? '?')}</span><b>${s.toLocaleString()}</b></li>`).join('')}</ol>` : ''}
    <button class="go" id="again">Dash 🔺</button>`, true);
  requestAnimationFrame(loop);
})();
