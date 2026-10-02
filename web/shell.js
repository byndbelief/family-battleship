// 🧬 THE SHELL: the one body every solo game wears (CHAOS.md, "The shell and the organs").
//
// A solo game is an ORGAN: a module that draws a world and maps the box's nine events to its own
// nouns. It owns nothing else. The shell owns the canvas and its sizing, the beat clock and the chaos
// curve, the tally and the rating, hearts, score and combo, the HUD and meter, banners, the intro and
// end cards, the leaderboard, full screen, input, and the run's save (solo_submit).
//
// One organ makes an ordinary game page (squirrel.html, fractal.html). Several make a Chaos Run: the
// curve decides which organ you're in, and the world morphs when it says so:
//   a peak flips to the next organ (once you've had a few beats in this one), the mirror brings back
//   the one before, the window rotates every beat (the rhythm of 3), the golden cut dives into the
//   organ you've been away from longest. Hearts, score, combo, loot and the curve carry across the
//   seams; each organ keeps its own world alive while it's away, and picks up where it left off.
//
// Organ interface (see organs/*.js):
//   key, name, icon, verb, beat (seconds a beat), theme?  { bg, accent }
//   init(host)  start()  enter(from, anchor)  leave() → anchor  update(dt)  draw(t)  onBeat(ev)
//   pointer(type, p, e)  keydown(e)?  keyup(e)?  resize()?  hudLine()  level()  overText(how) → [title, sub]
//   endStats() → text  debug()?
// The host an organ gets: { cv, ctx, W, H, k, dpr, reduceMotion, S, banner, add, hurt, heal, over, sfx, ui, morphs }
import { sb, me, signedIn, sfx, setGameTools, esc, names } from './common.js';
import { makeCurve, stepCurve, drawMeter, meterText, NEWS, tally, ratingLine, CALM, isCalm, CHAOS, MOOD_SAY, MOOD_NAME, WEIGHTS } from './chaos.js';
import { palWidget, PAL, drawPal } from './pals.js';
import { applyPalTheme } from './common.js';

const SHELL_CSS = `
  .shud{position:absolute;left:0;right:0;top:0;display:flex;justify-content:space-between;align-items:flex-start;padding:8px 10px;pointer-events:none;font-weight:900;text-shadow:0 2px 4px #000c}
  .shud .score{font-family:var(--display,inherit);font-size:24px;line-height:1}
  .shud .combo{color:var(--gold,#F5C542);font-size:14px}
  .shud .lvl{font-size:13px;color:var(--muted,#ccc);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:min(58vw,260px)}   /* one line on a phone: Putt's course text used to wrap under the hearts */
  .shud > div:first-child{min-width:0}
  .shud .hearts{font-size:14px;letter-spacing:1px}
  .shud .hearts small{display:block;font-size:11px;letter-spacing:2px;color:var(--muted,#ccc)}
  .chaosm{display:flex;flex-direction:column;align-items:flex-end;gap:2px;font-size:11px;letter-spacing:.06em;text-transform:uppercase}
  .chaosm canvas{width:92px;height:34px;background:#0008;border-radius:8px}
  .spal{position:absolute;left:4px;top:76px;width:60px;height:60px;pointer-events:none;filter:drop-shadow(0 4px 8px #000a)}   /* under the score, off the field (Hilltop's tank lives bottom-left) */
  .verb{display:none !important;position:absolute;left:68px;right:8px;top:76px;display:flex;flex-direction:column;align-items:flex-start;gap:4px;pointer-events:none;font-size:12px;font-weight:900;text-shadow:0 2px 4px #000c}   /* up top beside the pal, under the score: the field stays clear */
  .verb b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
  .verb b{display:inline-block;padding:4px 9px;border-radius:99px;background:#0009;border:1px solid #ffffff33;color:#fff}
  .verb b.next{color:var(--gold,#F5C542);border-color:var(--gold,#F5C542);animation:vpulse 1s infinite alternate}
  @keyframes vpulse{from{opacity:.6}to{opacity:1}}
  .oui{position:absolute;right:8px;bottom:8px;display:flex;flex-direction:column;gap:6px;align-items:flex-end}
  .oui .wbar{display:flex;flex-direction:column;gap:6px}
  .oui .wbar button{position:relative;width:44px;height:44px;padding:0;border-radius:12px;font-size:22px;line-height:1;background:#0E0C22aa;border:1.5px solid #ffffff44;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
  .oui .wbar button.on{border-color:var(--gold,#F5C542);background:#F5C54244;box-shadow:0 0 12px #F5C54288}
  .oui .wbar button b{position:absolute;right:-5px;bottom:-5px;font-size:10px;padding:1px 4px;border-radius:8px;background:#141026;border:1px solid #ffffff44}
  .oui .dash{width:110px;height:8px;border-radius:6px;background:#0008;border:1px solid #ffffff33;overflow:hidden}
  .oui .dash i{display:block;height:100%;background:linear-gradient(90deg,#3DF2E0,#FF5FB0);width:100%;transition:width .08s linear}
  .sbanner{position:absolute;left:68px;top:84px;max-width:calc(100% - 80px);pointer-events:none;font-weight:900;font-size:12px;line-height:1.2;padding:4px 10px;border-radius:99px;background:#000a;border:1px solid #ffffff33;color:var(--bannerc,#FFE08A);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transform-origin:0 50%;animation:bpop .25s ease-out}   /* 🟢 Fig says it: a small word beside the pal, never over the field */8,0 0 30px var(--gold,#F5C542);white-space:nowrap;animation:bpop .45s cubic-bezier(.2,1.6,.4,1) both;text-align:center}
  .sbanner small{display:none;font-family:var(--body,inherit);font-weight:900;font-size:15px;-webkit-text-stroke:0;color:#fff;text-shadow:0 2px 4px #000;white-space:normal;line-height:1.25}
  @keyframes bpop{from{transform:scale(.4);opacity:0}}
  .sover{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;background:#07060F;padding:16px;text-align:center;overflow:auto}   /* the card sits low: the box shows above it */
  .sover .boxbg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}   /* inside the box: drawn by drawBox() while the overlay is up */
  .sover .card{position:relative;max-width:340px;display:flex;flex-direction:column;gap:10px;align-items:center;padding:14px 16px;border-radius:20px;background:#0B0918b8;border:1px solid #ffffff1a;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
  .sover p{margin:0}
  .sover .muted{color:var(--muted,#ccc)} .sover .small{font-size:13px}
  .sover .board{list-style:none;margin:0;padding:0;width:100%;max-width:280px;display:flex;flex-direction:column;gap:4px;text-align:left}
  .sover .board li{display:flex;justify-content:space-between;padding:6px 10px;border-radius:10px;background:#0006}
  .sover .board li.me{outline:2px solid var(--gold,#F5C542)}
  .sover .organs{display:flex;gap:10px;justify-content:center;font-size:28px}
  @media (prefers-reduced-motion:reduce){.sbanner{animation:none}.verb b.next{animation:none}}`;

export function runShell({ organs, key, title, icon, intro, again = 'Play again', W: W0 = 400 }) {
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), cv = $('cv'), ctx = cv.getContext('2d');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const morphs = organs.length > 1;
  // ---------------------------------------------------------------- the body's parts
  const style = document.createElement('style'); style.textContent = SHELL_CSS; document.head.appendChild(style);
  stage.insertAdjacentHTML('beforeend', `
    <div class="shud" aria-live="off">
      <div><div class="score" id="score">0</div><div class="hearts" id="hearts">❤️❤️❤️</div><div class="combo" id="combo"></div><div class="lvl" id="lvl"></div></div>
      <div class="chaosm"><canvas id="meter" width="184" height="68" aria-hidden="true"></canvas><span id="phase">calm</span></div>
    </div>
    <canvas class="spal" id="spal" width="144" height="144" aria-hidden="true" hidden></canvas>
    <div class="verb" id="verb" hidden></div>
    <div class="oui" id="oui"></div>
    <div class="sbanner" id="banner" hidden></div>
    <div class="sover" id="over"><canvas class="boxbg" id="boxbg" aria-hidden="true"></canvas><div class="card" id="overCard"></div></div>`);
  const meter = $('meter');
  // ---------------------------------------------------------------- shared state
  const S = { score: 0, hearts: 3, lives: {}, combo: 0, comboT: 0, tally: {}, curve: makeCurve(), beatT: 0, beats: 0, over: false, how: null, time: 0, morphs: 0 };
  // 🎮 Every organ is its own little game inside the run: it has three lives of its own (S.lives[key]). Lose
  // them and that organ resets to its easy start, and the run loses one of its own three hearts. The run ends
  // when the run's hearts are gone. The reset waits for the organ's update to finish (resetPending).
  const livesOf = (k) => S.lives[k] ?? 3;
  let resetPending = null;
  let active = null, prev = null, transition = null, tenure = 0, lastUsed = new Map(), running = false;
  // 🧘 calm within the chaos: beats left in the hold a calm organ (CALM.organs) opens on entry
  let calm = 0;
  // ⚡ a glitch: seconds left of the flicker a held peak sets off (the theme is another organ's meanwhile)
  let glitchT = 0;
  function glitchRun() { if (S.over) return; glitchT = 1.1; const others = organs.filter((o) => o !== active && o.theme); const th = others[Math.floor(Math.random() * others.length)]; if (th) applyTheme(th.theme); active.glitch?.(true, S.curve.mood); pal.hurt(); sfx('buzz'); banner(NEWS.glitch[0], `${PAL[S.curve.mood || 'calm'].name}'s mind flickers: nothing changed. Probably.`); }
  function tear() {   // slices of the frame shoved sideways, and a colour band, for the glitch's life
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i < 5; i++) { const y = Math.random() * cv.height, h = (6 + Math.random() * 34) * host.dpr, dx = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 18) * host.dpr; ctx.drawImage(cv, 0, y, cv.width, h, dx, y, cv.width, h); }
    ctx.globalCompositeOperation = 'difference'; ctx.globalAlpha = 0.35; ctx.fillStyle = ['#3DD6C6', '#FF5A4A', '#B9A6FF'][Math.floor(Math.random() * 3)]; ctx.fillRect(0, Math.random() * cv.height, cv.width, (4 + Math.random() * 20) * host.dpr);
    ctx.restore();
  }
  const openCalm = () => { if (!isCalm(active?.key)) { calm = 0; return; } calm = CALM.RUN_HOLD; banner('🧘 FIG TAKES A BREATH', `calm within the chaos: r holds and nothing twists · ${calm} beats`); pal.force('gift', 1.6); };
  // 🎨 the resident pal sits in the corner and feels every beat (pals.js; who it is: the Design Studio)
  const pal = palWidget($('spal'), { pal: 'calm', s: 22, own: false, dpr: 2 });   // 🟢 Fig, in the run's mood
  const host = {
    cv, ctx, W: W0, H: 640, k: 1, dpr: 1, ox: 0, oy: 0, reduceMotion, S, sfx, morphs,
    banner, add: (pts) => { S.score += Math.max(0, Math.round(pts)); },
    heal: (n = 1) => { if (active) S.lives[active.key] = Math.min(3, livesOf(active.key) + n); },
    hurt: (how) => { S.combo = 0; S.comboT = 0; pal.hurt(); if (!active) return false; S.lives[active.key] = livesOf(active.key) - 1; if (S.lives[active.key] <= 0) resetPending = how; return false; },
    over, ui: (html) => { $('oui').innerHTML = html || ''; return $('oui'); },
    organ: () => active?.key, activeBeat: () => active?.beat || 1, stage: () => stageOf() + 1,   // 🎚️ the run's stage, for organs that grow with it
    // 🟢 Fig in the corner watches the field from outside it: organs cue it on what happens and where (x in world units),
    // it turns to look that way and acts it out — a kill bounces it, a score winks, a near miss makes it flinch, a pickup is a gift
    cue: (kind, x, y) => { if (x != null) pal.set({ face: x < host.W * 0.3 ? -1 : 1 }); if (kind === 'kill') pal.force('big', 0.9); else if (kind === 'score') pal.force('fib', 0.8); else if (kind === 'near') pal.force('peak', 0.6); else if (kind === 'pickup') pal.force('gift', 1.2);
      if (x != null) { lunge(kind, x, y); if (kind !== 'look' && y != null) sparks(kind, x, y); } },
  };
  // 🟢 Fig reaches into the field: the chip lunges toward the action (a nudge of its canvas toward where it happened, then
  // back), and sparks fly from Fig across the board to the spot — gold stars for a kill, teal motes for a score, a red
  // shock ring for a near miss, a heart for a pickup. Drawn by the shell over the organ, in device pixels.
  let lungeT = null, figfx = [];
  const palPt = () => { const r = $('spal').getBoundingClientRect(), c = cv.getBoundingClientRect(); return { x: (r.left + r.width / 2 - c.left) * (cv.width / c.width), y: (r.top + r.height * 0.56 - c.top) * (cv.height / c.height) }; };
  function lunge(kind, x, y) {
    const r = $('spal').getBoundingClientRect(), c = cv.getBoundingClientRect(), tx = c.left + ((x * host.k + host.ox) / host.dpr), ty = c.top + (((y ?? host.H * 0.5) * host.k + host.oy) / host.dpr);
    const dx = tx - (r.left + r.width / 2), dy = ty - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1, amt = kind === 'look' ? 6 : kind === 'near' ? -10 : 16;
    const el = $('spal'); el.style.transition = 'transform .12s ease-out'; el.style.transform = `translate(${(dx / d) * amt}px, ${(dy / d) * amt}px) scale(${kind === 'kill' ? 1.25 : kind === 'near' ? 0.9 : 1.1})`;
    clearTimeout(lungeT); lungeT = setTimeout(() => { el.style.transition = 'transform .35s cubic-bezier(.3,1.6,.5,1)'; el.style.transform = ''; }, 140);
  }
  function sparks(kind, x, y) {
    const from = palPt(), to = { x: x * host.k + host.ox, y: y * host.k + host.oy }, d = host.dpr;
    const n = kind === 'kill' ? 9 : kind === 'score' ? 6 : kind === 'pickup' ? 1 : 1;
    for (let i = 0; i < n; i++) figfx.push({ kind, x0: from.x, y0: from.y, x1: to.x, y1: to.y, t: -i * 0.03, dur: kind === 'near' ? 0.5 : 0.45 + Math.random() * 0.2, arc: (Math.random() - 0.5) * 140 * d, s: (kind === 'pickup' ? 14 : 4 + Math.random() * 4) * d, spin: Math.random() * 6 });
  }
  function drawFigfx(dt) {
    if (!figfx.length) return; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    figfx = figfx.filter((f) => { f.t += dt; if (f.t < 0) return true; const e = Math.min(1, f.t / f.dur), ee = e * e * (3 - 2 * e);
      if (f.kind === 'near') { const r = 10 * host.dpr + ee * 60 * host.dpr; ctx.globalAlpha = 1 - e; ctx.strokeStyle = '#FF5A3A'; ctx.lineWidth = 3 * host.dpr; ctx.beginPath(); ctx.arc(f.x0, f.y0, r, 0, 7); ctx.stroke(); return e < 1; }
      const x = f.x0 + (f.x1 - f.x0) * ee, y = f.y0 + (f.y1 - f.y0) * ee - Math.sin(e * Math.PI) * f.arc;
      ctx.globalAlpha = e < 0.85 ? 1 : (1 - e) / 0.15; ctx.save(); ctx.translate(x, y); ctx.rotate(f.spin + e * 6);
      if (f.kind === 'kill') { ctx.fillStyle = '#F5C542'; ctx.shadowColor = '#F5C542'; ctx.shadowBlur = 8 * host.dpr; ctx.beginPath(); for (let k = 0; k < 10; k++) { const a = (k / 10) * 6.28, rr = k % 2 ? f.s * 0.45 : f.s; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); }
      else if (f.kind === 'score') { ctx.fillStyle = '#3DD6C6'; ctx.shadowColor = '#3DD6C6'; ctx.shadowBlur = 6 * host.dpr; ctx.beginPath(); ctx.arc(0, 0, f.s * 0.6, 0, 7); ctx.fill(); }
      else { ctx.fillStyle = '#FF5FB0'; ctx.font = `${Math.round(f.s)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('💚', 0, 0); }
      ctx.restore(); return e < 1; });
    ctx.restore();
  }
  // ---------------------------------------------------------------- sizing
  function size() {
    const fs = !!document.querySelector('#play.fs-on');
    const r = stage.getBoundingClientRect();
    const w = r.width, h = fs ? innerHeight : Math.max(420, innerHeight - r.top - 12);
    host.dpr = Math.min(2, devicePixelRatio || 1);
    cv.style.height = `${h}px`; cv.width = Math.round(w * host.dpr); cv.height = Math.round(h * host.dpr);
    // The world is 400 wide and as tall as the screen allows. On a wide screen (a phone on its side) a
    // full-width fit would scale everything up and leave a world a few beats tall: zoom out instead,
    // so the world is at least 1.25× taller than wide, centred on the full canvas (host.ox, device px)
    // with the organ's own background around it. Organs draw with setTransform(k, 0, 0, k, host.ox, 0).
    // 🎚️ The stages widen the world more than they lengthen it: W grows by `widen`, the visible height only by
    // 1/zoom, and whichever runs out of screen first gets margins (host.ox / host.oy, device px) in the organ's
    // own colour. Organs draw with setTransform(k, 0, 0, k, host.ox, host.oy) and read host.W live.
    const k0 = Math.min(cv.width / W0, cv.height / (W0 * 1.25)), H0 = cv.height / k0;   // the Stage 1 fit: 400 wide, at least 1.25× taller than wide
    host.W = Math.round(W0 * widen); const Hv = H0 / zoom;
    host.k = Math.min(cv.width / host.W, cv.height / Hv); host.H = Hv;
    host.ox = Math.max(0, (cv.width - host.W * host.k) / 2); host.oy = Math.max(0, (cv.height - host.H * host.k) / 2);
    organs.forEach((o) => o.resize?.());
  }
  // ---------------------------------------------------------------- banners, HUD
  let bannerT = null;
  // 🟢 Notices go through Fig: the pal in the corner acts the event out (a cue read off the title's mark) and a
  // short word sits beside it for a moment. Nothing lands over the field; the sub-line is for the ratings only.
  const CUE = [['🌻', 'golden'], ['✨', 'mirror'], ['⚖️', 'balance'], ['🔁', 'window'], ['⚡', 'peak'], ['🧘', 'gift'], ['🎚️', 'big'], ['🛡️', 'gift'], ['🌀', 'peak'], ['🔂', 'window'], ['🌟', 'gold'], ['🟢', null]];
  const HURTS = /OUCH|ZAP|SPLASH|HIT|BOMBED|BONK|PICKED|DRONED|GLITCH|OVER PAR/;
  function banner(t, sub) {
    const b = $('banner'); b.textContent = t; b.title = sub || ''; b.hidden = false;
    b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    clearTimeout(bannerT); bannerT = setTimeout(() => { b.hidden = true; }, 1400);
    const cue = CUE.find(([m]) => t.includes(m)); if (HURTS.test(t)) pal.hurt(); else if (cue) { if (cue[1]) pal.force(cue[1], 1.6); } else pal.force('big', 1);
  }
  const nextOrgan = () => organs[(organs.indexOf(active) + 1) % organs.length];
  // 🎚️ STAGES: the run eases into chaos. A stage is a stretch of beats; early stages let r climb only
  // every few beats (frozen beats: x walks and Fig's moods still land, a hint of what's coming), morph
  // less, and keep the board close; later stages climb every beat and zoom the board out (a taller world).
  const STAGES = [
    { name: 'Stage 1 · learn', beats: 0, climbEvery: 5, zoom: 1.0, widen: 1.0, tenure: 10, lens: 2.2 },
    { name: 'Stage 2 · warm', beats: 30, climbEvery: 2, zoom: 0.94, widen: 1.15, tenure: 8, lens: 4 },
    { name: 'Stage 3 · wild', beats: 60, climbEvery: 1, zoom: 0.88, widen: 1.3, tenure: 6, lens: 6 },
    { name: 'Stage 4 · chaos', beats: 100, climbEvery: 1, zoom: 0.82, widen: 1.45, tenure: 4, lens: 7 },
  ];   // zoom: the visible height grows by 1/zoom; widen: the world's width grows by widen — sideways more than up
  const stageOf = () => { let i = 0; STAGES.forEach((st, j) => { if (S.beats >= st.beats) i = j; }); return i; };
  let zoom = 1, zoomTo = 1, widen = 1, widenTo = 1;
  const minTenure = () => (S.curve.r >= 3.5699 ? Math.min(3, STAGES[stageOf()].tenure) : STAGES[stageOf()].tenure);
  // 🔍 LENSES: Fig's personalities bend the picture itself. A new mood may put a lens on: Wild Fig inverts the
  // colours, Mirror Fig mirrors the screen (and your touches), Boxy Fig leaves only the wireframe, Golden Fig
  // turns it gold. Short in the early stages (a hint), longer later.
  const LENS = { fig: ['invert', '🌀 WILD FIG INVERTS THE WORLD', 'the colours flip'], kit: ['mirror', '✨ MIRROR FIG FLIPS THE SCREEN', 'left is right now'], bit: ['wire', '🔁 BOXY FIG: WIREFRAME', 'only the edges are real'], phi: ['gold', '🌻 GOLDEN FIG GILDS IT', 'everything in gold'] };
  let lens = null;   // { kind, t, dur }
  function putLens(kind, dur) {
    lens = { kind, t: 0, dur };
    cv.style.filter = kind === 'invert' ? 'invert(1) hue-rotate(180deg)' : kind === 'gold' ? 'sepia(1) saturate(1.6) hue-rotate(-10deg) contrast(1.1)' : '';
    cv.style.transform = kind === 'mirror' ? 'scaleX(-1)' : '';
  }
  function clearLens() { lens = null; cv.style.filter = ''; cv.style.transform = ''; }
  function wireframe() {   // edges only: the frame minus itself shifted a pixel, brightened
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'difference'; ctx.drawImage(cv, 1, 1); ctx.drawImage(cv, -1, 0);
    ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(cv, 0, 0); ctx.drawImage(cv, 0, 0); ctx.restore();
  }
  function hud() {
    $('score').textContent = S.score.toLocaleString();
    const lv = active ? livesOf(active.key) : 3, hearts = '❤️'.repeat(Math.max(0, S.hearts)) + '🖤'.repeat(Math.max(0, 3 - S.hearts)) + (active ? `<small>${active.icon} ${'●'.repeat(Math.max(0, lv))}${'○'.repeat(Math.max(0, 3 - lv))}</small>` : '');
    if ($('hearts').innerHTML !== hearts) $('hearts').innerHTML = hearts;   // the run's hearts, and under them this organ's own lives
    $('combo').textContent = S.combo > 1 && S.comboT > 0 ? `COMBO ×${S.combo}` : '';
    $('lvl').textContent = `Stage ${stageOf() + 1}${active?.hudLine?.() ? ' · ' + active.hudLine() : ''}`;
    $('phase').textContent = meterText(S.curve);
    drawMeter(meter, S.curve);
    const v = $('verb');
    v.hidden = true; if (true) return;   // the hint pills are gone: Fig and the field say what's happening
    const armed = morphs && tenure >= minTenure() - 1 && !S.curve.window && calm <= 0;
    v.hidden = false;
    v.innerHTML = `<b>${active.icon} ${esc(active.verb)}</b>${morphs ? `<b class="${armed ? 'next' : ''}">${calm > 0 ? `🧘 calm · ${calm} beat${calm === 1 ? '' : 's'} · r holds` : S.curve.window ? '🔁 the window: it rotates every beat' : armed ? `⚡ next: ${nextOrgan().icon} ${esc(nextOrgan().verb)}` : `${S.morphs} morph${S.morphs === 1 ? '' : 's'}`}</b>` : ''}`;
  }
  // ---------------------------------------------------------------- the beat and the morphs
  function beat() {
    const held = calm > 0, st0 = stageOf(), stg = STAGES[st0];
    const frozen = !held && stg.climbEvery > 1 && (S.beats % stg.climbEvery) !== 0;   // 🎚️ an early stage: r climbs only every few beats
    const ev = stepCurve(S.curve, { hold: held, freeze: frozen }); S.beats += 1; tenure += 1; tally(ev, S.tally);
    if (stageOf() !== st0) { const ns = STAGES[stageOf()]; banner(`🎚️ ${ns.name.toUpperCase()}`, st0 === 0 ? 'r climbs faster now · the board zooms out' : st0 === 1 ? 'r climbs every beat · the board zooms out' : 'the top of the curve · the whole board'); sfx('twist'); zoomTo = ns.zoom; widenTo = ns.widen; }
    // 🟢 Fig's mood moved: say so, recolour the room, and its pillar's events pay double (the bond, in points)
    if (ev.moodChanged) { banner(`🟢 ${MOOD_NAME[ev.mood]}`, st0 < 2 && ev.mood !== 'calm' ? `${MOOD_SAY[ev.mood]} · a hint of what's coming` : MOOD_SAY[ev.mood]); applyPalTheme(ev.mood);
      // 🔍 a lens, sometimes: a hint in the early stages, a stretch later
      const L = LENS[ev.mood]; if (L && !lens && Math.random() < [0.5, 0.65, 0.85, 1][st0]) { putLens(L[0], stg.lens); setTimeout(() => banner(L[1], L[2]), 900); sfx('buzz'); } }
    { const B = PAL[ev.mood]?.boosts || []; let bond = 0; for (const k of B) { if (k === 'r4' ? ev.crossed.some((p) => p.name === 'r = 4') : k === 'phase' ? ev.crossed.length > 0 : ev[k]) bond += WEIGHTS[k] || 0; } if (bond) S.tally.bond = (S.tally.bond || 0) + bond; }
    if (held) { calm -= 1; if (calm === CALM.WARN) { banner(...NEWS.again); sfx('tick'); } else if (ev.glitch) glitchRun(); }
    pal.set({ r: S.curve.r, mood: ev.mood }); pal.react(ev);
    ev.crossed.forEach((p) => banner(p.name, p.say));
    if (ev.enteredWindow) banner(...NEWS.window);
    if (ev.mirror) banner(...NEWS.mirror);
    if (ev.balance) banner(...NEWS.balance);
    if (ev.golden) banner(...NEWS.golden);
    active.onBeat(ev);
    if (morphs && !transition && !S.over && !held) {   // 🧘 nothing morphs during a calm
      let to = null, why = '';
      if (ev.window) { to = nextOrgan(); why = 'window'; }
      else if (ev.golden) { to = [...organs].filter((o) => o !== active).sort((a, b) => (lastUsed.get(a) || 0) - (lastUsed.get(b) || 0))[0]; why = 'golden'; }
      else if (ev.mirror && prev && prev !== active) { to = prev; why = 'mirror'; }
      else if (ev.peak && tenure >= minTenure()) { to = nextOrgan(); why = 'peak'; }
      if (to && to !== active) morphTo(to, why);
    }
  }
  const WHY = { window: '🔁 the window turns the world', golden: '🌻 the golden cut: a dive', mirror: '✨ the mirror: back to the world before', peak: '⚡ a peak: the world twists' };
  function morphTo(to, why) {
    const snap = document.createElement('canvas'); snap.width = cv.width; snap.height = cv.height; snap.getContext('2d').drawImage(cv, 0, 0);
    const anchor = active.leave?.() || null;
    lastUsed.set(active, S.beats); prev = active; active = to; tenure = 0; S.morphs += 1;
    active.enter(prev.key, anchor);
    applyTheme(); openCalm();
    transition = { t: 0, dur: reduceMotion ? 0.05 : (why === 'golden' ? 1.1 : 0.7), snap, why, anchor };
    banner(`${to.icon} ${to.name.toUpperCase()}`, `${to.verb} · ${WHY[why]}`); sfx(why === 'golden' ? 'birdie' : 'twist');
  }
  function applyTheme(th = active?.theme) { if (!th) return; Object.entries(th).forEach(([k, v]) => stage.style.setProperty(`--${k}`, v)); }
  // ---------------------------------------------------------------- the loop
  // ---------------------------------------------------------------- inside the box (the start and over screens)
  // The site is the box; this is what it's made of, filling the screen behind the card: the logistic map's
  // bifurcation diagram across the lower half with a cursor sweeping r and the orbit sparking at it (the
  // curve, live), the same fractal tree mirrored left and right (symmetry), a golden spiral turning above,
  // Fibonacci rings of dots pulsing from the centre, and Fig in the corner in the run's mood.
  const bb = $('boxbg'), bctx = bb.getContext('2d'); let bif = null;
  function bifurcation(w, h) {   // the diagram as an offscreen canvas: for each r, the orbit after it settles
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x2 = c.getContext('2d');
    for (let i = 0; i < w; i++) { const r = 2.5 + (i / w) * 1.5; let x = 0.3; for (let n = 0; n < 60; n++) x = r * x * (1 - x);
      const col = r < 3 ? '#3DD6C6' : r < 3.449 ? '#C9B8FF' : r < 3.5699 ? '#F5C542' : '#FF5FB0'; x2.fillStyle = col; x2.globalAlpha = 0.5;
      for (let n = 0; n < 48; n++) { x = r * x * (1 - x); x2.fillRect(i, h - 2 - x * (h - 4), 1, 1.2); } }
    return c;
  }
  const FIB = [1, 1, 2, 3, 5, 8, 13, 21, 34], PHI = (1 + Math.sqrt(5)) / 2;
  function tree(x, y, a, len, d, sway) { if (d === 0 || len < 2) return; const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len; bctx.lineWidth = Math.max(0.6, d * 0.45); bctx.beginPath(); bctx.moveTo(x, y); bctx.lineTo(x2, y2); bctx.stroke(); tree(x2, y2, a - 0.5 + sway, len / PHI, d - 1, sway); tree(x2, y2, a + 0.5 + sway, len / PHI, d - 1, sway); }
  function drawBox(t) {
    const W = bb.width = bb.clientWidth * host.dpr, H = bb.height = bb.clientHeight * host.dpr; if (!W || !H) return; const d = host.dpr, cx = W / 2;
    bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.fillStyle = '#07060F'; bctx.fillRect(0, 0, W, H);
    // the curve: the diagram across the screen's lower half, a cursor sweeping r 2.5 → 4 over ~20 s, the orbit sparking at it
    const I = { x0: W * 0.06, x1: W * 0.94, y0: H * 0.22, y1: H * 0.46 }, iw = I.x1 - I.x0, ih = I.y1 - I.y0;
    if (!bif || bif.width !== Math.round(iw) || bif.height !== Math.round(ih)) bif = bifurcation(Math.max(2, Math.round(iw)), Math.max(2, Math.round(ih)));
    bctx.drawImage(bif, I.x0, I.y0);
    const u = (t / 20000) % 1, r = 2.5 + u * 1.5, rx = I.x0 + u * iw; let x = 0.5 + 0.3 * Math.sin(t / 1300); for (let n = 0; n < 40; n++) x = r * x * (1 - x);
    const gl = bctx.createRadialGradient(rx, I.y1, 4, rx, I.y1, ih); gl.addColorStop(0, 'rgba(61,214,198,0.18)'); gl.addColorStop(1, 'rgba(61,214,198,0)'); bctx.fillStyle = gl; bctx.fillRect(0, 0, W, H);
    bctx.strokeStyle = r < 3.5699 ? '#F5C542' : '#FF5FB0'; bctx.lineWidth = 1 * d; bctx.globalAlpha = 0.7; bctx.beginPath(); bctx.moveTo(rx, I.y0); bctx.lineTo(rx, I.y1); bctx.stroke();
    for (let n = 0; n < 12; n++) { x = r * x * (1 - x); const py = I.y1 - 2 - x * (ih - 4); bctx.fillStyle = '#fff'; bctx.globalAlpha = 0.9 - n * 0.07; bctx.beginPath(); bctx.arc(rx, py, (2.6 - n * 0.15) * d, 0, 7); bctx.fill(); }
    bctx.fillStyle = '#FFE08A'; bctx.globalAlpha = 0.9; bctx.font = `${Math.round(11 * d)}px ui-monospace, monospace`; bctx.textAlign = 'left'; bctx.textBaseline = 'top'; bctx.fillText(`r ${r.toFixed(2)}`, Math.min(rx + 4 * d, I.x1 - 40 * d), I.y0 - 14 * d);
    // symmetry: the same fractal tree left and right, mirror images, swaying together
    bctx.strokeStyle = '#C9B8FF'; bctx.globalAlpha = 0.5; const sway = Math.sin(t / 1700) * 0.12, tl = H * 0.06;
    tree(W * 0.14, H * 0.22, -Math.PI / 2, tl, 6, sway); tree(W * 0.86, H * 0.22, -Math.PI / 2, tl, 6, -sway);
    // the golden spiral, turning above, its φ rectangles faint behind it
    bctx.save(); bctx.translate(cx, H * 0.1); bctx.rotate(t / 6000); bctx.strokeStyle = '#F5C542'; bctx.globalAlpha = 0.6; bctx.lineWidth = 1.2 * d;
    { let a = 0, rr = 2 * d; bctx.beginPath(); for (let i = 0; i < 160; i++) { a += 0.1; rr *= Math.pow(PHI, 0.1 / (Math.PI / 2)); bctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); if (rr > H * 0.11) break; } bctx.stroke(); }
    bctx.globalAlpha = 0.16; for (let i = 1; i < 6; i++) { const w2 = 6 * d * Math.pow(PHI, i); bctx.strokeRect(-w2 / 2, -w2 / PHI / 2, w2, w2 / PHI); }
    bctx.restore();
    // Fibonacci: rings of 1, 1, 2, 3, 5, 8… dots pulse out from the centre, one ring a beat
    const beat = Math.floor(t / 700) % FIB.length, ring = FIB[beat], e = (t % 700) / 700, fy = H * 0.34;
    bctx.fillStyle = '#3DD6C6'; bctx.globalAlpha = 0.8 * (1 - e); for (let i = 0; i < ring; i++) { const a = (i / ring) * 6.28 + beat; const rad = (0.03 + 0.16 * e) * H; bctx.beginPath(); bctx.arc(cx + Math.cos(a) * rad, fy + Math.sin(a) * rad, 2 * d, 0, 7); bctx.fill(); }
    bctx.globalAlpha = 1;
    // Fig, in the corner, in the run's mood
    drawPal(S.curve.mood || 'calm', bctx, { x: W - 34 * d, y: H * 0.1 + Math.sin(t / 900) * 3 * d, s: 15 * d, t: t / 1000, r: S.curve.r, face: -1 });
  }
  let last = 0;
  function loop(t) {
    if (!$('over').hidden) drawBox(t);
    const dt = Math.min(0.05, last ? (t - last) / 1000 : 0); last = t;
    if (running && !S.over) {
      S.time += dt;
      S.beatT += dt; const bl = active.beat || 1; while (S.beatT >= bl && !S.over) { S.beatT -= bl; beat(); }
      if (S.comboT > 0) { S.comboT -= dt; if (S.comboT <= 0) S.combo = 0; }
      if (!S.over) active.update(dt);
      if (resetPending && !S.over) resetOrgan();
      if (Math.abs(zoom - zoomTo) > 0.001 || Math.abs(widen - widenTo) > 0.001) { const e = Math.min(1, dt * 1.5); zoom += (zoomTo - zoom) * e; widen += (widenTo - widen) * e; if (Math.abs(zoom - zoomTo) < 0.002) zoom = zoomTo; if (Math.abs(widen - widenTo) < 0.002) widen = widenTo; size(); }   // 🔍 the board eases out, wider faster than taller
      if (lens) { lens.t += dt; if (lens.t >= lens.dur) clearLens(); }
      hud();
    }
    if (host.ox > 0 || host.oy > 0) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = getComputedStyle(stage).getPropertyValue('--bg').trim() || '#0B0918'; ctx.fillRect(0, 0, cv.width, cv.height); }   // zoomed out: the margins in the organ's colour
    ctx.setTransform(host.k, 0, 0, host.k, host.ox, host.oy);
    (active || organs[0]).draw(t);
    if (transition) {   // the old world zooms away from where you were, and the new one is underneath
      transition.t += dt; const p = Math.min(1, transition.t / transition.dur), e = p * p * (3 - 2 * p);
      const ax = (transition.anchor?.x ?? host.W / 2) * host.k + host.ox, ay = (transition.anchor?.y ?? host.H / 2) * host.k + host.oy, z = 1 + e * (transition.why === 'golden' ? 6 : 2.2);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1 - e; ctx.translate(ax, ay); ctx.scale(z, z); ctx.translate(-ax, -ay); ctx.drawImage(transition.snap, 0, 0); ctx.restore();
      if (p >= 1) transition = null;
    }
    if (glitchT > 0) { glitchT -= dt; if (!reduceMotion) tear(); if (glitchT <= 0) { applyTheme(); active?.glitch?.(false); } }
    if (!reduceMotion) drawFigfx(dt);
    if (lens?.kind === 'wire') wireframe();
    requestAnimationFrame(loop);
  }
  // ---------------------------------------------------------------- start and end
  function resetOrgan() {   // the organ's lives are gone: it starts over, easy, and the run pays a heart
    const how = resetPending; resetPending = null; S.lives[active.key] = 3; S.hearts -= 1; S.how = how;
    if (S.hearts <= 0) { over(how); return; }
    active.start(); active.enter(null, null); applyTheme(); host.ui(''); calm = 0; if (isCalm(active.key)) openCalm();
    banner(`🔁 ${active.name.toUpperCase()} STARTS OVER · ❤️ −1`, `${how} · the run has ${S.hearts} ${S.hearts === 1 ? 'heart' : 'hearts'} left`); sfx('buzz'); navigator.vibrate?.(80);
  }
  function startRun() {
    S.score = 0; S.hearts = 3; S.lives = {}; resetPending = null; S.combo = 0; S.comboT = 0; S.tally = {}; S.curve = makeCurve(); S.beatT = 0; S.beats = 0; S.over = false; S.how = null; S.time = 0; S.morphs = 0;
    tenure = 0; prev = null; transition = null; lastUsed = new Map(); zoom = zoomTo = 1; widen = widenTo = 1; clearLens(); size();
    organs.forEach((o) => o.start());
    active = organs[Math.floor(Math.random() * organs.length)]; active.enter(null, null); applyTheme(); calm = 0;
    $('over').hidden = true; running = true; sfx('click'); pal.wake(); pal.set({ r: S.curve.r, mood: 'calm' }); applyPalTheme('calm'); $('spal').hidden = false;
    banner(`${active.icon} ${active.name.toUpperCase()}`, morphs ? `${active.verb} · the curve will morph the world` : active.verb);
    if (isCalm(active.key)) setTimeout(() => { if (running && !S.over && active && isCalm(active.key)) openCalm(); }, 1800);
  }
  async function over(how) {
    if (S.over) return; S.over = true; S.how = how; running = false; $('verb').hidden = true; host.ui(''); pal.sleep(); clearLens();
    const [t1, sub] = active.overText?.(how) || ['GAME OVER', ''];
    sfx(how === 'sleeps' ? 'fanfare' : 'lose');
    showOver(`<h2 style="color:#FF9A8A">${esc(t1)}</h2>${sub ? `<p class="muted small">${esc(sub)}</p>` : ''}<h2>${icon} ${S.score.toLocaleString()} points</h2><p class="muted small">saving…</p>`);
    const level = Math.max(1, Math.min(99, morphs ? 1 + S.morphs : active.level?.() || 1));
    const { data, error } = await sb.rpc('solo_submit', { p_game: key, p_score: S.score, p_level: level, p_events: S.tally });
    const board = data?.top?.length ? `<ol class="board">${data.top.map((r, i) => `<li class="${r.player === me.id ? 'me' : ''}"><span>${i + 1}. ${esc(r.name)}</span><b>${r.score.toLocaleString()}</b></li>`).join('')}</ol>` : '';
    const stats = organs.map((o) => o.endStats?.()).filter(Boolean).join(' · ');
    showOver(`<h2 style="color:#FF9A8A">${esc(t1)}</h2>${sub ? `<p class="muted small">${esc(sub)}</p>` : ''}<h2>${icon} ${S.score.toLocaleString()} points</h2>${data?.record ? '<p style="color:var(--gold);font-weight:900">🏆 Your new best!</p>' : data ? `<p class="muted small">Your best: ${data.best.toLocaleString()}</p>` : ''}
      <p class="muted small">${esc(stats)}${morphs ? ` · ${S.morphs} morph${S.morphs === 1 ? '' : 's'}` : ''} · chaos reached r = ${S.curve.r.toFixed(2)}</p>
      ${data?.chaos ? `<p class="small">${ratingLine(data.chaos)}</p>` : ''}
      ${error ? `<p class="small" style="color:#FF9A7A">Couldn't save: ${esc(error.message || '')}</p>` : ''}${board}
      <button class="go" id="again">${esc(again)}</button>`);
  }
  function showOver(html) { $('overCard').innerHTML = html; $('over').hidden = false; const a = $('again'); if (a) a.onclick = startRun; }
  // ---------------------------------------------------------------- input: the shell listens, the organ decides
  const toWorld = (e) => { const r = cv.getBoundingClientRect(); const sx = cv.width / r.width, sy = cv.height / r.height; let x = ((e.clientX - r.left) * sx - host.ox) / host.k; if (lens?.kind === 'mirror') x = host.W - x; return { x: Math.max(0, Math.min(host.W, x)), y: Math.max(0, Math.min(host.H, ((e.clientY - r.top) * sy - host.oy) / host.k)) }; };   // through the zoom-out (and a mirror lens), clamped to the world
  const fwd = (type) => (e) => { if (type === 'down') e.preventDefault(); if (running && !S.over && active) { const p = toWorld(e); if (type === 'down') host.cue('look', p.x, p.y); else if (type === 'move' && (e.buttons || e.touches)) pal.set({ face: p.x < host.W * 0.3 ? -1 : 1 }); active.pointer(type, p, e); } };   // Fig's eyes follow your finger
  cv.addEventListener('pointerdown', fwd('down')); cv.addEventListener('pointermove', fwd('move'));
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => cv.addEventListener(ev, fwd('up')));
  addEventListener('keydown', (e) => { if (running && !S.over) active?.keydown?.(e); });
  addEventListener('keyup', (e) => { if (running && !S.over) active?.keyup?.(e); });
  window.__shell = () => ({ organ: active?.key, prev: prev?.key, calm, glitch: glitchT > 0, mood: S.curve.mood, stage: stageOf() + 1, zoom, widen, W: host.W, lens: lens?.kind || null, H: host.H, oy: host.oy, cw: cv.getBoundingClientRect().width, k: host.k, ox: host.ox, theme: stage.style.getPropertyValue('--bg'), score: S.score, hearts: S.hearts, combo: S.combo, beats: S.beats, morphs: S.morphs, r: S.curve.r, n: S.curve.n, window: S.curve.window, over: S.over, tenure, running, transition: !!transition, lives: { ...S.lives },
    tally: { ...S.tally }, force: (why) => { if (why === 'glitch') return glitchRun(); if (why.startsWith('lens:')) return putLens(why.slice(5), 3); if (why === 'stage') { S.beats = STAGES[Math.min(3, stageOf() + 1)].beats; zoomTo = STAGES[stageOf()].zoom; widenTo = STAGES[stageOf()].widen; return; } const to = why === 'mirror' && prev ? prev : nextOrgan(); morphTo(to, why); }, over: S.over, end: (how) => over(how), hurt: () => host.hurt('test') });
  // ---------------------------------------------------------------- go
  (async () => {
    if (!(await signedIn())) return;
    setGameTools({ fs: '#play' });
    size(); addEventListener('resize', size);
    new MutationObserver(() => requestAnimationFrame(size)).observe($('play'), { attributes: true, attributeFilter: ['class'] });
    organs.forEach((o) => o.init(host));
    const { data: top } = await sb.from('solo_scores').select('player, score').eq('game', key).order('score', { ascending: false }).limit(40);
    const best = {}; (top || []).forEach((r) => { if (!(r.player in best)) best[r.player] = r.score; });
    const board = Object.entries(best).slice(0, 5);
    showOver(`<h2>${icon} ${esc(title)}</h2>${morphs ? `<div class="organs">${organs.map((o) => `<span title="${esc(o.name)}">${o.icon}</span>`).join('')}</div>` : ''}${intro}
      ${board.length ? `<ol class="board">${board.map(([p, s], i) => `<li class="${p === me.id ? 'me' : ''}"><span>${i + 1}. ${esc(names[p] ?? '?')}</span><b>${s.toLocaleString()}</b></li>`).join('')}</ol>` : ''}
      <button class="go" id="again">Start ${icon}</button>`);
    requestAnimationFrame(loop);
  })();
}
