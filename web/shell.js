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
import { makeCurve, stepCurve, drawMeter, meterText, NEWS, tally, ratingLine, CALM, isCalm, CHAOS, EDGE_SAY } from './chaos.js';
import { palWidget, PAL } from './pals.js';
import { resident, residentNow } from './studio.js';

const SHELL_CSS = `
  .shud{position:absolute;left:0;right:0;top:0;display:flex;justify-content:space-between;align-items:flex-start;padding:8px 10px;pointer-events:none;font-weight:900;text-shadow:0 2px 4px #000c}
  .shud .score{font-family:var(--display,inherit);font-size:24px;line-height:1}
  .shud .combo{color:var(--gold,#F5C542);font-size:14px}
  .shud .lvl{font-size:13px;color:var(--muted,#ccc)}
  .shud .hearts{font-size:14px;letter-spacing:1px}
  .chaosm{display:flex;flex-direction:column;align-items:flex-end;gap:2px;font-size:11px;letter-spacing:.06em;text-transform:uppercase}
  .chaosm canvas{width:92px;height:34px;background:#0008;border-radius:8px}
  .spal{position:absolute;left:4px;top:76px;width:60px;height:60px;pointer-events:none;filter:drop-shadow(0 4px 8px #000a)}   /* under the score, off the field (Hilltop's tank lives bottom-left) */
  .verb{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none;font-size:12px;font-weight:900;text-shadow:0 2px 4px #000c;max-width:calc(100% - 140px)}   /* centred, clear of the field's edges and the weapon bar */
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
  .sbanner{position:absolute;left:50%;top:22%;transform:translateX(-50%);width:max-content;max-width:94%;pointer-events:none;font-family:var(--display,inherit);font-size:clamp(22px,7vw,40px);color:var(--bannerc,#FFE08A);-webkit-text-stroke:1.5px #000a;paint-order:stroke fill;text-shadow:0 4px 0 #0008,0 0 30px var(--gold,#F5C542);white-space:nowrap;animation:bpop .45s cubic-bezier(.2,1.6,.4,1) both;text-align:center}
  .sbanner small{display:block;font-family:var(--body,inherit);font-weight:900;font-size:15px;-webkit-text-stroke:0;color:#fff;text-shadow:0 2px 4px #000;white-space:normal;line-height:1.25}
  @keyframes bpop{from{transform:translateX(-50%) scale(.3);opacity:0}}
  .sover{position:absolute;inset:0;display:grid;place-items:center;background:radial-gradient(circle at 50% 40%,#0008,#000d);padding:16px;text-align:center;overflow:auto}
  .sover .card{max-width:360px;display:flex;flex-direction:column;gap:12px;align-items:center}
  .sover p{margin:0}
  .sover .muted{color:var(--muted,#ccc)} .sover .small{font-size:13px}
  .sover .board{list-style:none;margin:0;padding:0;width:100%;max-width:280px;display:flex;flex-direction:column;gap:4px;text-align:left}
  .sover .board li{display:flex;justify-content:space-between;padding:6px 10px;border-radius:10px;background:#0006}
  .sover .board li.me{outline:2px solid var(--gold,#F5C542)}
  .sover .organs{display:flex;gap:10px;justify-content:center;font-size:28px}
  @media (prefers-reduced-motion:reduce){.sbanner{animation:none}.verb b.next{animation:none}}`;

export function runShell({ organs, key, title, icon, intro, again = 'Play again', W = 400 }) {
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
    <div class="sover" id="over"><div class="card" id="overCard"></div></div>`);
  const meter = $('meter');
  // ---------------------------------------------------------------- shared state
  const S = { score: 0, hearts: 3, combo: 0, comboT: 0, tally: {}, curve: makeCurve(), beatT: 0, beats: 0, over: false, how: null, time: 0, morphs: 0 };
  let active = null, prev = null, transition = null, tenure = 0, lastUsed = new Map(), running = false;
  // 🧘 calm within the chaos: beats left in the hold a calm organ (CALM.organs) opens on entry
  let calm = 0;
  // ⚡ a glitch: seconds left of the flicker a held peak sets off (the theme is another organ's meanwhile)
  let glitchT = 0;
  function glitchRun() { if (S.over) return; glitchT = 1.1; const others = organs.filter((o) => o !== active && o.theme); const th = others[Math.floor(Math.random() * others.length)]; if (th) applyTheme(th.theme); active.glitch?.(true, pal.pal); pal.hurt(); sfx('buzz'); banner(NEWS.glitch[0], `${PAL[pal.pal].name}'s mind flickers: nothing changed. Probably.`); }
  function tear() {   // slices of the frame shoved sideways, and a colour band, for the glitch's life
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i < 5; i++) { const y = Math.random() * cv.height, h = (6 + Math.random() * 34) * host.dpr, dx = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 18) * host.dpr; ctx.drawImage(cv, 0, y, cv.width, h, dx, y, cv.width, h); }
    ctx.globalCompositeOperation = 'difference'; ctx.globalAlpha = 0.35; ctx.fillStyle = ['#3DD6C6', '#FF5A4A', '#B9A6FF'][Math.floor(Math.random() * 3)]; ctx.fillRect(0, Math.random() * cv.height, cv.width, (4 + Math.random() * 20) * host.dpr);
    ctx.restore();
  }
  const openCalm = () => { if (!isCalm(active?.key)) { calm = 0; return; } calm = CALM.RUN_HOLD; banner(`🧘 ${PAL[pal.pal].name.toUpperCase()} TAKES A BREATH`, `calm within the chaos: r holds and nothing twists · ${calm} beats`); pal.force('gift', 1.6); };
  // 🎨 the resident pal sits in the corner and feels every beat (pals.js; who it is: the Design Studio)
  const pal = palWidget($('spal'), { pal: residentNow(), s: 22, own: false, dpr: 2 }); resident().then((k) => pal.set({ pal: k }));
  const host = {
    cv, ctx, W, H: 640, k: 1, dpr: 1, reduceMotion, S, sfx, morphs,
    banner, add: (pts) => { S.score += Math.max(0, Math.round(pts)); },
    heal: (n = 1) => { S.hearts = Math.min(3, S.hearts + n); },
    hurt: (how) => { S.hearts -= 1; S.combo = 0; S.comboT = 0; pal.hurt(); if (S.hearts <= 0) { over(how); return true; } return false; },
    over, ui: (html) => { $('oui').innerHTML = html || ''; return $('oui'); },
    organ: () => active?.key, activeBeat: () => active?.beat || 1,
  };
  // ---------------------------------------------------------------- sizing
  function size() {
    const fs = !!document.querySelector('#play.fs-on');
    const r = stage.getBoundingClientRect();
    const w = r.width, h = fs ? innerHeight : Math.max(420, innerHeight - r.top - 12);
    host.dpr = Math.min(2, devicePixelRatio || 1);
    cv.style.height = `${h}px`; cv.width = Math.round(w * host.dpr); cv.height = Math.round(h * host.dpr);
    host.k = cv.width / W; host.H = cv.height / host.k;
    organs.forEach((o) => o.resize?.());
  }
  // ---------------------------------------------------------------- banners, HUD
  let bannerT = null;
  function banner(t, sub) {
    const b = $('banner'); b.innerHTML = `${esc(t)}${sub ? `<small>${esc(sub)}</small>` : ''}`; b.hidden = false;
    b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    clearTimeout(bannerT); bannerT = setTimeout(() => { b.hidden = true; }, 1700);
  }
  const nextOrgan = () => organs[(organs.indexOf(active) + 1) % organs.length];
  const minTenure = () => (S.curve.r >= 3.5699 ? 3 : 6);
  function hud() {
    $('score').textContent = S.score.toLocaleString();
    const hearts = '❤️'.repeat(Math.max(0, S.hearts)) + '🖤'.repeat(Math.max(0, 3 - S.hearts)); if ($('hearts').textContent !== hearts) $('hearts').textContent = hearts;
    $('combo').textContent = S.combo > 1 && S.comboT > 0 ? `COMBO ×${S.combo}` : '';
    $('lvl').textContent = active?.hudLine?.() || '';
    $('phase').textContent = meterText(S.curve);
    drawMeter(meter, S.curve);
    const v = $('verb');
    if (!active || !running) { v.hidden = true; return; }
    const armed = morphs && tenure >= minTenure() - 1 && !S.curve.window && calm <= 0;
    v.hidden = false;
    v.innerHTML = `<b>${active.icon} ${esc(active.verb)}</b>${morphs ? `<b class="${armed ? 'next' : ''}">${calm > 0 ? `🧘 calm · ${calm} beat${calm === 1 ? '' : 's'} · r holds` : S.curve.window ? '🔁 the window: it rotates every beat' : armed ? `⚡ next: ${nextOrgan().icon} ${esc(nextOrgan().verb)}` : `${S.morphs} morph${S.morphs === 1 ? '' : 's'}`}</b>` : ''}`;
  }
  // ---------------------------------------------------------------- the beat and the morphs
  function beat() {
    const held = calm > 0;
    const ev = stepCurve(S.curve, { hold: held, pal: pal.pal }); S.beats += 1; tenure += 1; tally(ev, S.tally);   // 🧭 your companion's edges
    if (held) { calm -= 1; if (calm === CALM.WARN) { banner(...NEWS.again); sfx('tick'); } else if (ev.glitch) glitchRun(); }
    pal.set({ r: S.curve.r }); pal.react(ev);
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
  let last = 0;
  function loop(t) {
    const dt = Math.min(0.05, last ? (t - last) / 1000 : 0); last = t;
    if (running && !S.over) {
      S.time += dt;
      S.beatT += dt; const bl = active.beat || 1; while (S.beatT >= bl && !S.over) { S.beatT -= bl; beat(); }
      if (S.comboT > 0) { S.comboT -= dt; if (S.comboT <= 0) S.combo = 0; }
      if (!S.over) active.update(dt);
      hud();
    }
    ctx.setTransform(host.k, 0, 0, host.k, 0, 0);
    (active || organs[0]).draw(t);
    if (transition) {   // the old world zooms away from where you were, and the new one is underneath
      transition.t += dt; const p = Math.min(1, transition.t / transition.dur), e = p * p * (3 - 2 * p);
      const ax = (transition.anchor?.x ?? W / 2) * host.k, ay = (transition.anchor?.y ?? host.H / 2) * host.k, z = 1 + e * (transition.why === 'golden' ? 6 : 2.2);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1 - e; ctx.translate(ax, ay); ctx.scale(z, z); ctx.translate(-ax, -ay); ctx.drawImage(transition.snap, 0, 0); ctx.restore();
      if (p >= 1) transition = null;
    }
    if (glitchT > 0) { glitchT -= dt; if (!reduceMotion) tear(); if (glitchT <= 0) { applyTheme(); active?.glitch?.(false); } }
    requestAnimationFrame(loop);
  }
  // ---------------------------------------------------------------- start and end
  function startRun() {
    S.score = 0; S.hearts = 3; S.combo = 0; S.comboT = 0; S.tally = {}; S.curve = makeCurve(); S.beatT = 0; S.beats = 0; S.over = false; S.how = null; S.time = 0; S.morphs = 0;
    tenure = 0; prev = null; transition = null; lastUsed = new Map();
    organs.forEach((o) => o.start());
    active = organs[Math.floor(Math.random() * organs.length)]; active.enter(null, null); applyTheme(); calm = 0;
    $('over').hidden = true; running = true; sfx('click'); pal.wake(); pal.set({ r: S.curve.r }); $('spal').hidden = false;
    banner(`${active.icon} ${active.name.toUpperCase()}`, morphs ? `${active.verb} · the curve will morph the world` : active.verb);
    setTimeout(() => { if (running && !S.over) banner(`🧭 ${PAL[pal.pal].name.toUpperCase()} RIDES WITH YOU`, EDGE_SAY[pal.pal]); }, 2000);   // what your companion bends
    if (isCalm(active.key)) setTimeout(() => { if (running && !S.over && active && isCalm(active.key)) openCalm(); }, 1800);
  }
  async function over(how) {
    if (S.over) return; S.over = true; S.how = how; running = false; $('verb').hidden = true; host.ui(''); pal.sleep();
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
  const toWorld = (e) => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * host.H }; };
  const fwd = (type) => (e) => { if (type === 'down') e.preventDefault(); if (running && !S.over && active) active.pointer(type, toWorld(e), e); };
  cv.addEventListener('pointerdown', fwd('down')); cv.addEventListener('pointermove', fwd('move'));
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => cv.addEventListener(ev, fwd('up')));
  addEventListener('keydown', (e) => { if (running && !S.over) active?.keydown?.(e); });
  addEventListener('keyup', (e) => { if (running && !S.over) active?.keyup?.(e); });
  window.__shell = () => ({ organ: active?.key, prev: prev?.key, calm, glitch: glitchT > 0, theme: stage.style.getPropertyValue('--bg'), score: S.score, hearts: S.hearts, combo: S.combo, beats: S.beats, morphs: S.morphs, r: S.curve.r, n: S.curve.n, window: S.curve.window, over: S.over, tenure, running, transition: !!transition,
    tally: { ...S.tally }, force: (why) => { if (why === 'glitch') return glitchRun(); const to = why === 'mirror' && prev ? prev : nextOrgan(); morphTo(to, why); }, over: S.over, end: (how) => over(how), hurt: () => host.hurt('test') });
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
