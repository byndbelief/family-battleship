// Hilltop Duel, live. The shooter's browser flies the shell; the server records where it
// landed and the damage, and the other player watches it replay.
import { sb, me, bots, signedIn, esc, nm, friendly, notify, ITEMS, backpack, useLoot, announceChaos, backpackBarHTML, sfx, liveGame, nudge, nextUpChip, names, gauntletBar, isPhone, note, noteMirror, splash, danger, liveCountdown, shotClock, stopShotClock, chaosClock, dramaOn, face, jumpToNext, setGameTools, condenseTop, compactPack } from './common.js';
import { W, H, CRATER_R, BERTHA_R, rng, buildTop as buildTopN, applyCrater, windFor, tankPos, simulate, damage, WEAPONS, simulateWeapon, weaponCraters, weaponDamage, craterCount, railAngle, startXs, zones, aimDir, digCut, coveredAt, ceilAt, TUN, setWorld, droneX, droneAim, droneY, DRONE_STEP } from './duel-engine.js';

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- state and drawing
let G = null;     // { game, shots }
let top = null, shot = null, particles = [], busy = false, pack = [];
let live = null;          // the live channel: send('aim' | 'shot', …) to the other players' pages
// What the others are doing, by seat: aims[p] = { move, angle, power, x } streamed while they aim.
// Two players: a message without `from` is from "the other one" (an older page).
let aims = {};
// Tanks can drive a little each turn (40 px of fuel, own side only). myX is where I've driven to
// this turn before firing; it's sent with the shot.
let myX = null, myXMove = -1;
let botDrive = null;      // { move, x } while the robot rolls to its firing spot
// Dodging: while someone aims at you, you may shift up to 20 px (from where their turn began).
// dodgeX is my dodge this turn; dodges[p] are the others', streamed live while I aim.
let dodgeX = null, dodgeMove = -1, dodges = {};
const DODGE = 20;
// Live battle: while both players have the duel open (each page checks in with duel_here every
// few seconds), there are no turns. Fire whenever the cannon has reloaded, drive anywhere on your
// side. Shells can be in the air at the same time (shells); `shot` is only a turn-based shell.
let liveOn = false, reloadAt = 0, liveMyX = null, liveX = {}, liveSave = null, seenHp = null, shells = [];
const RELOAD = 1500;   // live battle: the server allows a shot every 1.2 s (025)
const FUEL = 40;
// ⛏️ Dig mode (029): the Move bar digs instead of drives: the tank keeps its level and cuts
// straight through hills (same fuel). The cut is saved with the move; until then every page
// draws it from the driver's spot (pendingCuts). Your pick sticks until you switch back.
let digOn = false;
// 2 players face each other on two halves; 3-4 (023) spread along the ridge, each on its own stretch.
const N = () => G.game.players.length, multi = () => N() > 2;
const SIDE = (p) => zones(N())[p];
const buildTop = (seed, craters) => buildTopN(seed, craters, G ? N() : 2);
const baseXs = () => G.game.tank_x || startXs(N());
const COLS = ['#FF6B5A', '#3DD6C6', '#FFC857', '#B79CFF', '#7FE07A', '#FF8FD0'];
// Which seat a live message came from (older pages don't say: then it's the other of two).
const fromOf = (a) => (a?.from != null ? a.from : G ? 1 - myIdx() : -1);
function xs() {
  const t = [...baseXs()], g = G.game, mi = myIdx();
  if (g.status === 'playing' && liveOn) {
    if (mi >= 0 && liveMyX != null) t[mi] = liveMyX;
    Object.entries(liveX).forEach(([p, x]) => { if (+p !== mi && x != null) t[+p] = x; });
    return t;
  }
  if (g.status === 'playing') {
    const a = aims[g.turn];
    if (turnId() === me.id && myXMove === g.move && myX != null) t[g.turn] = myX;
    else if (turnId() !== me.id && a?.move === g.move && a.x != null) t[g.turn] = a.x;
    if (botDrive?.move === g.move) t[g.turn] = botDrive.x;
    // Everyone else may dodge while the shooter aims.
    if (turnId() !== me.id && mi >= 0 && dodgeMove === g.move && dodgeX != null) t[mi] = dodgeX;
    Object.entries(dodges).forEach(([p, d]) => { if (+p !== mi && +p !== g.turn && d?.move === g.move) t[+p] = d.x; });
  }
  return t;
}
// For flying a shell: tanks already knocked out (by hp before the shot) aren't there to hit.
const standing = (X, hp, shooter) => X.map((x, i) => (i === shooter || (hp?.[i] ?? 100) > 0 ? x : null));
// The default barrel for a tank nobody is aiming: toward the middle.
const restAngle = (p, X) => (multi() ? (X[p] < W / 2 ? 45 : 135) : 45);
const cv = $('cv');
let ctx = cv.getContext('2d');   // swapped for the tank cam's while it draws (drawTankCam)
// The camera (4+ tanks, where the field is wide and the tanks small): zoom 1-3× around a point of
// the battlefield (x, y). Pinch or the wheel to zoom, one finger pans when you're not aiming, and a
// shell in the air pulls the view along with it. At 1× it's the whole field, exactly as before.
let cam = { z: 1, x: 400, y: 220 }, camHeld = 0;   // camHeld: until when the person, not the shell, steers
// 🎬 The shot camera: zoomed in, the view stays where you put it until someone fires. Then it glides
// to the shooter's tank, follows the shell, holds on the impact, and glides back to your spot at
// your zoom. Touch the battlefield (or a zoom button) and it lets go at once, leaving the view there.
let ride = null, rideLast = 0;
function rideStart(p) {
  if (!camOn() || cam.z <= 1.001 || reduceMotion || Date.now() < camHeld) return 0;
  const tp = tankPos(p, top, xs());
  const far = tp && Math.hypot(tp.x - cam.x, tp.y - 30 - cam.y) > 40;
  if (!ride) ride = { home: { x: cam.x, y: cam.y }, p, t0: performance.now(), end: 0, aim: null, vx: 0, vy: 0 };
  else Object.assign(ride, { p, t0: performance.now(), end: 0 });
  return far && !liveOn ? 650 : 0;   // turn by turn: the shell leaves once the camera has got there
}
window.__duelCam = () => ({ x: cam.x, y: cam.y, z: cam.z, ride: !!ride });   // for tests: read-only
function rideStep(t) {
  const dt = rideLast ? Math.min(0.1, (t - rideLast) / 1000) : 0; rideLast = t;
  if (!ride) return;
  if (Date.now() < camHeld || !camOn() || cam.z <= 1.001) { ride = null; return; }   // you took over
  const now = performance.now(), flying = shells.filter((s) => s.i < s.path.length && s.p === ride.p);
  let T, w = 7;   // spring stiffness: higher follows tighter
  if (flying.length && now - ride.t0 > 300) {   // the shell (the middle of a cluster's)
    const qs = flying.map((s) => s.path[Math.max(0, Math.min(s.i, s.path.length - 1))]);
    T = { x: qs.reduce((a, q) => a + q.x, 0) / qs.length, y: qs.reduce((a, q) => a + q.y, 0) / qs.length }; ride.aim = T; w = 9;
  } else if (!ride.end || now - ride.end < 900) {   // the shooter, then the impact a moment
    const tp = !ride.aim && tankPos(ride.p, top, xs()); T = tp ? { x: tp.x, y: tp.y - 30 } : ride.aim || ride.home;
  } else { T = ride.home; w = 5; }
  // A critically damped spring: it eases in and out, never overshoots, and is capped at about two
  // screens a second, so a long pan glides instead of whipping.
  const cap = (2.2 * W) / cam.z;
  for (let n = 0, h = dt / 2; n < 2; n++) {
    ride.vx += (w * w * (T.x - cam.x) - 2 * w * ride.vx) * h; ride.vy += (w * w * (T.y - cam.y) - 2 * w * ride.vy) * h;
    const sp = Math.hypot(ride.vx, ride.vy); if (sp > cap) { ride.vx *= cap / sp; ride.vy *= cap / sp; }
    cam.x += ride.vx * h; cam.y += ride.vy * h;
  }
  const bx = cam.x, by = cam.y; camClamp(); if (cam.x !== bx) ride.vx = 0; if (cam.y !== by) ride.vy = 0;   // stopped by the edge
  if (T === ride.home && Math.hypot(cam.x - T.x, cam.y - T.y) < 0.5 && Math.hypot(ride.vx, ride.vy) < 5) { cam.x = T.x; cam.y = T.y; camClamp(); ride = null; }
}
const camOn = () => !!G && N() >= 4;
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// How much of the battlefield's height the canvas shows at 1×: all of it (H), except in landscape
// full screen on a phone, where the canvas takes the screen's wider shape and the top of the sky
// is trimmed (fitCanvas). At 1× the view sits on the ground.
const viewH = () => Math.min(H, (W * cv.height) / cv.width);
function camClamp() {
  cam.z = clampN(cam.z, 1, 3);
  const vw = W / cam.z, vh = viewH() / cam.z;
  if (cam.z <= 1.001) { cam.x = W / 2; cam.y = H - vh / 2; return; }
  cam.x = clampN(cam.x, vw / 2, W - vw / 2); cam.y = clampN(cam.y, vh / 2, H - vh / 2);
}
const camReset = () => { cam = { z: 1, x: W / 2, y: H / 2 }; camClamp(); showCam(); };
function fitCanvas() {
  const cover = $('play').classList.contains('fs-on') && matchMedia('(orientation: landscape) and (max-height: 520px)').matches;
  const r = cover ? cv.parentElement.clientWidth / Math.max(1, cv.parentElement.clientHeight) : 0;
  const h = cover && r > 1600 / 880 ? Math.round(1600 / r) : 880;
  if (cv.height !== h) { cv.height = h; camClamp(); }
}
addEventListener('resize', fitCanvas);
new MutationObserver(() => requestAnimationFrame(fitCanvas)).observe($('play'), { attributes: true, attributeFilter: ['class'] });
// A point on the page → the battlefield under it.
function toWorld(clientX, clientY) {
  const r = cv.getBoundingClientRect(), fx = (clientX - r.left) / r.width, fy = (clientY - r.top) / r.height;
  return { x: cam.x + (fx - 0.5) * (W / cam.z), y: cam.y + (fy - 0.5) * (viewH() / cam.z), fx, fy };
}
// Zoom to z keeping the battlefield point under (fx, fy) of the screen where it is.
function zoomAt(z, fx, fy, wx, wy) { cam.z = clampN(z, 1, 3); cam.x = wx - (fx - 0.5) * (W / cam.z); cam.y = wy - (fy - 0.5) * (viewH() / cam.z); camClamp(); showCam(); }
function camLook(x, y, z = cam.z) { cam.z = z; cam.x = x; cam.y = y; camClamp(); showCam(); }
const clouds = Array.from({ length: 5 }, (_, i) => { const r = rng(i * 104729 + 11); return { x: r(), y: 0.25 + r() * 0.5, r: 18 + r() * 16, v: 0.004 + r() * 0.006 }; });
// Daylight: 0 at night, 1 by day, eased across dawn (6-7) and dusk (19-20) by the local clock.
const dayTarget = () => { const n = new Date(), h = n.getHours() + n.getMinutes() / 60; return h < 6 || h >= 20 ? 0 : h < 7 ? h - 6 : h < 19 ? 1 : 20 - h; };
let dayNow = reduceMotion ? dayTarget() : 0, dayLast = 0;
function dayStep(t) {   // a 2.5 s morph from wherever the sky is to where the clock says it should be
  const goal = dayTarget(), dt = dayLast ? Math.min(0.1, (t - dayLast) / 1000) : 0; dayLast = t;
  if (t < 600) return;   // let the battlefield appear first, then the moon turns into the sun
  dayNow = goal > dayNow ? Math.min(goal, dayNow + dt / 2.5) : Math.max(goal, dayNow - dt / 2.5);
}
const mixHex = (a, b, k) => { const p = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16), n = Math.max(a.length, b.length) === 9 ? 4 : 3;
  return '#' + Array.from({ length: n }, (_, i) => Math.round(p(a.length === 9 || i < 3 ? a : a + 'ff', i) * (1 - k) + p(b.length === 9 || i < 3 ? b : b + 'ff', i) * k).toString(16).padStart(2, '0')).join(''); };
const stars = Array.from({ length: 90 }, (_, i) => { const r = rng(i * 7919 + 3); return { x: r(), y: r() * 240, s: r() * 1.4 + 0.3, t: r() * 6 }; });
const myIdx = () => G.game.players.indexOf(me.id);
const turnId = () => G.game.players[G.game.turn];
// The special shell a player has loaded (🎆 cluster, 🚀 homing, ⚡ railgun, 🪨 dirt), or null.
// A shot's wind multiplier: 3 in a 🌪️ hurricane, 5 in a 🌀 tornado (047), plus 10 in 🌙 low gravity (044; see gravOf).
const windXOf = (g, move) => (g.tornado === move ? 5 : g.gust === move ? 3 : 1) + (g.lowgrav === move ? 10 : 0);
const armedOf = (id) => G?.game.armed?.[id] || null;
// 🚁 Drone Strike: you pick a spot along the map (dropX) instead of an angle and a power; it goes to
// the server as the angle and power droneAim() makes of it. The sliders keep your usual aim.
let dropX = null;
const droneOn = () => armedOf(me.id) === 'drone';
const myAim = () => (droneOn() ? droneAim(dropX ?? W / 2) : { angle: +$('angle').value, power: +$('power').value });
// A saved shot's crater(s) as a list (a cluster bomb saves several).
const craterList = (c) => (!c ? [] : Array.isArray(c[0]) ? c : [c]);
// The ground before a saved shot: every edit but that shot's own craters (found from the end, as
// a Foxhole or a live dig may have been saved after it).
function cratersBefore(all, shotCrater) {
  const out = [...all], key = (c) => JSON.stringify(c);
  craterList(shotCrater).slice().reverse().forEach((c) => { const j = out.map(key).lastIndexOf(key(c)); if (j >= 0) out.splice(j, 1); });
  return out;
}
// Digs in progress, not saved yet: mine, and anyone else's the live channel told us about.
function pendingCuts() {
  const g = G.game, mi = myIdx(), out = [];
  if (g.status !== 'playing') return out;
  const add = (p, x) => { const c = digCut(baseXs()[p], x); if (c) out.push(c); };
  if (mi >= 0 && digOn) {
    if (liveOn && liveMyX != null) add(mi, liveMyX);
    else if (!liveOn && turnId() === me.id && myXMove === g.move && myX != null) add(mi, myX);
  }
  Object.entries(aims).forEach(([p, a]) => { if (+p !== mi && a?.dig && a.x != null && (liveOn || (a.move === g.move && +p === g.turn))) add(+p, a.x); });
  return out;
}
const groundCraters = () => [...G.game.craters, ...pendingCuts()];
const ground = () => buildTop(G.game.seed, groundCraters());
// Redraw the ground for a dig in progress (not while a shell is in the air: it's digging too).
const refreshTop = () => { if (G && !shot && !shells.length && !(busy && !liveOn)) top = ground(); };
// 🕳️ Foxhole (029): dug in while your tank is still where you dug. Blasts do 40% less (× a Shield's half).
const dugIn = (g, id, x) => x != null && g.foxholes?.[id] != null && +g.foxholes[id] === x;
const guards = (g, X, shooterId) => g.players.map((id, k) => (g.shields.includes(id) && id !== shooterId ? 0.5 : 1) * (dugIn(g, id, X[k]) ? 0.6 : 1));
const isBot = (id) => bots.has(id);
const who = (id) => (id === me.id ? 'You' : nm(id));
const seenKey = () => `duel.seen.${G.game.id}`;
const seenMove = () => { try { return +(localStorage.getItem(seenKey()) || 0); } catch { return 0; } };
const markSeen = (m) => { try { if (m > seenMove()) localStorage.setItem(seenKey(), String(m)); } catch {} };

function draw(t) {
  if (!G || !top) return;
  const g = G.game, dy = H - 440;   // dy: the extra sky a bigger battlefield has
  // A shell in the air, zoomed in: the view follows it (unless you've just moved it yourself).
  if (!camPass) rideStep(t);
  if (!camPass) camClamp();   // keeps 1× on the ground whatever shape the canvas is
  const k = (ctx.canvas.width / W) * cam.z; ctx.setTransform(k, 0, 0, k, -(cam.x - W / cam.z / 2) * k, -(cam.y - ctx.canvas.height / k / 2) * k);
  // ☀️ Day or 🌙 night by your own clock (dawn 6-7, dusk 19-20), the moon morphing into the sun when
  // a game opens in daylight (dayNow eases toward dayTarget).
  if (!camPass) dayStep(t);
  const d = dayNow, mix = (a, b) => mixHex(a, b, d);
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, mix('#1B1646', '#3E8EDB')); sky.addColorStop(0.6, mix('#3B2A6E', '#86C6F0')); sky.addColorStop(1, mix('#7A3E72', '#E4F3FB'));
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  if (d < 1) { stars.forEach((s) => { ctx.globalAlpha = (1 - d) * (0.5 + 0.5 * Math.sin(t / 900 + s.t)); ctx.fillStyle = '#fff'; ctx.fillRect(s.x * W, s.y * (H / 440), s.s, s.s); }); ctx.globalAlpha = 1; }
  const mx = W * 0.7625, my = 90 + dy * 0.5;
  // The glow warms and widens from moonlight to sunshine; the disc grows and turns gold.
  const gr = 120 + 50 * d, mg = ctx.createRadialGradient(mx, my, 10, mx, my, gr);
  mg.addColorStop(0, mix('#FFF4D6', '#FFFFFF')); mg.addColorStop(0.28, mix('#FFE3A3', '#FFE680')); mg.addColorStop(0.3, mix('#FFC85733', '#FFD24A66')); mg.addColorStop(1, mix('#FFC85700', '#FFD24A00'));
  ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, gr, 0, 7); ctx.fill();
  if (d > 0.35) {   // the sun's rays, turning slowly
    const a = Math.min(1, (d - 0.35) / 0.5), spin = reduceMotion ? 0 : t / 9000, r0 = gr * 0.36, r1 = gr * (0.62 + 0.04 * Math.sin(t / 700));
    ctx.save(); ctx.globalAlpha = a * 0.75; ctx.strokeStyle = '#FFD24A'; ctx.lineCap = 'round'; ctx.lineWidth = 5;
    for (let i = 0; i < 12; i++) { const an = spin + (i * Math.PI) / 6; ctx.beginPath(); ctx.moveTo(mx + Math.cos(an) * r0, my + Math.sin(an) * r0); ctx.lineTo(mx + Math.cos(an) * r1, my + Math.sin(an) * r1); ctx.stroke(); }
    ctx.restore();
  }
  if (d > 0) {   // clouds drift in with the day
    ctx.save(); ctx.globalAlpha = d * 0.85; ctx.fillStyle = '#FFFFFF';
    clouds.forEach((c) => { const x = ((c.x * (W + 300) + (reduceMotion ? 0 : t * c.v)) % (W + 300)) - 150, y = c.y * (170 + dy);
      [[0, 0, 1], [-0.9, 0.25, 0.7], [0.9, 0.25, 0.75], [0.35, -0.35, 0.7]].forEach(([ox, oy, k]) => { ctx.beginPath(); ctx.ellipse(x + ox * c.r, y + oy * c.r, c.r * k, c.r * k * 0.72, 0, 0, 7); ctx.fill(); }); });
    ctx.restore();
  }
  ctx.fillStyle = mix('#2A2158', '#6FA7C4'); ctx.beginPath(); ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 10) ctx.lineTo(x, 250 + dy + Math.sin(x * 0.011 + g.seed) * 30 + Math.sin(x * 0.027) * 14);
  ctx.lineTo(W, H); ctx.fill();
  const tg = ctx.createLinearGradient(0, 170 + dy, 0, H); tg.addColorStop(0, '#3DD6C6'); tg.addColorStop(0.08, '#1F8C8A'); tg.addColorStop(1, '#0F2E3F');
  ctx.fillStyle = tg; ctx.beginPath(); ctx.moveTo(0, H); for (let x = 0; x < W; x++) ctx.lineTo(x, top[x]); ctx.lineTo(W, H); ctx.fill();
  ctx.strokeStyle = '#9BF5EA'; ctx.lineWidth = 2; ctx.beginPath(); for (let x = 0; x < W; x++) ctx[x ? 'lineTo' : 'moveTo'](x, top[x]); ctx.stroke();
  // Tunnels (⛏️ Dig): the hollow inside the hill, dark, with the tank sitting in it under its roof.
  if (top.under?.length) {
    ctx.fillStyle = '#04090F'; ctx.strokeStyle = '#9BF5EAAA'; ctx.lineWidth = 2;
    for (let x = 0; x < W; x++) {
      if (top.under[x] == null) continue;
      let e = x; while (e + 1 < W && top.under[e + 1] != null) e++;
      ctx.beginPath(); ctx.moveTo(x, ceilAt(top, x));
      for (let k = x; k <= e; k++) ctx.lineTo(k, ceilAt(top, k));
      for (let k = e; k >= x; k--) ctx.lineTo(k, top.under[k]);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // a miner's lamp glow along the floor
      const gl = ctx.createLinearGradient(0, ceilAt(top, x), 0, top.under[x]); gl.addColorStop(0, '#FFC85700'); gl.addColorStop(1, '#FFC85733');
      ctx.fillStyle = gl; ctx.fill(); ctx.fillStyle = '#04090F';
      x = e;
    }
  }
  const X = shot?.xs || xs();
  g.players.forEach((_, p) => {
    const tp = tankPos(p, top, X) || tankPos(p, top, xs()); if (!tp) return;   // a replay leaves out tanks already out: draw the wreck where it stands
    const { x, y } = tp, col = COLS[p];
    const aiming = g.status === 'playing' && g.hp[p] > 0 && (liveOn || (!shot && g.turn === p));
    const a = aims[p];
    let ang = aiming && p === myIdx() ? +$('angle').value : aiming && a && (liveOn || a.move === g.move) ? a.angle : (shot && shot.p === p ? shot.angle : restAngle(p, X));
    // A Drone Strike's angle is a map spot, not the barrel's: theirs rests (yours keeps your usual aim).
    if (p !== myIdx() && (armedOf(g.players[p]) === 'drone' || (shot && shot.p === p && shot.weapon === 'drone'))) ang = restAngle(p, X);
    const aim = aimDir(p, ang, X), dir = aim.dir;
    ang = aim.a;
    if (armedOf(g.players[p]) === 'railgun' || (shot && shot.p === p && shot.weapon === 'railgun')) ang = railAngle(ang);
    ctx.save(); ctx.translate(x, y); if (g.hp[p] <= 0) ctx.globalAlpha = 0.45;
    ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(Math.cos((ang * Math.PI) / 180) * 20 * dir, -14 - Math.sin((ang * Math.PI) / 180) * 20); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, -12, 8, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.roundRect(-16, -10, 32, 10, 4); ctx.fill();
    ctx.fillStyle = '#0008'; for (let i = -12; i <= 12; i += 8) { ctx.beginPath(); ctx.arc(i, 0, 3, 0, 7); ctx.fill(); }
    ctx.restore();
    if (aiming && !liveOn) { ctx.fillStyle = col; const bob = Math.sin(t / 250) * 3; ctx.beginPath(); ctx.moveTo(x - 6, y - 44 + bob); ctx.lineTo(x + 6, y - 44 + bob); ctx.lineTo(x, y - 36 + bob); ctx.fill(); }
  });
  if (canAim()) {
    if (drag && !droneOn()) {
      const tp = tankPos(myIdx(), top, X);
      ctx.strokeStyle = '#FFF4D688'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(tp.x, tp.y - 14); ctx.lineTo(drag.x, drag.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#FFC85755'; ctx.beginPath(); ctx.arc(drag.x, drag.y, 16, 0, 7); ctx.fill();
    }
    drawHint(t);
  }
  shells.forEach((sh) => drawShell(sh, t));
  meteors.forEach((m) => drawMeteor(m));
  particles.forEach((q) => { ctx.globalAlpha = Math.max(0, q.life); ctx.fillStyle = q.c; ctx.beginPath(); ctx.arc(q.x, q.y, q.s, 0, 7); ctx.fill(); });
  ctx.globalAlpha = 1;
}
// Each kind of shell has its own look in flight.
const SHELL_LOOK = {
  null: { trail: '#FFC857', head: '#FFF4D6', glow: '#FFC857', r: 4 },
  cluster: { trail: '#FF8AD8', head: '#FFE3F6', glow: '#FF4FC1', r: 3.5 },
  homing: { trail: '#FF7A3C', head: '#FFD2B0', glow: '#FF5A1F', r: 4.5 },
  dirt: { trail: '#B08355', head: '#8A5A2B', glow: '#00000000', r: 6 },
};
function drawShell(sh, t) {
  const n = Math.min(sh.i, sh.path.length), pts = sh.path;
  if (sh.weapon === 'drone') {   // the drone flies over, then its bomb falls
    const lead = sh.lead || 1, d = pts.length > 1 ? Math.sign(pts[1].x - pts[0].x) || 1 : 1;
    const dx = n < lead ? pts[n].x : pts[lead - 1].x + d * (n - lead + 1) * DRONE_STEP;
    ctx.save(); ctx.font = `${Math.round(40 * W / 800)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.translate(dx, droneY()); if (d > 0) ctx.scale(-1, 1); ctx.fillText('🚁', 0, Math.sin(t / 90) * 1.5); ctx.restore();
    if (n >= lead && n < pts.length) {
      ctx.fillStyle = '#FFF4D6'; for (let j = Math.max(lead, n - 24); j < n; j += 3) { ctx.globalAlpha = (j - (n - 24)) / 40; ctx.beginPath(); ctx.arc(pts[j].x, pts[j].y, 1.5, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1; ctx.font = `${Math.round(26 * W / 800)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('💣', pts[n].x, pts[n].y);
    }
    return;
  }
  if (sh.weapon === 'railgun') {   // a beam: a white-hot core in a cyan glow, fading once it's done
    const fade = sh.i >= pts.length ? Math.max(0, 1 - (sh.i - pts.length) / 20) : 1;
    ctx.save(); ctx.globalAlpha = fade; ctx.lineCap = 'round';
    [[10, '#29E7FF33'], [5, '#29E7FFAA'], [2, '#FFFFFF']].forEach(([w, c]) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let j = 1; j < n; j++) ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke(); });
    ctx.restore(); return;
  }
  const L = SHELL_LOOK[sh.weapon] || SHELL_LOOK.null, len = sh.weapon === 'homing' ? 60 : 40;
  for (let j = Math.max(0, n - len); j < n; j++) {
    ctx.globalAlpha = (j - (n - len)) / len; ctx.fillStyle = sh.weapon === 'cluster' && j % 3 === 0 ? '#FFF4D6' : L.trail;
    ctx.beginPath(); ctx.arc(pts[j].x + (sh.weapon === 'homing' ? Math.sin(j + t / 40) * 1.5 : 0), pts[j].y, sh.weapon === 'homing' ? 2.6 : 2, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (n < pts.length) { const q = pts[n]; ctx.shadowColor = L.glow; ctx.shadowBlur = 18; ctx.fillStyle = L.head; ctx.beginPath(); ctx.arc(q.x, q.y, L.r, 0, 7); ctx.fill(); ctx.shadowBlur = 0; }
}
// Aim hint: a rough guide, not a solution. Each turn it carries a small hidden error (a few
// degrees and a bit of power, different every turn), it wobbles a little even in calm air, sways
// with the wind, and only shows the first 65% of the flight. Reduced motion: a still band.
const hintCache = new Map();
function hintPath(angle, power, windX) {
  const g = G.game, X = xs(), wpn = armedOf(me.id), key = `${g.move}|${wpn}|${X[myIdx()]}|${angle.toFixed(1)}|${power.toFixed(1)}|${windX.toFixed(2)}`;
  if (!hintCache.has(key)) {
    if (hintCache.size > 300) hintCache.clear();
    const { path } = simulateWeapon(g.seed, g.move, top, myIdx(), angle, power, windX, standing(X, g.hp, myIdx()), wpn)[0];
    hintCache.set(key, path.slice(0, Math.ceil(path.length * 0.65)));
  }
  return hintCache.get(key);
}
function drawDots(pts, alpha, t, still) {
  const n = pts.length, drift = still ? 0 : (t / 60) % 6;
  for (let j = Math.floor(drift) % 6; j < n; j += 6) {
    const q = pts[j], f = 1 - j / n;
    ctx.globalAlpha = alpha * (0.15 + 0.85 * f * f); ctx.fillStyle = '#FFC857'; ctx.shadowColor = '#FFC857'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(q.x, Math.max(4, q.y), 2.2 + 2 * f, 0, 7); ctx.fill();
  }
}
function drawHint(t) {
  if (droneOn()) {   // where the drone will drop: a dashed line down from the sky (the wind still drifts the bomb)
    const x = dropX ?? W / 2, gy = top.under?.[Math.round(x)] ?? top[Math.max(0, Math.min(W - 1, Math.round(x)))];
    ctx.save(); ctx.strokeStyle = '#FFC857AA'; ctx.lineWidth = 2; ctx.setLineDash([6, 8]); ctx.lineDashOffset = -t / 40;
    ctx.beginPath(); ctx.moveTo(x, droneY() + 14); ctx.lineTo(x, gy); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#FFC857'; ctx.beginPath(); ctx.arc(x, gy - 2, 10, 0, 7); ctx.moveTo(x - 15, gy - 2); ctx.lineTo(x + 15, gy - 2); ctx.stroke();
    ctx.font = `${Math.round(34 * W / 800)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.globalAlpha = 0.8; ctx.fillText('🚁', x, droneY()); ctx.restore();
    return;
  }
  const g = G.game, base = windXOf(g, g.move) % 10, lg = g.lowgrav === g.move ? 10 : 0, windy = windFor(g.seed, g.move, base) !== 0;
  const r = rng(g.seed * 7919 + g.move * 131 + 17), aBias = (r() * 2 - 1) * 3.5, pBias = (r() * 2 - 1) * 6;   // this turn's hidden error
  const q = (v, s) => Math.round(v / s) * s;
  // The hint never swings across straight up (with 3+ players past 90° is the other way).
  const cur = +$('angle').value, [alo, ahi] = !multi() ? [5, 85] : cur <= 90 ? [5, 90] : [90, 175];
  const A = (w) => Math.max(alo, Math.min(ahi, q(cur + aBias + w, 0.5))), P = (w) => Math.max(20, Math.min(100, q(+$('power').value + pBias + w, 0.5)));
  if (reduceMotion) {
    drawDots(hintPath(A(-1.5), P(-2), (windy ? base * 0.6 : base) + lg), 0.55, t, true);
    drawDots(hintPath(A(1.5), P(2), (windy ? base * 1.4 : base) + lg), 0.55, t, true);
  } else {
    const gust = windy ? 1 + 0.3 * Math.sin(t / 700) + 0.15 * Math.sin(t / 260 + 1.3) : 1;
    drawDots(hintPath(A(1.4 * Math.sin(t / 900)), P(2 * Math.sin(t / 640 + 1)), (base === 5 ? 5 : Math.round(base * gust * 50) / 50) + lg), 1, t, false);
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}
function loop(t) { particles.forEach((q) => { q.x += q.vx; q.y += q.vy; q.vy += 0.12; q.life -= 0.018; }); particles = particles.filter((q) => q.life > 0); draw(t); drawTankCam(t); requestAnimationFrame(loop); }
// 🎥 The tank cam: zoomed in with your own tank off screen, a small window in the corner keeps it in
// view: the same scene drawn again with a camera on your tank (so its barrel, the aim guide, shells
// and blasts all show), your HP under it, and a red flash with the damage when you're hit. Tap it
// to jump the view back to your tank.
let camPass = false, tcHp = null;
const tcCv = $('tankCamCv'), tcCtx = tcCv.getContext('2d');
function drawTankCam(t) {
  const box = $('tankCam'), mi = G && top ? myIdx() : -1;
  const tp = mi >= 0 ? tankPos(mi, top, shot?.xs || xs()) : null;
  const vw = W / cam.z, vh = viewH() / cam.z;
  const off = tp && camOn() && cam.z > 1.001 && G.game.hp[mi] > 0
    && (tp.x < cam.x - vw / 2 + 12 || tp.x > cam.x + vw / 2 - 12 || tp.y - 20 < cam.y - vh / 2 || tp.y > cam.y + vh / 2 - 6);
  if (box.hidden === !!off) { box.hidden = !off; if (off) box.style.setProperty('--c', COLS[mi]); }
  if (!G || mi < 0) return;
  const hp = Math.max(0, G.game.hp[mi]);
  if (tcHp !== null && hp < tcHp && off) {   // hit while it's showing: a red flash and the damage
    const d = document.createElement('b'); d.className = 'tcdmg'; d.textContent = `−${tcHp - hp}`; box.appendChild(d); setTimeout(() => d.remove(), 1400);
    box.classList.remove('hit'); void box.offsetWidth; box.classList.add('hit');
  }
  if (hp !== tcHp) { tcHp = hp; $('tankCamHp').style.setProperty('--hp', `${hp}%`); $('tankCamHp').querySelector('b').textContent = hp; }
  if (!off) return;
  const z = W / 200, cw = W / z, ch = H / z, saved = cam, savedCtx = ctx;
  cam = { z, x: clampN(tp.x, cw / 2, W - cw / 2), y: clampN(tp.y - 20, ch / 2, H - ch / 2) };
  ctx = tcCtx; camPass = true;
  try { draw(t); } finally { cam = saved; ctx = savedCtx; camPass = false; }
}
$('tankCam').addEventListener('click', () => { const mi = myIdx(), tp = mi >= 0 && tankPos(mi, top, xs()); camHeld = Date.now() + 4000; if (tp) camLook(tp.x, tp.y - 40); });
function boom(x, y, big = 1) {
  sfx('boom', { size: big });
  navigator.vibrate?.(Math.round(60 * big));
  const cols = ['#FFF4D6', '#FFC857', '#FF6B5A', '#B79CFF'];
  for (let i = 0; i < 70 * big; i++) { const a = Math.random() * 6.28, v = Math.random() * 5 * big + 1; particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, life: 1, s: Math.random() * 3 + 1, c: cols[i % 4] }); }
}
// Where a shell lands: a boom sized to its crater, or a dust cloud and a thud for a Dirt Bomb.
function blast(c) {
  if (c[3] === 4) { boom(c[0], c[1], 1.3); navigator.vibrate?.([30, 30, 90]); return; }   // a Bunker Buster going off underground
  if (c[3]) {
    sfx('thud'); sfx('thud', { delay: 0.12 }); navigator.vibrate?.(50);
    const cols = ['#8A5A2B', '#B08355', '#6B4423', '#D6B28A'];
    for (let i = 0; i < 70; i++) { const a = Math.PI + Math.random() * Math.PI, v = Math.random() * 4 + 1; particles.push({ x: c[0], y: c[1], vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.2, s: Math.random() * 4 + 2, c: cols[i % 4] }); }
    return;
  }
  boom(c[0], c[1], c[2] >= 40 ? 2 : c[2] <= 14 ? 0.7 : 1);
}
// The moment a shell lands: the ground caves in, the damage shows and the HP bars drop, all on
// that frame (the save to the server follows behind). Damage is worked out before the crater is
// dug, as it always was, so the numbers don't change.
function impactNow(craters, hpBefore, hpAfter) {
  craters.forEach((c) => { blast(c); applyCrater(top, c); });
  if (hpAfter) { G.game = { ...G.game, hp: hpAfter }; hitDrama(hpBefore, hpAfter); }
  render();
}
// A hit: small ones get a number, big ones a flash and DIRECT HIT!; a knockout waits for the K.O. screen.
function hitDrama(before, after) {
  // A knockout waits for the K.O. screen (two players), or gets its own stamp (3-4: the fight goes on).
  if (multi()) {
    const out = after.map((h, p) => (h <= 0 && (before[p] ?? 100) > 0 ? p : -1)).filter((p) => p >= 0);
    if (out.length && G.game.status === 'playing') {
      stamp(out.includes(myIdx()) ? 'K.O.!<br><small style="font-size:.45em">you\'re out</small>' : `K.O.!<br><small style="font-size:.45em">${out.map((p) => esc(who(G.game.players[p]).replace(/<[^>]+>/g, ''))).join(' & ')} out</small>`, out.includes(myIdx()) ? 'red' : '', 1800);
      sfx('boom', { size: 2 }); return;
    }
  }
  if (after.some((h) => h <= 0)) return;
  const mi = myIdx(), drops = after.map((h, p) => (before[p] ?? 100) - h), big = Math.max(...drops);
  if (big <= 0) return;
  if (big >= 25) {
    stamp('DIRECT<br>HIT!', drops[mi] === big ? 'red' : '', 1600); sfx('flash', { delay: 0.05 });
    navigator.vibrate?.([60, 40, 140]);
    if (!reduceMotion) { const f = document.createElement('div'); f.style.cssText = 'position:fixed;inset:0;z-index:58;background:#fff;pointer-events:none;opacity:.85;transition:opacity .35s'; document.body.appendChild(f); requestAnimationFrame(() => { f.style.opacity = '0'; }); setTimeout(() => f.remove(), 400); }
  } else if (drops[mi] > 0) stamp(`−${drops[mi]}`, 'red', 1400);
  else stamp(`Hit! −${big}`, '', 1400);
}
// The end: a K.O. screen the first time you see it, then just the result panel.
function endDrama(g) {
  danger(false);
  const key = `drama.end.${g.id}`; let seen = false;
  try { seen = !!localStorage.getItem(key); localStorage.setItem(key, '1'); } catch {}
  if (seen) return;
  const won = g.winner === me.id;
  splash(['K.O.!', won ? 'VICTORY' : 'DEFEATED', won ? 'You hold the hill' : `${nm(g.winner).replace(/<[^>]+>/g, '')} takes the hill`], { tone: won ? 'gold' : 'red', ms: 2800 });
  sfx(won ? 'fanfare' : 'lose', { delay: 0.9 });
  jumpToNext('duel', g, me.id, (p) => (bots.has(p) ? '🤖 ' : '') + (names[p] ?? G?.names?.[p] ?? 'someone'), 2600, $('nextSlot'));
}
function stamp(text, tone = '', ms = 2400) { const el = document.createElement('div'); el.className = `stamp ${tone}`; el.innerHTML = `<span>${text}</span>`; document.body.appendChild(el); setTimeout(() => el.remove(), ms); }

// Flies a shell along its path, then blows up where the server says it landed.
// Flies a shot (every shell of it: a cluster bomb makes three), then, for a replay, sets off the
// craters the server saved. Resolves with { impact, impacts } (impact = the first shell's).
function flyShell(p, angle, power, beforeCraters, move, crater, windX = 1, X = xs(), weapon = null, hpBefore = G.game.hp) {
  return new Promise((done) => {
    if (!liveOn) top = buildTop(G.game.seed, beforeCraters);   // live: the ground is already current
    X = standing(X, hpBefore, p);
    const sims = simulateWeapon(G.game.seed, move, top, p, angle, power, windX, X, weapon);
    const mine = sims.map((sim) => ({ p, angle, weapon, path: sim.path, lead: sim.lead, xs: X, i: reduceMotion ? sim.path.length : 0 }));
    const wait = rideStart(p);
    shells.push(...mine); if (!liveOn) shot = mine[0];
    const longest = Math.max(...sims.map((x) => x.path.length));
    if (weapon === 'railgun') { sfx('flash', { delay: wait / 1000 }); sfx('cannon', { delay: wait / 1000 + 0.02 }); }
    else if (weapon === 'drone') { const lead = sims[0].lead || 0; sfx('drone', { delay: wait / 1000, dur: Math.max(0.4, lead / 3 / 60) }); if (!reduceMotion) sfx('whistle', { delay: wait / 1000 + lead / 3 / 60, dur: Math.max(0.3, (longest - lead) / 3 / 60) }); }
    else { sfx('cannon', { delay: wait / 1000 }); if (!reduceMotion) sfx('whistle', { delay: wait / 1000 + 0.15, dur: Math.max(0.3, longest / 3 / 60 - 0.15) }); }
    if (weapon === 'cluster' && !reduceMotion) { const split = sims[0].path.findIndex((q, j) => j > 0 && q.y > sims[0].path[j - 1].y); if (split > 0) sfx('pop', { delay: wait / 1000 + split / 3 / 60 }); }
    const speed = weapon === 'railgun' ? 6 : 3;
    const step = () => {
      // Slow motion as a shell closes in on a tank.
      const near = !reduceMotion && dramaOn() && weapon !== 'railgun' && mine.some((s) => { const q = s.path[Math.min(s.i, s.path.length - 1)]; return X.some((_, t) => { const k = tankPos(t, top, X); return k && Math.hypot(q.x - k.x, q.y - (k.y - 8)) < 90; }); });
      mine.forEach((s) => { s.i += near ? 1 : speed; });
      if (mine.some((s) => s.i < s.path.length)) return requestAnimationFrame(step);
      // A railgun beam lingers a moment before it fades.
      const linger = weapon === 'railgun' && !reduceMotion ? 350 : 0;
      setTimeout(() => { shells = shells.filter((x) => !mine.includes(x)); }, linger);
      if (shot && mine.includes(shot)) shot = null;
      if (ride && ride.p === p && !shells.some((x) => !mine.includes(x) && x.i < x.path.length)) ride.end = performance.now();
      const list = craterList(crater);
      if (list.length) { list.forEach((c) => { blast(c); applyCrater(top, c); }); if (list[0][3] !== 1 && !reduceMotion && cv.animate) cv.animate([{ transform: 'translate(-6px,3px)' }, { transform: 'translate(5px,-3px)' }, { transform: 'none' }], { duration: 350 }); }
      done({ impact: sims[0].impact, impacts: sims.map((x) => x.impact) });
    };
    if (wait) setTimeout(() => requestAnimationFrame(step), wait); else requestAnimationFrame(step);
  });
}

// ---------------------------------------------------------------- screen
function render() {
  const g = G.game, mi = myIdx();
  top = top || ground();
  const X0 = xs(), tag = (p) => (coveredAt(top, X0[g.players.indexOf(p)]) ? ' ⛰️' : '') + (dugIn(g, p, X0[g.players.indexOf(p)]) ? ' 🕳️' : '') + (g.shields.includes(p) ? ' 🛡️' : '') + (g.bertha.includes(p) ? ' 💣' : '') + (armedOf(p) ? ` ${WEAPONS[armedOf(p)].icon}` : '');
  // Face, name (the part that gives way on a narrow screen, with …), then the HP, which always shows.
  const label = (p) => `${face(g.players[p])}<span class="nm">${who(g.players[p])}</span><span>&nbsp;· ${g.hp[p]}${tag(g.players[p])}</span>`;
  const many = multi();
  document.querySelector('.hud').classList.add('multi');   // every count gets the slim chip strip (047)
  // 4+ tanks on a phone: the HP chips and wind sit above the battlefield instead of covering half of it.
  const bigHud = g.players.length >= 4 && isPhone();
  document.querySelector('.stage').classList.toggle('bighud', bigHud);
  // ...and the zoom buttons ride along in that bar, beside the wind (not over the tanks in the corner).
  const cb = $('camBar'), home = bigHud && !$('play').classList.contains('fs-on') ? document.querySelector('.hud') : document.querySelector('.stage');
  if (cb.parentElement !== home) home.appendChild(cb);
  // One slim pill per tank in a single strip: colour, face, HP (names on wide screens), the pill
  // filling with the tank's colour as HP drops; the one whose turn it is outlined.
  $('hpRow').hidden = false; $('hpRow').classList.toggle('tight', g.players.length >= 5 && isPhone());   // 5-6 on a phone: colour dots, no faces
  $('hpRow').innerHTML = g.players.map((id, p) => `<div class="hpc ${g.hp[p] <= 0 ? 'out' : ''} ${g.status === 'playing' && !liveOn && g.turn === p ? 'turn' : ''}" style="--c:${COLS[p]};--hp:${Math.max(0, g.hp[p])}%" title="${esc(who(id).replace(/<[^>]+>/g, ''))}: ${g.hp[p]} HP">
    <i class="dot"></i>${face(id)}<span class="nm">${who(id)}</span><b>${g.hp[p] <= 0 ? '💀' : g.hp[p]}</b><span class="tg">${tag(id)}</span></div>`).join('');
  const wx = windXOf(g, g.move) % 10, gusty = wx === 3, w = windFor(g.seed, g.move, wx);
  $('wind').textContent = (g.lowgrav === g.move ? '🌙 ' : '') + (gusty ? '🌪️ ' : wx === 5 ? '🌀 ' : '') + (w === 0 ? 'No wind' : `Wind ${w < 0 ? '←' : '→'} ${Math.abs(w)}${gusty ? ' (hurricane!)' : wx === 5 ? ' (tornado!)' : ''}`);
  const over = g.status === 'over', out = !over && mi >= 0 && g.hp[mi] <= 0;   // knocked out, still watching (3-4 players)
  const liveNow = liveOn && !over && mi >= 0 && !out, mine = !over && !out && (liveNow || turnId() === me.id);
  $('title').innerHTML = over ? (g.winner === me.id ? 'You win!' : `${nm(g.winner)} wins!`) : out ? "💀 You're out" : liveNow ? '⚔️ Live battle' : mine ? 'Your shot' : `${nm(turnId())}'s shot`;
  $('status').textContent = over ? '' : out ? 'Watching the rest fight it out' : liveNow ? 'Fire at will!' : mine ? `Move ${g.move + 1}` : busy ? '' : 'Waiting…';
  // The controls stay up for the whole game: off your shot Fire! waits (and says whose shot it
  // is), but you can line up your next angle and power.
  $('controls').hidden = over || out || mi < 0 || g.status !== 'playing';
  const waiting = !mine || (busy && !liveNow);
  $('controls').classList.toggle('waiting', waiting);
  if (liveNow) showReload();
  else {
    const fb = $('fire'); fb.disabled = waiting;
    fb.textContent = !waiting ? 'Fire!' : mine ? 'Firing…' : `${nm(turnId()).replace(/<[^>]+>/g, '')}'s shot`;
  }
  document.querySelector('#controls .aimtip').textContent = waiting && !mine ? 'Not your shot yet: line up your next one while you wait.' : 'Drag back from anywhere, like a slingshot: the shell flies the other way, and a longer pull is more power. Fine-tune below.';
  showFuel();
  // Dodge row: on their turn, against a person (the robot fires too fast to dodge). Live: just drive.
  $('dodge').hidden = !(g.status === 'playing' && !mine && !out && mi >= 0 && !busy && !isBot(turnId()));
  if (!$('dodge').hidden) showDodge();
  // 3-4 players: the shooter might not be aiming at you.
  document.querySelector('.dodgetip').textContent = multi() ? `${nm(turnId()).replace(/<[^>]+>/g, '')} is lining up a shot. Shift your tank before they fire.` : "They're lining up a shot at you. Shift your tank before they fire.";
  // Shot clock: 30 seconds to fire (not against the robot, where nobody is waiting on you).
  if (mine && !liveNow && !busy && !g.players.some(isBot)) shotClock(`duel.${g.id}.${g.move}`, 30, async () => {
    const { data } = await sb.rpc('shot_clock', { p_kind: 'duel', p_game: g.id });
    if (data) splash(['TOO SLOW!', '⏱ SHOT CLOCK', data], { tone: 'red', sound: null, ms: 2000 });
    await load(g.id); render();
  });
  else stopShotClock();
  danger(g.status === 'playing' && mi >= 0 && g.hp[mi] > 0 && g.hp[mi] <= 25);   // nearly out: red pulse and a heartbeat
  if (mine && !busy && isPhone()) { try { if (!sessionStorage.getItem('duel.tip')) { sessionStorage.setItem('duel.tip', '1'); note('Drag back from anywhere to aim, like a slingshot: the shell flies the other way.'); } } catch {} }
  // Dragging aims on your turn instead of scrolling; with the camera (4+ tanks) the battlefield keeps
  // its fingers too, for pinching and panning, except a plain vertical swipe that scrolls the page.
  $('controls').style.touchAction = canAim() && !droneOn() ? 'none' : '';   // the panel takes slingshot pulls, not scrolls
  cv.style.touchAction = canAim() || (camOn() && cam.z > 1) ? 'none' : camOn() ? 'pan-y' : 'manipulation';
  showCam();
  if (camOn() && isPhone()) { try { if (!localStorage.getItem('duel.camtip')) { localStorage.setItem('duel.camtip', '1'); note('🔍 A big battlefield: pinch it to zoom in, and drag to look around.'); } } catch {} }
  cv.style.cursor = canAim() ? 'crosshair' : '';
  // Phones, on your shot: the backpack as a row of icons right above Fire!; otherwise its own panel below.
  const mini = compactPack() && !$('controls').hidden;
  $('packMini').innerHTML = mini ? backpackBarHTML(pack, 'duel', !busy, { compact: true }) : '';
  $('pack').innerHTML = over || out || mini ? '' : backpackBarHTML(pack, 'duel', !busy);
  document.querySelectorAll('#pack [data-loot], #packMini [data-loot]').forEach((b) => {
    const item = b.dataset.item;
    b.classList.toggle('on', armedOf(me.id) === item || (item === 'bertha' && g.bertha.includes(me.id)) || (item === 'shield' && g.shields.includes(me.id)));
    const shell = item === 'bertha' || WEAPONS[item];
    if ((shell && (!mine || g.bertha.includes(me.id) || armedOf(me.id))) || (item === 'shield' && g.shields.includes(me.id))) b.disabled = true;
    // A Foxhole digs in where your tank is saved: not while a turn's drive is still unsaved.
    const drove = !liveOn && myXMove === g.move && myX != null && myX !== baseXs()[mi];
    if (item === 'foxhole') { b.classList.toggle('on', mi >= 0 && dugIn(g, me.id, xs()[mi])); if (mi < 0 || dugIn(g, me.id, xs()[mi]) || drove) b.disabled = true; }
    b.onclick = async () => {
      b.disabled = true;
      if (item === 'foxhole' && liveOn && liveMyX != null && liveMyX !== baseXs()[mi]) { clearTimeout(liveSave); await saveLiveX(); }
      const { error } = await useLoot(+b.dataset.loot, g.id);
      if (error) { $('err').textContent = friendly(error); return; }
      stamp(`${ITEMS[item].icon} ${ITEMS[item].name}${WEAPONS[item] ? '<br><small style="font-size:.45em">loaded</small>' : '!'}`, '', 1500); sfx('pop');
      if (WEAPONS[item]) { note(`${ITEMS[item].icon} ${ITEMS[item].desc}`); hintCache.clear(); }
      pack = await backpack(); await load(g.id);
      if (item === 'foxhole') { top = ground(); sfx('boom', { size: 0.5 }); note('🕳️ Dug in! Blasts do 40% less to you while you stay put. Drive out and it\'s just a hole.'); }
      render(); showAim();
    };
  });
  setGameTools({ fs: '#play', canDelete: g.created_by === me.id, onDelete: deleteGame,
    bot: g.status === 'playing' && mi >= 0 && g.players.some(isBot) ? { on: !!g.live_bot, label: 'Live battle vs robot', onToggle: toggleBotLive } : null });
  // Live vs robot: a switch whenever the robot is in the duel.
  $('feed').innerHTML = [...G.shots].reverse().slice(0, 6).map((s) => {
    const full = g.players.map(() => 100), before = s.move > 1 ? G.shots.find((x) => x.move === s.move - 1)?.hp_after || full : full;
    const hurt = s.hp_after.map((h, p) => before[p] - h).map((d, p) => (d > 0 ? `${who(g.players[p])} −${d}${s.hp_after[p] <= 0 ? ' 💀' : ''}` : '')).filter(Boolean).join(', ');
    const wl = s.weapon ? `${WEAPONS[s.weapon].icon} ${WEAPONS[s.weapon].name.toLowerCase()} ` : '';
    const sa = aimDir(g.players.indexOf(s.shooter), s.angle, g.players), shown = s.weapon === 'railgun' ? railAngle(sa.a) : sa.a;
    if (s.weapon === 'drone') return `<li><strong>${who(s.shooter)}</strong> called in a 🚁 drone strike: ${s.crater ? hurt || 'it missed, but left a crater' : 'the bomb drifted off the map'}.</li>`;
    return `<li><strong>${who(s.shooter)}</strong> fired ${wl}${multi() ? (sa.dir > 0 ? '→ ' : '← ') : ''}at ${shown}°${s.weapon === 'railgun' ? '' : `, power ${s.power}`}: ${s.weapon === 'dirt' && s.crater ? hurt || 'a brand-new hill' : s.crater ? hurt || 'a miss, but a nice crater' : s.weapon === 'railgun' ? 'the beam missed' : 'the shell flew off the map'}.</li>`;
  }).join('') || '<li class="muted">No shots yet.</li>';
  if (over) {
    $('endPanel').hidden = false;
    // What's next (the countdown, with Rematch and Stay here) shows in #nextSlot, just below.
    $('endPanel').innerHTML = `<h2>${g.winner === me.id ? '🏆 Victory!' : `${nm(g.winner)} took the hill`}</h2><p class="muted">${g.move} shots fired${multi() ? ` · last tank standing of ${g.players.length}` : ''}.</p>`;
  }
}

// ---------------------------------------------------------------- chaos twists on the battlefield
// Meteors [x, depth, r, 5] and quakes [x, dh, r, 6] (042) arrive as craters from the server: the
// page plays the ones it hasn't shown yet (never on first load), then the ground is rebuilt.
let twistSeen = null, meteors = [];
function newTwists(g) {
  const tw = g.craters.filter((c) => c[3] === 5 || c[3] === 6), prev = twistSeen?.game === g.id ? twistSeen.n : null;
  twistSeen = { game: g.id, n: tw.length };
  return prev == null ? [] : tw.slice(prev);
}
function drawMeteor(m) {
  const f = Math.min(1, (performance.now() - m.t0) / m.dur); if (f <= 0) return;
  const x = m.x0 + (m.x1 - m.x0) * f, y = m.y0 + (m.y1 - m.y0) * f;
  ctx.save(); ctx.lineCap = 'round';
  const g = ctx.createLinearGradient(x - (m.x1 - m.x0) * 0.25, y - (m.y1 - m.y0) * 0.25, x, y); g.addColorStop(0, '#FF6B3D00'); g.addColorStop(1, '#FFC857');
  ctx.strokeStyle = g; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(x - (m.x1 - m.x0) * 0.25, y - (m.y1 - m.y0) * 0.25); ctx.lineTo(x, y); ctx.stroke();
  ctx.shadowColor = '#FF6B3D'; ctx.shadowBlur = 20; ctx.fillStyle = '#FFF4D6'; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill(); ctx.restore();
}
async function twistFx(list) {
  const quakes = list.filter((c) => c[3] === 6), rocks = list.filter((c) => c[3] === 5);
  if (quakes.length) {
    sfx('boom', { size: 1.6 }); sfx('thud', { delay: 0.3 }); navigator.vibrate?.([90, 40, 90, 40, 140]);
    if (!reduceMotion && cv.animate) cv.animate([0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({ transform: k === 7 ? 'none' : `translate(${(k % 2 ? 1 : -1) * (9 - k)}px,${(k % 3 - 1) * (7 - k)}px)` })), { duration: 900 });
    const cols = ['#8A5A2B', '#B08355', '#6B4423', '#D6B28A'];
    quakes.forEach((c) => { applyCrater(top, c); for (let i = 0; i < 18; i++) { const x = c[0] + (Math.random() * 2 - 1) * c[2]; particles.push({ x, y: top[Math.max(0, Math.min(W - 1, Math.round(x)))], vx: (Math.random() - 0.5) * 2, vy: -Math.random() * 3, life: 1, s: Math.random() * 3 + 1.5, c: cols[i % 4] }); } });
    render(); await sleep(reduceMotion ? 0 : 900);
  }
  if (rocks.length) {
    const dur = reduceMotion ? 1 : 520, t0 = performance.now();
    rocks.forEach((c, i) => { const x1 = c[0], y1 = top[Math.max(0, Math.min(W - 1, Math.round(x1)))]; meteors.push({ x0: x1 - 140, y0: -30, x1, y1, t0: t0 + i * (reduceMotion ? 0 : 260), dur, c }); });
    if (!reduceMotion) sfx('whistle', { dur: 0.5 });
    await Promise.all(meteors.map((m) => sleep(m.t0 + m.dur - performance.now()).then(() => {
      const y = top[Math.max(0, Math.min(W - 1, Math.round(m.x1)))] + m.c[1];
      blast([m.x1, y, m.c[2]]); applyCrater(top, m.c); render();
    })));
    meteors = [];
  }
}

async function load(id) {
  const [g, s] = await Promise.all([
    sb.from('duel_games').select('*').eq('id', id).maybeSingle(),
    sb.from('duel_shots').select('*').eq('game_id', id).order('move'),
  ]);
  if (!g.data) return false;
  const { data: prof } = await sb.from('profiles').select('id, username').in('id', g.data.players);
  const fresh = G?.game.id !== g.data.id;
  setWorld(g.data.world);   // 3-4 tanks: a wider battlefield, drawn zoomed out (031)
  if (fresh) camReset();   // a new duel starts on the whole field
  G = { game: g.data, shots: s.data ?? [], names: Object.fromEntries((prof ?? []).map((p) => [p.id, p.username])) };
  if (G.game.gauntlet_id) gauntletBar(G.game.gauntlet_id, G.game.id, me.id, (p) => G.names[p] ?? names[p] ?? 'someone');
  return true;
}

async function decide() {
  if (busy) return;
  const g = G.game, last = G.shots[G.shots.length - 1];
  // Live: shells were already flown as they were fired; just show what they did.
  if (liveOn && last) {
    if (last.shooter !== me.id && seenHp && g.hp.some((h, k) => h < seenHp[k])) hitDrama(seenHp, g.hp);
    markSeen(last.move);
  }
  seenHp = [...g.hp];
  // Watch the last shot if it's new to you.
  if (last && last.shooter !== me.id && last.move > seenMove()) {
    busy = true; render();
    const before = cratersBefore(g.craters, last.crater);
    const lp = g.players.indexOf(last.shooter), full = g.players.map(() => 100), prevHp = G.shots[G.shots.length - 2]?.hp_after || full;
    // Where everyone stood when it was fired (xs, 023), or the older two-tank record.
    const LX = last.xs ? [...last.xs] : [...baseXs()]; if (!last.xs) { if (last.from_x != null) LX[lp] = last.from_x; if (last.target_x != null) LX[1 - lp] = last.target_x; }
    await flyShell(lp, last.angle, last.power, before, last.wind_move ?? last.move - 1, last.crater, last.wind_x || 1, LX, last.weapon, prevHp);
    markSeen(last.move); top = ground(); busy = false;
    hitDrama(prevHp, last.hp_after);
  }
  const tw = newTwists(g);
  if (tw.length) { busy = true; await twistFx(tw); busy = false; }
  top = ground();
  render();
  if (g.status === 'over') { if (liveOn) setLive(false); endDrama(g); return; }
  const cur = turnId();
  if (isBot(cur) && !liveOn) {
    const stale = Date.now() - new Date(g.updated_at).getTime() > 15000;
    // Whoever fired last plays the robot's turn; after another robot, the first person still standing does.
    const host = botHost(g);
    // No shot yet (048 can deal a robot the first turn): the first person standing opens for it.
    if ((last && (last.shooter === me.id || (isBot(last.shooter) && host))) || (!last && host) || stale) return robotShot();
  }
}

async function fire() {
  const g = G.game, p = myIdx(), { angle, power } = myAim(), move = g.move, X = xs();
  const moved = X[p] !== baseXs()[p] ? X[p] : null, cut = digOn && moved != null ? digCut(baseXs()[p], moved) : null;
  busy = true; drag = null; render();
  navigator.vibrate?.(40);
  const wpn = armedOf(me.id), big = !wpn && g.bertha.includes(me.id);
  live?.send('shot', { from: p, move, angle, power, x: X[p], tx: multi() ? null : X[1 - p], X, w: wpn, dig: !!cut });
  const sim = await flyShell(p, angle, power, cut ? [...g.craters, cut] : g.craters, move, null, windXOf(g, move), X, wpn);
  const cr = weaponCraters(sim.impacts, wpn, big), crater = wpn === 'cluster' ? (cr.length ? cr : null) : cr[0] || null;
  const hp = weaponDamage(top, sim.impacts, g.hp, wpn, big, guards(g, X, me.id), standing(X, g.hp, p));
  impactNow(cr, g.hp, hp);
  const { error } = await sb.rpc('duel_fire', { p_game: g.id, p_angle: angle, p_power: power, p_crater: crater, p_hp: hp, p_xs: X,
    ...(multi() ? {} : { p_target_x: X[1 - p] }), ...(moved != null ? { p_x: moved } : {}), ...(cut ? { p_dig: true } : {}) });
  busy = false; myX = null;
  if (error) { $('err').textContent = friendly(error); await load(g.id); top = ground(); render(); return; }   // not saved: put things back
  markSeen(move + 1);
  notify('duel', g.id);
  announceChaos({ gameId: g.id }); pack = await backpack();
  await load(g.id); decide();
}

// The other player just pulled the trigger: fly their shell here right away, the same way
// their page does, instead of waiting for the database to catch up.
async function watchLiveShot(msg, refresh) {
  const { move, angle, power, x, tx, live: isLive, wx, w, X: sentX, dig } = msg;
  if (isLive) return watchShellLive(msg);
  const g = G?.game;
  if (!g || busy || g.status !== 'playing' || move !== g.move || turnId() === me.id) return;
  const p = g.turn, shooter = g.players[p], big = g.bertha.includes(shooter);
  busy = true; aims[p] = { move, angle, power, x }; render();
  const WX = sentX ? [...sentX] : [...baseXs()]; if (!sentX) { if (x != null) WX[p] = x; if (tx != null) WX[1 - p] = tx; }
  dodgeX = null;   // their shell is already in the air
  const cut = dig ? digCut(baseXs()[p], WX[p]) : null;
  const sim = await flyShell(p, angle, power, cut ? [...g.craters, cut] : g.craters, move, null, windXOf(g, move), WX, w || null);
  // Same flight, same numbers as their page: show the hit now; their saved shot confirms it.
  const hpNow = weaponDamage(top, sim.impacts, g.hp, w || null, big && !w, guards(g, WX, shooter), standing(WX, g.hp, p));
  impactNow(weaponCraters(sim.impacts, w || null, big && !w), g.hp, hpNow);
  markSeen(move + 1); delete aims[p];
  // Wait for their shot to land in the database, then show where things stand.
  for (let i = 0; i < 8 && G.game.move === move; i++) { await sleep(500); await load(g.id); }
  busy = false;
  if (G.game.move === move) return refresh();   // still not saved; the regular checks will pick it up
  top = ground();
  if (G.game.hp.join() !== hpNow.join()) hitDrama(hpNow, G.game.hp);   // only if the saved shot says otherwise
  pack = await backpack(); announceChaos({ gameId: g.id });
  decide();
}

// ---------------------------------------------------------------- live battle
async function fireLive() {
  const g = G?.game, p = G ? myIdx() : -1;
  if (!g || p < 0 || !liveOn || g.status !== 'playing' || Date.now() < reloadAt) return;
  if (Date.now() < liveGo) { note('Wait for GO!'); sfx('buzz'); return; }
  reloadAt = Date.now() + RELOAD; showReload();
  if (digOn && liveMyX != null && liveMyX !== baseXs()[p]) { clearTimeout(liveSave); await saveLiveX(); }   // the dig is saved before the shot
  const { angle, power } = myAim(), move = g.move, windX = windXOf(g, move), X = xs();
  navigator.vibrate?.(40); drag = null;
  const wpn = armedOf(me.id), big = !wpn && g.bertha.includes(me.id);
  live?.send('shot', { live: true, from: p, move, angle, power, x: X[p], wx: windX, w: wpn });
  const sim = await flyShell(p, angle, power, g.craters, move, null, windX, X, wpn);
  // Damage is worked out where the tanks stand when it lands (they may have driven meanwhile).
  const now = G.game, Xi = xs(), cr = weaponCraters(sim.impacts, wpn, big), crater = wpn === 'cluster' ? (cr.length ? cr : null) : cr[0] || null;
  const hp = weaponDamage(top, sim.impacts, now.hp, wpn, big, guards(now, Xi, me.id), standing(Xi, now.hp, p));
  cr.forEach((c) => { blast(c); applyCrater(top, c); });
  const { error } = await sb.rpc('duel_fire_live', { p_game: g.id, p_angle: angle, p_power: power, p_crater: crater,
    p_dmg: now.hp.map((h, k) => h - hp[k]), p_x: X[p] !== baseXs()[p] ? X[p] : null, p_target_x: multi() ? null : Xi[1 - p], p_xs: Xi, p_wind_move: move, p_wind_x: windX });
  if (error) { note(friendly(error), 'error'); if (/live battle is over/i.test(error.message || '')) setLive(false); }
  else { hitDrama(now.hp, hp); seenHp = hp; nudge(); announceChaos({ gameId: g.id }); pack = await backpack(); }
  await load(g.id); decide();
}
// Their live shell: fly it here as it's fired. The damage arrives with the next refresh.
async function watchShellLive(msg) {
  const { angle, power, x, move, wx, w } = msg;
  const g = G?.game, mi = G ? myIdx() : -1;
  if (!g || !liveOn || mi < 0 || g.status !== 'playing') return;
  const p = fromOf(msg); if (p < 0 || p === mi) return;
  const big = g.bertha.includes(g.players[p]), X = xs(); if (x != null) X[p] = x;
  aims[p] = { ...(aims[p] || {}), angle, power, x };
  const sim = await flyShell(p, angle, power, g.craters, move ?? g.move, null, wx || 1, X, w || null);
  weaponCraters(sim.impacts, w || null, big && !w).forEach((c) => { blast(c); applyCrater(top, c); });
}
function showReload() {
  const b = $('fire'), left = reloadAt - Date.now();
  if (liveOn && left > 0) { b.disabled = true; b.textContent = `Reloading… ${(left / 1000).toFixed(1)}`; setTimeout(showReload, 100); }
  else { b.disabled = false; b.textContent = 'Fire!'; }
}
// Check in with the server; it says whether you're both here.
async function here(on = true) {
  const g = G?.game;
  if (!g || myIdx() < 0) return;
  if (g.status !== 'playing' || (g.players.some(isBot) && !g.live_bot)) { if (liveOn) setLive(false); return; }
  const { data, error } = await sb.rpc('duel_here', { p_game: g.id, p_on: on });
  if (on && !error) setLive(!!data);
}
function setLive(v) {
  if (v === liveOn) return;
  liveOn = v; liveMyX = null; liveX = {}; aims = {}; myX = null; dodgeX = null; drag = null;
  hintCache.clear();
  if (v) {
    live?.send('here', {});
    stopShotClock();
    const vsBot = G?.game.players.some(isBot);
    if (vsBot) G.game.players.forEach((p, k) => { if (isBot(p)) botReloadAt[k] = Date.now() + 4000 + k * 400; });   // a few seconds' grace before the robots open fire
    liveGo = Date.now() + 3000;
    liveCountdown('duel', G.game.id, ['⚔️ LIVE BATTLE', vsBot && !multi() ? 'You vs the robot' : "Everyone's here"], { solo: G.game.players.filter((p) => !isBot(p)).length < 2 })
      .then((t) => { liveGo = t; G?.game.players.forEach((p, k) => { if (isBot(p)) botReloadAt[k] = t + 1500 + k * 400; }); });   // robots open fire after GO
  } else {
    reloadAt = 0; showReload();
    if (G?.game.status === 'playing') note('Live battle over: back to taking turns.');
  }
  if (G) { top = ground(); render(); }
}

// ---------------------------------------------------------------- the robot, live
// With "Live vs robot" on, the robot fires on its own reload (Rookie 2.3 s, Pro 1.6 s, Ace 1.3 s;
// yours is 1.5 s): it rolls a little, aims at where your tank is right now, and wobbles by skill.
// It gives you 4 s to get going, and wobbles more than in turns (see botLiveShot).
let botReloadAt = {}, botBusy = new Set(), liveGo = 0;   // liveGo: live shots wait for the countdown's GO (045)   // by seat: several robots can be in one duel (033)
const BOT_RELOAD = [2300, 1600, 1300];
// Who the robot shoots at: with two players the other tank. With more, each robot picks its own
// target and sticks with it for a few shots: nearer tanks are easier, it hits back at whoever last
// hit it, and it likes to finish off a tank that's nearly out, with plenty of chance on top. It
// used to be "the weakest tank standing" for everyone, so the whole table ganged up on whoever took
// the first hit (usually the person, who shoots slower than robots). People and robots count alike.
const botAim = {};   // by seat: { game, t, left }
function lastHitBy(bi) {
  const g = G.game, full = g.players.map(() => 100);
  for (let i = G.shots.length - 1; i >= 0; i--) {
    const s = G.shots[i], before = G.shots[i - 1]?.hp_after || full;
    if (s.shooter !== g.players[bi] && s.hp_after?.[bi] < before[bi]) return g.players.indexOf(s.shooter);
  }
  return -1;
}
function botTarget(bi, X) {
  const g = G.game;
  if (!multi()) return 1 - bi;
  const alive = g.players.map((_, p) => p).filter((p) => p !== bi && g.hp[p] > 0);
  const cur = botAim[bi];
  if (cur?.game === g.id && cur.left > 0 && alive.includes(cur.t)) { cur.left--; return cur.t; }
  const foe = lastHitBy(bi);
  const score = Object.fromEntries(alive.map((p) => [p,
    (Math.abs(X[p] - X[bi]) / W) * 80 - (p === foe ? 35 : 0) - (g.hp[p] <= 25 ? 20 : 0) + Math.random() * 60]));
  const t = alive.sort((a, b) => score[a] - score[b])[0];
  botAim[bi] = { game: g.id, t, left: 2 };
  return t;
}
const botAngles = (bi, ti, X, step) => { const right = !multi() || X[ti] > X[bi], out = []; for (let a = 10; a <= 85; a += step) out.push(right ? a : 180 - a); return out; };
// Keep a wobbled angle on the side it was aimed at.
const botClamp = (a, aimed) => (!multi() || aimed <= 90 ? Math.max(5, Math.min(85, a)) : Math.max(95, Math.min(175, a)));
// Only one page drives the robots: the first person at the table still standing, or once every
// person is out (only robots left), the first person in the duel, watching it play out.
const botHost = (g) => (g.players.find((p, k) => !isBot(p) && g.hp[k] > 0) ?? g.players.find((p) => !isBot(p))) === me.id;
const botDriver = () => botHost(G.game);
setInterval(() => {
  if (!liveOn || G?.game.status !== 'playing' || !botDriver()) return;
  G.game.players.forEach((p, bi) => { if (isBot(p) && G.game.hp[bi] > 0 && !botBusy.has(bi) && Date.now() >= (botReloadAt[bi] || 0)) botLiveShot(bi); });
}, 250);
async function botLiveShot(bi) {
  botBusy.add(bi);
  try {
    const g = G.game, lvl = g.bot_level ?? 1;
    if (g.hp[bi] <= 0) return;
    botReloadAt[bi] = Date.now() + BOT_RELOAD[lvl];
    // Roll to a nearby spot first.
    const [lo, hi] = SIDE(bi), from = xs()[bi], to = Math.max(lo, Math.min(hi, from + Math.round((Math.random() * 2 - 1) * 30)));
    if (!reduceMotion) for (let x = from; x !== to; x += Math.sign(to - x) * Math.min(3, Math.abs(to - x))) { liveX[bi] = x; await sleep(30); if (!liveOn) return; }
    liveX[bi] = to;
    const X = xs(), mi = botTarget(bi, X), target = tankPos(mi, top, X), move = g.move, windX = windXOf(g, move), SX = standing(X, g.hp, bi);
    let best = null;
    for (const a of botAngles(bi, mi, X, 1)) for (let pw = 20; pw <= 100; pw += 2) {
      const sim = simulate(g.seed, move, top, bi, a, pw, windX, SX);
      const d = sim.impact ? Math.hypot(sim.impact.x - target.x, sim.impact.y - target.y) : 999;
      if (!best || d < best.d) best = { d, a, pw };
    }
    // Live it wobbles more than in turns (1.8×) and steadies less (to 60% at best): a person needs time
    // to aim and it doesn't, and you can drive out of the way.
    const taken = G.shots.filter((s) => s.shooter === g.players[bi]).length, learn = 1.8 * (lvl === 0 ? 1 : Math.max(0.6, 0.85 ** taken));
    const base = [{ a: 6, p: 8 }, { a: 1.7, p: 2.4 }, { a: 0.6, p: 0.8 }][lvl];
    const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const angle = botClamp(Math.round(best.a + gauss() * base.a * learn), best.a), power = Math.max(20, Math.min(100, Math.round(best.pw + gauss() * base.p * learn)));
    aims[bi] = { move, angle, power, x: to };
    await sleep(reduceMotion ? 0 : 250);
    if (!liveOn) return;
    const sim = await flyShell(bi, angle, power, g.craters, move, null, windX, X);
    const now = G.game, Xi = xs(), crater = sim.impact ? [Math.round(sim.impact.x), Math.round(sim.impact.y), CRATER_R] : null;
    const hp = damage(top, sim.impact, now.hp, false, guards(now, Xi, now.players[bi]), standing(Xi, now.hp, bi));
    if (crater) { blast(crater); applyCrater(top, crater); }
    const { error } = await sb.rpc('duel_fire_live_bot', { p_game: g.id, p_angle: angle, p_power: power, p_crater: crater, p_dmg: now.hp.map((h, k) => h - hp[k]),
      p_x: to !== baseXs()[bi] ? to : null, p_target_x: multi() ? null : Xi[mi], p_xs: Xi, p_wind_move: move, p_wind_x: windX, p_bot: g.players[bi] });
    if (error) { if (/Still reloading/.test(error.message || '')) botReloadAt[bi] = Date.now() + 800; else if (!/over/i.test(error.message || '')) note(friendly(error), 'error'); }
    else { hitDrama(now.hp, hp); seenHp = hp; }
    await load(g.id); decide();
  } finally { botBusy.delete(bi); }
}

// The robot tries every angle and power, keeps the one that lands closest, then wobbles it by skill.
async function robotShot() {
  busy = true; render();
  const g = G.game, p = g.turn, windX = windXOf(g, g.move);
  // The robot drives too: it scouts spots within its fuel with a quick coarse search, takes the
  // one with the best shot (Rookie drives more at random), and never just sits still.
  $('status').textContent = `${nm(g.players[p]).replace(/<[^>]+>/g, '')} is sizing you up…`;
  await sleep(reduceMotion ? 0 : 400);
  const start = baseXs()[p], [lo, hi] = SIDE(p), ti = botTarget(p, baseXs());
  const spots = [-40, -30, -20, -10, 0, 10, 20, 30, 40].map((d) => start + d).filter((x) => x >= lo && x <= hi);
  const coarse = (X) => { const tg = tankPos(ti, top, X), SX = standing(X, g.hp, p); let b = 999;
    for (const a of botAngles(p, ti, X, 3)) for (let pw = 20; pw <= 100; pw += 4) {
      const sim = simulate(g.seed, g.move, top, p, a, pw, windX, SX);
      if (sim.impact) b = Math.min(b, Math.hypot(sim.impact.x - tg.x, sim.impact.y - tg.y));
    } return b; };
  // Pro and Ace also dodge: they'd rather not stand where your last shell landed.
  const theirs = [...G.shots].reverse().find((s) => s.shooter !== g.players[p] && s.crater);
  const tc = theirs ? craterList(theirs.crater)[0] : null;
  const dodge = (x) => (g.bot_level > 0 && tc ? 0.35 * Math.min(90, Math.abs(x - tc[0])) : 0);
  const scored = spots.map((x) => { const X = [...baseXs()]; X[p] = x; return { x, d: coarse(X) - dodge(x) + Math.random() * (g.bot_level === 0 ? 60 : 8) }; }).sort((u, v) => u.d - v.d);
  let goal = scored[0].x;
  if (goal === start) goal = Math.max(lo, Math.min(hi, start + (Math.random() < 0.5 ? -1 : 1) * (6 + Math.round(Math.random() * 10))));
  $('status').textContent = `${nm(g.players[p]).replace(/<[^>]+>/g, '')} is on the move…`;
  botDrive = { move: g.move, x: start };
  if (reduceMotion) botDrive.x = goal;
  else while (botDrive.x !== goal) { botDrive.x += Math.sign(goal - botDrive.x) * Math.min(2, Math.abs(goal - botDrive.x)); if (botDrive.x % 8 === 0) sfx('tick'); await sleep(60); }
  await sleep(reduceMotion ? 0 : 250);
  const X = xs(), target = tankPos(ti, top, X), SX = standing(X, g.hp, p);
  let best = null;
  for (const a of botAngles(p, ti, X, 1)) for (let pw = 20; pw <= 100; pw += 2) {
    const sim = simulate(g.seed, g.move, top, p, a, pw, windX, SX);
    const d = sim.impact ? Math.hypot(sim.impact.x - target.x, sim.impact.y - target.y) : 999;
    if (!best || d < best.d) best = { d, a, pw };
  }
  // Rookie stays wobbly. Pro and Ace are tighter, and they learn: every shot they've already
  // taken this duel steadies the next one (down to about a third of the wobble).
  const lvl = g.bot_level ?? 1, taken = G.shots.filter((s) => s.shooter === g.players[p]).length;
  const learn = lvl === 0 ? 1 : Math.max(0.35, 0.82 ** taken);
  const base = [{ a: 6, p: 8 }, { a: 1.7, p: 2.4 }, { a: 0.6, p: 0.8 }][lvl];
  const skill = { a: base.a * learn, p: base.p * learn };
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const angle = botClamp(Math.round(best.a + gauss() * skill.a), best.a);
  const power = Math.max(20, Math.min(100, Math.round(best.pw + gauss() * skill.p)));
  $('status').textContent = `${nm(g.players[p]).replace(/<[^>]+>/g, '')} is aiming…`;
  await sleep(reduceMotion ? 0 : 900);
  const sim = await flyShell(p, angle, power, g.craters, g.move, null, windX, X);
  const crater = sim.impact ? [Math.round(sim.impact.x), Math.round(sim.impact.y), CRATER_R] : null;
  const hp = damage(top, sim.impact, g.hp, false, guards(g, SX, g.players[p]), SX);
  impactNow(crater ? [crater] : [], g.hp, hp);
  const { error } = await sb.rpc('duel_fire_bot', { p_game: g.id, p_angle: angle, p_power: power, p_crater: crater, p_hp: hp, p_xs: X, ...(goal !== start ? { p_x: goal } : {}) });
  botDrive = null;
  markSeen(g.move + 1);
  busy = false;
  if (error) { $('err').textContent = friendly(error); await load(g.id); top = ground(); return render(); }
  nudge();
  await load(g.id); decide();
}

// ---------------------------------------------------------------- controls
let aimT = 0, aimQueued = false;
const sendAim = () => {
  if (!G || (busy && !liveOn)) return;
  const now = Date.now();
  if (now - aimT < 90) { if (!aimQueued) { aimQueued = true; setTimeout(() => { aimQueued = false; sendAim(); }, 90); } return; }
  aimT = now; live?.send('aim', { from: myIdx(), move: G.game.move, ...myAim(), x: xs()[myIdx()], dig: digOn });
};
// Sets the aim from anywhere (sliders, − / + buttons, dragging on the battlefield).
function showAim() {
  // 🚁 loaded: a Drop slider along the map in place of Angle and Power.
  const drone = G && droneOn();
  $('aimbar').hidden = !!drone; $('dropRow').hidden = !drone;
  if (drone) {
    const X = xs(), x = dropX ?? W / 2, over = G.game.players.map((id, p) => (p !== myIdx() && G.game.hp[p] > 0 && X[p] != null && Math.abs(X[p] - x) < 22 ? who(id).replace(/<[^>]+>/g, '') : null)).find(Boolean);
    $('drop').max = W - 1; $('drop').value = Math.round(x); $('dropOut').textContent = over ? `🎯` : '🚁'; $('dropOut').title = over ? `Right over ${over}` : '';
    $('drop').style.setProperty('--fill', `${(x / (W - 1)) * 100}%`);
  }
  const rail = G && armedOf(me.id) === 'railgun', v = +$('angle').value;
  // 3-4 players: the angle is shown as a direction and a steepness (→ 40°, ← 40°).
  const many = G && multi(), elev = many ? (v <= 90 ? v : 180 - v) : v;
  $('angleOut').textContent = (many ? (v <= 90 ? '→ ' : '← ') : '') + (rail ? railAngle(elev) : elev) + '°'; $('powerOut').textContent = rail ? '⚡' : $('power').value;
  ['angle', 'power'].forEach((id) => { const el = $(id); el.style.setProperty('--fill', `${((el.value - el.min) / (el.max - el.min)) * 100}%`); });
}
const aimKey = () => `duel.aim.${G.game.id}`;
function setDrop(x) { dropX = Math.max(0, Math.min(W - 1, Math.round(x))); showAim(); sendAim(); }
$('drop').addEventListener('input', () => setDrop(+$('drop').value));
function setAim(angle, power) {
  $('angle').value = Math.max(5, Math.min(G && multi() ? 175 : 85, Math.round(angle)));
  $('power').value = Math.max(20, Math.min(100, Math.round(power)));
  showAim(); sendAim();
  try { localStorage.setItem(aimKey(), JSON.stringify({ angle: +$('angle').value, power: +$('power').value })); } catch {}
}
['angle', 'power'].forEach((id) => $(id).addEventListener('input', () => setAim(+$('angle').value, +$('power').value)));

// Driving: ◀ ▶ move the tank 2 px a step (hold to keep going), up to 40 px of fuel a turn,
// never past your side of the hill. The other player sees it live; the move goes with the shot.
// ◀ ▶ step 2 px; the Move slider jumps straight to a spot. Either way: within your stretch of the
// ridge, and on your turn within 40 px of where the turn began.
const driveBy = (d) => driveTo(curDriveX() + d * 2);
const curDriveX = () => (liveOn ? liveMyX ?? baseXs()[myIdx()] : myXMove === G.game.move && myX != null ? myX : baseXs()[myIdx()]);
function driveRange() {
  const p = myIdx(), [lo, hi] = SIDE(p);
  if (liveOn) return [lo, hi];
  const start = baseXs()[p]; return [Math.max(lo, start - FUEL), Math.min(hi, start + FUEL)];
}
function driveTo(x) {
  if (liveOn && G && myIdx() >= 0 && G.game.status === 'playing') {
    const [lo, hi] = driveRange(), cur = curDriveX(), nx = Math.max(lo, Math.min(hi, Math.round(x)));
    if (nx === cur) return;
    liveMyX = nx; sendAim(); showFuel(); if (digOn) refreshTop();
    if (Math.floor(nx / 8) !== Math.floor(cur / 8)) sfx('tick');
    clearTimeout(liveSave); liveSave = setTimeout(saveLiveX, 400);
    return;
  }
  const g = G?.game; if (!g || busy || shot || g.status !== 'playing' || turnId() !== me.id) return;
  if (myXMove !== g.move || myX == null) { myXMove = g.move; myX = baseXs()[myIdx()]; }
  const [lo, hi] = driveRange(), cur = myX, nx = Math.max(lo, Math.min(hi, Math.round(x)));
  if (nx === cur) return;
  myX = nx; showFuel(); sendAim(); if (digOn) refreshTop();
  if (Math.floor(nx / 8) !== Math.floor(cur / 8)) sfx('tick');
}
async function saveLiveX() {
  const g = G?.game; if (!g || !liveOn || liveMyX == null) return;
  const dig = digOn && liveMyX !== baseXs()[myIdx()];
  const { error } = await sb.rpc('duel_dodge', { p_game: g.id, p_move: g.move, p_x: liveMyX, ...(dig ? { p_dig: true } : {}) });
  if (error) note(friendly(error), 'error');
  else if (dig) { await load(g.id); refreshTop(); }   // the tunnel is saved: build on it
}
function showFuel() {
  const g = G?.game; if (!g || !$('fuelOut')) return;
  const mr = $('moveRange');
  if (myIdx() >= 0) { const [lo, hi] = driveRange(); mr.min = lo; mr.max = hi; mr.value = curDriveX(); }
  mr.disabled = !(g.status === 'playing' && myIdx() >= 0 && (liveOn || (turnId() === me.id && !busy)));
  // The Foxhole digs in where your tank was saved: not after a drive this turn that isn't yet.
  const drove = !liveOn && myXMove === g.move && myX != null && myIdx() >= 0 && myX !== baseXs()[myIdx()];
  document.querySelectorAll('#pack [data-item="foxhole"], #packMini [data-item="foxhole"]').forEach((b) => { if (drove) b.disabled = true; });
  if (liveOn) { $('fuelOut').textContent = '∞'; return; }
  const used = myXMove === g.move && myX != null ? Math.abs(myX - baseXs()[myIdx()]) : 0;
  $('fuelOut').textContent = FUEL - used;
}
const dodgeBy = (d) => { const g = G?.game; if (g) dodgeTo((dodgeMove === g.move && dodgeX != null ? dodgeX : baseXs()[myIdx()]) + d * 2); };
function dodgeRange() {
  const g = G.game, i = myIdx(), start = (g.turn_x || baseXs())[i], [lo, hi] = SIDE(i);
  return [Math.max(lo, start - DODGE), Math.min(hi, start + DODGE)];
}
function dodgeTo(x) {
  const g = G?.game; if (!g || busy || shot || g.status !== 'playing' || turnId() === me.id || isBot(turnId()) || g.hp[myIdx()] <= 0) return;
  const i = myIdx();
  if (dodgeMove !== g.move || dodgeX == null) { dodgeMove = g.move; dodgeX = baseXs()[i]; }
  const [lo, hi] = dodgeRange(), cur = dodgeX, nx = Math.max(lo, Math.min(hi, Math.round(x)));
  if (nx === cur) return;
  dodgeX = nx; showDodge();
  if (Math.floor(nx / 8) !== Math.floor(cur / 8)) sfx('tick');
  live?.send('dodge', { from: i, move: g.move, x: nx });
  clearTimeout(dodgeSave); dodgeSave = setTimeout(saveDodge, 350);
}
let dodgeSave = null;
async function saveDodge() {
  const g = G?.game; if (!g || dodgeX == null || dodgeMove !== g.move) return;
  const x = dodgeX;
  const { error } = await sb.rpc('duel_dodge', { p_game: g.id, p_move: dodgeMove, p_x: x });
  if (error) { note(friendly(error), 'error'); dodgeX = null; await load(g.id); render(); return; }
  live?.send('dodge', { from: myIdx(), move: g.move, x });
}
function showDodge() {
  const g = G?.game; if (!g || !$('dodgeOut')) return;
  const i = myIdx(), start = (g.turn_x || baseXs())[i], cur = dodgeMove === g.move && dodgeX != null ? dodgeX : baseXs()[i];
  const left = DODGE - Math.abs(cur - start), dr = $('dodgeRange'), [lo, hi] = dodgeRange();
  dr.min = lo; dr.max = hi; dr.value = cur;
  $('dodgeOut').textContent = left;
}
$('moveRange').addEventListener('input', (e) => driveTo(+e.target.value));
$('dodgeRange').addEventListener('input', (e) => dodgeTo(+e.target.value));
document.querySelectorAll('[data-dv]').forEach((b) => {
  let hold = null, rep = null;
  const stop = () => { clearTimeout(hold); clearInterval(rep); };
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); dodgeBy(+b.dataset.dv); stop(); hold = setTimeout(() => { rep = setInterval(() => dodgeBy(+b.dataset.dv), 50); }, 300); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => b.addEventListener(ev, stop));
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dodgeBy(+b.dataset.dv); } });
});
// Move ⇄ ⛏️ Dig. Switching mid-drive redraws the ground: the drive so far becomes a dig, or not.
function showDig() {
  const b = $('digBtn'); b.setAttribute('aria-pressed', String(digOn));
  b.querySelector('.mi').textContent = digOn ? '⛏️' : '🚜'; b.querySelector('.ml').textContent = digOn ? 'Dig' : 'Move';
  $('moveRange').setAttribute('aria-label', digOn ? 'Where your tank is: drag to dig through the hill' : 'Where your tank is: drag to drive');
}
$('digBtn').addEventListener('click', () => {
  digOn = !digOn; showDig(); sfx('tick'); navigator.vibrate?.(15);
  try { localStorage.setItem('duel.dig', digOn ? '1' : ''); } catch {}
  if (G) { sendAim(); refreshTop(); }
  if (digOn) note('⛏️ Dig mode: your tank burrows down into the hill. Get deep enough and the hill covers you: shells hit the roof, blasts do half. Same fuel.');
});
try { digOn = !!localStorage.getItem('duel.dig'); } catch {}
showDig();
document.querySelectorAll('[data-mv]').forEach((b) => {
  let hold = null, rep = null;
  const stop = () => { clearTimeout(hold); clearInterval(rep); };
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); driveBy(+b.dataset.mv); stop(); hold = setTimeout(() => { rep = setInterval(() => driveBy(+b.dataset.mv), 50); }, 300); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => b.addEventListener(ev, stop));
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); driveBy(+b.dataset.mv); } });
});

// − / + buttons: one step per tap, and they keep going while held.
document.querySelectorAll('[data-step]').forEach((b) => {
  let hold = null, rep = null;
  const bump = () => { const id = b.dataset.step, d = +b.dataset.d; if (id === 'drop') return setDrop((dropX ?? W / 2) + d * 4); const a = +$('angle').value, da = G && multi() && a > 90 ? -d : d; setAim(id === 'angle' ? a + da : a, id === 'power' ? +$('power').value + d : +$('power').value); };
  const stop = () => { clearTimeout(hold); clearInterval(rep); hold = rep = null; };
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); bump(); stop(); hold = setTimeout(() => { rep = setInterval(bump, 70); }, 380); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => b.addEventListener(ev, stop));
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bump(); } });
});

// Slingshot aiming (046), like Putt Post: put a finger down anywhere on the battlefield or the
// controls panel and pull back; the shell flies the other way. How far you pull sets the power
// (SLING_FULL px for full). The railgun's pull aims its beam (down too); power doesn't matter to it.
// The pull shows as a rubber band behind your tank. A 🚁 Drone Strike still points at its spot.
let sling = null;
const SLING_FULL = () => Math.min(210, Math.max(130, innerWidth * 0.42));
function slingStart(e) { sling = { x: e.clientX, y: e.clientY }; drag = null; }
function slingMove(e) {
  const hx = sling.x - e.clientX, up = e.clientY - sling.y, len = Math.hypot(hx, up);
  if (len < 10) return;
  const p = myIdx(), t = tankPos(p, top, xs()), rail = armedOf(me.id) === 'railgun', deg = (r) => (r * 180) / Math.PI;
  const lim = (el) => (rail ? Math.max(-40, Math.min(40, el)) + 45 : Math.max(5, Math.min(85, el)));
  let angle;
  if (multi()) { const el = lim(deg(Math.atan2(up, Math.max(Math.abs(hx), 0.01)))); angle = hx >= 0 ? el : 180 - el; }
  else { const h = hx * (p === 0 ? 1 : -1); angle = lim(h <= 0 ? (up < 0 ? -90 : 90) : deg(Math.atan2(up, h))); }
  setAim(angle, rail ? +$('power').value : 20 + Math.min(1, len / SLING_FULL()) * 80);
  const r = cv.getBoundingClientRect(), k = ((W / (cam?.z || 1)) / r.width) * 0.6;
  drag = { x: t.x - hx * k, y: t.y - 14 + up * k };   // the band: from the tank back along the pull
}
// The controls panel's empty space takes the gesture too (buttons and the backpack keep theirs).
const ctl = $('controls');
ctl.addEventListener('pointerdown', (e) => {
  if (!canAim() || droneOn() || e.button > 0 || e.target.closest('button, input, select, a, summary, label, #packMini, [data-loot]')) return;
  e.preventDefault(); try { ctl.setPointerCapture(e.pointerId); } catch {} aimBefore = { angle: +$('angle').value, power: +$('power').value }; slingStart(e);
});
ctl.addEventListener('pointermove', (e) => { if (sling && canAim()) slingMove(e); });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => ctl.addEventListener(ev, () => { sling = null; drag = null; aimBefore = null; }));

// Drag on the battlefield to aim: the direction from your tank sets the angle and the
// distance sets the power. The aim hint follows your finger.
let drag = null;
const canAim = () => G && G.game.status === 'playing' && myIdx() >= 0 && G.game.hp[myIdx()] > 0 && (liveOn || (!busy && !shot && turnId() === me.id));
function aimFromPointer(e) {
  const { x: gx, y: gy } = toWorld(e.clientX, e.clientY);
  const p = myIdx(), t = tankPos(p, top, xs()), rail = armedOf(me.id) === 'railgun';   // the railgun aims -40° to +40°, straight at where you point
  drag = { x: gx, y: gy };
  if (droneOn()) return setDrop(gx);   // 🚁: point at the spot to bomb
  if (multi()) {
    // 3-4 players: point either way; the side you drag to is the side you fire.
    const right = gx >= t.x, dx = Math.abs(gx - t.x), dy = t.y - 14 - gy;
    const e = rail ? Math.max(5, Math.min(85, (Math.atan2(dy, Math.max(1, dx)) * 180) / Math.PI + 45)) : Math.max(5, Math.min(85, (Math.atan2(Math.max(dy, 0), Math.max(1, dx)) * 180) / Math.PI));
    setAim(right ? e : 180 - e, Math.hypot(dx, dy) / 3.4);
    return;
  }
  const dir = p === 0 ? 1 : -1, dx = (gx - t.x) * dir, dy = t.y - 14 - gy;
  const ang = rail ? (Math.atan2(dy, Math.max(1, dx)) * 180) / Math.PI + 45 : dx <= 0 ? 85 : (Math.atan2(dy, dx) * 180) / Math.PI;
  setAim(ang, Math.hypot(dx, dy) / 3.4);
}
// Fingers on the battlefield: one aims (your shot) or pans (zoomed in, not aiming); two pinch to
// zoom and pan together. A second finger undoes what the first one's aim did.
const touches = new Map();
let pinch = null, pan = null, aimBefore = null;
cv.addEventListener('pointerdown', (e) => {
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (camOn() && touches.size === 2) {
    e.preventDefault();
    if (aimBefore) setAim(aimBefore.angle, aimBefore.power);   // that first finger was the start of a pinch, not an aim
    sling = null;
    drag = null; pan = null;
    const [a, b] = [...touches.values()], mid = toWorld((a.x + b.x) / 2, (a.y + b.y) / 2);
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: cam.z, wx: mid.x, wy: mid.y };
    camHeld = Date.now() + 4000;
    return;
  }
  if (touches.size > 1) return;
  if (canAim()) { e.preventDefault(); cv.setPointerCapture?.(e.pointerId); aimBefore = { angle: +$('angle').value, power: +$('power').value }; if (droneOn()) aimFromPointer(e); else slingStart(e); return; }
  if (camOn() && cam.z > 1) { e.preventDefault(); cv.setPointerCapture?.(e.pointerId); pan = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y }; camHeld = Date.now() + 4000; }
});
cv.addEventListener('pointermove', (e) => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && touches.size >= 2) {
    const [a, b] = [...touches.values()], r = cv.getBoundingClientRect();
    const fx = ((a.x + b.x) / 2 - r.left) / r.width, fy = ((a.y + b.y) / 2 - r.top) / r.height;
    zoomAt(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), fx, fy, pinch.wx, pinch.wy);
    camHeld = Date.now() + 4000;
    return;
  }
  if (pan) {
    const r = cv.getBoundingClientRect();
    cam.x = pan.cx - ((e.clientX - pan.sx) / r.width) * (W / cam.z); cam.y = pan.cy - ((e.clientY - pan.sy) / r.height) * (viewH() / cam.z);
    camClamp(); camHeld = Date.now() + 4000;
    return;
  }
  if (sling && canAim()) slingMove(e); else if (drag && canAim() && droneOn()) aimFromPointer(e);
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => cv.addEventListener(ev, (e) => {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch = null;
  if (!touches.size) { pan = null; drag = null; aimBefore = null; sling = null; }
}));
// Desktop: the wheel zooms around the pointer.
cv.addEventListener('wheel', (e) => {
  if (!camOn()) return;
  e.preventDefault();
  const w = toWorld(e.clientX, e.clientY);
  zoomAt(cam.z * Math.exp(-e.deltaY * 0.0015), w.fx, w.fy, w.x, w.y);
  camHeld = Date.now() + 4000;
}, { passive: false });
// The zoom buttons: in, out, your tank, the whole field.
function showCam() {
  const box = $('camBar'); if (!box) return;
  box.hidden = !camOn();
  box.querySelector('[data-cam="out"]').disabled = cam.z <= 1.001;
  box.querySelector('[data-cam="fit"]').disabled = cam.z <= 1.001;
  box.querySelector('[data-cam="in"]').disabled = cam.z >= 2.999;
  box.querySelector('[data-cam="me"]').hidden = !G || myIdx() < 0 || G.game.hp[myIdx()] <= 0;
}
document.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.cam; camHeld = Date.now() + 4000;
  if (k === 'fit') return camReset();
  if (k === 'me') { const t = tankPos(myIdx(), top, xs()); if (t) camLook(t.x, t.y - 40, Math.max(cam.z, 2)); return; }
  // From the whole field, zoom in on the hills in the middle of the view rather than the sky.
  const gy = cam.z <= 1.001 && top ? top[Math.max(0, Math.min(W - 1, Math.round(cam.x)))] - 60 : cam.y;
  if (k === 'in') camLook(cam.x, gy, cam.z * 1.5); else zoomAt(cam.z / 1.5, 0.5, 0.5, cam.x, cam.y);
}));
$('fire').onclick = () => { if (liveOn) fireLive(); else if (!busy && G && turnId() === me.id) fire(); };
// The toolbar's 🤖 switch.
async function toggleBotLive() {
  const g = G?.game; if (!g) return;
  const { error } = await sb.rpc('set_live_bot', { p_kind: 'duel', p_game: g.id, p_on: !g.live_bot });
  if (error) return friendly(error);
  await load(g.id); render(); here();
}
async function deleteGame() {
  const { error } = await sb.rpc('duel_delete', { p_game: G.game.id });
  if (error) return friendly(error);
  location.href = './';
}

(async () => {
  if (!(await signedIn())) return;
  condenseTop($('title'), [document.querySelector('header')]);   // phones: ← · title · toolbar
  const id = (location.hash.match(/game=([0-9a-f-]{36})/) || [])[1];
  if (!id || !(await load(id))) { $('title').textContent = 'Duel not found'; return; }
  if (multi()) { $('angle').max = 175; if (+$('angle').value === 45 && baseXs()[myIdx()] > W / 2) $('angle').value = 135; }   // 3-4 players aim either way
  try { const a = JSON.parse(localStorage.getItem(`duel.aim.${id}`) || 'null'); if (a) { $('angle').value = a.angle; $('power').value = a.power; } } catch {}
  showAim();
  $('shotsFold').open = !isPhone();
  noteMirror($('err'), 'error');
  pack = await backpack();
  announceChaos({ gameId: id });
  requestAnimationFrame(loop);
  let pending = false;
  const refresh = () => { if (pending) return; pending = true; setTimeout(async () => { pending = false; if (busy) { setTimeout(refresh, 1000); return; } await load(id); pack = await backpack(); announceChaos({ gameId: id }); decide(); }, 200); };
  live = liveGame(`duel-${id}`, [{ event: '*', table: 'duel_games', filter: `id=eq.${id}` }], refresh, async () => {
    if (busy || !G) return;
    if (await chaosClock()) return refresh();   // anything overdue on a stalled turn lands now
    const { data } = await sb.from('duel_games').select('updated_at').eq('id', id).maybeSingle();
    if (data && data.updated_at !== G.game.updated_at) refresh();
  }, {
    dodge: (a) => { const p = fromOf(a); if (G && p >= 0 && p !== myIdx() && a.move === G.game.move) dodges[p] = a; },
    here: () => here(),
    aim: (a) => {
      const p = fromOf(a); if (!G || p < 0 || p === myIdx()) return;
      if (liveOn) { aims[p] = a; if (a.x != null) liveX[p] = a.x; if (a.dig) refreshTop(); return; }
      if (a.move === G.game.move && p === G.game.turn && turnId() !== me.id) { aims[p] = a; $('status').textContent = 'Aiming…'; if (a.dig) refreshTop(); }
    },
    shot: (s) => watchLiveShot(s, refresh),
  });
  navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.url) location.href = e.data.url; });
  const upNext = () => nextUpChip(me.id, id, (p) => (bots.has(p) ? '🤖 ' : '') + (names[p] ?? G?.names?.[p] ?? 'someone'));
  upNext(); setInterval(() => { if (!document.hidden) upNext(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) upNext(); });
  decide();
  // Live battle: check in every 3 s while the page is showing; leave when it's hidden or closed.
  here(); setInterval(() => { if (!document.hidden) here(); }, 3000);
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) { setLive(false); await here(false); live?.send('here', {}); } else here();
  });
  addEventListener('pagehide', () => { here(false); live?.send('here', {}); });
})();
