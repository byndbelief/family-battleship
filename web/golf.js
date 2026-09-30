// Putt Post, live: turns and scores are saved on the server; putts replay for everyone.
import { sb, me, bots, signedIn, esc, nm, friendly, notify, ITEMS, compactPack, backpack, useLoot, announceChaos, backpackBarHTML, sfx, liveGame, nudge, nextUpChip, names, gauntletBar, isPhone, noteMirror, note, onHold, onTaps, rumour, shotClock, stopShotClock, chaosClock, dramaOn, face, livePresence, avatarOf, splash, jumpToNext, setGameTools, condenseTop, golfTheme, setGolfThemePref, liveCountdown, srv } from './common.js';
import {
  BW, BH, LW, LH, COURSE, POWER, LONG, parOf, maxStrokes, setCourse, HOLES, R, CUP_R, tick, q20, q100, ATTACKS, holeWithAttack, holeWithTwists, twistsFor, CHIP_AIR, drawHole,
  inPoly, inRect, segDist, reduceMotion, setGolfTheme, holeName, flowTo,
} from './golf-engine.js';

const $ = (id) => document.getElementById(id);
// The course's look (drawing only, so everyone can pick their own): mini golf or a natural course.
function showTheme() {
  const nat = golfTheme() === 'natural'; setGolfTheme(golfTheme());
  const b = $('themeBtn'); b.innerHTML = nat ? '🌳<span class="tlabel"> Natural</span>' : '⛳<span class="tlabel"> Mini golf</span>'; b.setAttribute('aria-pressed', String(nat));
  b.title = nat ? 'Natural golf course: tap for mini golf' : 'Mini golf: tap for a natural golf course';
  document.body.classList.toggle('natural', nat);
}
$('themeBtn').onclick = () => { setGolfThemePref(golfTheme() === 'natural' ? 'classic' : 'natural'); showTheme(); sfx('click'); };
showTheme();
const cv = $('course'), ctx = cv.getContext('2d');

// ---------------------------------------------------------------- state
let G = null;              // { game, turns, players, acc, secrets, best }
let scene = {}, mode = 'idle', strokes = 0, current = [], skipReplay = false;
let curAttack = 0, curAttacker = null;   // sneak attack in effect for the hole being played
// Live race (040): an attack can land mid-hole; attackFrom is the putt it starts on (0: the whole hole).
let attackFrom = 0, liveAtkCheck = null;
let cheatsUsed = 0, lastStroke = null, drag = null;
let flowing = false;       // a replay, judging, robot or turn flow is running
let afterPanel = false;    // the "plant an attack" panel after my hole is open
let pack = [], magnetOn = false;   // backpack items; Magnet Cup active this hole
// Live race: while everyone has the game open, all play the current hole at once (no turn order,
// no cheating), and rivals' balls roll across your screen as ghosts streamed over the live channel.
let liveOn = false, live = null, ghosts = {}, ballSentAt = 0;
let liveGo = 0;   // live: putts wait for the countdown's GO (045)
// Live: the next hole's start, set by the server when the last player finishes the hole before (065),
// in this device's clock. goAt(): when putting (and the robots' holes) may begin.
const holeGo = () => (G?.game.hole_go ? Date.parse(G.game.hole_go) - srv.offset : 0);
const goAt = () => Math.max(liveGo, holeGo());

const n = () => G.game.players.length;
// Live: have I already played the hole everyone is on?
const myHoleDone = () => G.turns.some((x) => x.player === me.id && Math.floor(x.t / n()) === Math.floor(G.game.t / n()));
const stillPlaying = () => G.game.players.filter((p) => !G.turns.some((x) => x.player === p && Math.floor(x.t / n()) === Math.floor(G.game.t / n())));
const curPlayer = () => G.game.players[G.game.t % n()];
const curHole = () => G.game.start + Math.floor(G.game.t / n());
const magnetize = (h, on) => (on ? { ...h, cupR: 13, cupSpeed: 7.5 * POWER } : h);
// A hole as it stands for turn t: its sneak attack (if any) and the chaos twists that came before t (043).
const holeAt = (hi, type, t) => holeWithTwists(G.game.seed, hi, type, G.game.twists, t);
// My turn's slot: the turn number, or live, my slot on the hole everyone's on.
const myT = () => (liveOn ? Math.floor(G.game.t / n()) * n() + G.game.players.indexOf(me.id) : G.game.t);
const H = () => magnetize(holeAt(curHole(), curAttack, myT()), magnetOn && mode !== 'bot');
let chipNext = false;   // a ⛳ Chip Shot is loaded for the next putt (043)
const isBot = (id) => bots.has(id);
const who = (id) => (id === me.id ? 'You' : nm(id));
const seenKey = () => `golf.seen.${G.game.id}`;
const seenT = () => { try { const v = localStorage.getItem(seenKey()); return v === null ? -1 : +v; } catch { return -1; } };
const markSeen = (t) => { try { if (t > seenT()) localStorage.setItem(seenKey(), String(t)); } catch {} };
const WORDS = { '-3': 'albatross', '-2': 'eagle', '-1': 'birdie', 0: 'par', 1: 'bogey', 2: 'double bogey' };
const scoreWord = (s, par) => (s === 1 ? 'hole in one!' : WORDS[s - par] ? `${WORDS[s - par]} (${s})` : `${s} strokes`);
const fmtPar = (v) => (v === 0 ? 'even par' : `${v > 0 ? '+' : ''}${v} to par`);
const CHEAT_NAMES = { 1: '🦶 Foot Wedge', 2: '🔄 Mulligan', 4: '✏️ Pencil Whip' };
// Rookie is easy on purpose; Pro and Ace putt tighter (aim in degrees of wobble, power as a fraction).
const BOT_SKILL = [{ aim: 7, power: 0.18, cheat: 0.3 }, { aim: 1.8, power: 0.05, cheat: 0.22 }, { aim: 0.6, power: 0.018, cheat: 0.15 }];
const botSkill = () => BOT_SKILL[G.game.bot_level ?? 1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- loading
async function load(id) {
  const [g, t, p, a, s] = await Promise.all([
    sb.from('golf_games').select('*').eq('id', id).maybeSingle(),
    sb.from('golf_turns').select('*').eq('game_id', id).order('t'),
    sb.from('golf_players').select('*').eq('game_id', id),
    sb.from('golf_accusations').select('*').eq('game_id', id),
    sb.from('golf_secrets').select('*').eq('game_id', id),
  ]);
  if (!g.data) return false;
  setCourse((g.data.course || 100) / 100);   // 4+ players: a bigger course, zoomed out (036)
  G = { game: g.data, turns: t.data ?? [], players: p.data ?? [], acc: a.data ?? [], secrets: s.data ?? [], best: G?.best };
  if (G.game.gauntlet_id) gauntletBar(G.game.gauntlet_id, G.game.id, me.id, (p) => names[p] ?? 'someone');
  return true;
}
// Backpack sneak attacks (041): item -> attack type.
const ATK_ITEMS = { atk_ice: 1, atk_wind: 2, atk_cup: 3, atk_bumpers: 4, atk_butter: 5 };
const pl = (id) => G.players.find((x) => x.player === id) || { tokens: 0, away: 0, busted: 0, catches: 0 };

// ---------------------------------------------------------------- drawing loop
// Full screen on a landscape phone (047): the course turns sideways (tee on the left, cup on the
// right) so it fills the screen. Only drawing and touches rotate; the physics never knows.
let rot = false;
const landFs = () => !!document.querySelector('#play.fs-on') && innerWidth > innerHeight && innerHeight < 560;
// Phones (and full screen): the course takes the whole screen below the hole's name, any shape; the
// camera frames it (it no longer has to be the hole's own shape). Tablets and desktop: as before.
const fullCourse = () => !!document.querySelector('#play.fs-on') || (touchUI() && innerWidth < 760);
function sizeCanvas() {
  rot = landFs();
  const dpr = Math.min(2, devicePixelRatio || 1), set = (w, h) => { cv.style.width = w + 'px'; cv.style.height = h + 'px'; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); };
  if (rot) return set(Math.max(300, innerWidth - 250), innerHeight - 12);   // sideways, down the left; the hole and backpack on the right
  const wrap = cv.parentElement; wrap.style.margin = '';
  if (fullCourse()) {
    if (!document.querySelector('#play.fs-on')) {   // phones: edge to edge, whatever the page's padding
      const r = wrap.getBoundingClientRect(); wrap.style.margin = `0 ${-(innerWidth - r.right)}px 0 ${-r.left}px`;
    }
    const top = cv.parentElement.getBoundingClientRect().top + (document.querySelector('#play.fs-on') ? 0 : scrollY), below = ($('packMini')?.offsetHeight || 0);
    return set(cv.parentElement.clientWidth, Math.max(300, innerHeight - top - below - 10));
  }
  const desk = matchMedia('(min-width:1000px) and (min-height:560px)').matches;   // desktop: the course beside its controls
  const maxW = desk ? Math.max(320, innerWidth - 540) : Math.min(cv.parentElement.clientWidth, 520);
  const maxH = desk ? Math.max(420, innerHeight - (document.getElementById('gtbar')?.offsetHeight || 0) - 90) : Math.max(360, innerHeight - 230);
  const w = Math.min(maxW, (maxH * LW) / LH);
  set(w, (w * LH) / LW);
}
// Shot clock: 30 seconds for each putt on your turn, against other people (not solo, not the
// robot). The first time it runs out this turn costs a stroke; after that it stops for the turn.
let clockHitT = -1;
function clockCheck() {
  const on = G && !liveOn && (mode === 'aim' || mode === 'wedge') && !locked && curPlayer() === me.id && n() > 1
    && !G.game.players.some(isBot) && clockHitT !== G.game.t;
  if (!on) { if (!(G && locked && mode === 'aim')) stopShotClock(); return; }
  shotClock(`golf.${G.game.id}.${G.game.t}.${strokes}`, 30, async () => {
    clockHitT = G.game.t;
    const { data } = await sb.rpc('shot_clock', { p_kind: 'golf', p_game: G.game.id });
    if (data) note(`⏱️ Too slow! ${data}.`, 'error');
  });
}
// ---------------------------------------------------------------- camera (055)
// A big course is bigger than the screen: the page shows it at a 1-player course's size (ball and
// cup at their normal size) and follows the ball. Each hole opens on the whole layout, the balls
// tiny specks, then zooms down onto the tee: in a live race over the countdown, so it lands on GO.
// 🗺️ steps back to the whole hole. Waiting on someone else, you see all of it.
const cam = { x: 0, y: 0, z: 1, intro: null, over: false, key: '' };
const holeKey = (hole) => `${G.game.id}:${hole}`;
// The canvas is any shape (a phone's whole screen): lw × lh is it in device pixels before the
// sideways turn, kFit the course's pixels a unit with the whole hole in view (zoom 1), kNorm a 1-player
// hole's size on this screen (the ball at its normal size), k = kFit × zoom.
const lw = () => (rot ? cv.height : cv.width), lh = () => (rot ? cv.width : cv.height);
const kFit = () => Math.min(lw() / LW, lh() / LH), kNorm = () => Math.min(lw() / BW, lh() / BH), kNow = () => kFit() * cam.z;
const dprNow = () => cv.width / (cv.getBoundingClientRect().width || cv.width);
const zPlay = () => Math.max(1, kNorm() / kFit());
const viewW = () => lw() / kNow(), viewH = () => lh() / kNow();
function camClamp(x, y, z) {
  const k = kFit() * z, hw = lw() / (2 * k), hh = lh() / (2 * k);
  return [2 * hw >= LW ? LW / 2 : Math.min(LW - hw, Math.max(hw, x)), 2 * hh >= LH ? LH / 2 : Math.min(LH - hh, Math.max(hh, y))];
}
function camIntro(key, force) {
  if (!force && key === cam.key) return;
  cam.key = key;
  if (zPlay() < 1.02) return;
  const left = liveOn ? liveGo - Date.now() : 0, synced = left > 1600;
  cam.intro = { t0: performance.now(), hold: synced ? left - 1500 : 1100, dur: synced ? 1400 : 1600 };
  cam.x = LW / 2; cam.y = LH / 2; cam.z = 1; cam.over = false; cam.uz = null; cam.hold = false; mapBtn();
}
const camFocus = () => (scene.ball && !scene.ball.hidden ? [scene.ball.x, scene.ball.y] : scene.hole.tee);
// 🌀 The fractal cup (059): down in every cup is the next hole in miniature (the last hole's holds the
// first: the round loops), and in its cup the one after that. Holing out dives into it until the
// miniature fills the screen, which is just the next hole's opening view.
const cupArts = new Map();
function drawHoleTo(h, px, inner) {
  const oc = document.createElement('canvas'); oc.width = px; oc.height = Math.round((px * LH) / LW);
  const c = oc.getContext('2d'), k = px / LW; c.setTransform(k, 0, 0, k, 0, 0);
  drawHole(c, h, 0, { cupArt: inner, cupDark: 1 }); return oc;
}
function cupArtFor(hi) {
  const g = G.game, after = (i) => (i + 1 < g.start + g.count ? i + 1 : g.start), px = Math.max(240, Math.round(kFit() * LW));
  const key = `${g.id}:${hi}:${px}:${golfTheme()}:${JSON.stringify(g.twists || {})}`;
  if (!cupArts.has(key)) {
    const n1 = after(hi), n2 = after(n1), at = (i) => holeWithTwists(g.seed, i, 0, g.twists, g.t);
    cupArts.clear(); cupArts.set(key, drawHoleTo(at(n1), px, drawHoleTo(at(n2), Math.round(px / 5))));
  }
  return cupArts.get(key);
}
function startDive(delay = 350) {
  if (reduceMotion || !scene.hole) return;
  const h = scene.hole, dg = Math.hypot(BW, BH), iw = ((h.cupR || CUP_R) * 2 * BW) / dg;
  cam.intro = null;
  cam.dive = { t0: performance.now() + delay, dur: 1700, z0: cam.z, x0: cam.x, y0: cam.y, zEnd: LW / iw, hole: h };
}
const diveDone = () => new Promise((res) => { const chk = () => (!cam.dive || performance.now() > cam.dive.t0 + cam.dive.dur ? res() : setTimeout(chk, 50)); chk(); });
function camStep(now) {
  if (cam.dive) {
    const d = cam.dive, e = Math.min(1, Math.max(0, (now - d.t0) / d.dur));
    if (e >= 1 && (mode !== 'done' || scene.hole !== d.hole)) { cam.dive = null; scene.cupDark = 1; }   // on to whatever's next (back out, or the next hole's opening)
    else {
      const k = e * e * (3 - 2 * e), m = Math.min(1, k * 3);
      cam.z = d.z0 * (d.zEnd / d.z0) ** k;
      cam.x = d.x0 + (d.hole.cup[0] - d.x0) * m; cam.y = d.y0 + (d.hole.cup[1] - d.y0) * m;
      scene.cupDark = 1 - k; if (e > 0) scene.fx = [];
      return;
    }
  }
  const zp = cam.over ? 1 : cam.uz ?? (mode === 'idle' || mode === 'over' ? 1 : zPlay()), [fx, fy] = camFocus();
  if (cam.intro) {
    const e0 = (now - cam.intro.t0 - cam.intro.hold) / cam.intro.dur;
    if (e0 < 1) {
      const e = e0 <= 0 ? 0 : e0 * e0 * (3 - 2 * e0), [tx, ty] = camClamp(fx, fy, zp);
      cam.z = zp ** e;   // geometric, so the zoom feels even all the way down
      [cam.x, cam.y] = camClamp(LW / 2 + (tx - LW / 2) * e, LH / 2 + (ty - LH / 2) * e, cam.z);
      return;
    }
    cam.intro = null;
  }
  if (view) return;   // a finger's on it
  const k = reduceMotion ? 1 : 0.14;
  cam.z += (zp - cam.z) * k; if (Math.abs(zp - cam.z) < 0.003) cam.z = zp;
  const follow = !cam.hold || cam.over || ['rolling', 'replay', 'bot'].includes(mode);   // a view you set holds, but a rolling ball is followed
  const [tx, ty] = follow ? camClamp(fx, fy, cam.z) : [cam.x, cam.y];
  cam.x += (tx - cam.x) * (reduceMotion ? 1 : 0.2); cam.y += (ty - cam.y) * (reduceMotion ? 1 : 0.2);
  [cam.x, cam.y] = camClamp(cam.x, cam.y, cam.z);
}
// Where the cup is when it's off the screen: a flag at the edge, pointing the way.
function cupPointer() {
  const d = dprNow(), k = kNow(), W2 = lw(), H2 = lh(), [cx, cy] = scene.hole.cup, lx = (cx - cam.x) * k + W2 / 2, ly = (cy - cam.y) * k + H2 / 2, m = 24 * d;
  if (lx > 0 && ly > 0 && lx < W2 && ly < H2) return;
  const px = Math.min(W2 - m, Math.max(m, lx)), py = Math.min(H2 - m, Math.max(m, ly)), a = Math.atan2(ly - py, lx - px), r = 13 * d;
  ctx.save(); ctx.translate(px, py);
  ctx.fillStyle = '#0B1A12cc'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  ctx.fillStyle = '#F2C14E'; ctx.beginPath(); ctx.moveTo(Math.cos(a) * (r + 9 * d), Math.sin(a) * (r + 9 * d));
  ctx.lineTo(Math.cos(a + 0.5) * r, Math.sin(a + 0.5) * r); ctx.lineTo(Math.cos(a - 0.5) * r, Math.sin(a - 0.5) * r); ctx.fill();
  if (rot) ctx.rotate(-Math.PI / 2);   // the emoji stays upright on a sideways course
  ctx.font = `${Math.round(15 * d)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⛳', 0, 1);
  ctx.restore();
}
function mapBtn() {
  const b = $('mapBtn'); b.hidden = zPlay() < 1.02 || !G || G.game.status !== 'playing';
  b.classList.toggle('on', cam.over); b.setAttribute('aria-pressed', String(cam.over));
}
$('mapBtn').onclick = () => { cam.over = !cam.over; cam.intro = null; cam.uz = null; cam.hold = false; mapBtn(); sfx('click'); };
function loop(t) {
  clockCheck();
  if (locked && mode !== 'aim') { setLocked(false); showAim(null); }
  if (!ph.hidden && (!locked || mode !== 'aim')) ph.hidden = true;
  syncPutbar();
  scene.fx = (scene.fx || []).filter((f) => { f.x += f.vx; f.y += f.vy; f.vy += f.g || 0; f.life -= 0.02; return f.life > 0; });
  if (scene.hole) {
    if (scene.cupArt === undefined && G) scene.cupArt = cupArtFor(scene.hi ?? curHole());
    camStep(t);
    if (rot) ctx.setTransform(0, 1, -1, 0, cv.width, 0);   // sideways: the canvas's own pixels, turned
    else ctx.setTransform(1, 0, 0, 1, 0, 0);
    const base = ctx.getTransform(), k = kNow();
    ctx.fillStyle = golfTheme() === 'natural' ? '#3F6B2C' : '#1A4F32'; ctx.fillRect(0, 0, lw(), lh());   // past the course's edge
    ctx.transform(k, 0, 0, k, lw() / 2 - k * cam.x, lh() / 2 - k * cam.y);
    drawHole(ctx, scene.hole, t, scene); if (liveOn) drawGhosts();
    ctx.setTransform(base);
    if (cam.z > 1.05 && !cam.dive) cupPointer();
  }
  requestAnimationFrame(loop);
}
// Rivals' balls in a live race: a ball with their face floating over it.
const faceImgs = {};
function drawGhosts() {
  const hole = G?.game && curHole();
  Object.entries(ghosts).forEach(([p, gb]) => {
    if (gb.hole !== hole || gb.holed || Date.now() - gb.at > 60000) return;
    ctx.globalAlpha = 0.85; ctx.fillStyle = '#FFE08A'; ctx.strokeStyle = '#0006'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(gb.x, gb.y, R, 0, 7); ctx.fill(); ctx.stroke();
    const u = G.names?.[p] ?? names[p], av = isBot(p) ? '🤖' : avatarOf(u), fx = gb.x, fy = gb.y - 17;
    ctx.globalAlpha = 1; ctx.fillStyle = '#0008'; ctx.beginPath(); ctx.arc(fx, fy, 10, 0, 7); ctx.fill();
    if (av && av.includes('/')) {
      if (!faceImgs[av]) { faceImgs[av] = new Image(); faceImgs[av].src = av; }
      if (faceImgs[av].complete) { ctx.save(); ctx.beginPath(); ctx.arc(fx, fy, 9, 0, 7); ctx.clip(); ctx.drawImage(faceImgs[av], fx - 9, fy - 9, 18, 18); ctx.restore(); }
    } else { ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(av || String(u || '?')[0].toUpperCase(), fx, fy + 1); }
  });
  ctx.globalAlpha = 1;
}
function burst(x, y, colors, count = 36, g = 0.05) {
  for (let i = 0; i < count; i++) { const a = Math.random() * 6.283, v = Math.random() * 3 + 0.6; scene.fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, g, life: 1, s: Math.random() * 2.5 + 1, c: colors[i % colors.length] }); }
}
function bigText(html, ms) { const el = $('hio'); el.innerHTML = html; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => { el.hidden = true; }, ms); }
function shake() { if (reduceMotion) return; cv.classList.remove('shake'); void cv.offsetWidth; cv.classList.add('shake'); }
function celebrate(s, par) {
  if (s === 1) {
    bigText('<span>HOLE<br>IN ONE!</span>', 2900); shake(); sfx('fanfare', { delay: 0.25 });
    for (let i = 0; i < 9; i++) sfx('pop', { delay: 0.3 + i * 0.26 });
    const cols = ['#F2C14E', '#E4572E', '#7FD3F7', '#fff', '#B6F09C', '#FF8AD8'];
    const vx = () => cam.x + (Math.random() - 0.5) * viewW() * 0.72, vy = () => cam.y + (Math.random() - 0.5) * viewH() * 0.6;
    for (let i = 0; i < 9; i++) setTimeout(() => { const x = vx(), y = vy(); burst(x, y, cols, 70, 0.03);
      for (let k = 0; k < 24; k++) { const a = (k / 24) * 6.283; scene.fx.push({ x, y, vx: Math.cos(a) * 4.2, vy: Math.sin(a) * 4.2, g: 0.02, life: 1.2, s: 2.2, c: cols[k % cols.length] }); } }, i * 260);
    for (let i = 0; i < 120; i++) scene.fx.push({ x: cam.x - viewW() / 2 + Math.random() * viewW(), y: cam.y - viewH() / 2 - 20 - Math.random() * 200, vx: (Math.random() - 0.5) * 1.2, vy: 1 + Math.random() * 2, g: 0.02, life: 2.2, s: 2 + Math.random() * 2, c: cols[i % cols.length] });
  } else if (s < par) {
    sfx('birdie', { delay: 0.2 });
    bigText(`<span class="small-pop">${{ '-1': 'Birdie!', '-2': 'Eagle!', '-3': 'Albatross!' }[s - par] || 'Amazing!'}</span>`, 1700);
  }
}

// Rolls one stroke from scene.clock; resolves with the result and the ball.
function roll(stroke, h, speed = 2) {
  return new Promise((done) => {
    const b = { x: stroke.x, y: stroke.y, vx: stroke.vx, vy: stroke.vy, ticks: 0, clock: scene.clock || 0, air: stroke.chip ? CHIP_AIR : 0 };
    scene.ball = b; scene.trail = []; scene.bumpLit = scene.bumpLit || [];
    const quiet = skipReplay && mode === 'replay';
    if (!quiet) sfx('putt', { power: Math.hypot(b.vx, b.vy) / 8 });
    let lastClack = 0;
    const step = () => {
      // Will it drop? Half speed while the ball creeps up on the cup.
      const nearCup = !quiet && !reduceMotion && dramaOn() && Math.hypot(b.x - h.cup[0], b.y - h.cup[1]) < 50 && Math.hypot(b.vx, b.vy) < 3;
      const per = skipReplay && mode === 'replay' ? 400 : nearCup ? 1 : speed;
      for (let i = 0; i < per; i++) {
        const ev = tick(b, h);
        if (!quiet && ev === 'wall' && performance.now() - lastClack > 70) { lastClack = performance.now(); sfx('clack'); }
        if (!quiet && ev === 'bump') sfx('boing');
        if (!quiet && ev === 'gopher') { sfx('pop'); sfx('boing', { delay: 0.12 }); }
        if (ev !== 'cup' && Math.hypot(b.x - h.cup[0], b.y - h.cup[1]) < (h.cupR || CUP_R)) b.lip = true;   // rolled over the hole and kept going
        if (ev === 'bump') h.bumpers.forEach(([x, y, r], j) => { const dx = b.x - x, dy = b.y - y; if (dx * dx + dy * dy < (r + R + 2) ** 2) scene.bumpLit[j] = performance.now() + 180; });
        if (ev === 'cup' || ev === 'water' || ev === 'stop') {
          scene.trail = []; scene.clock = b.clock;
          if (liveOn && mode === 'rolling') live?.send('ball', { p: me.id, hole: curHole(), x: Math.round(b.x), y: Math.round(b.y), holed: ev === 'cup' });
          return done({ ev, b });
        }
      }
      scene.trail.push({ x: b.x, y: b.y }); if (scene.trail.length > 14) scene.trail.shift();
      if (liveOn && mode === 'rolling' && performance.now() - ballSentAt > 90) { ballSentAt = performance.now(); live?.send('ball', { p: me.id, hole: curHole(), x: Math.round(b.x), y: Math.round(b.y) }); }
      setTimeout(() => requestAnimationFrame(step), 0);
    };
    requestAnimationFrame(step);
  });
}
function afterStroke(ev, b, h, sx, sy) {
  if (ev === 'cup') { if (!(skipReplay && mode === 'replay')) { sfx('cup'); sfx('cheer', { delay: 0.2 }); } b.hidden = true; scene.flagOut = true; burst(h.cup[0], h.cup[1], ['#F2C14E', '#fff', '#E4572E', '#7FD3F7'], 60, 0.04); return { holed: true, penalty: 0 }; }
  if (ev === 'water') { if (!(skipReplay && mode === 'replay')) sfx('plunk'); burst(b.x, b.y, ['#BFE9FF', '#fff', '#3FA7E0'], 30, 0.08); b.x = sx; b.y = sy; b.vx = b.vy = 0; return { holed: false, penalty: 1 }; }
  if (!(skipReplay && mode === 'replay') && (b.lip || Math.hypot(b.x - h.cup[0], b.y - h.cup[1]) < (h.cupR || CUP_R) * 2.2)) {
    bigText(`<span class="small-pop">${b.lip ? 'Lipped out!' : 'Ooooh!'}</span>`, 1400); sfx('gasp');
  }
  b.x = q20(b.x); b.y = q20(b.y); b.vx = b.vy = 0; return { holed: false, penalty: 0 };
}
const toStroke = ([x, y, vx, vy, chip]) => ({ x, y, vx, vy, chip: chip === 1 });
const fromStroke = (s) => (s.chip ? [s.x, s.y, s.vx, s.vy, 1] : [s.x, s.y, s.vx, s.vy]);   // a chip is marked by a 5th number

// ---------------------------------------------------------------- header, scorecard
function setHud(hole, player, s, replay) {
  $('holeNo').textContent = `Hole ${hole + 1} of ${G.game.start + G.game.count} · Par ${parOf(hole)}`;
  $('holeName').textContent = holeName(hole);
  $('whoPill').innerHTML = `${replay ? '▶' : '⛳'} ${face(player)}${who(player)}`;
  $('strokes').textContent = s;
}
function cellScore(p, hole) {
  const tu = G.turns.find((x) => x.player === p && x.hole === hole);
  if (!tu) return null;
  return tu.skipped ? 'skip' : tu.written + tu.fine;
}
// The strokes on a card that weren't putts (055): splashes (+1 each), a false accusation or a slow
// shot clock (added when the hole was written down) and a busted cheat's fine.
function cellPen(p, hole) {
  const tu = G.turns.find((x) => x.player === p && x.hole === hole);
  if (!tu || tu.skipped || tu.actual == null) return 0;
  return Math.max(0, tu.actual - (tu.strokes?.length ?? tu.actual)) + Math.max(0, tu.written - tu.actual) + (tu.fine || 0);
}
function standings() {
  return G.game.players.map((p) => {
    let s = 0, par = 0, played = 0;
    for (let i = G.game.start; i < G.game.start + G.game.count; i++) { const v = cellScore(p, i); if (typeof v === 'number') { s += v; par += parOf(i); played++; } }
    return { p, strokes: s, toPar: s - par, played };
  });
}
function renderCard() {
  const g = G.game, over = g.status === 'over', cur = over ? null : { p: curPlayer(), h: curHole() };
  const st = standings(), lead = Math.min(...st.map((s) => (s.played ? s.toPar : Infinity)));
  const idx = []; for (let i = g.start; i < g.start + g.count; i++) idx.push(i);
  let h = `<table class="score"><thead><tr><th>Player</th>${idx.map((i) => `<th>${i + 1}</th>`).join('')}<th>Total</th><th>±</th></tr></thead><tbody>`;
  h += `<tr class="par"><td>Par</td>${idx.map((i) => `<td>${parOf(i)}</td>`).join('')}<td>${idx.reduce((a, i) => a + parOf(i), 0)}</td><td></td></tr>`;
  g.players.forEach((p, k) => {
    const sb2 = pl(p), badges = sb2.busted ? ` <span class="badge" title="Busted cheating">${'🚨'.repeat(Math.min(3, sb2.busted))}</span>` : '';
    h += `<tr class="${st[k].played && st[k].toPar === lead ? 'lead' : ''}"><td>${face(p)}${who(p)}${badges}</td>`;
    idx.forEach((i) => {
      const v = cellScore(p, i), cls = [];
      if (cur && (liveOn ? cur.h === i && cellScore(p, i) == null : cur.p === p && cur.h === i)) cls.push('now');
      if (v === 'skip') cls.push('skip'); else if (v) cls.push(v < parOf(i) ? 'under' : v > parOf(i) ? 'over' : '');
      const pen = typeof v === 'number' ? cellPen(p, i) : 0;
      // your hole in progress: the count so far, penalties included
      const going = v == null && p === me.id && cls.includes('now') && ['aim', 'rolling', 'wedge', 'reveal'].includes(mode) && strokes > 0;
      if (going) cls.push('going');
      h += `<td class="${cls.join(' ')}" ${pen ? `title="${v - pen} putts + ${pen} penalty"` : going ? 'title="So far this hole"' : ''}>${v === 'skip' ? '–' : going ? strokes : v ?? ''}${pen ? `<small class="pen">${v - pen}+${pen}</small>` : ''}</td>`;
    });
    h += `<td class="tot">${st[k].strokes || ''}</td><td>${st[k].played ? (st[k].toPar > 0 ? '+' : '') + st[k].toPar : ''}</td></tr>`;
  });
  $('scorecard').innerHTML = h + '</tbody></table>';
  mapBtn();
  setGameTools({ fs: '#play', canDelete: g.created_by === me.id, onDelete: deleteGame, chaos: { kind: 'golf', id: g.id },
    bot: g.status === 'playing' && n() > 1 && g.players.some(isBot) ? { on: !!g.live_bot, label: 'Live race vs robot', onToggle: toggleBotLive } : null });
  // Live race vs robot: a switch whenever the robot is playing.
  // Skip ahead, only while it's your turn and nothing is rolling.
  const canJump = !over && !liveOn && curPlayer() === me.id && mode === 'aim' && curHole() < g.start + g.count - 1;
  $('jumpRow').hidden = !canJump;
  if (canJump) { let o = ''; for (let i = curHole() + 1; i < g.start + g.count; i++) o += `<option value="${i}">Hole ${i + 1}: ${esc(holeName(i))}</option>`; $('jumpTo').innerHTML = o; }
}

// ---------------------------------------------------------------- what happens next
async function decide() {
  if (flowing) return;
  const g = G.game;
  renderCard();
  const prev = G.turns.find((x) => x.t === g.t - 1);
  if (g.status === 'over') {
    if (G.turns.length) markSeen(Math.max(...G.turns.map((x) => x.t)));   // no replay of the last hole (066): straight to the result
    return showFinal();
  }
  // Live race: no replays, no turn order. Play the hole if you haven't, else watch the others.
  if (liveOn && n() > 1) {
    if (G.turns.length) markSeen(Math.max(...G.turns.map((x) => x.t)));
    if (!myHoleDone()) return myTurnLive();
    return waitingLive();
  }
  // No replay of the last player's hole (it was there for calling cheater, which is gone): the
  // scorecard has their score, and your turn starts at once.
  if (prev && prev.t > seenT()) markSeen(prev.t);
  const cur = curPlayer();
  if (cur === me.id) return myTurn();
  if (isBot(cur)) {
    const stale = Date.now() - new Date(g.updated_at).getTime() > 20000;
    if (prev?.player === me.id || (prev && isBot(prev.player) && g.players.find((q) => !isBot(q)) === me.id) || stale || !prev) {   // robot after robot: the first person drives
      if (afterPanel) return;   // they click "Let it play" when they are ready
      return robotTurn();
    }
  }
  waiting(cur);
}
function waiting(cur) {
  mode = 'idle';
  scene = { hole: holeAt(curHole(), 0, G.game.t), fx: [], clock: 0 };
  setHud(curHole(), cur, 0, false);
  $('tip').textContent = `Waiting for ${who(cur).replace(/<[^>]+>/g, '')} to play hole ${curHole() + 1}. This page updates when they do.`;
  $('cheats').hidden = true; $('pack').innerHTML = ''; $('packMini').innerHTML = '';
  renderCard();
}

function waitingLive() {
  mode = 'idle';
  scene = { hole: holeAt(curHole(), 0, G.game.t), fx: [], clock: 0 };
  setHud(curHole(), me.id, 0, false);
  const left = stillPlaying().filter((p) => p !== me.id).map((p) => who(p).replace(/<[^>]+>/g, ''));
  $('tip').textContent = `⚔️ Live race: waiting for ${left.join(' & ') || 'the others'} to finish hole ${curHole() + 1}.`;
  $('cheats').hidden = true; $('pack').innerHTML = ''; $('packMini').innerHTML = '';
  renderCard();
}
async function myTurnLive() {
  flowing = true;
  const { data: atk } = await sb.rpc('golf_my_attack', { p_game: G.game.id });
  curAttack = atk?.type || 0; curAttacker = atk?.attacker || null; attackFrom = 0;
  // Everyone tees off together (065): the server set this hole's start when the last player finished
  // the one before; count down to it (live_go answers with it), so nobody gets a head start.
  if (holeGo() > Date.now() + 400 && n() > 1) {
    liveGo = holeGo();
    liveCountdown('golf', G.game.id, [`⛳ HOLE ${curHole() + 1}`, 'Everyone off together']).then((t) => { liveGo = t; });
  }
  flowing = false;
  startTurn();
  if (!curAttack) $('tip').textContent = `⚔️ Live race! Everyone's on hole ${curHole() + 1} at once. Drag back and let go.`;
}
// Live: has someone just hit me? Asked whenever the game changes (planting touches it). Lands on
// my next putt: now if I'm aiming, or once the ball in play stops.
async function checkLiveAttack() {
  if (!liveOn || curAttack || liveAtkCheck || !['aim', 'rolling'].includes(mode) || myHoleDone()) return;
  liveAtkCheck = sb.rpc('golf_my_attack', { p_game: G.game.id });
  const { data: atk } = await liveAtkCheck; liveAtkCheck = null;
  if (!atk?.type || curAttack || !liveOn || !['aim', 'rolling'].includes(mode)) return;
  curAttack = atk.type; curAttacker = atk.attacker || null; attackFrom = current.length;
  if (mode === 'aim') landLiveAttack();
}
function landLiveAttack() {
  const a = ATTACKS[curAttack];
  scene.hole = H(); shake(); sfx('buzz');
  bigText(`<span class="small-pop">${a.icon} ${a.name}!</span>`, 1800);
  $('tip').textContent = `${a.icon} Sneak attack from ${curAttacker ? who(curAttacker).replace(/<[^>]+>/g, '') : 'chaos'}: ${a.desc}`;
}
function setLive(v) {
  if (v === liveOn) return;
  liveOn = v; ghosts = {};
  if (G.game.status !== 'playing') return;
  if (v) {
    stopShotClock();
    liveGo = Date.now() + 3000;
    liveCountdown('golf', G.game.id, ['⛳ LIVE RACE', 'Same hole, same time'], { solo: G.game.players.filter((p) => !isBot(p)).length < 2 }).then((t) => { liveGo = t; });
    cam.key = '';   // the whole hole, then down onto the tee as the countdown runs
    if (mode === 'aim') camIntro(holeKey(curHole()), true);
    if (mode === 'idle' && !flowing) decide();
    else if (mode === 'aim') $('tip').textContent = `⚔️ Live race! Everyone's on hole ${curHole() + 1} at once. Drag back and let go.`;
    if (mode === 'reveal' && curAttack) { closeModal(); mode = 'aim'; attackFrom = 0; landLiveAttack(); renderCheats(); }   // its box would block the race
  } else {
    note('Live race over: back to taking turns.');
    // Mid-hole when it isn't your turn in order: that hole waits for your turn.
    if (['aim', 'rolling', 'wedge', 'reveal'].includes(mode) && curPlayer() !== me.id) { closeModal(); setLocked(false); mode = 'idle'; decide(); }
    else if (mode === 'idle' && !flowing) decide();
    else if (mode === 'aim') $('tip').textContent = 'Your turn. Drag back and let go.';
  }
}

// Plays back a saved turn.
async function replayTurn(tu) {
  flowing = true;
  // Hit mid-hole in a live race (040): the plain hole until the attack's putt.
  const from = tu.attack ? tu.attack_from || 0 : 0, hA = magnetize(holeAt(tu.hole, tu.attack, tu.t), tu.boost === 1);
  const h0 = from ? magnetize(holeAt(tu.hole, 0, tu.t), tu.boost === 1) : hA;
  let h = h0;
  mode = 'replay'; skipReplay = false; scene = { hole: h, hi: tu.hole, fx: [], clock: 0, ball: { x: h.tee[0], y: h.tee[1] } };
  camIntro(holeKey(tu.hole));
  setHud(tu.hole, tu.player, 0, true);
  const atk = (tu.attack ? `, while hit by ${ATTACKS[tu.attack].name}${from ? ` from putt ${from + 1}` : ''}` : '') + (tu.boost ? ' (with a 🧲 Magnet Cup)' : '');
  $('tip').textContent = `Watching ${who(tu.player).replace(/<[^>]+>/g, '')} on hole ${tu.hole + 1}: ${tu.written} on the card${atk}.`;
  $('skip').hidden = false;
  let count = 0;
  for (const [k, raw] of tu.strokes.entries()) {
    const s = toStroke(raw);
    if (k === from && h !== hA) { h = hA; scene.hole = h; if (!skipReplay) { shake(); bigText(`<span class="small-pop">${ATTACKS[tu.attack].icon} ${ATTACKS[tu.attack].name}!</span>`, 1400); await sleep(600); } }
    scene.ball = { x: s.x, y: s.y, clock: scene.clock }; scene.flagOut = false;
    if (!skipReplay) await sleep(350);
    const { ev, b } = await roll(s, h);
    const r = afterStroke(ev, b, h, s.x, s.y); count += 1 + r.penalty; $('strokes').textContent = count;
    if (r.holed && !skipReplay) celebrate(count, parOf(tu.hole));
    if (!skipReplay) await sleep(r.holed && count === 1 ? 2600 : 500);
  }
  $('skip').hidden = true;
  if (!skipReplay) await sleep(700);
  flowing = false;
}
$('skip').onclick = () => { skipReplay = true; $('skip').hidden = true; };

// ---------------------------------------------------------------- my turn
async function myTurn() {
  flowing = true;
  const { data: atk } = await sb.rpc('golf_my_attack', { p_game: G.game.id });
  curAttack = atk?.type || 0; curAttacker = atk?.attacker || null;
  flowing = false;
  startTurn();
}
function modal(html) { $('gate').hidden = false; $('gateCard').innerHTML = html; }
function closeModal() { $('gate').hidden = true; }
function startTurn() {
  magnetOn = false;
  const h = H();
  cheatsUsed = 0; lastStroke = null; strokes = 0; current = [];
  mode = 'aim'; scene = { hole: h, fx: [], clock: 0, ball: { x: h.tee[0], y: h.tee[1] } };
  camIntro(holeKey(curHole()));
  if (n() > 1 && !liveOn) rumour(GOLF_RUMOURS);
  setHud(curHole(), me.id, 0, false);
  chipNext = false;
  const tw = twistsFor(G.game.twists, curHole(), myT());
  $('tip').textContent = 'Drag back from anywhere on the course, then let go to putt.' + (h.extra ? ' This hole has random obstacles.' : '')
    + (tw.some((x) => x.k === 'cup') ? ' 🚩 Chaos moved the cup!' : '') + (tw.some((x) => x.k === 'gopher') ? ' 🐹 Gophers dug up the fairway: in one hole, out the other.' : '')
    + (tw.some((x) => x.k === 'fog') ? ' 🌫️ Fog rolled in: you only see round your ball.' : '') + (tw.some((x) => x.k === 'flood') ? ' 🌊 A flood left a new pond.' : '')
    + (tw.some((x) => x.k === 'windmill') ? ' 🌀 A windmill sprang up.' : '') + (tw.some((x) => x.k === 'mud') ? ' 🟤 Watch the mud: it swallows speed.' : '')
    + (tw.some((x) => x.k === 'gust') ? ' 🍃 A gust is blowing across the hole.' : '');
  $('send').hidden = true;
  renderCard();
  if (curAttack && liveOn) { attackFrom = 0; landLiveAttack(); }   // live: no box to tap while everyone else races
  else if (curAttack) {
    const a = ATTACKS[curAttack];
    mode = 'reveal';
    modal(`<div style="font-size:54px;line-height:1">${a.icon}</div><h2 style="color:#FF9A7A">Sneak attack!</h2>
      <p><strong>${curAttacker ? nm(curAttacker) : '🌀 Chaos'}</strong> hit you with <strong>${a.name}</strong>.</p><p class="muted small">${a.desc}</p><button class="go" id="bring">Bring it on</button>`);
    shake();
    $('bring').onclick = () => { closeModal(); mode = 'aim'; $('tip').textContent = `${a.icon} ${a.name} is on. Drag back and let go.`; renderCheats(); renderCard(); };
  }
  renderCheats();
}
// On touch screens letting go only sets up the putt: nudge it, then tap Putt! (or ✕).
// With a mouse, letting go putts right away, as before.
let locked = false;
function showAim(a) {
  const m = $('pmeter');
  if (!a) { m.hidden = true; return; }
  phRead();
  m.hidden = false; $('pfill').style.width = Math.round(a.p * 100) + '%'; $('ptext').textContent = `Power ${Math.round(a.p * 100)}%`;
}
function setLocked(on) { locked = on; syncPutbar(); }
// Touch screens: the Putt! bar is always up during a game. Until you've dragged back it waits
// (and says whose turn it is); after, ↺ ↻ − + ✕ and Putt! come alive. Mouse: only as before.
const touchUI = () => isPhone() || matchMedia('(pointer: coarse)').matches;
let putbarKey = '';
function syncPutbar() {
  if (!G) return;
  const playing = G.game.status === 'playing' && !['over', 'done'].includes(mode), show = !touchUI() && playing && locked;   // touch: the pop-up Putt instead
  const ready = locked && mode === 'aim';
  const label = ready ? 'Putt!' : mode === 'aim' ? '👆 Drag back on the course to aim' : mode === 'rolling' ? 'Rolling…' : mode === 'replay' ? 'Watching…'
    : mode === 'bot' ? '🤖 Robot putting…' : liveOn ? 'Waiting…' : `${who(curPlayer()).replace(/<[^>]+>/g, '')}${curPlayer() === me.id ? 'r turn' : "'s turn"}`;
  const key = `${show}|${ready}|${label}`;
  if (key === putbarKey) return;
  putbarKey = key;
  const bar = $('putbar'); bar.hidden = !show; bar.classList.toggle('waiting', !ready);
  bar.querySelectorAll('button').forEach((b) => { b.disabled = !ready; });
  $('puttGo').textContent = label;
}
function nudgeAim(turn, pow) {
  const a = scene.aim; if (!a || mode !== 'aim') return;
  if (turn) { const t = (turn * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t); [a.dx, a.dy] = [a.dx * c - a.dy * s, a.dx * s + a.dy * c]; }
  if (pow) a.p = Math.max(0.04, Math.min(1, Math.round((a.p + pow * 0.01) * 100) / 100));
  showAim(a);
}
document.querySelectorAll('#putbar [data-turn], #putbar [data-pow], #puttHere [data-turn], #puttHere [data-pow]').forEach((b) => {
  let hold = null, rep = null;
  const step = () => nudgeAim(+(b.dataset.turn || 0), +(b.dataset.pow || 0));
  const stop = () => { clearTimeout(hold); clearInterval(rep); };
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); step(); stop(); hold = setTimeout(() => { rep = setInterval(step, 60); }, 350); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => b.addEventListener(ev, stop));
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); step(); } });
});
// ---------------------------------------------------------------- the slingshot Putt (touch)
const ph = $('puttHere');
function phShow(e) {
  const r = cv.parentElement.getBoundingClientRect();
  const x = Math.max(82, Math.min(r.width - 82, e.clientX - r.left)), y = Math.max(72, Math.min(r.height - 72, e.clientY - r.top));
  ph.style.left = `${x}px`; ph.style.top = `${y}px`;
  ph.hidden = false; ph.classList.remove('pop'); void ph.offsetWidth; ph.classList.add('pop'); phRead();
}
const phRead = () => { if (!ph.hidden && scene.aim) $('phRead').textContent = `⚡ ${Math.round(scene.aim.p * 100)}%`; };
$('phGo').onclick = () => { ph.hidden = true; $('puttGo').onclick(); };
$('phX').onclick = () => { ph.hidden = true; $('puttX').onclick(); };
$('puttX').onclick = () => { setLocked(false); scene.aim = null; showAim(null); $('tip').textContent = 'Putt cancelled. Drag back from anywhere to aim again.'; };
$('puttGo').onclick = () => { const a = scene.aim; setLocked(false); scene.aim = null; showAim(null); if (a && mode === 'aim') putt(a); };

// A point on screen in the canvas's own units (before the camera), and the course point under it.
function toL(cx, cy) {
  const r = cv.getBoundingClientRect(), u = (cx - r.left) / r.width, v = (cy - r.top) / r.height;
  return rot ? { x: v * lw(), y: lh() - u * lh() } : { x: u * lw(), y: v * lh() };
}
const worldOf = (L) => ({ x: (L.x - lw() / 2) / kNow() + cam.x, y: (L.y - lh() / 2) / kNow() + cam.y });   // through the camera (055)
const toLogical = (e) => worldOf(toL(e.clientX, e.clientY));
// ---------------------------------------------------------------- zoom and pan (059)
// Pinch to zoom, two fingers to pan; one finger pans too whenever you're not aiming (waiting, watching
// a putt or a replay). Mouse: the wheel zooms round the pointer, right-drag pans (left-drag too when
// not aiming). Your view holds until you putt; then the camera follows the ball at your zoom.
// 🗺️ and a new hole go back to the usual camera.
const touches = new Map(); let view = null;
const zMax = () => Math.max(3, zPlay() * 2.5);
function viewAt(z, w, L) {   // zoom z, with course point w under canvas point L
  z = Math.min(zMax(), Math.max(1, z));
  cam.z = z; [cam.x, cam.y] = camClamp(w.x - (L.x - lw() / 2) / (kFit() * z), w.y - (L.y - lh() / 2) / (kFit() * z), z);
  cam.uz = z; cam.hold = true; cam.intro = null; cam.dive = null;
  if (cam.over) { cam.over = false; mapBtn(); }
}
function startView() {
  const pts = [...touches.values()], mid = pts.reduce((a, q) => ({ x: a.x + q.x / pts.length, y: a.y + q.y / pts.length }), { x: 0, y: 0 });
  view = { w: worldOf(toL(mid.x, mid.y)), z0: cam.z, d0: pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0 };
}
cv.addEventListener('pointerdown', (e) => {
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const pan = touches.size >= 2 || (e.pointerType === 'mouse' && e.button === 2) || (mode !== 'aim' && mode !== 'wedge');
  if (!pan) return;   // one finger while aiming: that's a putt (below)
  e.stopImmediatePropagation(); cv.setPointerCapture?.(e.pointerId);
  drag = null; scene.aim = null; showAim(null); clearTimeout(wedgeHold); if (locked) setLocked(false);
  startView();
}, true);
cv.addEventListener('pointermove', (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!view) return;
  e.stopImmediatePropagation();
  const pts = [...touches.values()], mid = pts.reduce((a, q) => ({ x: a.x + q.x / pts.length, y: a.y + q.y / pts.length }), { x: 0, y: 0 });
  const z = view.d0 && pts.length > 1 ? (view.z0 * Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)) / view.d0 : cam.z;
  viewAt(z, view.w, toL(mid.x, mid.y));
}, true);
const lift = (e) => { touches.delete(e.pointerId); if (!view) return; e.stopImmediatePropagation(); if (touches.size) startView(); else view = null; };
cv.addEventListener('pointerup', lift, true); cv.addEventListener('pointercancel', lift, true);
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const L = toL(e.clientX, e.clientY);
  viewAt(cam.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), worldOf(L), L);   // ctrl: a trackpad pinch
}, { passive: false });
cv.addEventListener('pointerdown', (e) => {
  if (mode === 'wedge') return wedgeTo(toLogical(e));
  if (mode !== 'aim') return;
  if (cam.intro) { cam.intro = null; cam.z = cam.over ? 1 : zPlay(); [cam.x, cam.y] = camClamp(...camFocus(), cam.z); }   // straight to the tee, before the aim is read
  drag = { ...toLogical(e), cx: e.clientX, cy: e.clientY, mouse: e.pointerType === 'mouse' }; cv.setPointerCapture(e.pointerId); setLocked(false);
  // Holding still on your own ball is the secret foot wedge.
  clearTimeout(wedgeHold);
  if (canCheat() && scene.ball && Math.hypot(drag.x - scene.ball.x, drag.y - scene.ball.y) < (26 * kNorm()) / kNow()) wedgeHold = setTimeout(() => { if (drag && !scene.aim) cheatWedge(); }, 750);
});
let wedgeHold = null;
cv.addEventListener('pointerup', () => clearTimeout(wedgeHold), true);
cv.addEventListener('pointermove', (e) => {
  if (!drag || mode !== 'aim') return;
  const p = toLogical(e), dx = drag.x - p.x, dy = drag.y - p.y, d = Math.sqrt(dx * dx + dy * dy);
  if (d >= 6) clearTimeout(wedgeHold);
  if (d < 6) { scene.aim = null; showAim(null); return; }
  // Full power is 150 course units of drag. With a mouse the screen edge can get in the way (the tee
  // sits near the bottom), so full power comes a little before whichever edge you're dragging toward.
  let full = (150 * kNorm()) / kNow();   // the same drag on screen whatever the course size and zoom
  if (drag.mouse) {
    const k = kNow() / dprNow(), lx = -dx / d, ly = -dy / d;   // screen px a course unit
    const ux = rot ? -ly : lx, uy = rot ? lx : ly;   // the way the pointer is moving, on screen
    const room = Math.min(ux > 0 ? (innerWidth - drag.cx) / ux : ux < 0 ? drag.cx / -ux : Infinity, uy > 0 ? (innerHeight - drag.cy) / uy : uy < 0 ? drag.cy / -uy : Infinity);
    full = Math.min((150 * kNorm()) / kNow(), Math.max((50 * kNorm()) / kNow(), (room - 8) / k));
  }
  const pw = Math.min(1, d / full); scene.aim = { bx: scene.ball.x, by: scene.ball.y, dx: dx / d, dy: dy / d, p: pw };
  showAim(scene.aim);
});
cv.addEventListener('pointercancel', () => { drag = null; scene.aim = null; showAim(null); });
cv.addEventListener('pointerup', async (e) => {
  if (!drag) return; drag = null;
  const a = scene.aim;
  if (!a || a.p < 0.04 || mode !== 'aim') { scene.aim = null; showAim(null); if (mode === 'aim') $('tip').textContent = 'Drag back further to putt.'; return; }
  if (e.pointerType !== 'mouse') { setLocked(true); phShow(e); $('tip').textContent = 'Fine-tune with ↺ ↻ − +, then tap Putt!'; return; }
  scene.aim = null; showAim(null);
  putt(a);
});
async function putt(a) {
  if (liveOn && Date.now() < goAt()) { bigText('<span class="small-pop">Wait for GO!</span>', 900); sfx('buzz'); return; }
  const sp = (0.6 + a.p * 10.4) * POWER * (curAttack === 5 ? 0.67 : 1);
  cam.hold = false;   // follow this putt (at the zoom you chose)
  const s = { x: q20(scene.ball.x), y: q20(scene.ball.y), vx: q100(a.dx * sp), vy: q100(a.dy * sp), chip: chipNext };
  if (chipNext) { chipNext = false; sfx('whistle', { dur: 0.35 }); }
  current.push(s); mode = 'rolling'; $('tip').textContent = ''; renderCheats(); renderCard();
  const clockBefore = scene.clock || 0;
  const { ev, b } = await roll(s, H());
  const r = afterStroke(ev, b, H(), s.x, s.y);
  strokes += 1 + r.penalty; $('strokes').textContent = strokes;
  lastStroke = { s, penalty: r.penalty, clockBefore };
  if (r.holed) return finishTurn(true);
  if (strokes >= maxStrokes(curHole())) return finishTurn(false);
  mode = 'aim';
  $('tip').textContent = r.penalty ? 'Splash! One penalty stroke. Back to where you putted from.' : `Stroke ${strokes + 1}. Drag back and let go.`;
  if (curAttack && attackFrom === current.length && liveOn) landLiveAttack();   // it landed while the ball rolled
  renderCheats(); renderCard();
}

// ---------------------------------------------------------------- cheating (if you dare)
const ccw = (ax, ay, bx, by, cx, cy) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
const overRail = (h, x1, y1, x2, y2) => h.segs.some(([a, b, c, d]) => ccw(x1, y1, x2, y2, a, b) !== ccw(x1, y1, x2, y2, c, d) && ccw(a, b, c, d, x1, y1) !== ccw(a, b, c, d, x2, y2));
function clearSpot(h, x, y, from) {
  if (from && overRail(h, from.x, from.y, x, y)) return false;   // a foot can't kick through a labyrinth wall
  return inPoly(x, y, h.outline) && !h.segs.some((sg) => segDist(x, y, sg) < R + 1) && !h.water.some((w) => inRect(x, y, w))
    && !h.bumpers.some(([cx, cy, cr]) => (x - cx) ** 2 + (y - cy) ** 2 < (cr + R + 1) ** 2);
}
function renderPack() {
  const on = mode === 'aim', mini = compactPack();
  const html = G.game.status === 'playing' && (liveOn ? !myHoleDone() : curPlayer() === me.id) ? backpackBarHTML(pack, 'golf', on, { compact: mini }) : '';
  // Phones: a row of icons right above the Putt! bar; otherwise the full backpack below the tip.
  $('packMini').innerHTML = mini ? html : ''; $('pack').innerHTML = mini ? '' : html;
  document.querySelectorAll('#pack [data-loot], #packMini [data-loot]').forEach((b) => {
    const item = b.dataset.item;
    if ((item === 'magnet' && magnetOn) || (item === 'golden_tee' && !lastStroke) || (item === 'chip' && chipNext)) b.disabled = true;
    b.onclick = async () => {
      b.disabled = true;
      const { error } = await useLoot(+b.dataset.loot, G.game.id);
      if (error) { $('tip').textContent = friendly(error); return; }
      if (item === 'chip') { chipNext = true; sfx('pop'); bigText('<span class="small-pop">⛳ Chip shot!</span>', 1400); $('tip').textContent = '⛳ Your next putt is a chip: it flies over walls, hedges, bumpers, water and sand, then lands and rolls.'; }
      else if (ATK_ITEMS[item]) {   // a sneak attack on everyone else
        const a = ATTACKS[ATK_ITEMS[item]];
        sfx('sneaky'); nudge(); bigText(`<span class="small-pop">${a.icon} ${a.name}!</span>`, 1500);
        $('tip').textContent = liveOn ? `${a.icon} ${a.name} hits everyone else right now (anyone already in the cup gets it next hole).` : `${a.icon} ${a.name} is waiting for everyone else on their next hole.`;
      } else if (item === 'magnet') { sfx('pop'); magnetOn = true; scene.hole = H(); bigText('<span class="small-pop">🧲 Magnet Cup!</span>', 1500); $('tip').textContent = 'The cup just got huge and hungry.'; }
      else {   // Golden Tee: an honest mulligan
        const L = lastStroke;
        current.pop(); strokes -= 1 + L.penalty; attackFrom = Math.min(attackFrom, current.length); scene.clock = L.clockBefore; scene.flagOut = false;
        scene.ball = { x: L.s.x, y: L.s.y }; lastStroke = null; $('strokes').textContent = strokes;
        sfx('pop'); bigText('<span class="small-pop">🏌️ Golden Tee!</span>', 1500); $('tip').textContent = 'A free do-over. Totally legal.';
      }
      pack = await backpack(); renderCheats();
    };
  });
}
function renderCheats() {
  renderPack();
  $('cheats').hidden = true;   // the cheats have no buttons: they're secret gestures (below)
}
// Hidden cheats (see CLAUDE.md): hold your ball for a foot wedge, triple-tap the stroke counter
// for a mulligan, hold the hole's name to toggle the pencil whip. Only with other players around.
const canCheat = () => n() > 1 && !liveOn && (mode === 'aim' || mode === 'wedge');
function cheatWedge() {
  if (cheatsUsed & 1) return note('Your foot already did its work this hole.');
  mode = 'wedge'; drag = null; scene.aim = null; showAim(null); setLocked(false); sfx('sneaky');
  note('🦶 Nobody\'s looking… tap a spot near the ball to nudge it there.');
}
onTaps(document.body, '.hudbar .pill:last-child', 3, () => {
  if (!canCheat()) return;
  const L = lastStroke; if (!L || cheatsUsed & 2) return;
  current.pop(); strokes -= 1 + L.penalty; scene.clock = L.clockBefore; scene.flagOut = false;
  scene.ball = { x: L.s.x, y: L.s.y }; lastStroke = null; cheatsUsed |= 2; sfx('sneaky');
  $('strokes').textContent = strokes; note('🔄 Mulligan! That putt never happened.'); renderCheats();
});
onHold(document.body, '#holeName', () => {
  if (!canCheat()) return;
  cheatsUsed ^= 4; sfx('sneaky');
  note(cheatsUsed & 4 ? "✏️ Pencil whip on: you'll write down one stroke fewer." : '✏️ Pencil whip off. Honest scoring.');
});
const GOLF_RUMOURS = ['The groundskeeper swears someone keeps nudging balls when they hold still long enough.', 'Word is the stroke counter forgets things if you pester it.', 'A caddie whispered: the hole\'s name is written in pencil, and pencils can be pressed.'];
function wedgeTo(pt) {
  const h = H(), b = scene.ball, dx = pt.x - b.x, dy = pt.y - b.y, d = Math.sqrt(dx * dx + dy * dy);
  const k = d > 45 ? 45 / d : 1, x = q20(b.x + dx * k), y = q20(b.y + dy * k);
  if (!clearSpot(h, x, y, b)) { $('tip').textContent = "Can't kick it there. Pick an open spot."; return; }
  scene.ball = { x, y }; cheatsUsed |= 1; mode = 'aim'; lastStroke = null;
  sfx('sneaky'); $('tip').textContent = '*whistles innocently* Drag back and let go.'; renderCheats();
}

// ---------------------------------------------------------------- finishing a hole
async function finishTurn(holed) {
  mode = 'done'; $('cheats').hidden = true; $('pack').innerHTML = ''; $('packMini').innerHTML = '';
  const par = parOf(curHole()), t = G.game.t;
  if (holed) { celebrate(strokes, par); startDive(); }
  const wasLive = liveOn;
  const { data, error } = await sb.rpc(wasLive ? 'golf_submit_live' : 'golf_submit_turn', { p_game: G.game.id, p_strokes: current.map(fromStroke), p_actual: strokes, p_cheats: cheatsUsed, p_holed: holed,
    ...(wasLive ? { p_attack_from: curAttack ? attackFrom : -1 } : {}) });
  if (error) { $('tip').textContent = `Couldn't save that hole: ${friendly(error)}`; if (wasLive) { mode = 'idle'; await load(G.game.id); decide(); } return; }
  markSeen(t); if (wasLive) nudge();   // live: the others' pages refresh now, so a hole that just ended starts its countdown everywhere at once (065)
  $('tip').textContent = (holed ? `In the cup: ${scoreWord(strokes, par)}.` : `Picked up after ${strokes} strokes.`)
    + (data.earned ? ` ${data.earned > 1 ? `${data.earned} sneak attacks` : 'A sneak attack'} dropped into your backpack!` : '')
    + (cheatsUsed & 4 ? ` You wrote down ${data.written}. 🤫` : '') + (data.penalty ? ` (+${data.penalty} for the false accusation.)` : '');
  notify('golf', G.game.id);
  announceChaos({ gameId: G.game.id }); pack = await backpack();
  await sleep(holed && strokes === 1 && !reduceMotion ? 1800 : 300);
  await diveDone();   // all the way down into the cup first
  await load(G.game.id);
  if (G.game.status === 'over' || n() === 1) { afterPanel = false; return decide(); }
  afterPanel = true; renderAfter(); decide();
}
// After your hole: who's up next (and, with the robot next, the button that lets it play).
// Sneak attacks are backpack items now (041), used during your own hole.
function renderAfter() {
  const el = $('send'), next = curPlayer();
  el.hidden = false;
  el.innerHTML = liveOn ? `<div class="row between"><strong>⚔️ The next hole starts when everyone's in.</strong><button id="doneAfter">Done</button></div>`
    : isBot(next) ? `<div class="row between"><strong>${nm(next)} is up next.</strong><button class="go" id="botGo">Let it play</button></div>`
    : `<div class="row between"><strong>${nm(next)} is up next. They'll get an alert.</strong><button id="doneAfter">Done</button></div>`;
  const close = () => { el.hidden = true; afterPanel = false; };
  const bg = $('botGo'); if (bg) bg.onclick = () => { close(); window.scrollTo(0, 0); decide(); };
  const dn = $('doneAfter'); if (dn) dn.onclick = close;
}

// ---------------------------------------------------------------- the robot (played out on this device)
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
// Test-rolls about a thousand putts through the real physics and keeps the best, then wobbles it by skill.
function botAim() {
  const h = H(), bx = q20(scene.ball.x), by = q20(scene.ball.y), clock = scene.clock || 0, flow = flowTo(h);
  const weak = curAttack === 5 ? 0.67 : 1;
  let best = null;
  const trial = (ang, p) => {
    const sp = (0.6 + p * 10.4) * POWER * weak, b = { x: bx, y: by, vx: q100(Math.cos(ang) * sp), vy: q100(Math.sin(ang) * sp), ticks: 0, clock };
    let ev; do { ev = tick(b, h); } while (ev !== 'cup' && ev !== 'water' && ev !== 'stop');
    const sc = ev === 'cup' ? -1000 + p : ev === 'water' ? 1e5 : flow(b.x, b.y) + (h.sand.some((r) => inRect(b.x, b.y, r)) ? 20 : 0);
    if (!best || sc < best.sc) best = { sc, ang, p };
  };
  for (let a = 0; a < 360; a += 5) for (let p = 0.06; p <= 1.0001; p += 0.08) trial((a * Math.PI) / 180, p);
  const a0 = best.ang, p0 = best.p;
  for (let da = -4; da <= 4; da++) for (let dp = -0.06; dp <= 0.0601; dp += 0.02) trial(a0 + (da * Math.PI) / 180, Math.min(1, Math.max(0.04, p0 + dp)));
  const sk = botSkill(), ang = best.ang + (gauss() * sk.aim * Math.PI) / 180, p = Math.min(1, Math.max(0.04, best.p * (1 + gauss() * sk.power)));
  const sp = (0.6 + p * 10.4) * POWER * weak;
  return { ang, p, vx: q100(Math.cos(ang) * sp), vy: q100(Math.sin(ang) * sp) };
}
async function robotTurn() {
  flowing = true;
  const bot = curPlayer(), t = G.game.t, sk = botSkill();
  const { data: atk } = await sb.rpc('golf_bot_attack', { p_game: G.game.id });
  curAttack = atk?.type || 0; curAttacker = atk?.attacker || null;
  const h = H();
  cheatsUsed = 0; strokes = 0; current = []; mode = 'bot'; $('pack').innerHTML = ''; $('packMini').innerHTML = '';
  scene = { hole: h, fx: [], clock: 0, ball: { x: h.tee[0], y: h.tee[1] } };
  camIntro(holeKey(curHole()));
  setHud(curHole(), bot, 0, false); renderCard();
  if (curAttack) { sfx('sneaky'); bigText(`<span class="small-pop">${ATTACKS[curAttack].icon} ${ATTACKS[curAttack].name}!</span>`, 1700); $('tip').textContent = `${nm(bot).replace(/<[^>]+>/g, '')} got hit with ${ATTACKS[curAttack].name}. Heh.`; await sleep(1500); }
  let holed = false;
  while (strokes < maxStrokes(curHole())) {
    // Foot wedge when nobody's looking.
    if (!(cheatsUsed & 1) && Math.random() < sk.cheat * 0.5) {
      const b = scene.ball, [cx, cy] = h.cup, d = Math.sqrt((cx - b.x) ** 2 + (cy - b.y) ** 2);
      if (d > 70) { const x = q20(b.x + ((cx - b.x) * 45) / d), y = q20(b.y + ((cy - b.y) * 45) / d); if (clearSpot(h, x, y, b)) { scene.ball = { x, y }; cheatsUsed |= 1; } }
    }
    $('tip').textContent = `${nm(bot).replace(/<[^>]+>/g, '')} is lining up a putt…`;
    await sleep(350);
    const shot = botAim();
    scene.aim = { bx: scene.ball.x, by: scene.ball.y, dx: Math.cos(shot.ang), dy: Math.sin(shot.ang), p: shot.p };
    await sleep(reduceMotion ? 0 : 650);
    scene.aim = null;
    const s = { x: q20(scene.ball.x), y: q20(scene.ball.y), vx: shot.vx, vy: shot.vy }, clockBefore = scene.clock || 0;
    current.push(s); $('tip').textContent = '';
    const { ev, b } = await roll(s, h);
    const r = afterStroke(ev, b, h, s.x, s.y);
    strokes += 1 + r.penalty; $('strokes').textContent = strokes;
    if (r.holed) { holed = true; break; }
    const far = Math.sqrt((b.x - h.cup[0]) ** 2 + (b.y - h.cup[1]) ** 2);
    if (!(cheatsUsed & 2) && (far > 90 || r.penalty) && Math.random() < sk.cheat) {   // mulligan
      current.pop(); strokes -= 1 + r.penalty; scene.clock = clockBefore; scene.ball = { x: s.x, y: s.y }; cheatsUsed |= 2; $('strokes').textContent = strokes;
    }
    await sleep(450);
  }
  if (holed && strokes > 1 && Math.random() < sk.cheat) cheatsUsed |= 4;   // pencil whip
  if (holed) celebrate(strokes, parOf(curHole()));
  const { error } = await sb.rpc('golf_submit_bot_turn', { p_game: G.game.id, p_strokes: current.map(fromStroke), p_actual: strokes, p_cheats: cheatsUsed, p_holed: holed });
  curAttack = 0;
  markSeen(t);
  if (!error) { notify('golf', G.game.id); announceChaos({ gameId: G.game.id }); }
  $('tip').textContent = holed ? `${nm(bot).replace(/<[^>]+>/g, '')}: ${scoreWord(strokes, parOf(curHole()))}.` : '';
  await sleep(1200);
  flowing = false;
  decide();
}

// ---------------------------------------------------------------- the robot in a live race
// It plays its own ball on the hole everyone is on, shown as a 🤖 ghost, with a think between
// putts (Rookie slowest, Ace quickest), then saves its hole. One hole at a time, once.
const botRowPlaying = {};   // robot id -> the hole row it's playing (several robots can race, 033)
const botAimFrom = (ball, clock, h, lvl, weak = 1) => {
  const bx = q20(ball.x), by = q20(ball.y), flow = flowTo(h);
  let best = null;
  const trial = (ang, p) => {
    const sp = (0.6 + p * 10.4) * POWER * weak, b = { x: bx, y: by, vx: q100(Math.cos(ang) * sp), vy: q100(Math.sin(ang) * sp), ticks: 0, clock };
    let ev; do { ev = tick(b, h); } while (ev !== 'cup' && ev !== 'water' && ev !== 'stop');
    const sc = ev === 'cup' ? -1000 + p : ev === 'water' ? 1e5 : flow(b.x, b.y) + (h.sand.some((r) => inRect(b.x, b.y, r)) ? 20 : 0);
    if (!best || sc < best.sc) best = { sc, ang, p };
  };
  for (let a = 0; a < 360; a += 5) for (let p = 0.06; p <= 1.0001; p += 0.08) trial((a * Math.PI) / 180, p);
  const a0 = best.ang, p0 = best.p;
  for (let da = -4; da <= 4; da++) for (let dp = -0.06; dp <= 0.0601; dp += 0.02) trial(a0 + (da * Math.PI) / 180, Math.min(1, Math.max(0.04, p0 + dp)));
  const sk = BOT_SKILL[lvl], ang = best.ang + (gauss() * sk.aim * Math.PI) / 180, p = Math.min(1, Math.max(0.04, best.p * (1 + gauss() * sk.power))), sp = (0.6 + p * 10.4) * POWER * weak;
  return { vx: q100(Math.cos(ang) * sp), vy: q100(Math.sin(ang) * sp) };
};
const botLiveHoles = () => G?.game.players.filter(isBot).forEach((b) => botLiveHole(b));
async function botLiveHole(bot) {
  const g = G?.game;
  if (!bot || g.status !== 'playing' || !liveOn) return;
  const row = Math.floor(g.t / n());
  if (botRowPlaying[bot] === row || G.turns.some((x) => x.player === bot && Math.floor(x.t / n()) === row)) return;
  botRowPlaying[bot] = row;
  const hole = curHole(), lvl = g.bot_level ?? 1, think = [3600, 2600, 2000][lvl];
  const slot = row * n() + g.players.indexOf(bot);
  let h = holeWithTwists(g.seed, hole, 0, g.twists, slot), atk = 0, atkFrom = -1;   // a sneak attack on it lands before its next putt (040)
  let ball = { x: h.tee[0], y: h.tee[1] }, clock = 0, count = 0, holed = false;
  const strokes = [], still = () => liveOn && G.game.status === 'playing' && Math.floor(G.game.t / n()) === row;
  ghosts[bot] = { hole, x: ball.x, y: ball.y, at: Date.now() };
  await sleep(Math.max(0, goAt() - Date.now()) + 1200 + Math.random() * 1200);   // the robot waits for GO too (this hole's, 065)
  while (still() && count < maxStrokes(hole) && !holed) {
    await sleep(think * (0.7 + Math.random() * 0.6));
    if (!still()) break;
    if (!atk) {
      const { data: a } = await sb.rpc('golf_bot_live_attack', { p_game: g.id, p_bot: bot });
      if (a?.type) { atk = a.type; atkFrom = strokes.length; h = holeWithTwists(g.seed, hole, atk, g.twists, slot); }
    }
    const aim = botAimFrom(ball, clock, h, lvl, atk === 5 ? 0.67 : 1), s = { x: q20(ball.x), y: q20(ball.y), vx: aim.vx, vy: aim.vy };
    strokes.push(fromStroke(s));
    const b = { x: s.x, y: s.y, vx: s.vx, vy: s.vy, ticks: 0, clock };
    let ev;
    for (;;) {
      for (let i = 0; i < 3; i++) { ev = tick(b, h); if (ev === 'cup' || ev === 'water' || ev === 'stop') break; }
      ghosts[bot] = { hole, x: b.x, y: b.y, at: Date.now() };
      if (ev === 'cup' || ev === 'water' || ev === 'stop') break;
      await new Promise((r) => requestAnimationFrame(r));
    }
    clock = b.clock; count += 1;
    if (ev === 'cup') { holed = true; ghosts[bot].holed = true; }
    else if (ev === 'water') { count += 1; ball = { x: s.x, y: s.y }; }
    else ball = { x: q20(b.x), y: q20(b.y) };
  }
  if (!still()) { botRowPlaying[bot] = -1; return; }
  const { error } = await sb.rpc('golf_submit_live_bot', { p_game: g.id, p_strokes: strokes, p_actual: Math.max(1, Math.min(20, count)), p_holed: holed, p_bot: bot, p_attack_from: atk ? atkFrom : -1 });
  if (error && !/finished this hole/.test(error.message || '')) { botRowPlaying[bot] = -1; return; }
  await load(g.id); renderCard(); if (mode === 'idle' && !flowing) decide();
}

// ---------------------------------------------------------------- the end
let finalShownFor = null;
async function showFinal() {
  mode = 'over';
  $('cheats').hidden = true; $('send').hidden = true;
  renderCard();
  // The result card is drawn once (refreshes would wipe the countdown inside it).
  if (finalShownFor === G.game.id) return;
  finalShownFor = G.game.id;
  jumpToNext('golf', G.game, me.id, (p) => (bots.has(p) ? '🤖 ' : '') + (names[p] ?? 'someone'), 2500, $('gateCard'));
  const st = standings().filter((s) => s.played);
  if (!st.length) return;
  const best = Math.min(...st.map((s) => s.toPar)), winners = st.filter((s) => s.toPar === best).map((s) => s.p);
  let h;
  if (n() === 1) {
    const { data: b } = await sb.from('golf_best').select('best').eq('player', me.id).eq('start', G.game.start).eq('count', G.game.count).maybeSingle();
    const full = !G.turns.some((x) => x.skipped), isBest = full && b && b.best === st[0].toPar;
    h = `<h2>⛳ Round complete!</h2><p><strong>${st[0].strokes}</strong> strokes, ${fmtPar(st[0].toPar)}</p>
      ${isBest ? '<p>🏆 Your personal best on this course!</p>' : b ? `<p class="muted small">Personal best: ${fmtPar(b.best)}</p>` : ''}
      ${full ? '' : '<p class="muted small">Some holes were skipped, so this round doesn\'t count for a personal best.</p>'}`;
  } else {
    const award = (k, label) => { const m = Math.max(...G.players.map((x) => x[k])); return m ? `<p class="small">${label}: <strong>${G.players.filter((x) => x[k] === m).map((x) => who(x.player)).join(' & ')}</strong> (${m})</p>` : ''; };
    const log = G.secrets.filter((s) => s.cheats).map((s) => { const tu = G.turns.find((x) => x.t === s.t); return `${who(s.player)}: ${[1, 2, 4].filter((k) => s.cheats & k).map((k) => CHEAT_NAMES[k]).join(', ')} on hole ${tu ? tu.hole + 1 : '?'}`; });
    h = `<h2>🏆 ${winners.map(who).join(' & ')} ${winners.length > 1 ? 'tie' : winners[0] === me.id ? 'win!' : 'wins!'}</h2><p class="muted">${fmtPar(best)}</p>
      ${award('away', '🦊 Sneakiest, cheats that got away')}${award('catches', '🔍 Sharpest eye')}${award('busted', '🚨 Most busted')}
      ${log.length ? `<details><summary class="small">The truth comes out</summary><ul class="small" style="text-align:left;margin:6px 0 0;padding-left:18px">${log.map((l) => `<li>${l}</li>`).join('')}</ul></details>` : '<p class="small muted">Nobody cheated. Allegedly.</p>'}`;
  }
  modal(h);   // "Coming next" and its countdown join this card (jumpToNext, above)
  for (let i = 0; i < 4; i++) setTimeout(() => burst(cam.x + (Math.random() - 0.5) * viewW() * 0.66, cam.y + (Math.random() - 0.4) * viewH() * 0.4, ['#F2C14E', '#E4572E', '#7FD3F7', '#fff'], 50, 0.05), i * 350);
}

// ---------------------------------------------------------------- skip ahead, delete
$('jumpGo').onclick = async () => {
  const btn = $('jumpGo'), target = +$('jumpTo').value;
  if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Tap again to skip for everyone'; $('jumpNote').textContent = `Unplayed holes before ${target + 1} are marked skipped and left out of scores.`; return; }
  delete btn.dataset.armed; btn.textContent = 'Skip';
  const { error } = await sb.rpc('golf_skip_to', { p_game: G.game.id, p_hole: target });
  if (error) { $('jumpNote').textContent = friendly(error); return; }
  mode = 'idle'; await load(G.game.id); notify('golf', G.game.id); decide();
};
// The toolbar's 🤖 switch.
async function toggleBotLive() {
  const { error } = await sb.rpc('set_live_bot', { p_kind: 'golf', p_game: G.game.id, p_on: !G.game.live_bot });
  if (error) return friendly(error);
  await load(G.game.id); renderCard();
}
async function deleteGame() {
  const { error } = await sb.rpc('golf_delete', { p_game: G.game.id });
  if (error) return friendly(error);
  location.href = './';
}

// ---------------------------------------------------------------- start
(async () => {
  if (!(await signedIn())) return;
  condenseTop(document.querySelector('.hudbar > .stack'));   // phones: ← · hole · toolbar
  const id = (location.hash.match(/game=([0-9a-f-]{36})/) || [])[1];
  if (!id || !(await load(id))) { $('holeName').textContent = 'Game not found'; $('holeNo').textContent = 'It may have been deleted.'; return; }
  sizeCanvas(); addEventListener('resize', sizeCanvas);
  if (window.ResizeObserver) { const ro = new ResizeObserver(() => { if (fullCourse()) sizeCanvas(); }); ro.observe($('packMini')); ro.observe(document.querySelector('.hudbar')); }   // the full-screen course fits round them
  new MutationObserver(() => requestAnimationFrame(sizeCanvas)).observe($('play'), { attributes: true, attributeFilter: ['class'] });   // in and out of full screen
  $('cardFold').open = !isPhone();
  noteMirror($('tip'), '', () => liveOn && ['aim', 'rolling', 'reveal'].includes(mode));   // live: no pop-ups over the course while you putt
  pack = await backpack();
  announceChaos({ gameId: id });
  requestAnimationFrame(loop);
  let pending = false;
  const refresh = () => { if (pending) return; pending = true; setTimeout(async () => { pending = false; await load(id); renderCard(); announceChaos({ gameId: id });
    G.turns.forEach((x) => { if (ghosts[x.player] && Math.floor(x.t / n()) === Math.floor((G.game.t - 1) / n())) ghosts[x.player].holed = true; });
    if (G.game.status === 'over' && mode !== 'over' && !flowing) decide();   // over while you were aiming (or watching): the result, and what's next
    else if (mode === 'idle' && !flowing) decide(); else if (liveOn && mode === 'idle') waitingLive();
    checkLiveAttack(); }, 200); };
  live = liveGame(`golf-${id}`, [
    { event: '*', table: 'golf_games', filter: `id=eq.${id}` },
    { event: 'INSERT', table: 'golf_turns', filter: `game_id=eq.${id}` },
    { event: 'INSERT', table: 'golf_accusations', filter: `game_id=eq.${id}` },
  ], refresh, async () => {
    if (!G) return;
    if (await chaosClock()) return refresh();   // anything overdue on a stalled turn lands now
    const { data } = await sb.from('golf_games').select('updated_at').eq('id', id).maybeSingle();
    if (data && data.updated_at !== G.game.updated_at) refresh();
  }, {
    ball: (m) => { if (liveOn && m.p && m.p !== me.id) ghosts[m.p] = { hole: m.hole, x: m.x, y: m.y, holed: !!m.holed, at: Date.now() }; },
  });
  if (n() > 1) livePresence('golf', id, setLive);   // with the robot in, the server only counts it live when live_bot is on
  setInterval(() => { if (liveOn) botLiveHoles(); }, 1500);
  navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.url) location.href = e.data.url; });
  const upNext = () => nextUpChip(me.id, id, (p) => (bots.has(p) ? '🤖 ' : '') + (names[p] ?? G?.names?.[p] ?? 'someone'));
  upNext(); setInterval(() => { if (!document.hidden) upNext(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) upNext(); });
  decide();
  window.__golf = () => ({ mode, liveOn, liveGo, holeGo: holeGo(), goIn: goAt() - Date.now(), offset: srv.offset, t: G?.game.t, hole_go: G?.game.hole_go });   // test hook
})();
