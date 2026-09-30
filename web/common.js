// Shared by the game pages (golf.html, duel.html): the Supabase client, who's signed in,
// player names, which players are robots, and turn alerts.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from './config.js';
import { sfx, isMuted, setMuted } from './sfx.js';
import { drawPal, palWidget, PAL, PALS } from './pals.js';
// 🎨 the resident (who lives in r4box; studio.js keeps it in localStorage). r4box is its mind: the curve
// is its mood, so it shows up wherever the curve does: the 🌀 button, the curve box, a glitch, a calm.
export function palKey() { try { const k = localStorage.getItem('r4.pal'); if (k && PAL[k]) return k; } catch {} return PALS[0].key; }
export const palName = () => PAL[palKey()].name;
// This player's companion, kept in localStorage for the next page. Quiet on any failure: the last known one stands.
async function refreshResident() {
  try {
    const { data } = await sb.rpc('design_tally', { p_topic: 'resident' }); if (!Array.isArray(data)) return;
    const mine = data.find((r) => r.player === me.id)?.choice;   // 🧭 my companion (077); nothing picked yet: Fig house-sits
    localStorage.setItem('r4.pal', mine && PAL[mine] ? mine : PALS[0].key);
  } catch {}
}
// the mood a game's last move put the resident in, read off the curve row
function curveMood(cv) { const h = cv?.hist || [], x = h[h.length - 1], x0 = h[h.length - 2]; if (x == null) return null; if (cv.hold > 0) return 'gift'; if (x > CHAOS.GOLD) return 'gold'; if (x0 != null && Math.abs(x - (1 - x0)) < CHAOS.MIRROR) return 'mirror'; if (Math.abs(x - CHAOS.CUT) < CHAOS.CUT_TOL) return 'golden'; if (x > CHAOS.PEAK) return 'peak'; if (x < CHAOS.GIFT) return 'gift'; return null; }
import { CHAOS, CALM, isCalm } from './chaos.js';   // 🌀 the box: CHAOS.md
export { sfx };
import { THEMES, vesselSVG } from './bs-themes.js';

// ---------------------------------------------------------------- full screen for the game area
// A page puts fsButton('#someId') inside the part of the page that is the game. On phones
// the button makes just that part cover the screen (browser bars hidden where the browser
// allows it; iPhone Safari keeps its bars but the game still fills the rest).
export const fsButton = (target) => `<button type="button" class="fsbtn" data-fs="${target}" aria-label="Full screen">⛶</button>`;
const fsStyle = document.createElement('style');
fsStyle.textContent = `
  .fsbtn{width:40px;height:40px;border-radius:12px;border:1.5px solid #ffffff55;background:#141026cc;color:#fff;font-size:20px;line-height:1;padding:0;cursor:pointer}
  @media (pointer:fine){.fsbtn{display:none!important}}
  .fs-on{position:fixed!important;inset:0;z-index:60;margin:0!important;max-width:none!important;width:auto!important;overflow:auto;overscroll-behavior:contain;
    background:var(--bg,#101024);box-sizing:border-box;padding:max(8px,env(safe-area-inset-top)) max(8px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left))}
  body.fs-lock{overflow:hidden}
`;
document.head.appendChild(fsStyle);
const fsNative = () => document.fullscreenElement || document.webkitFullscreenElement;
function fsLabels() {
  const on = !!document.querySelector('.fs-on');
  document.body.classList.toggle('fs-lock', on);
  document.querySelectorAll('[data-fs]').forEach((b) => { b.textContent = on ? '✕' : '⛶'; b.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen'); });
}
// Native full screen puts the game area on the browser's top layer, above everything else in the
// page whatever its z-index, so the toolbar and Settings ride inside it while it's on.
// overlayHost(): where a page's overlays go. In native full screen only the full-screen element is
// shown, so anything added to <body> (a splash, Battleship's effects canvas, a kraken, a stamp) is
// invisible until it's put inside it. fsHost moves the long-lived ones over when full screen toggles.
export const overlayHost = () => document.querySelector('.fs-on') || document.body;
function fsHost() {
  const host = overlayHost();
  ['gameTools', 'fx', 'dangerV', 'dramaSplash', 'nextJump'].forEach((id) => { const el = document.getElementById(id); if (el && el.parentElement !== host) host.appendChild(el); });
}
function fsSync() { fsHost(); fsLabels(); fit(); dispatchEvent(new Event('resize')); }   // fit: the toolbar is slimmer in full screen
export function fsExit() {
  document.querySelectorAll('.fs-on').forEach((el) => el.classList.remove('fs-on'));
  if (fsNative()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
  fsSync();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-fs]');
  if (!b) return;
  if (document.querySelector('.fs-on')) return fsExit();
  const el = document.querySelector(b.dataset.fs);
  if (!el) return;
  el.classList.add('fs-on');
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  try { req?.call(el, { navigationUI: 'hide' })?.catch?.(() => {}); } catch {}
  fsSync();
});
const fsChanged = () => { if (!fsNative() && document.querySelector('.fs-on') && (document.fullscreenEnabled || document.webkitFullscreenEnabled)) fsExit(); else fsSync(); };
document.addEventListener('fullscreenchange', fsChanged); document.addEventListener('webkitfullscreenchange', fsChanged);
// The page redrew the game area: keep its button's label right.
export const fsRefresh = () => fsLabels();

// ---------------------------------------------------------------- the toolbar
// One cluster pinned to the top-right corner of every page: ⚙️ Settings always, and in a game
// 🤖 live-vs-robot (when the robot plays), ⛶ full screen (touch screens) and 🗑 delete (the
// game's creator). It stays on top in full screen by riding inside the full-screen element
// (fsHost). The page's top row (class gtop) leaves room for it (--gtw).
// setGameTools({ fs, canDelete, onDelete, bot }) shows the game buttons; setGameTools(null) hides
// them. onDelete() returns an error message, or nothing when the game is gone.
// bot: { on, label, onToggle } — onToggle() flips it and returns an error message or nothing.
// ---------------------------------------------------------------- the loader: x → r·x·(1−x)
// While a page loads, the chaos curve plays itself: r sweeps from calm to chaos, a cobweb walks x
// round the parabola (settling, then flipping, then lost), and the bifurcation diagram draws itself
// underneath, one r at a time. It goes when the page first shows its tools (setGameTools), or 6 s.
const loaderEl = (() => {
  if (!document.body) return null;
  const el = document.createElement('div'); el.id = 'chaosLoader'; el.setAttribute('role', 'status'); el.setAttribute('aria-label', 'Loading');
  el.style.cssText = 'position:fixed;inset:0;z-index:200;background:radial-gradient(ellipse at 50% 35%,#1C1640,#0B0918 70%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#fff;font:700 15px/1.3 system-ui,sans-serif;transition:opacity .35s';
  el.innerHTML = '<canvas width="560" height="700" style="width:min(300px,72vw);height:auto"></canvas><div style="font:800 22px/1 system-ui,sans-serif;letter-spacing:.02em">x → r·x·(1−x)</div><div class="lr" style="opacity:.7;font-size:13px;font-variant-numeric:tabular-nums">r = 2.80</div>';
  document.body.appendChild(el);
  const cv = el.querySelector('canvas'), c = cv.getContext('2d'), W = 560, top = 460, bif = document.createElement('canvas');
  bif.width = W; bif.height = 220; const b = bif.getContext('2d');
  const R0 = 2.8, R1 = 4, still = matchMedia('(prefers-reduced-motion: reduce)').matches, t0 = performance.now();
  let col = 0;
  const plotCol = (px) => {   // one column of the diagram: where x settles for this r
    const r = R0 + ((R1 - R0) * px) / (W - 1); let x = 0.5;
    for (let i = 0; i < 200; i++) x = r * x * (1 - x);
    b.fillStyle = r >= 3.5699 ? '#FF8A3D55' : '#3DD6C6aa';
    for (let i = 0; i < 90; i++) { x = r * x * (1 - x); b.fillRect(px, (1 - x) * 219, 1.4, 1.4); }
  };
  const frame = (now) => {
    if (!el.isConnected) return;
    const k = still ? 1 : ((now - t0) / 5200) % 1, r = R0 + (R1 - R0) * k;
    if (still) while (col < W) plotCol(col++);
    else { const upto = Math.floor(k * W); if (upto < col) { b.clearRect(0, 0, W, 220); col = 0; } while (col <= upto && col < W) plotCol(col++); }
    c.clearRect(0, 0, W, 700);
    // the cobweb: y = r·x·(1−x) against y = x, x stepping from 0.2
    const P = 40, S = top - 2 * P, X = (v) => P + v * S, Y = (v) => top - P - v * S;
    c.strokeStyle = '#ffffff22'; c.lineWidth = 2; c.strokeRect(P, P, S, S);
    c.strokeStyle = '#ffffff55'; c.beginPath(); c.moveTo(X(0), Y(0)); c.lineTo(X(1), Y(1)); c.stroke();
    c.strokeStyle = '#B9A6FF'; c.lineWidth = 4; c.beginPath();
    for (let i = 0; i <= 60; i++) { const v = i / 60; c[i ? 'lineTo' : 'moveTo'](X(v), Y(r * v * (1 - v))); } c.stroke();
    let x = 0.2; c.lineWidth = 2.5; c.beginPath(); c.moveTo(X(x), Y(0));
    for (let i = 0; i < 70; i++) { const y = r * x * (1 - x); c.lineTo(X(x), Y(y)); c.lineTo(X(y), Y(y)); x = y; }
    c.strokeStyle = r >= 3.5699 ? '#FF8A3Dcc' : '#3DD6C6cc'; c.stroke();
    let palKey = 'fig'; try { palKey = localStorage.getItem('r4.pal') || 'fig'; } catch {}
    drawPal(palKey, c, { x: X(x), y: Y(x), s: 20, t: now / 1000, r, face: 1 });   // the resident rides the cobweb
    // the diagram, and where r is on it
    c.drawImage(bif, 0, top + 10); c.fillStyle = '#fff'; c.fillRect(Math.min(W - 3, k * W), top + 6, 3, 228);
    el.querySelector('.lr').textContent = `r = ${r.toFixed(2)} · ${r < 3 ? 'calm' : r < 3.449 ? 'a rhythm of 2' : r < 3.5699 ? '4, 8, 16…' : 'chaos'}`;
    if (!still) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  setTimeout(() => loaderDone(), 6000);
  return el;
})();
export function loaderDone() {
  if (!loaderEl?.isConnected || loaderEl.dataset.out) return;
  loaderEl.dataset.out = '1'; loaderEl.style.opacity = '0'; loaderEl.style.pointerEvents = 'none';
  setTimeout(() => loaderEl.remove(), 380);
}
let tools = null, toolsOpts = null;
const toolsCss = document.createElement('style');
toolsCss.textContent = `
  #gameTools{position:fixed;top:calc(10px + env(safe-area-inset-top,0px));right:calc(10px + env(safe-area-inset-right,0px));z-index:71;display:flex;gap:8px;align-items:center}
  #gameTools .gtb{position:relative;width:40px;height:40px;border-radius:12px;border:1.5px solid #ffffff55;background:#141026cc;color:#fff;font-size:19px;line-height:1;padding:0;cursor:pointer;display:grid;place-items:center;box-shadow:0 4px 12px #0004}
  #gameTools .gtb[hidden]{display:none}
  #gameTools .gtb.del.armed{width:auto;padding:0 14px;font-size:14px;font-weight:800;background:#C0392B;border-color:#C0392B;white-space:nowrap}
  #gameTools .gtb.bot[aria-pressed=true]{background:#C0392B;border-color:#FF8A7A;box-shadow:0 0 12px #FF5A4A99}
  #gameTools .gtb.bot b{position:absolute;right:-6px;bottom:-7px;padding:1px 4px;border-radius:6px;font-size:9px;font-weight:900;letter-spacing:.04em;background:#141026;color:#fff;border:1px solid #ffffff55}
  #gameTools .gtb.bot[aria-pressed=true] b{background:#FFC857;color:#2A2100;border-color:#FFC857}
  #gameTools .gtb:disabled{opacity:.6}
  #gameTools .gtb.chaos canvas{width:32px;height:32px;display:block}
  body.fs-lock #gameTools .gtb.chaos canvas{width:28px;height:28px}
  #curveBox{box-sizing:border-box;position:fixed;top:calc(58px + env(safe-area-inset-top,0px));right:calc(10px + env(safe-area-inset-right,0px));z-index:86;width:min(380px,calc(100vw - 20px));background:#141026f5;color:#fff;border:1px solid #ffffff33;border-radius:14px;box-shadow:0 14px 34px #0009;padding:12px 12px 10px;font:600 13.5px/1.4 system-ui,sans-serif}
  #curveBox h3{margin:0 0 2px;font:800 17px/1.2 system-ui,sans-serif}
  #curveBox canvas{width:100%;height:auto;display:block;border-radius:10px;margin:8px 0;background:#0B0918}
  #curveBox p{margin:4px 0;opacity:.85}
  #curveBox .ph{color:#3DD6C6;font-weight:900}
  #gameTools .gtb.news b{position:absolute;right:-6px;top:-7px;min-width:17px;height:17px;padding:0 4px;border-radius:99px;font-size:10.5px;font-weight:900;background:#F2C230;color:#2A2100;display:grid;place-items:center}
  #gameTools .gtb.news.ping{animation:newsPing .9s ease-out 2}
  @keyframes newsPing{0%{box-shadow:0 0 0 0 #F2C230aa}100%{box-shadow:0 0 0 12px #F2C23000}}
  #newsBox{position:fixed;top:calc(58px + env(safe-area-inset-top,0px));right:calc(10px + env(safe-area-inset-right,0px));z-index:86;width:min(360px,calc(100vw - 20px));max-height:min(60vh,420px);overflow:auto;background:#141026f5;color:#fff;border:1px solid #ffffff33;border-radius:14px;box-shadow:0 14px 34px #0009;padding:6px}
  #newsBox h3{margin:6px 8px 4px;font:800 13px/1.2 system-ui,sans-serif;opacity:.75;text-transform:uppercase;letter-spacing:.06em}
  #newsBox li{list-style:none;display:flex;gap:10px;align-items:flex-start;padding:8px;border-radius:10px;font:600 14px/1.35 system-ui,sans-serif}
  #newsBox li+li{border-top:1px solid #ffffff14}
  #newsBox li span:first-child{font-size:22px;line-height:1}
  #newsBox ul{margin:0;padding:0}
  .gtop{padding-right:var(--gtw,56px)}
  /* No strip kept empty for the toolbar: the game starts at the top, and its top row leaves room on
     the right for the toolbar (--gtw is its width; each game's page says which row that is). */
  body.fs-lock .fs-on{padding-top:calc(8px + env(safe-area-inset-top,0px))}
  /* ...and the page's own ← row goes too (✕ leaves full screen); a title moved into it stays */
  body.fs-lock .fs-on .gtop > a:first-child, body.fs-lock .fs-on .gtop > #back{display:none!important}
  body.fs-lock .fs-on .gtop:not(:has(.intop)), body.fs-lock .fs-on nav.gtop:not(:has(.intop)){display:none!important}
  /* Full screen, every game the same: no Settings or Delete (those wait outside full screen, and a
     game's own settings come later), and what's left (news, next up, robot, leave full screen) sits in
     one slim see-through strip in the corner. */
  body.fs-lock #gameTools{top:calc(6px + env(safe-area-inset-top,0px));right:calc(6px + env(safe-area-inset-right,0px));gap:2px;padding:3px;border-radius:14px;background:#0E0C2270;border:1px solid #ffffff26;box-shadow:0 4px 14px #0005;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
  body.fs-lock #gameTools #setBtn, body.fs-lock #gameTools .del{display:none!important}
  body.fs-lock #gameTools .gtb{width:34px;height:34px;border-radius:10px;font-size:16px;background:transparent;border-color:transparent;box-shadow:none}
  body.fs-lock #gameTools .gtb:hover{background:#ffffff1a}
  body.fs-lock #gameTools .gtb.bot[aria-pressed=true]{background:#C0392Bcc;border-color:transparent}
  body.fs-lock #gameTools .gtb.bot b{right:-3px;bottom:-4px;font-size:8px}
  body.fs-lock #gameTools .gtb.news b{right:-3px;top:-4px;min-width:15px;height:15px;font-size:9.5px}
  body.fs-lock #gameTools #nextUp.intools{height:34px!important;font-size:13px!important;border-radius:10px!important;box-shadow:none!important}
  @media (pointer:fine){#gameTools .fsbtn{display:none!important}}
  /* Phones: the top row is ← · title · toolbar (condenseTop moves the title in) */
  @media (max-width:640px){
    .gtop{min-height:46px;align-items:center!important;gap:8px;flex-wrap:nowrap!important;margin-bottom:4px}
    .gtop > a:first-child, .gtop > #back{font-size:0!important;flex:none;text-decoration:none;width:34px;height:40px;display:grid;place-items:center;border-radius:12px}
    .gtop > a:first-child::before, .gtop > #back::before{content:'←';font-size:24px;line-height:1;font-weight:700}
    .gtop #live, .gtop > .live{display:none!important}
    .gtop .intop{flex:1;min-width:0;margin:0!important}
    .gtop h1.intop, .gtop .intop h1, .gtop .intop h2{font-size:19px!important;line-height:1.15;margin:0!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .gtop .intop .small, .gtop .intop .eyebrow{font-size:11px!important;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
    .hdrgone{display:none!important}
    #gtbar:empty{display:none}
    header.stack:has(> .gtop){gap:6px}
  }`;
document.head.appendChild(toolsCss);
function settingsButton() {
  if (tools) return;
  tools = document.createElement('div'); tools.id = 'gameTools'; tools.setAttribute('role', 'toolbar'); tools.setAttribute('aria-label', 'Tools');
  tools.innerHTML = `<button type="button" class="gtb chaos" hidden aria-label="The chaos curve" title="The chaos curve: x → r·x·(1−x)"><canvas width="64" height="64"></canvas></button>`
    + `<button type="button" class="gtb news" hidden aria-label="News" title="News">🔔<b></b></button>`
    + `<button type="button" class="gtb bot" hidden aria-pressed="false">🤖<b>OFF</b></button>`
    + `<button type="button" class="gtb fsbtn" data-fs="" hidden aria-label="Full screen">⛶</button>`
    + `<button type="button" class="gtb del" hidden aria-label="Delete this game" title="Delete this game">🗑</button>`
    + `<button type="button" class="gtb" id="setBtn" aria-label="Settings" title="Settings">⚙️</button>`;
  (document.body || document.documentElement).appendChild(tools);
  tools.querySelector('#setBtn').onclick = openSettings;
  tools.querySelector('.news').onclick = toggleNews;
  tools.querySelector('.chaos').onclick = toggleCurve;
  const del = tools.querySelector('.del');
  let t = null;
  const disarm = () => { clearTimeout(t); delete del.dataset.armed; del.classList.remove('armed'); del.textContent = '🗑'; del.setAttribute('aria-label', 'Delete this game'); fit(); };
  del.onclick = async () => {
    if (!del.dataset.armed) {
      del.dataset.armed = '1'; del.classList.add('armed'); del.textContent = '🗑 Delete for everyone?'; del.setAttribute('aria-label', 'Tap again to delete the game for everyone');
      fit(); t = setTimeout(disarm, 4000); return;
    }
    clearTimeout(t); del.disabled = true;
    const err = await toolsOpts?.onDelete?.();
    del.disabled = false;
    if (err) { disarm(); note(err, 'error'); }
  };
  const bot = tools.querySelector('.bot');
  bot.onclick = async () => {
    const b = toolsOpts?.bot; if (!b) return;
    bot.disabled = true;
    const err = await b.onToggle();
    bot.disabled = false;
    if (err) note(err, 'error');
    else note(!b.on ? `⚔️ ${b.label}: on. No turns, fire at will!` : `${b.label}: off. Back to taking turns.`);
  };
  fit();
}
// Phones: move a page's title (el) into its top row next to ←, and hide what that makes redundant.
export function condenseTop(el, hide = []) {
  if (!el || !isPhone()) return;
  const top = document.querySelector('.gtop'); if (!top) return;
  el.classList.add('intop'); top.insertBefore(el, top.children[1] || null);
  hide.forEach((h) => h?.classList.add('hdrgone'));
}
export function setGameTools(opts) {
  loaderDone();   // the page is up
  settingsButton();
  toolsOpts = opts;
  const host = document.querySelector('.fs-on') || document.body;
  if (tools.parentElement !== host) host.appendChild(tools);   // re-attach after a page redraw
  const fsb = tools.querySelector('[data-fs]'), del = tools.querySelector('.del'), bot = tools.querySelector('.bot');
  fsb.dataset.fs = opts?.fs || ''; fsb.hidden = !opts?.fs;
  del.hidden = !opts?.canDelete;
  bot.hidden = !opts?.bot;
  curveFor(opts?.chaos);
  if (opts?.bot) {
    bot.setAttribute('aria-pressed', String(!!opts.bot.on));
    bot.querySelector('b').textContent = opts.bot.on ? 'LIVE' : 'OFF';
    bot.setAttribute('aria-label', `${opts.bot.label}: ${opts.bot.on ? 'on' : 'off'}`); bot.title = `${opts.bot.label}: ${opts.bot.on ? 'on' : 'off'}`;
  }
  showNews(); fsLabels(); fit();
}
function fit() {
  if (!tools) return;
  requestAnimationFrame(() => {
    const t = tools.getBoundingClientRect();
    document.documentElement.style.setProperty('--gtw', `${Math.ceil(t.width) + 16}px`);
    // Phones: line the top row up with the toolbar (it's pinned at the very top).
    const row = document.querySelector('.gtop');
    if (row && isPhone() && !document.querySelector('.fs-on') && scrollY < 4) {
      row.style.marginTop = '';
      // A tall row (the lobby's header: the mark, a name, the avatars) lines its top up instead of its middle.
      const r = row.getBoundingClientRect(), shift = r.height > t.height + 8 ? Math.round(t.top - r.top) : Math.round((t.top + t.height / 2) - (r.top + r.height / 2));
      if (shift < 0) row.style.marginTop = `${shift}px`;
    }
  });
}

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const me = { id: null, username: null };
export const names = {};          // profile id -> username
export const bots = new Set();    // profile ids of robot players

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Live chaos battles (Battleship, Putt Post): check in with the server every 3 s while the page
// is showing, leave when it's hidden or closed. onChange(true) when everyone is here (turns stop),
// onChange(false) when someone leaves. The duel has its own (duel_here).
export function livePresence(kind, gameId, onChange) {
  let on = false, stopped = false;
  const set = (v) => { if (v !== on) { on = v; onChange(v); } };
  const tick = async (here = true) => {
    if (stopped && here) return;
    const { data, error } = await sb.rpc('live_here', { p_kind: kind, p_game: gameId, p_on: here });
    if (here && !error && !stopped) set(!!data);
  };
  const vis = () => { if (document.hidden) { set(false); tick(false); } else tick(); };
  const bye = () => tick(false);
  const iv = setInterval(() => { if (!document.hidden) tick(); }, 3000);
  document.addEventListener('visibilitychange', vis);
  addEventListener('pagehide', bye);
  tick();
  return {
    get on() { return on; },
    stop() { if (stopped) return; stopped = true; clearInterval(iv); document.removeEventListener('visibilitychange', vis); removeEventListener('pagehide', bye); tick(false); },
  };
}

// Player pictures, by username: a file in web/avatars/, or an emoji. Anyone without one gets their initial.
const AVATARS = { phoenix_lord: 'avatars/phoenix_lord.jpg', dad_commander: '😎', obanai_rocks: '🐍' };
export const avatarOf = (username) => AVATARS[username] || null;   // a picture path, an emoji, or null
export function avatar(p, cls = 'avatar') {
  if (p?.bot) return `<span class="${cls}" aria-hidden="true">🤖</span>`;
  const a = AVATARS[p?.username], u = p?.username ? ` data-u="${esc(p.username)}"` : '';   // data-u: painted live/away (paintOnline)
  if (a && a.includes('/')) return `<img class="${cls} pic"${u} src="${a}" alt="">`;
  if (a) return `<span class="${cls} emo"${u} aria-hidden="true">${a}</span>`;
  return `<span class="${cls}"${u} aria-hidden="true">${esc(String(p?.username || '?')[0].toUpperCase())}</span>`;
}
// A small round face beside a player's name in the games (sized to the text around it). Nothing
// for the robot, whose name already says 🤖. Styles itself, so every page gets it.
export function face(id, uname = names[id], isBot = bots.has(id)) {
  if (isBot || !uname) return '';
  if (!document.getElementById('faceCss')) {
    const st = document.createElement('style'); st.id = 'faceCss';
    st.textContent = `.face{display:inline-grid;place-items:center;width:1.45em;height:1.45em;border-radius:50%;vertical-align:-.38em;margin-right:.3em;overflow:hidden;line-height:1;font-weight:700;font-style:normal;flex:none;background:linear-gradient(160deg,#F2C230,#E0892F);color:#2A2100;box-shadow:0 0 0 1.5px #ffffff55}
.face.emo{font-size:.9em;width:1.6em;height:1.6em;background:#ffffff26}
img.face{object-fit:cover;background:#000;box-shadow:0 0 0 1.5px #E8B84A}`;
    document.head.appendChild(st);
  }
  return avatar({ username: uname }, 'face');
}
export const nm = (id) => (bots.has(id) ? '🤖 ' : '') + esc(names[id] ?? 'someone');
export const friendly = (err) => (err?.message || String(err)).replace(/^.*?ERROR:\s*/, '');

// ---------------------------------------------------------------- who's live
// Every page checks in every 15 s with where it is (here_now, 021). Anyone whose avatar is on
// screen gets a green ring while they're live, and a glowing one while they're at your table;
// pages that list people (the lobby's Who's here) listen for the 'online' event.
export const online = {};   // username -> { id, u, live, page, game, seen_at }
let onlineMe = null, onlineTimer = null, paintQueued = false;
export function wherePage() {
  const file = location.pathname.split('/').pop() || 'index.html';
  const game = (location.hash.match(/game=([0-9a-f-]{36})/) || [])[1] || null;
  const kind = { 'golf.html': 'golf', 'duel.html': 'duel', 'cards.html': 'cards' }[file];
  return kind ? { page: kind, game } : game ? { page: 'battleship', game } : { page: 'lobby', game: null };
}
async function checkIn(away = false) {
  const w = wherePage();
  const { data, error } = await sb.rpc('here_now', { p_page: w.page, p_game: w.game, p_away: away });
  if (error || !Array.isArray(data)) return;
  Object.keys(online).forEach((k) => delete online[k]);
  data.forEach((r) => { online[r.u] = r; });
  paintOnline();
  dispatchEvent(new Event('online'));
}
export function paintOnline() {
  paintQueued = false;
  const here = wherePage().game;
  document.querySelectorAll('[data-u]').forEach((el) => {
    const r = online[el.dataset.u], mine = el.dataset.u === onlineMe;
    const on = !mine && !!r?.live, at = on && !!here && r.game === here;
    el.classList.toggle('is-on', on); el.classList.toggle('is-here', at);
    if (!mine) el.title = at ? `${el.dataset.u} is here now` : on ? `${el.dataset.u} is live` : '';
  });
}
export function startOnline(username) {
  onlineMe = username;
  if (onlineTimer) return;
  const st = document.createElement('style');
  st.textContent = `[data-u].is-on{outline:2.5px solid #3DDC84;outline-offset:1.5px}
[data-u].is-here{outline:3px solid #3DDC84;outline-offset:2px}
@media (prefers-reduced-motion:no-preference){[data-u].is-here{animation:hereGlow 1.8s ease-in-out infinite}}
@keyframes hereGlow{50%{outline-color:#3DDC8466;outline-offset:3.5px}}`;
  document.head.appendChild(st);
  checkIn();
  onlineTimer = setInterval(() => { if (!document.hidden) checkIn(); }, 15000);
  document.addEventListener('visibilitychange', () => checkIn(document.hidden));
  addEventListener('pagehide', () => checkIn(true));
  addEventListener('hashchange', () => checkIn());
  // Pages re-render all the time; paint new avatars as they appear.
  new MutationObserver(() => { if (!paintQueued) { paintQueued = true; requestAnimationFrame(paintOnline); } })
    .observe(document.body, { childList: true, subtree: true });
}
// "5m ago" / "3h ago" / "2d ago".
export function agoText(t) {
  const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
  return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
}

// Loads the signed-in player, or sends them to the sign-in page.
export async function signedIn() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.href = './'; return false; }
  const [{ data: profiles }, { data: botRows }] = await Promise.all([
    sb.from('profiles').select('id, username'),
    sb.from('bots').select('profile_id'),
  ]);
  (profiles ?? []).forEach((p) => { names[p.id] = p.username; });
  (botRows ?? []).forEach((b) => bots.add(b.profile_id));
  me.id = session.user.id; me.username = names[me.id];
  startOnline(me.username);
  refreshResident();   // 🎨 who lives in r4box, so a game page opened first on a fresh device still shows the right one
  // Join realtime as this player (not anonymously), or row-level security hides every change.
  try { await sb.realtime.setAuth(session.access_token); } catch {}
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  return true;
}

// Ask the server to send "your turn" alerts. Never blocks the game.
export function notify(kind, gameId) {
  sb.functions.invoke('notify', { body: { game_id: gameId, kind } }).catch(() => {});
  nudge();
}

// Keeps a game page live three ways, so a move shows up even if one path drops:
// database changes over realtime, a direct "I moved" nudge from the other player's page,
// and a light check every few seconds (and whenever the page comes back into view).
let liveCh = null;
export function nudge() { liveCh?.send({ type: 'broadcast', event: 'moved', payload: {} }).catch?.(() => {}); }
// `extra` maps more broadcast events (like a duel's live aiming) to handlers; send(event, payload) sends one.
export function liveGame(topic, changes, onChange, check, extra = {}) {
  liveCh = sb.channel(topic, { config: { broadcast: { self: false } } });
  changes.forEach((c) => liveCh.on('postgres_changes', { schema: 'public', ...c }, onChange));
  liveCh.on('broadcast', { event: 'moved' }, onChange);
  Object.entries(extra).forEach(([event, fn]) => liveCh.on('broadcast', { event }, (m) => fn(m.payload || {})));
  liveCh.subscribe((s) => { const el = document.getElementById('live'); if (el) el.textContent = s === 'SUBSCRIBED' ? '● Live' : 'Reconnecting…'; });
  setInterval(() => { if (!document.hidden) check(); }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) onChange(); });
  addEventListener('online', onChange);
  return { send: (event, payload) => { liveCh.send({ type: 'broadcast', event, payload }).catch?.(() => {}); } };
}

// ---------------------------------------------------------------- chaos: loot, curses, twists
export const ITEMS = {
  sonar: { icon: '📡', name: 'Sonar Ping', game: 'battleship', desc: 'Reveal ship squares in a 3×3 patch.' },
  sierpinski: { icon: '🔺', name: 'Sierpiński Salvo', game: 'battleship', desc: 'Tap the top of a triangle: up to 9 extra shots in a fractal, a triangle with a triangle-shaped hole in it.' },
  salvo: { icon: '🎆', name: 'Double Salvo', game: 'battleship', desc: 'Fire two extra shots this turn.' },
  golden_tee: { icon: '🏌️', name: 'Golden Tee', game: 'golf', desc: 'One free, honest mulligan this hole.' },
  magnet: { icon: '🧲', name: 'Magnet Cup', game: 'golf', desc: 'A huge, grabby cup for this hole.' },
  chip: { icon: '⛳', name: 'Chip Shot', game: 'golf', desc: 'Your next putt flies over walls, hedges, bumpers, water and sand, then lands and rolls.' },
  atk_ice: { icon: '🧊', name: 'Ice Rink', game: 'golf', desc: "Sneak attack on everyone else: their green freezes and every putt slides much farther." },
  atk_wind: { icon: '🌬️', name: 'Gusty Wind', game: 'golf', desc: 'Sneak attack on everyone else: a crosswind shoves their ball sideways.' },
  atk_cup: { icon: '🕳️', name: 'Tiny Cup', game: 'golf', desc: 'Sneak attack on everyone else: their cup shrinks and only takes gentle putts.' },
  atk_bumpers: { icon: '💥', name: 'Surprise Bumpers', game: 'golf', desc: 'Sneak attack on everyone else: two bumpers pop up beside their cup.' },
  atk_butter: { icon: '🧈', name: 'Butterfingers', game: 'golf', desc: 'Sneak attack on everyone else: their putter loses a third of its power.' },
  shield: { icon: '🛡️', name: 'Shield', game: 'duel', desc: 'Halves the next hit on your tank.' },
  bertha: { icon: '💣', name: 'Big Bertha', game: 'duel', desc: 'Your next shell has a monster blast.' },
  cluster: { icon: '🎆', name: 'Cluster Bomb', game: 'duel', desc: 'Bursts at the top of its arc into three bomblets.' },
  fractal: { icon: '❄️', name: 'Fractal Shell', game: 'duel', desc: 'At the top of its arc it forks in two, and every branch forks again, three times: up to 8 bomblets spraying out like a tree.' },
  homing: { icon: '🚀', name: 'Homing Missile', game: 'duel', desc: 'Curves toward their tank on the way down. Smaller blast.' },
  railgun: { icon: '⚡', name: 'Railgun', game: 'duel', desc: 'A straight beam through hills: aim only, no power. 45 on a direct hit.' },
  dirt: { icon: '🪨', name: 'Dirt Bomb', game: 'duel', desc: 'Piles up a hill where it lands: build a wall, or block their shot.' },
  foxhole: { icon: '🕳️', name: 'Foxhole', game: 'duel', desc: 'Dig in where you stand: blasts do 40% less to you until you drive out.' },
  buster: { icon: '🔻', name: 'Bunker Buster', game: 'duel', desc: 'Drills down where it lands and goes off underground: breaks into tunnels.' },
  drone: { icon: '🚁', name: 'Drone Strike', game: 'duel', desc: 'Pick a spot on the map (tap it, or slide Drop): a drone flies over and drops a bomb straight down. Mind the wind.' },
  xray: { icon: '👀', name: 'X-Ray Specs', game: 'cards', desc: "Peek at one opponent's hand." },
  paint: { icon: '🎨', name: 'Paint Bomb', game: 'cards', desc: 'Set the colour in play to any colour you like.' },
  trash: { icon: '🗑️', name: 'Trash Chute', game: 'cards', desc: 'Throw away one card from your hand (3 or more in hand).' },
  gift: { icon: '🎁', name: 'Gift Box', game: 'cards', desc: 'Hand one of your cards to an opponent (3 or more in hand).' },
  scroll: { icon: '📜', name: 'Curse Scroll', game: 'any', desc: 'Hex any player in a random game of theirs.' },
};

export async function backpack() {
  const { data } = await sb.from('loot').select('*').is('used_at', null).order('id');
  return data ?? [];
}
export async function useLoot(id, gameId = null, target = null, cell = null) {
  return sb.rpc('use_loot', { p_loot: id, p_game: gameId, p_target: target, p_cell: cell });
}

// Pops up chaos news (loot, curses, twists, Gauntlet rounds) one after another, then marks it seen.
let toastQueue = Promise.resolve();
// Two calls at once (the lobby makes them) share one fetch, and no event is shown twice.
let chaosBusy = null; const chaosShown = new Set();
export function announceChaos(filter = {}) {
  if (chaosBusy) return chaosBusy;
  chaosBusy = announceChaosNow(filter).finally(() => { chaosBusy = null; });
  return chaosBusy;
}
async function announceChaosNow(filter) {
  let q = sb.from('chaos_events').select('*').is('seen_at', null).order('id').limit(8);
  if (filter.gameId) q = q.eq('game_id', filter.gameId);
  let { data } = await q;
  data = (data || []).filter((e) => !chaosShown.has(e.id)); data.forEach((e) => chaosShown.add(e.id));
  if (!data.length) return [];
  const gl = data.find((e) => String(e.kind).startsWith('glitch'));   // ⚡ somebody's companion leaks through a calm: the page flickers their way
  if (gl) glitch(1100, { pal: String(gl.kind).split(':')[1] || palKey(), who: gl.actor ? names[gl.actor] || null : null });
  await sb.rpc('chaos_seen', { p_ids: data.map((e) => e.id) });
  // In a game, news doesn't pop up over the board (unless Settings says so): it waits in the 🔔.
  if (onGamePage() && !pref('gamePopups', false)) { data.forEach((e) => news.unshift(e)); newsUnread += data.length; showNews(true); return data; }
  // Quietly: the same news once (×n), two toasts at most, the rest as one "+n more" line.
  const groups = [];
  data.forEach((e) => { const g = groups.find((x) => x.message === e.message && x.icon === e.icon); if (g) g.n += 1; else groups.push({ ...e, n: 1 }); });
  groups.slice(0, 2).forEach((e) => { toastQueue = toastQueue.then(() => toast(e.icon, e.n > 1 ? `${e.message} ×${e.n}` : e.message, e.kind)); });
  const rest = groups.slice(2).reduce((a, e) => a + e.n, 0);
  if (rest) toastQueue = toastQueue.then(() => toast('🌀', `+${rest} more chaos news`, 'twist', true));
  return data;
}
// ⚡ A glitch (CHAOS.md § Calm): for a second the page tears, the theme swaps for another game's,
// tanks and cards turn into squirrels (pages listen for 'chaosglitch' and draw the swap themselves;
// cards do it in CSS). Nothing in the rules changes. Reduced motion: only the theme swap.
const WORLDS = [['#0F2A22', '#18433A'], ['#15122E', '#231F4A'], ['#0B2A22', '#0F3A2D'], ['#14200E', '#1E2E15'], ['#0B0A1F', '#161433'], ['#0A1626', '#12243A']];
let glitchTimer = null;
export function glitch(ms = 1100, { pal = palKey(), who = null } = {}) {
  pal = PAL[pal] ? pal : palKey();
  if (!document.getElementById('glitchCss')) {
    const st = document.createElement('style'); st.id = 'glitchCss';
    st.textContent = `@keyframes r4tear{0%{filter:none;transform:none}8%{filter:hue-rotate(160deg) saturate(2.2) contrast(1.4);transform:translate(-4px,1px)}18%{filter:invert(1) hue-rotate(60deg);transform:translate(5px,-2px) skewX(-2deg)}28%{filter:none;transform:none}52%{filter:hue-rotate(-120deg) saturate(3);transform:translate(3px,0)}62%{filter:contrast(2) brightness(1.3);transform:translate(-3px,2px) skewX(2deg)}72%,100%{filter:none;transform:none}}
body.glitch{animation:r4tear 1.1s steps(1) 1}
body.glitch .card > b,body.glitch .card > small{font-size:0!important}body.glitch .card > b::after{content:var(--glitch-icon,'🐿️');font-size:26px;line-height:1}
@keyframes r4mirror{0%,100%{transform:none;filter:none}12%,68%{transform:scaleX(-1);filter:hue-rotate(40deg)}80%{transform:none;filter:invert(1)}}
body.glitch.glitch-kit{animation:r4mirror 1.1s steps(1) 1}
@keyframes r4zoom{0%{transform:none}20%{transform:scale(1.08);filter:contrast(1.5)}45%{transform:scale(.94)}70%{transform:scale(1.04);filter:contrast(1.5) hue-rotate(90deg)}100%{transform:none;filter:none}}
body.glitch.glitch-bit{animation:r4zoom 1.1s steps(1) 1}
@keyframes r4spiral{0%{transform:none;filter:none}25%{transform:rotate(-6deg) scale(1.03);filter:sepia(.7) saturate(2.2)}55%{transform:rotate(5deg) scale(1.02);filter:sepia(.7) saturate(2.2) hue-rotate(-20deg)}100%{transform:none;filter:none}}
body.glitch.glitch-phi{animation:r4spiral 1.1s steps(1) 1}
#glitchTag{position:fixed;left:50%;top:38%;transform:translate(-50%,86px);z-index:96;pointer-events:none;padding:4px 12px;border-radius:99px;background:#0B0918dd;color:#fff;font:800 13px/1.2 system-ui,sans-serif;white-space:nowrap;border:1px solid #ffffff33}
@keyframes r4blink{50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){body.glitch{animation:none}#glitchPal{animation:none}}`;
    document.head.appendChild(st);
  }
  const cur = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase();
  const pick = WORLDS.filter(([bg]) => bg.toLowerCase() !== cur), [bg, panel] = pick[Math.floor(Math.random() * pick.length)];
  const root = document.documentElement.style;
  ['--bg', '--panel', '--paper', '--bg-2', '--felt'].forEach((v) => root.setProperty(v, v === '--bg' || v === '--bg-2' ? bg : panel));
  document.body.classList.remove('glitch', 'glitch-fig', 'glitch-kit', 'glitch-bit', 'glitch-phi'); void document.body.offsetWidth; document.body.classList.add('glitch', `glitch-${pal}`);
  root.setProperty('--glitch-icon', `'${PAL[pal].icon}'`);
  sfx('buzz');
  // the resident blinks through, dizzy: it's its mind glitching
  document.getElementById('glitchPal')?.remove();
  const gp = document.createElement('canvas'); gp.id = 'glitchPal'; gp.width = 320; gp.height = 320; gp.setAttribute('aria-hidden', 'true');
  gp.style.cssText = 'position:fixed;left:50%;top:38%;width:160px;height:160px;transform:translate(-50%,-50%);z-index:96;pointer-events:none;filter:drop-shadow(0 8px 20px #000c);animation:r4blink .18s steps(2) infinite';
  (document.querySelector('.fs-on') || document.body).appendChild(gp);
  const w = palWidget(gp, { pal, s: 48, own: false, r0: 4, dpr: 2 }); w.hurt();
  document.getElementById('glitchTag')?.remove();
  const tag = document.createElement('div'); tag.id = 'glitchTag'; tag.textContent = who ? `${who}'s ${PAL[pal].name}` : PAL[pal].name; gp.after(tag);   // whose companion this is
  setTimeout(() => { w.stop(); gp.remove(); tag.remove(); }, ms);
  const until = Date.now() + ms;
  window.dispatchEvent(new CustomEvent('chaosglitch', { detail: { until, pal, who } }));
  clearTimeout(glitchTimer);
  glitchTimer = setTimeout(() => { document.body.classList.remove('glitch', `glitch-${pal}`); ['--bg', '--panel', '--paper', '--bg-2', '--felt', '--glitch-icon'].forEach((v) => root.removeProperty(v)); }, ms);
}
// The game-page news (🔔): what came in during play, newest first, for this visit to the page.
const news = []; let newsUnread = 0;
const onGamePage = () => !!toolsOpts?.fs || /(duel|golf|cards)\.html$/.test(location.pathname) || /game=/.test(location.hash);
function showNews(fresh = false) {
  const b = tools?.querySelector('.news'); if (!b) return;
  b.hidden = !onGamePage() || !news.length;
  b.querySelector('b').textContent = newsUnread ? String(Math.min(99, newsUnread)) : '';
  b.querySelector('b').hidden = !newsUnread;
  b.setAttribute('aria-label', newsUnread ? `News: ${newsUnread} new` : 'News');
  if (fresh && newsUnread) { b.classList.remove('ping'); void b.offsetWidth; b.classList.add('ping'); sfx('tick'); }
  fit();
}
// ---------------------------------------------------------------- the chaos curve (058)
// Every game carries the logistic map x → r·x·(1−x) (chaos_curve): r climbs a little every move, and a
// move twists when x lands above 0.75. The 🌀 button draws x's recent values; tapped, it shows the
// bifurcation diagram (itself a fractal: every split repeats the whole in miniature) with this game's r.
let curve = null, curveKey = '', curveAt = 0;
const CURVE_T = CHAOS.PEAK;
const curvePhase = (r) => (r < 3 ? ['Calm', 'x settles on one value below the line, so no twists yet']
  : r < 3.449 ? ['A rhythm of 2', 'x flips between two values: a twist every other move']
  : r < 3.544 ? ['A rhythm of 4', 'the curve split again: twists in a four-move beat']
  : r < 3.5699 ? ['8, 16, 32…', 'period doubling, faster and faster: the rhythm is falling apart']
  : ['CHAOS', 'no rhythm left. Tiny differences grow huge, and no one can say what comes next']);
async function curveFor(c) {
  const btn = tools?.querySelector('.chaos'); if (!btn) return;
  if (!c?.id) { btn.hidden = true; curve = null; curveKey = ''; fit(); return; }
  const key = `${c.kind}:${c.id}`;
  if (key !== curveKey) { curveKey = key; curve = null; curveAt = 0; }
  if (Date.now() - curveAt < 1500) return drawCurveBtn();
  curveAt = Date.now();
  const { data } = await sb.from('chaos_curve').select('n, r, x, hist, hold').eq('game_id', c.id).maybeSingle();
  if (curveKey !== key) return;
  curve = data || { n: 0, r: 2.9, x: null, hist: [] };
  drawCurveBtn(); if (document.getElementById('curveBox')) drawCurveBox();
}
function drawCurveBtn() {
  const btn = tools?.querySelector('.chaos'); if (!btn) return;
  const was = btn.hidden; btn.hidden = !curveKey; if (was !== btn.hidden) fit();
  if (!curve) return;
  const [ph] = curvePhase(curve.r); btn.title = curve.hold > 0 ? `🧘 Calm within the chaos: r holds at ${curve.r.toFixed(2)} for ${curve.hold} more move${curve.hold === 1 ? '' : 's'}. Tap for more.` : `The chaos curve: ${ph} (r ${curve.r.toFixed(2)}). Tap for more.`;
  const c = btn.querySelector('canvas').getContext('2d'), W = 64, H = 64, pts = (curve.hist || []).slice(-14);
  c.clearRect(0, 0, W, H);
  c.strokeStyle = '#FF5A4A99'; c.lineWidth = 2; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(4, H - 6 - CURVE_T * (H - 12)); c.lineTo(W - 4, H - 6 - CURVE_T * (H - 12)); c.stroke(); c.setLineDash([]);
  if (!pts.length) { c.font = '34px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('🌀', W / 2, H / 2 + 2); return; }
  const X = (i) => 6 + (i * (W - 12)) / Math.max(1, pts.length - 1), Y = (v) => H - 6 - v * (H - 12);
  c.strokeStyle = curve.r >= 3.5699 ? '#FF8A3D' : '#3DD6C6'; c.lineWidth = 3; c.lineJoin = 'round'; c.beginPath();
  pts.forEach((v, i) => c[i ? 'lineTo' : 'moveTo'](X(i), Y(v))); c.stroke();
  pts.forEach((v, i) => { if (i === pts.length - 1) return; c.fillStyle = v > CURVE_T ? '#FF5A4A' : '#fff'; c.beginPath(); c.arc(X(i), Y(v), 3, 0, 7); c.fill(); });
  drawPal(palKey(), c, { x: X(pts.length - 1) - 4, y: Y(pts[pts.length - 1]), s: 8, t: performance.now() / 1000, r: curve.r, mood: curveMood(curve), mp: 0.5, face: 1 });   // the resident rides the last move
  if (curve.hold > 0) { c.fillStyle = '#C9FFF8'; c.font = '800 13px system-ui'; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText(`🧘${curve.hold}`, 4, 3); }   // 🧘 held: moves before r climbs again
}
let bifImg = null;
export function bifurcation(W, H, r0, r1) {   // drawn once: 1200 r's, 160 settled x's each
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d'), img = c.createImageData(W, H), d = img.data;
  for (let px = 0; px < W; px++) {
    const r = r0 + ((r1 - r0) * px) / (W - 1); let x = 0.5;
    for (let i = 0; i < 300; i++) x = r * x * (1 - x);
    for (let i = 0; i < 160; i++) { x = r * x * (1 - x); const py = Math.round((1 - x) * (H - 1)), k = (py * W + px) * 4; d[k] = 150; d[k + 1] = 140; d[k + 2] = 255; d[k + 3] = Math.min(255, d[k + 3] + 90); }
  }
  c.putImageData(img, 0, 0); return cv;
}
function drawCurveBox() {
  const box = document.getElementById('curveBox'); if (!box || !curve) return;
  const [ph, say] = curvePhase(curve.r), W = 720, H = 360, r0 = 2.8, r1 = 4;
  box.querySelector('.ph').textContent = ph; box.querySelector('.say').textContent = `${say}. This is ${palName()}'s mind: every move you make is a beat of it`;
  box.querySelector('.num').textContent = curve.hold > 0 ? `🧘 Calm within the chaos: r holds at ${curve.r.toFixed(2)} for ${curve.hold} more move${curve.hold === 1 ? '' : 's'}, and nothing twists. Then here comes that chaos curve again.` : curve.n ? `Move ${curve.n} · r = ${curve.r.toFixed(2)} · x = ${curve.x.toFixed(3)}${curve.x > CURVE_T ? ' → twist!' : ''}` : 'No moves yet: r starts at 2.90.';
  const cv = box.querySelector('canvas'), c = cv.getContext('2d');
  bifImg = bifImg || bifurcation(W, H, r0, r1);
  c.clearRect(0, 0, W, H); c.drawImage(bifImg, 0, 0);
  const Y = (v) => (1 - v) * (H - 1), Xr = (r) => ((r - r0) / (r1 - r0)) * (W - 1);
  c.strokeStyle = '#FF5A4Acc'; c.lineWidth = 2; c.setLineDash([8, 6]); c.beginPath(); c.moveTo(0, Y(CURVE_T)); c.lineTo(W, Y(CURVE_T)); c.stroke(); c.setLineDash([]);
  c.fillStyle = '#FF5A4A'; c.font = '800 20px system-ui'; c.fillText('twist', 8, Y(CURVE_T) - 8);
  c.fillStyle = '#C9B8FF33'; c.fillRect(Xr(CHAOS.WINDOW[0]), 0, Math.max(3, Xr(CHAOS.WINDOW[1]) - Xr(CHAOS.WINDOW[0])), H); c.fillStyle = '#C9B8FF'; c.font = '700 16px system-ui'; c.fillText('window ×3', Xr(CHAOS.WINDOW[0]) - 40, 22);   // 🔁 the period-3 window (the box)
  c.fillStyle = '#ffffff99'; c.font = '700 18px system-ui'; ['3', '3.449', '3.57', '4'].forEach((t) => { const x = Xr(+t); c.fillRect(x, H - 14, 2, 14); c.fillText(t === '3.57' ? 'chaos' : t, Math.min(W - 60, x + 5), H - 4); });
  // this game: r now, and x's last moves (older ones at the r they had then)
  const hist = curve.hist || [], n = curve.n;
  hist.forEach((v, i) => { const r = Math.min(CHAOS.RMAX, CHAOS.R0 + CHAOS.DR * (n - hist.length + 1 + i)), last = i === hist.length - 1;
    c.fillStyle = v > CURVE_T ? '#FF5A4A' : '#3DD6C6'; c.globalAlpha = last ? 1 : 0.35 + (0.5 * i) / hist.length; c.beginPath(); c.arc(Xr(r), Y(v), last ? 9 : 5, 0, 7); c.fill(); });
  c.globalAlpha = 1; c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(Xr(curve.r), 0); c.lineTo(Xr(curve.r), H); c.stroke();
  if (hist.length) drawPal(palKey(), c, { x: Xr(curve.r), y: Y(hist[hist.length - 1]), s: 16, t: performance.now() / 1000, r: curve.r, mood: curveMood(curve), mp: 0.5, face: 1 });   // the resident, where this game is in its mind
}
function toggleCurve() {
  const open = document.getElementById('curveBox');
  if (open) { open.remove(); return; }
  const box = document.createElement('div'); box.id = 'curveBox'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'The chaos curve');
  box.innerHTML = `<h3>🌀 x → r·x·(1−x)</h3><p><span class="ph"></span>: <span class="say"></span>.</p>
    <canvas width="720" height="360" aria-label="The bifurcation diagram of the logistic map, with this game's place on it"></canvas>
    <p class="num"></p><p class="small" style="font-size:12px;opacity:.7">Each move r climbs a little (2.9 → 4) and x takes one step. A move twists when x lands above the red line, except in the violet window, where the chaos runs in threes. A move that lands on the mirror of the last (x ≈ 1 − x before) is ✨ symmetry: a drop. The picture is every value x settles into for each r: watch it split in two, then four, then shatter, and zoom in anywhere in the mess to find the whole picture again.</p>`;
  (document.querySelector('.fs-on') || document.body).appendChild(box);
  curveAt = 0; curveFor(toolsOpts?.chaos); drawCurveBox();
  const close = (ev) => { if (!box.contains(ev.target) && !ev.target.closest?.('.chaos')) { box.remove(); document.removeEventListener('pointerdown', close, true); } };
  setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
}
function toggleNews() {
  const open = document.getElementById('newsBox');
  if (open) { open.remove(); return; }
  const box = document.createElement('div'); box.id = 'newsBox'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'News');
  box.innerHTML = `<h3>News</h3><ul>${news.slice(0, 30).map((e) => `<li><span aria-hidden="true">${e.icon || '🌀'}</span><span></span></li>`).join('')}</ul>`;
  box.querySelectorAll('li span:last-child').forEach((el, i) => { el.textContent = news[i].message; });
  (document.querySelector('.fs-on') || document.body).appendChild(box);
  newsUnread = 0; showNews();
  const close = (ev) => { if (!box.contains(ev.target) && !ev.target.closest?.('.news')) { box.remove(); document.removeEventListener('pointerdown', close, true); } };
  setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
}
function toast(icon, message, kind, quiet = false) {
  return new Promise((done) => {
    let box = document.getElementById('chaosToasts');
    if (!box) {
      box = document.createElement('div'); box.id = 'chaosToasts';
      box.style.cssText = 'position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:80;display:flex;flex-direction:column;gap:6px;width:min(380px,calc(100vw - 32px));pointer-events:none';
      document.body.appendChild(box);
    }
    const colors = { loot: '#F2C230', curse: '#B37BFF', twist: '#3DD6C6', gauntlet: '#FF8A3D' };
    const t = document.createElement('div');
    t.style.cssText = `pointer-events:auto;display:flex;gap:8px;align-items:center;padding:7px 11px;border-radius:12px;background:#141026e0;color:#fff;font:600 13px/1.3 system-ui,sans-serif;box-shadow:0 6px 16px #0006;border:1px solid #ffffff22;border-left:4px solid ${colors[kind] || '#fff'};transform:translateY(12px);opacity:0;transition:transform .3s ease-out,opacity .25s;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)`;
    t.innerHTML = `<span style="font-size:18px;line-height:1">${icon}</span><span style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden"></span>`;
    t.lastChild.textContent = message;
    while (box.children.length >= 2) box.firstChild.remove();   // never more than two on screen
    box.appendChild(t);
    if (!quiet) sfx({ loot: 'chime', curse: 'curse', twist: 'twist', gauntlet: 'birdie' }[kind] || 'pop');
    requestAnimationFrame(() => { t.style.transform = 'none'; t.style.opacity = '1'; });
    setTimeout(done, 900);
    const bye = () => { t.style.opacity = '0'; t.style.transform = 'translateY(-10px)'; setTimeout(() => t.remove(), 300); };
    t.onclick = bye; setTimeout(bye, 3500);
  });
}

// A backpack bar for a game page: the items usable in this game (plus scrolls), as buttons.
export function backpackBarHTML(items, gameKind, enabled, { compact = false } = {}) {
  const usable = items.filter((l) => ITEMS[l.item].game === gameKind);
  if (!usable.length) return '';
  const counts = {}; usable.forEach((l) => { counts[l.item] = (counts[l.item] || []).concat(l.id); });
  // Compact (phones, above the Fire! button): one row of icon buttons with a count badge; the name
  // is still there for screen readers and as a long-press tooltip.
  if (compact) {
    if (!document.getElementById('packMiniCss')) {
      const st = document.createElement('style'); st.id = 'packMiniCss';
      st.textContent = `.packmini{display:flex;align-items:center;gap:8px;overflow-x:auto;scrollbar-width:none;padding:8px 6px 4px 0}
.packmini::-webkit-scrollbar{display:none}
.packmini .pmlabel{flex:none;font-size:12px;line-height:1;opacity:.45;filter:grayscale(1);padding:4px 7px 4px 0;border-right:1px solid #ffffff26}
.packmini button{position:relative;flex:none;width:42px;height:42px;min-height:0;padding:0;border-radius:12px;display:grid;place-items:center;font-size:21px;line-height:1;border:1.5px dashed #F2C23099;background:#F2C23012}
.packmini button[disabled]{opacity:.35}
.packmini button.on{opacity:1;border-style:solid;border-color:#F2C230;background:#F2C23033;box-shadow:0 0 10px #F2C23066}
.packmini button b{position:absolute;right:-5px;top:-6px;min-width:17px;height:17px;padding:0 4px;border-radius:99px;background:#F2C230;color:#2A2100;font-size:10.5px;font-weight:800;display:grid;place-items:center}`;
      document.head.appendChild(st);
    }
    return `<div class="packmini" role="group" aria-label="Backpack"><span class="pmlabel" aria-hidden="true">🎒</span>
      ${Object.entries(counts).map(([item, ids]) => `<button type="button" data-loot="${ids[0]}" data-item="${item}" ${enabled ? '' : 'disabled'} title="${esc(ITEMS[item].name)}: ${esc(ITEMS[item].desc)}" aria-label="${esc(ITEMS[item].name)}${ids.length > 1 ? `, ${ids.length} left` : ''}"><span aria-hidden="true">${ITEMS[item].icon}</span>${ids.length > 1 ? `<b aria-hidden="true">${ids.length}</b>` : ''}</button>`).join('')}
    </div>`;
  }
  return `<div class="backpack" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;border:1.5px dashed #F2C23099;border-radius:14px;padding:10px 12px">
    <span style="font-weight:800;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#F2C230">🎒 Backpack</span>
    ${Object.entries(counts).map(([item, ids]) => `<button type="button" data-loot="${ids[0]}" data-item="${item}" ${enabled ? '' : 'disabled'} title="${esc(ITEMS[item].desc)}">${ITEMS[item].icon} ${ITEMS[item].name}${ids.length > 1 ? ` ×${ids.length}` : ''}</button>`).join('')}
  </div>`;
}

// ---------------------------------------------------------------- "your move" queue
const KIND_ICON = { battleship: '⚓', golf: '⛳', duel: '💥', cards: '🃏' };
const hrefFor = (kind, id) => (kind === 'battleship' ? `./#game=${id}` : `${kind}.html#game=${id}`);
// Every game where it's this player's move, newest first: { kind, id, href, at, players }.
export async function myTurns(meId) {
  const [bs, fl, golf, duel, cardG] = await Promise.all([
    sb.from('games').select('id, players, turn, status, eliminated, updated_at').in('status', ['setup', 'playing']).limit(60),
    sb.from('fleets').select('game_id').eq('player_id', meId),
    sb.from('golf_games').select('id, players, t, status, updated_at').eq('status', 'playing').limit(60),
    sb.from('duel_games').select('id, players, turn, status, updated_at').eq('status', 'playing').limit(60),
    sb.from('card_games').select('id, players, turn, status, updated_at').eq('status', 'playing').limit(60),
  ]);
  const placed = new Set((fl.data ?? []).map((f) => f.game_id)), out = [];
  (bs.data ?? []).forEach((g) => {
    if (!g.players.includes(meId)) return;
    if (g.status === 'setup' ? !placed.has(g.id) : g.players[g.turn] === meId && !g.eliminated.includes(meId)) out.push({ kind: 'battleship', id: g.id, at: g.updated_at, players: g.players });
  });
  (golf.data ?? []).forEach((g) => { if (g.players[g.t % g.players.length] === meId) out.push({ kind: 'golf', id: g.id, at: g.updated_at, players: g.players }); });
  (duel.data ?? []).forEach((g) => { if (g.players[g.turn] === meId) out.push({ kind: 'duel', id: g.id, at: g.updated_at, players: g.players }); });
  (cardG.data ?? []).forEach((g) => { if (g.players[g.turn] === meId) out.push({ kind: 'cards', id: g.id, at: g.updated_at, players: g.players }); });
  out.forEach((x) => { x.href = hrefFor(x.kind, x.id); });
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}
// A chip in the bottom-left corner of a game page: "▶ Next: ⛳ vs Sam +2", linking to the
// next game waiting on you. Call it again whenever things may have changed.
let nextBusy = false;
export async function nextUpChip(meId, currentId, nameOf) {
  if (nextBusy || !meId) return; nextBusy = true;
  try {
    const list = (await myTurns(meId)).filter((x) => x.id !== currentId);
    let chip = document.getElementById('nextUp');
    if (!list.length) { chip?.remove(); return; }
    if (!chip) {
      chip = document.createElement('a'); chip.id = 'nextUp';
      chip.style.cssText = 'position:fixed;left:calc(12px + env(safe-area-inset-left,0px));bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:70;max-width:calc(100vw - 88px);display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:999px;background:#F2C230;color:#2A2100;font:800 15px/1.2 system-ui,sans-serif;text-decoration:none;box-shadow:0 8px 22px #0007;white-space:nowrap;overflow:hidden';
      chip.addEventListener('click', (e) => {
        const u = new URL(chip.getAttribute('href'), location.href);
        if (u.pathname === location.pathname && !/\/(index\.html)?$/.test(u.pathname)) { e.preventDefault(); location.hash = u.hash; location.reload(); }
      });
      document.body.appendChild(chip);
      if (!document.getElementById('nextUpCss')) {
        const st = document.createElement('style'); st.id = 'nextUpCss';
        // Desktop: top center, out of the way of the game (phones keep it bottom-left, by the thumb).
        st.textContent = '#nextUp.intools{position:static!important;height:40px;padding:0 10px!important;gap:5px!important;font-size:15px!important;box-shadow:0 4px 12px #0004!important;max-width:none!important;border-radius:12px!important} body.fs-lock #nextUp{display:none!important} #nextUp:focus-visible{outline:3px solid #fff;outline-offset:2px} @keyframes nudgeIn{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}} #nextUp{animation:nudgeIn .35s ease-out}'
          + ' @media (min-width:1000px) and (min-height:560px){html body #nextUp:not(.intools),html body.has-firebar #nextUp:not(.intools){top:calc(8px + env(safe-area-inset-top,0px))!important;bottom:auto!important;left:0!important;right:0!important;margin:0 auto;width:max-content;max-width:38vw!important;padding:7px 14px!important;font-size:14px!important}}';
        document.head.appendChild(st);
      }
    }
    const n = list[0], vs = n.players.filter((p) => p !== meId).map(nameOf).join(' & ') || 'solo';
    chip.href = n.href;
    // In a game (047) it's a compact button in the top toolbar, beside the 🔔: at the bottom-left it
    // sat on the Putt! bar, Fire! and the backpack. The lobby keeps the full chip by the thumb.
    const tools = onGamePage() && document.getElementById('gameTools');
    chip.classList.toggle('intools', !!tools);
    if (tools && chip.parentElement !== tools) tools.prepend(chip);
    else if (!tools && chip.parentElement !== document.body) document.body.appendChild(chip);
    const more = list.length > 1 ? `<span style="background:#2A2100;color:#F2C230;border-radius:99px;padding:1px ${tools ? 6 : 8}px;font-size:${tools ? 12 : 13}px">+${Math.min(99, list.length - 1)}</span>` : '';
    chip.innerHTML = tools ? `<span>▶ ${KIND_ICON[n.kind]}</span>${more}`
      : `<span>▶ Next:</span><span style="overflow:hidden;text-overflow:ellipsis">${KIND_ICON[n.kind]} vs ${esc(vs)}</span>${more}`;
    chip.title = `Next: ${n.kind} vs ${vs}`;
    chip.setAttribute('aria-label', `Next game waiting on you: ${n.kind} versus ${vs}${list.length > 1 ? `, and ${list.length - 1} more` : ''}`);
  } finally { nextBusy = false; }
}

// ---------------------------------------------------------------- phones: game first
export const isPhone = () => matchMedia('(max-width: 640px)').matches;
// The backpack as a row of icons (not the full panel): phones, and any touch screen whichever way
// it's held. By width alone a redraw while a phone was sideways (or in full screen) swapped in the
// full backpack mid-game.
export const compactPack = () => isPhone() || matchMedia('(pointer: coarse)').matches;
// A section that is open on big screens and folded to a one-line header on phones.
export const foldOpen = () => (isPhone() ? '' : 'open');
// A quick message that pops in at the top and fades, instead of a line of text on the page.
let lastNote = '', lastNoteAt = 0;
export function note(text, tone = '') {
  text = String(text || '').trim();
  if (!text || (text === lastNote && Date.now() - lastNoteAt < 4000)) return;
  lastNote = text; lastNoteAt = Date.now();
  let box = document.getElementById('notes');
  if (!box) {
    box = document.createElement('div'); box.id = 'notes'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    box.style.cssText = 'position:fixed;left:50%;top:calc(58px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:85;display:flex;flex-direction:column;gap:6px;align-items:center;width:min(420px,calc(100vw - 24px));pointer-events:none';
    document.body.appendChild(box);
  }
  while (box.children.length >= 2) box.firstChild.remove();
  const n = document.createElement('div');
  const bg = tone === 'error' ? '#8E1F1Af2' : '#141026ee';
  n.style.cssText = `pointer-events:${onGamePage() ? 'none' : 'auto'};padding:9px 14px;border-radius:12px;background:${bg};color:#fff;font:600 14px/1.35 system-ui,sans-serif;box-shadow:0 8px 20px #0007;text-align:center;opacity:0;transform:translateY(-8px);transition:opacity .2s,transform .2s`;
  n.textContent = text; n.onclick = () => n.remove();
  box.appendChild(n);
  requestAnimationFrame(() => { n.style.opacity = '1'; n.style.transform = 'none'; });
  // In a game, tips get out of the way faster (errors still stay long enough to read).
  const inGame = onGamePage() && tone !== 'error';
  if (inGame) { n.style.fontSize = '13px'; n.style.padding = '7px 12px'; }
  setTimeout(() => { n.style.opacity = '0'; setTimeout(() => n.remove(), 250); }, inGame ? Math.min(3200, 1300 + text.length * 22) : Math.min(5000, 1800 + text.length * 35));
}
// Turns a line of page text (like a tip or an error) into quick notes on phones and in full screen:
// the line is hidden there, and each new message it shows pops up instead.
// skip(): true when this change shouldn't pop up (a live race keeps the course clear while you putt).
export function noteMirror(el, tone = '', skip = null) {
  if (!el) return;
  el.classList.add('noteline');
  new MutationObserver(() => { if ((isPhone() || document.querySelector('.fs-on')) && !skip?.()) note(el.textContent, tone); })
    .observe(el, { childList: true, characterData: true, subtree: true });
}
const foldCss = document.createElement('style');
foldCss.textContent = `
  details.mfold > summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px}
  details.mfold > summary::-webkit-details-marker{display:none}
  details.mfold > summary::after{content:'▾';font-size:18px;opacity:.7;transition:transform .2s}
  details.mfold:not([open]) > summary::after{transform:rotate(-90deg)}
  details.mfold > summary > *{margin:0}
  @media (max-width:640px){.noteline{display:none!important}}
  .fs-on .noteline{display:none!important}`;
document.head.appendChild(foldCss);

// ---------------------------------------------------------------- the Gauntlet bar on a game page
// Shows the series around this game: scores, the round track, and a button on to the next
// round once this one is decided. Put <div id="gtbar"></div> where it should go.
const GT_ICON = { battleship: '⚓', golf: '⛳', duel: '💥', cards: '🃏' };
export async function gauntletBar(gauntletId, gameId, meId, nameOf) {
  const el = document.getElementById('gtbar');
  if (!gauntletId) { if (el) el.innerHTML = ''; return ''; }
  const { data: gt } = await sb.from('gauntlets').select('*').eq('id', gauntletId).maybeSingle();
  if (!gt) { if (el) el.innerHTML = ''; return ''; }
  roundIntro(gt, gameId, meId, nameOf);
  const lead = Math.max(...gt.scores), who = (p) => (p === meId ? 'You' : esc(nameOf(p)));
  const table = gt.players.map((p, i) => `<span class="gtp${gt.scores[i] === lead && lead > 0 ? ' lead' : ''}">${gt.scores[i] === lead && lead > 0 ? '👑 ' : ''}${who(p)} <b>${gt.scores[i]}</b></span>`).join('');
  const done = gt.history || [];
  const dots = Array.from({ length: gt.rounds }, (_, i) => {
    const h = done[i], cur = !h && i === gt.round - 1 && gt.status === 'playing';
    const k = h ? h.kind : cur ? gt.current_kind : null;
    return `<i class="${h ? 'done' : cur ? 'cur' : ''}" title="Round ${i + 1}">${k ? GT_ICON[k] : ''}</i>`;
  }).join('');
  let go = '';
  if (gt.status === 'over') {
    const champs = gt.players.filter((_, i) => gt.scores[i] === lead).map(who).join(' & ');
    // The rivalry rolls straight into its next Gauntlet: offer its first round.
    const key = [...gt.players].sort().join(',');
    const { data: nextOnes } = await sb.from('gauntlets').select('*').eq('status', 'playing').order('created_at', { ascending: false }).limit(20);
    const nx = (nextOnes ?? []).find((x) => [...x.players].sort().join(',') === key);
    go = nx ? `<a class="gtgo" data-reload href="${nx.current_kind === 'battleship' ? `./#game=${nx.current_game}` : `${nx.current_kind}.html#game=${nx.current_game}`}">👑 ${champs} ${champs === 'You' ? 'win' : 'wins'}! Next Chaos: ${GT_ICON[nx.current_kind]} ›</a>`
      : `<a class="gtgo" href="./">👑 ${champs} ${champs === 'You' ? 'win' : 'wins'} the Chaos! ›</a>`;
  } else if (gt.current_game !== gameId) {
    go = `<a class="gtgo" data-reload href="${gt.current_kind === 'battleship' ? `./#game=${gt.current_game}` : `${gt.current_kind}.html#game=${gt.current_game}`}">Round ${gt.round}: ${GT_ICON[gt.current_kind]} Play ›</a>`;
  }
  const thisRound = done.findIndex((h) => h.game === gameId);
  const label = gt.status === 'over' ? 'Final' : `Round ${thisRound >= 0 ? thisRound + 1 : gt.round} of ${gt.rounds}`;
  const off = gt.status === 'playing' && gt.created_by === meId ? `<button type="button" class="gtoffbar" data-gtoff="${gt.id}">Call off</button>` : '';
  const html = `<div class="gtbar"><span class="gtt">🌀 Route to Chaos · ${label}</span><span class="gtdots">${dots}</span><span class="gtscores">${table}</span>${go}${off}</div>`;
  const now = document.getElementById('gtbar'); if (now) now.innerHTML = html;
  return html;
}
// Game over, straight on to the next one: the next Gauntlet round (or the rivalry's next
// Gauntlet) first, else the next game waiting on you. A banner counts down ("Stay here" cancels).
// Quick-play games also get a Rematch button (same players, same settings); with nothing else
// waiting, the banner counts down to a new game instead (a rematch that starts by itself). Only the first time this device sees
// the game end, and only if it ended in the last 10 minutes, so an old result never bounces you
// away. `wait` lets the win/lose screen play first.
// `mount`: an element on the result screen to show it in ("Coming next"), instead of a floating banner.
export async function jumpToNext(kind, game, meId, nameOf, wait = 3000, mount = null) {
  const key = `next.jumped.${game.id}`;
  try { if (localStorage.getItem(key)) return; } catch { return; }
  if (Date.now() - new Date(game.updated_at).getTime() > 600000) return;
  let target = null;
  if (game.gauntlet_id) {
    // The next round is made in the same transaction that ends this one, but give it a few tries
    // anyway: if this page's read lands early, the round shouldn't be lost for good.
    for (let i = 0; i < 6 && !target; i++) {
      if (i) await new Promise((r) => setTimeout(r, 1000));
      const { data: gt } = await sb.from('gauntlets').select('*').eq('id', game.gauntlet_id).maybeSingle();
      if (!gt) break;
      if (gt.status === 'playing' && gt.current_game && gt.current_game !== game.id) target = { kind: gt.current_kind, id: gt.current_game, players: gt.players, label: `Round ${gt.round}` };
      else if (gt.status === 'over') {
        const k = [...gt.players].sort().join(',');
        const { data: nx } = await sb.from('gauntlets').select('*').eq('status', 'playing').order('created_at', { ascending: false }).limit(20);
        const n = (nx ?? []).find((x) => [...x.players].sort().join(',') === k);
        if (n?.current_game) target = { kind: n.current_kind, id: n.current_game, players: n.players, label: 'Next Chaos' };
      }
    }
  }
  if (!target) { const list = (await myTurns(meId)).filter((x) => x.id !== game.id); if (list.length) target = { ...list[0], label: 'Your move' }; }
  const canRematch = !game.gauntlet_id;
  if (!target && !canRematch) return;
  // Only now is the jump "done" for this device: a look that found nothing to jump to doesn't spend it.
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { return; }
  await new Promise((r) => setTimeout(r, wait));
  const go = (href) => {
    const u = new URL(href, location.href);
    if (u.pathname === location.pathname) { location.hash = u.hash; if (!/\/(index\.html)?$/.test(u.pathname)) location.reload(); }
    else location.href = href;
  };
  const btn = 'border:0;border-radius:99px;padding:6px 12px;font:inherit;cursor:pointer;flex:none;white-space:nowrap';
  document.getElementById('nextJump')?.remove();
  const el = document.createElement('div'); el.id = 'nextJump';
  // Shown in its spot on the result screen when that's on screen, otherwise as a floating banner.
  const inSpot = !!mount && mount.isConnected && (mount.checkVisibility ? mount.checkVisibility() : true);
  el.style.cssText = inSpot
    ? 'display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;background:#00000040;color:#fff;font:700 15px/1.3 system-ui,sans-serif;border:1.5px solid #F2C23099;box-sizing:border-box;text-align:left'
    : 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(76px + env(safe-area-inset-bottom,0px));z-index:95;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 14px;border-radius:16px;background:#1B1646;color:#fff;font:700 15px/1.3 system-ui,sans-serif;box-shadow:0 10px 30px #000a;width:max-content;max-width:calc(100vw - 24px);box-sizing:border-box';
  const them = game.players.filter((p) => p !== meId).map(nameOf).join(' & ') || 'solo';
  const vs = target ? target.players.filter((p) => p !== meId).map(nameOf).join(' & ') || 'solo' : them;
  // 🧘 a calm game next: a breather first (CALM.BREATH), and a heads-up when the chaos is back on.
  const calmNext = !!target && isCalm(target.kind), chaosAgain = !calmNext && isCalm(kind);
  const secs = calmNext ? CALM.BREATH : target ? 3 : 5;   // nothing waiting: a little longer before a brand-new game starts
  const label = `<span id="nextJumpEye" style="display:block;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#F2C230">${calmNext ? '🧘 Calm within the chaos · a breather' : chaosAgain ? '😎 Here comes that chaos curve again' : 'Coming next'}</span>`
    + (target ? `${esc(target.label)}: ${KIND_ICON[target.kind]} vs ${esc(vs)}` : `A new game: ${KIND_ICON[kind]} vs ${esc(them)}`);
  el.innerHTML = `<b id="nextJumpN" style="flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#F2C230;color:#2A2100">${secs}</b><span style="flex:1 1 170px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}</span>`
    + '<span style="display:flex;gap:8px;margin-left:auto">' + (canRematch && target ? `<button type="button" data-nj="rematch" style="${btn};background:#F2C230;color:#2A2100">🔁 Rematch</button>` : '')
    + `<button type="button" data-nj="stay" style="${btn};background:#ffffff22;color:#fff">Stay here</button></span>`;
  if (inSpot) { const t = el.querySelector('span'); t.style.whiteSpace = 'normal'; t.style.overflow = 'visible'; }   // room to wrap on the result screen
  // Full screen on a phone shows only the full-screen element: the banner goes inside it.
  (inSpot ? mount : overlayHost()).appendChild(el);
  let n = secs, iv = null;
  const stop = () => { clearInterval(iv); el.remove(); };
  const startRematch = async (btnEl) => {
    clearInterval(iv);
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Setting up…'; }
    const b = document.getElementById('nextJumpN'); if (b) b.textContent = '…';
    const { data, error } = await rematch(kind, game, meId, !btnEl);
    if (error || !data) { if (btnEl) { btnEl.textContent = '🔁 Rematch'; btnEl.disabled = false; } else el.remove(); note(error ? friendly(error) : "Couldn't start a rematch", 'error'); return; }
    if (!data.joined) notify(kind, data.id);
    el.remove(); go(hrefFor(kind, data.id));
  };
  iv = setInterval(() => {
    n -= 1; const b = document.getElementById('nextJumpN'); if (b) b.textContent = String(n);
    if (calmNext && n === CALM.WARN) { const e = document.getElementById('nextJumpEye'); if (e) e.textContent = '😎 Ready? Take your time in there'; }
    if (n <= 0) { clearInterval(iv); if (target) { stop(); go(hrefFor(target.kind, target.id)); } else startRematch(null); }
  }, 1000);
  el.querySelector('[data-nj="stay"]').onclick = stop;
  const rm = el.querySelector('[data-nj="rematch"]');
  if (rm) rm.onclick = () => startRematch(rm);
}
// The same game again: same players, same settings. If one is already running for exactly these
// players (the other player's page just started it), join that instead of making a second one.
// Resolves { data: { id, joined }, error }.
// When the countdown (not a tap) starts it, every page counts down together, so one player's page
// makes the game and the others wait a few seconds to join it.
async function rematch(kind, game, meId, auto = false) {
  const table = { duel: 'duel_games', golf: 'golf_games', battleship: 'games', cards: 'card_games' }[kind];
  const key = [...game.players].sort().join(',');
  const find = async () => {
    const { data: running } = await sb.from(table).select('id, players').neq('id', game.id).in('status', kind === 'battleship' ? ['setup', 'playing'] : ['playing']).is('gauntlet_id', null).order('created_at', { ascending: false }).limit(30);
    return (running ?? []).find((x) => [...x.players].sort().join(',') === key);
  };
  const host = [...game.players].filter((p) => !bots.has(p)).sort()[0] === meId;
  for (let i = 0; i < (auto && !host ? 8 : 1); i++) {
    const same = await find();
    if (same) return { data: { id: same.id, joined: true }, error: null };
    if (auto && !host) await new Promise((r) => setTimeout(r, 750));
  }
  const { data, error } = await createRematch(kind, game, meId);
  return { data: data ? { id: data, joined: false } : null, error };
}
async function createRematch(kind, game, meId) {
  const others = game.players.filter((p) => p !== meId);
  const { data: prof } = others.length ? await sb.from('profiles').select('id, username').in('id', others) : { data: [] };
  const un = others.map((id) => (prof ?? []).find((p) => p.id === id)?.username).filter(Boolean);
  if (kind === 'duel') return sb.rpc('duel_create', { p_opponents: un, p_bot_level: game.bot_level });
  if (kind === 'golf') return sb.rpc('golf_create', { opponents: un, p_start: game.start, p_count: game.count, p_random: !!game.seed, p_bot_level: game.bot_level });
  if (kind === 'cards') return sb.rpc('card_create', { opponents: un, p_bot_level: game.bot_level });
  return sb.rpc('create_game', { opponents: un, p_mode: 2, p_spt: game.spt });   // always the shared ocean (056)
}
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[data-reload]');
  if (!a) return;
  const u = new URL(a.getAttribute('href'), location.href);
  if (u.pathname === location.pathname && !/\/(index\.html)?$/.test(u.pathname)) { e.preventDefault(); location.hash = u.hash; location.reload(); }
});
// Call off from the bar: tap twice (within 4s). Remembered here, not on the button, because
// some pages redraw the bar between taps.
let gtOffArmed = null, gtOffAt = 0;
document.addEventListener('click', async (e) => {
  const b = e.target.closest?.('[data-gtoff]');
  if (!b) return;
  const id = b.dataset.gtoff;
  if (gtOffArmed !== id || Date.now() - gtOffAt > 4000) {
    gtOffArmed = id; gtOffAt = Date.now();
    b.textContent = 'Tap to confirm'; b.classList.add('armed');
    setTimeout(() => { if (b.isConnected && gtOffArmed === id && Date.now() - gtOffAt >= 4000) { b.textContent = 'Call off'; b.classList.remove('armed'); } }, 4100);
    return;
  }
  gtOffArmed = null; b.disabled = true;
  const { error } = await sb.rpc('gauntlet_delete', { p_gauntlet: id });
  if (error) { note(error.message.replace(/^.*?ERROR:\s*/, ''), 'error'); b.disabled = false; return; }
  note('Chaos called off.');
  setTimeout(() => { location.href = './'; }, 900);
});
const gtCss = document.createElement('style');
gtCss.textContent = `
  .gtbar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;padding:8px 12px;border-radius:14px;background:linear-gradient(90deg,#3A1D00,#6B3A00);color:#FFE7B0;font:600 14px/1.3 system-ui,sans-serif;border:1.5px solid #FFC85777}
  .gtbar .gtt{font-weight:800;letter-spacing:.02em}
  .gtbar .gtdots{display:flex;gap:4px}
  .gtbar .gtdots i{width:20px;height:20px;border-radius:50%;background:#ffffff22;display:grid;place-items:center;font-size:11px;font-style:normal}
  .gtbar .gtdots i.done{background:#FFC857}
  .gtbar .gtdots i.cur{background:#FF8A3D;box-shadow:0 0 0 2px #FFE7B0}
  .gtbar .gtscores{display:flex;flex-wrap:wrap;gap:8px}
  .gtbar .gtp b{color:#FFC857}
  .gtbar .gtp.lead{color:#fff}
  .gtbar .gtoffbar{min-height:30px;padding:3px 10px;border-radius:99px;font:700 12px/1 system-ui,sans-serif;background:#00000044;color:#F3D9A6;border:1.5px solid #FFC85766;cursor:pointer}
  .gtbar .gtoffbar.armed{background:#C0392B;color:#fff;border-color:#C0392B}
  .gtbar .gtoffbar:first-child,.gtbar .gtgo + .gtoffbar{margin-left:0}
  .gtbar > .gtoffbar{margin-left:auto}
  .gtbar .gtgo + .gtoffbar{margin-left:0}
  .gtbar .gtgo{margin-left:auto;background:#FFC857;color:#2A1600;border-radius:99px;padding:6px 14px;font-weight:800;text-decoration:none;animation:gtPulse 1.4s ease-in-out infinite}
  @keyframes gtPulse{50%{transform:scale(1.05)}}
  @media (prefers-reduced-motion:reduce){.gtbar .gtgo{animation:none}}
  .fs-on .gtbar{display:none}`;
document.head.appendChild(gtCss);

// ---------------------------------------------------------------- drama
// A full-screen moment: big lines slam in over a dark flash ("ROUND 3", "K.O.!"), then clear.
// Tap to skip. Reduced motion keeps the words and drops the slam.
// passThrough: touches go through to the game under it (a live race or battle is already on).
export function splash(lines, { tone = 'gold', ms = 2200, sound = 'stinger', passThrough = false } = {}) {
  if (!dramaOn()) { note(lines.map((l) => String(l).replace(/<[^>]+>/g, '')).join(' · '), tone === 'red' ? 'error' : ''); return; }   // Big moments off: a quick note instead
  document.getElementById('dramaSplash')?.remove();
  const el = document.createElement('div'); el.id = 'dramaSplash'; el.className = `drama drama-${tone}${passThrough ? ' pass' : ''}`;
  el.setAttribute('role', 'status');
  el.innerHTML = lines.map((l, i) => `<span class="dl dl${i}" style="animation-delay:${i * 180}ms">${l}</span>`).join('');
  el.onclick = () => el.remove();
  overlayHost().appendChild(el);
  if (sound) sfx(sound);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, ms);
}
// A live game's 3-2-1-GO, the same moment on every screen (045): counts down to live_go's start
// (5 s after the last player arrived, corrected for this device's clock). Touches go through, so
// you can line up while you wait. Resolves at once with GO in this device's Date.now() terms; the
// page holds fire until then. solo (only robots to race): a quick local 3 s, nothing to sync.
// srv.offset: the server's clock minus this device's, from the last live_go answer (065): a page
// turns a server-side start time (like Putt Post's hole_go) into its own Date.now() terms with it.
export const srv = { offset: 0 };
export async function liveCountdown(kind, gameId, lines, { solo = false } = {}) {
  let go = Date.now() + 3000;
  if (!solo) { try { const { data } = await sb.rpc('live_go', { p_kind: kind, p_game: gameId }); if (data?.go) { srv.offset = data.now - Date.now(); go = data.go - srv.offset; } } catch {} }
  if (go < Date.now() + 400) { splash([...lines, 'GO!'], { ms: 1000, passThrough: true, sound: 'birdie' }); return Date.now(); }   // everyone else is already off
  go = Math.min(go, Date.now() + 6000);
  document.getElementById('dramaSplash')?.remove();
  const el = document.createElement('div'); el.id = 'dramaSplash'; el.className = 'drama drama-gold pass'; el.setAttribute('role', 'status');
  el.innerHTML = lines.map((l, i) => `<span class="dl dl${i}" style="animation-delay:${i * 150}ms">${l}</span>`).join('') + '<span class="dl dlcd">…</span>';
  overlayHost().appendChild(el); sfx('stinger');
  let last = null;
  const step = () => {
    if (!el.isConnected) return;
    const left = go - Date.now(), n = Math.ceil(left / 1000), cd = el.querySelector('.dlcd');
    if (left <= 0) {
      cd.replaceWith(Object.assign(document.createElement('span'), { className: 'dl dlcd', textContent: 'GO!' }));
      sfx('birdie'); navigator.vibrate?.(90);
      setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, 650);
      return;
    }
    if (n !== last && n <= 3) { last = n; cd.replaceWith(Object.assign(document.createElement('span'), { className: 'dl dlcd', textContent: String(n) })); sfx('tick', { hi: true }); navigator.vibrate?.(20); }
    else if (n > 3 && last == null) { last = 99; cd.textContent = 'Get ready…'; }
    requestAnimationFrame(step);
  };
  step();
  return go;
}
// A red pulse around the screen with a heartbeat while you're nearly out.
let dangerTimer = null;
export function danger(on) {
  let v = document.getElementById('dangerV');
  if (on && !dramaOn()) on = false;
  if (!on) { v?.remove(); clearInterval(dangerTimer); dangerTimer = null; return; }
  if (v) return;
  v = document.createElement('div'); v.id = 'dangerV'; v.setAttribute('aria-hidden', 'true');
  overlayHost().appendChild(v);
  sfx('heartbeat'); dangerTimer = setInterval(() => { if (!document.hidden) sfx('heartbeat'); }, 1300);
}
// The first time you open a Gauntlet round: which round, which game, and what's at stake.
const GT_NAME = { battleship: 'Battleship', golf: 'Putt Post', duel: 'Hilltop Duel', cards: 'Chaos Cards' };
export function roundIntro(gt, gameId, meId, nameOf) {
  if (!gt || gt.status !== 'playing' || gt.current_game !== gameId) return;
  const key = `drama.intro.${gameId}`;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { return; }
  const left = gt.rounds - gt.round;   // rounds after this one
  const clinch = gt.players.filter((_, i) => gt.scores[i] + 1 > Math.max(...gt.players.map((__, j) => (j === i ? -1 : gt.scores[j] + left))));
  const who = (p) => (p === meId ? 'YOU' : esc(nameOf(p)).toUpperCase());
  const stakes = clinch.length === 1 ? `MATCH POINT: ${who(clinch[0])}` : gt.round === gt.rounds ? 'FINAL ROUND' : `${gt.scores.join(' – ')}`;
  splash([`🌀 ROUTE TO CHAOS · ROUND ${gt.round}`, `${GT_ICON[gt.current_kind]} ${GT_NAME[gt.current_kind].toUpperCase()}`, stakes], { tone: clinch.length || gt.round === gt.rounds ? 'red' : 'gold', ms: 2600 });
}
const dramaCss = document.createElement('style');
dramaCss.textContent = `
  .drama{position:fixed;inset:0;z-index:90;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:16px;text-align:center;
    background:radial-gradient(circle at 50% 50%,#000a,#000e 70%);cursor:pointer;overflow:hidden;animation:dramaIn .2s ease-out both}
  .drama.out{opacity:0;transition:opacity .3s}
  .drama .dlcd{font-size:clamp(64px,22vw,150px)!important}
  .drama.pass{pointer-events:none;background:radial-gradient(circle at 50% 50%,#0006,#0000 75%)}
  .drama .dl{display:block;font-family:"Bungee","Rubik Mono One","Arial Black",Impact,sans-serif;line-height:1;color:#FFE08A;-webkit-text-stroke:2px #3A1D00;paint-order:stroke fill;
    text-shadow:0 5px 0 #3A1D00,0 0 36px #F2C230;animation:dramaSlam .5s cubic-bezier(.2,1.6,.4,1) both}
  .drama .dl0{font-size:clamp(20px,6vw,34px);letter-spacing:.2em;color:#fff}
  .drama .dl1{font-size:clamp(38px,12vw,84px)}
  .drama .dl2{font-size:clamp(18px,5.5vw,30px);letter-spacing:.08em;color:#fff;max-width:92vw;animation-name:dramaRise}
  @keyframes dramaRise{from{transform:translateY(14px);opacity:0}}
  .drama-red .dl1,.drama-red .dl2{color:#FF6B5E;-webkit-text-stroke-color:#2A0000;text-shadow:0 5px 0 #2A0000,0 0 36px #FF5A4E}
  @keyframes dramaIn{from{opacity:0}}
  @keyframes dramaSlam{0%{transform:scale(2.6);opacity:0}60%{transform:scale(.94);opacity:1}100%{transform:none}}
  #dangerV{position:fixed;inset:0;z-index:55;pointer-events:none;box-shadow:inset 0 0 90px 30px #E0201Aaa;animation:dangerPulse 1.3s ease-in-out infinite}
  @keyframes dangerPulse{0%,100%{opacity:.35}15%{opacity:1}30%{opacity:.5}45%{opacity:.85}}
  @media (prefers-reduced-motion:reduce){.drama,.drama .dl{animation:none}#dangerV{animation:none;opacity:.6}}`;
document.head.appendChild(dramaCss);

// ---------------------------------------------------------------- hidden cheats: secret gestures
// Cheats have no buttons. They hide behind a press-and-hold or a triple tap on ordinary-looking
// parts of the page. Both helpers delegate from `root`, so they survive pages that redraw.
// After a hold fires, the click that follows is swallowed so the tap underneath doesn't also act.
export function onHold(root, selector, fn, ms = 700) {
  let timer = null, start = null, swallow = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest?.(selector); if (!el || !root.contains(el)) return;
    start = { x: e.clientX, y: e.clientY }; cancel();
    timer = setTimeout(() => { timer = null; swallow = true; navigator.vibrate?.(15); fn(el, e); setTimeout(() => { swallow = false; }, 600); }, ms);
  });
  root.addEventListener('pointermove', (e) => { if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => root.addEventListener(t, cancel));
  root.addEventListener('click', (e) => { if (swallow && e.target.closest?.(selector)) { e.stopPropagation(); e.preventDefault(); swallow = false; } }, true);
  root.addEventListener('contextmenu', (e) => { if (e.target.closest?.(selector)) e.preventDefault(); });
}
export function onTaps(root, selector, n, fn) {
  let count = 0, last = 0;
  root.addEventListener('click', (e) => {
    const el = e.target.closest?.(selector); if (!el || !root.contains(el)) return;
    const now = Date.now(); count = now - last < 450 ? count + 1 : 1; last = now;
    if (count >= n) { count = 0; fn(el, e); }
  });
}
// Now and then, a rumour hints that the cheats exist. At most one per game page visit.
let rumourShown = false;
export function rumour(lines, chance = 0.25) {
  if (rumourShown || Math.random() > chance) return;
  rumourShown = true;
  setTimeout(() => note(`🤫 ${lines[Math.floor(Math.random() * lines.length)]}`), 1800);
}
const holdCss = document.createElement('style');
holdCss.textContent = '.nohold{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}';
document.head.appendChild(holdCss);

// ---------------------------------------------------------------- clocks
// Shot clock: a countdown pill while it's your turn. The time left is remembered for this turn
// (so reloading doesn't reset it) and pauses while the page is hidden. At zero, onExpire runs
// once; the server decides the penalty (shot_clock), once per turn.
let clockState = null;
// It sits in the page's [data-clockslot] (next to the game's controls) when there is one.
const mountClock = (el) => { const slot = document.querySelector('[data-clockslot]'); el.classList.toggle('inline', !!slot); if (slot) { if (el.parentNode !== slot) slot.appendChild(el); } else if (!el.isConnected) document.body.appendChild(el); };
export function shotClock(key, seconds, onExpire) {
  if (clockState?.key === key) { mountClock(clockState.el); return; }   // pages that redraw get it back
  stopShotClock();
  const store = `clock.${key}`;
  let left = seconds;
  try { const v = sessionStorage.getItem(store); if (v != null) left = +v; } catch {}
  if (left <= 0) return;
  const el = document.createElement('div'); el.id = 'shotClock'; el.setAttribute('role', 'timer'); el.setAttribute('aria-label', 'Shot clock');
  mountClock(el);
  const st = { key, left, el, timer: null };
  const paint = () => {
    const s = Math.max(0, Math.ceil(st.left));
    el.innerHTML = `<span>⏱</span><b>${s}</b>`;
    el.classList.toggle('hurry', s <= 10); el.style.setProperty('--frac', String(Math.max(0, st.left / seconds)));
  };
  st.timer = setInterval(() => {
    if (document.hidden) return;
    st.left -= 1; try { sessionStorage.setItem(store, String(st.left)); } catch {}
    paint();
    if (st.left <= 10 && st.left > 0) sfx('tick', { hi: st.left <= 5 });
    if (st.left <= 0) { stopShotClock(); sfx('alarm'); onExpire(); }
  }, 1000);
  clockState = st; paint();
}
export function stopShotClock() {
  if (!clockState) return;
  clearInterval(clockState.timer); clockState.el.remove(); clockState = null;
}
// Chaos clock: ask the server to apply anything overdue on my games (throttled). Returns how
// many hits landed, so a page can reload when something changed.
let lastChaosClock = 0;
export async function chaosClock() {
  if (Date.now() - lastChaosClock < 60000) return 0;
  lastChaosClock = Date.now();
  const { data } = await sb.rpc('chaos_clock');
  return data || 0;
}
// "chaos in 1h 20m" for a turn that started at turnAt (2h, 8h, then 24h for Gauntlet rounds).
export function chaosIn(turnAt, gauntlet) {
  if (!turnAt) return '';
  const hrs = (Date.now() - new Date(turnAt).getTime()) / 3600000;
  const next = [2, 8, ...(gauntlet ? [24] : [])].find((h) => h > hrs);
  if (next == null) return '';
  const m = Math.max(1, Math.round((next - hrs) * 60));
  const txt = m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  return next === 24 ? `⏰ forfeit in ${txt}` : `⏰ chaos in ${txt}`;
}
const clockCss = document.createElement('style');
clockCss.textContent = `
  #shotClock{position:fixed;left:50%;top:calc(8px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:75;display:flex;align-items:center;gap:6px;
    padding:6px 14px 6px 12px;border-radius:99px;background:#141026ee;color:#fff;font:800 18px/1 system-ui,sans-serif;box-shadow:0 6px 18px #0008;
    border:2px solid #FFC857;background-image:linear-gradient(90deg,#FFC85733 calc(var(--frac,1)*100%),transparent 0)}
  #shotClock b{font-variant-numeric:tabular-nums;min-width:1.4em;text-align:right}
  #shotClock.hurry{border-color:#FF5A4E;background-image:linear-gradient(90deg,#FF5A4E55 calc(var(--frac,1)*100%),transparent 0);animation:clockPulse 1s ease-in-out infinite}
  @keyframes clockPulse{50%{transform:translateX(-50%) scale(1.12)}}
  @media (prefers-reduced-motion:reduce){#shotClock.hurry{animation:none}}
  #shotClock.inline{position:static;transform:none;box-shadow:none;font-size:16px;padding:4px 12px 4px 10px;flex:none}
  #shotClock.inline.hurry{animation-name:clockPulseIn}
  @keyframes clockPulseIn{50%{transform:scale(1.12)}}`;
document.head.appendChild(clockCss);

// ---------------------------------------------------------------- settings (⚙️, every page)
// Per-device preferences, remembered in localStorage. The ⚙️ button in the corner opens a sheet.
const pref = (k, d) => { try { const v = localStorage.getItem(`set.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(`set.${k}`, JSON.stringify(v)); } catch {} };
export const dramaOn = () => pref('drama', true) && !matchMedia('(prefers-reduced-motion: reduce)').matches;
export const hapticsOn = () => pref('haptics', true);
export const gauntletRounds = () => pref('gtRounds', 3);
// Putt Post's look on this device: 'classic' mini golf or a 'natural' golf course.
export const golfTheme = () => pref('golfTheme', 'classic');
export const setGolfThemePref = (v) => setPref('golfTheme', v);
// Vibration everywhere goes through here, so the switch covers every buzz in every game.
try {
  const vib = navigator.vibrate?.bind(navigator);
  if (vib) Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p) => (hapticsOn() ? vib(p) : false) });
} catch {}
export async function signOutHere() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
  } catch {}
  await sb.auth.signOut();
  location.href = './';
}
function sw(key, on, label, hint) {
  return `<div class="setrow"><div><strong>${label}</strong><span>${hint}</span></div>
    <button type="button" class="switch" role="switch" aria-checked="${on}" data-sw="${key}" aria-label="${label}"><i></i></button></div>`;
}
// ⚓ Battleship themes (027): a tile per theme; the locked ones say how to get them (the UFO doesn't).
// Picked on the ship placement screen (box: an empty .themes element). What you have is fetched
// once a page and kept, so the placement screen can redraw as often as it likes.
let themeData = null;
export const forgetThemes = () => { themeData = null; };   // after an unlock
export async function themeTiles(box) {
  if (!box) return;
  if (!document.getElementById('themeTileCss')) {
    const st = document.createElement('style'); st.id = 'themeTileCss';
    st.textContent = `.themes{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.themes button{display:flex;flex-direction:column;align-items:stretch;gap:4px;padding:0;border:2px solid transparent;border-radius:12px;background:none;color:inherit;cursor:pointer;font:inherit;min-width:0}
.themes button .thsea{display:block;height:44px;border-radius:9px;overflow:hidden;padding:9px 6px;box-sizing:border-box}
.themes button .thsea svg{display:block;width:100%;height:100%}
.themes button b{font-size:11px;line-height:1.2;text-align:center}
.themes button small{font-size:10px;opacity:.7;text-align:center;line-height:1.1}
.themes button[aria-checked=true]{border-color:#F2C230;box-shadow:0 0 0 2px #F2C23055}
.themes button.locked .thsea{filter:grayscale(1) brightness(.55)}
.themes button.locked{cursor:default}`;
    document.head.appendChild(st);
  }
  themeData ??= sb.rpc('bs_themes').then(({ data, error }) => (error ? null : data));
  const data = await themeData;
  if (!data) { themeData = null; box.innerHTML = ''; return; }
  const draw = (cur) => {
    box.innerHTML = Object.entries(THEMES).map(([k, t]) => {
      const open = data.unlocked.includes(k), hidden = !open && t.lock?.secret;
      const left = t.lock?.wins ? Math.max(0, t.lock.wins - data.wins) : 0;
      return `<button type="button" role="radio" data-theme="${k}" aria-checked="${cur === k}" class="${open ? '' : 'locked'}" ${open ? '' : 'aria-disabled="true"'}
        title="${hidden ? 'A secret. Nobody knows how.' : open ? t.name : `Win ${left} more Battleship game${left === 1 ? '' : 's'}`}">
        <span class="thsea sea sea-${hidden ? 'sea' : k}">${hidden ? '' : vesselSVG(k, 3, true)}</span>
        <b>${hidden ? '❓ ???' : `${open ? t.icon : '🔒'} ${t.name}`}</b>${open ? '' : `<small>${hidden ? 'a secret…' : `${left} more win${left === 1 ? '' : 's'}`}</small>`}</button>`;
    }).join('');
    box.querySelectorAll('[data-theme]:not(.locked)').forEach((b) => { b.onclick = async () => {
      const { error: e } = await sb.rpc('set_bs_theme', { p_theme: b.dataset.theme });
      if (e) { note(friendly(e), 'error'); return; }
      data.current = b.dataset.theme; draw(b.dataset.theme); sfx('pop');
      dispatchEvent(new Event('bstheme'));   // a Battleship page redraws its boards
    }; });
  };
  draw(data.current);
}
export async function openSettings() {
  if (document.getElementById('setSheet')) return;
  const { data: { session } } = await sb.auth.getSession();
  const uid = session?.user?.id;
  const uname = uid ? (names[uid] || (await sb.from('profiles').select('username').eq('id', uid).maybeSingle()).data?.username) : null;
  const wrap = document.createElement('div'); wrap.id = 'setSheet';
  wrap.innerHTML = `<div class="setback"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="setTitle">
      <div class="row between"><h2 id="setTitle">⚙️ Settings</h2><button type="button" class="setx" aria-label="Close settings">✕</button></div>
      ${uname ? `<p class="setwho">Signed in as <strong>${esc(uname)}</strong></p>` : ''}
      <div class="setgroup">
        ${sw('sound', !isMuted(), '🔊 Sound', 'Game sounds and music stings')}
        ${navigator.vibrate ? sw('haptics', hapticsOn(), '📳 Vibration', 'A buzz on hits, taps and secrets') : ''}
        ${sw('drama', pref('drama', true), '🎬 Big moments', 'Splash screens, slow motion and the danger pulse. Off: quick notes instead')}
        ${sw('gamePopups', pref('gamePopups', false), '📰 News pop-ups in games', 'Loot, curses and twists pop up over the game. Off: they wait in the 🔔 up top')}
      </div>
      ${uid ? `<div class="setgroup">
        <div class="setrow"><div><strong>🌀 Route to Chaos length</strong><span>Picked for you when you start one</span></div>
          <div class="setseg" role="radiogroup" aria-label="Route to Chaos length">${[3, 5, 7].map((r) => `<button type="button" role="radio" aria-checked="${gauntletRounds() === r}" data-rounds="${r}">${r}</button>`).join('')}</div></div>
        <div class="setrow" id="alertRow"><div><strong>🔔 Turn alerts</strong><span id="alertHint">Checking…</span></div><span id="alertCtl"></span></div>
        <a class="setrow link" href="./#player=${uid}"><div><strong>🏅 My trophies</strong><span>Your trophy case and badges</span></div><span class="setgo">›</span></a>
      </div>
      <div class="setgroup">
        <button type="button" class="setrow link" id="pwOpen"><div><strong>🔑 Change password</strong><span>Pick a new one for this account</span></div><span class="setgo">›</span></button>
        <form id="pwForm" class="pwform" hidden>
          <label>New password<input type="password" id="pw1" autocomplete="new-password" minlength="6" required></label>
          <label>Type it again<input type="password" id="pw2" autocomplete="new-password" minlength="6" required></label>
          <div class="row"><button type="submit" class="setbtn">Save password</button><span class="small" id="pwMsg"></span></div>
        </form>
        <button type="button" class="setrow link danger" id="setOut"><div><strong>🚪 Sign out</strong><span>On this device</span></div></button>
      </div>` : ''}
    </div>`;
  document.body.appendChild(wrap);
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); document.getElementById('setBtn')?.focus(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.querySelector('.setback').onclick = close; wrap.querySelector('.setx').onclick = close;
  wrap.querySelector('.setx').focus();
  wrap.querySelectorAll('[data-sw]').forEach((b) => { b.onclick = () => {
    const on = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(on));
    const k = b.dataset.sw;
    if (k === 'sound') { setMuted(!on); if (on) setTimeout(() => sfx('click'), 30); }
    else { setPref(k, on); if (k === 'haptics' && on) navigator.vibrate?.(20); if (k === 'drama' && !on) danger(false); }
  }; });
  wrap.querySelectorAll('[data-rounds]').forEach((b) => { b.onclick = () => {
    setPref('gtRounds', +b.dataset.rounds);
    wrap.querySelectorAll('[data-rounds]').forEach((o) => o.setAttribute('aria-checked', String(o === b)));
  }; });
  wrap.querySelectorAll('a.setrow').forEach((a) => a.addEventListener('click', () => setTimeout(close, 0)));
  if (wrap.querySelector('#alertRow')) paintAlerts(wrap);
  const pwOpen = wrap.querySelector('#pwOpen');
  if (pwOpen) pwOpen.onclick = () => { const f = wrap.querySelector('#pwForm'); f.hidden = !f.hidden; if (!f.hidden) wrap.querySelector('#pw1').focus(); };
  const pwForm = wrap.querySelector('#pwForm');
  if (pwForm) pwForm.onsubmit = async (e) => {
    e.preventDefault();
    const a = wrap.querySelector('#pw1').value, b = wrap.querySelector('#pw2').value, msg = wrap.querySelector('#pwMsg');
    if (a.length < 6) { msg.textContent = 'At least 6 characters.'; return; }
    if (a !== b) { msg.textContent = "Those don't match."; return; }
    const { error } = await sb.auth.updateUser({ password: a });
    msg.textContent = error ? friendly(error) : '✅ Saved. Use it next time you sign in.';
    if (!error) { pwForm.reset(); }
  };
  const out = wrap.querySelector('#setOut');
  if (out) out.onclick = () => { out.disabled = true; signOutHere(); };
}
const setCss = document.createElement('style');
setCss.textContent = `
  #setSheet{position:fixed;inset:0;z-index:95;display:flex;align-items:flex-end;justify-content:center}
  #setSheet .setback{position:absolute;inset:0;background:#0009;animation:setFade .2s ease-out}
  #setSheet .sheet{position:relative;width:min(480px,100%);max-height:88vh;overflow:auto;background:#fff;color:#13233A;border-radius:20px 20px 0 0;
    padding:16px 16px calc(20px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:12px;font:16px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;
    box-shadow:0 -12px 40px #0006;animation:setUp .25s ease-out}
  @media (min-width:640px){#setSheet{align-items:center}#setSheet .sheet{border-radius:20px}}
  #setSheet h2{margin:0;font:800 20px/1.2 system-ui,sans-serif}
  #setSheet .row{display:flex;gap:10px;align-items:center}#setSheet .between{justify-content:space-between}
  #setSheet .setx{width:40px;height:40px;border-radius:50%;border:0;background:#EEF2F6;font-size:18px;cursor:pointer;color:inherit}
  #setSheet .setwho{margin:0;color:#566A80;font-size:14px}
  #setSheet .setgroup{display:flex;flex-direction:column;border:1px solid #D7E0EA;border-radius:14px;overflow:hidden}
  #setSheet .setrow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:0;border-top:1px solid #E6ECF2;background:none;color:inherit;font:inherit;text-align:left;text-decoration:none;width:100%}
  #setSheet .setgroup > .setrow:first-child{border-top:0}
  #setSheet .setrow > div{display:flex;flex-direction:column;min-width:0}
  #setSheet .setrow span{font-size:13px;color:#566A80}
  #setSheet .setrow.link{cursor:pointer}#setSheet .setrow.link:hover{background:#F4F7FA}
  #setSheet .setrow.danger strong{color:#C0392B}
  #setSheet .setgo{font-size:24px;color:#8FA2B6}
  #setSheet .switch{flex:none;width:52px;height:30px;border-radius:99px;border:0;background:#C9D3DE;position:relative;cursor:pointer;transition:background .2s}
  #setSheet .switch i{position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0005;transition:left .2s}
  #setSheet .switch[aria-checked=true]{background:#2FA36B}#setSheet .switch[aria-checked=true] i{left:25px}
  #setSheet .setrow > .setseg{display:flex;flex-direction:row;border:1.5px solid #C9D3DE;border-radius:99px;overflow:hidden;flex:none}
  #setSheet .setseg button{border:0;background:none;padding:6px 14px;font:700 15px/1 system-ui,sans-serif;cursor:pointer;color:inherit}
  #setSheet .setseg button[aria-checked=true]{background:#1E5A96;color:#fff}
  #setSheet .pwform{display:flex;flex-direction:column;gap:10px;padding:4px 14px 14px}
  #setSheet .pwform label{display:flex;flex-direction:column;gap:4px;font-size:14px;font-weight:600}
  #setSheet .pwform input{font:inherit;padding:10px 12px;border-radius:10px;border:1.5px solid #C9D3DE}
  #setSheet .setbtn{border:0;border-radius:10px;padding:10px 16px;background:#1E5A96;color:#fff;font:700 15px/1 system-ui,sans-serif;cursor:pointer}
  #setSheet :focus-visible{outline:3px solid #F2C230;outline-offset:2px}
  @keyframes setUp{from{transform:translateY(30px);opacity:0}} @keyframes setFade{from{opacity:0}}
  @media (prefers-color-scheme:dark){#setSheet .sheet{background:#142238;color:#E6EEF6}#setSheet .setgroup,#setSheet .setrow{border-color:#2A4262}
    #setSheet .setx{background:#1A3453}#setSheet .setrow span,#setSheet .setwho{color:#9BACC2}#setSheet .setrow.link:hover{background:#1A3453}
    #setSheet .pwform input{background:#0C1624;color:inherit;border-color:#2A4262}}
  @media (prefers-reduced-motion:reduce){#setSheet .sheet,#setSheet .setback{animation:none}}`;
document.head.appendChild(setCss);

// ---------------------------------------------------------------- turn alerts (push), in Settings
function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const homeScreen = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
// 'on' | 'off' | 'blocked' | 'ios-install' | 'unsupported'
export async function alertsState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIOS && !homeScreen ? 'ios-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}
export async function enableAlerts() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'blocked';
  if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register('./sw.js');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
  if (error) throw error;
  return 'on';
}
export async function disableAlerts() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
  return 'off';
}
const ALERT_HINT = {
  on: "You'll get a notification when it's your turn, even with the game closed.",
  off: 'Get a notification when it\'s your turn, even with the game closed.',
  blocked: "Notifications are blocked for this site. Allow them in your browser's site settings, then come back.",
  'ios-install': 'On iPhone or iPad: tap Share → Add to Home Screen, open r4box from there, then turn alerts on here.',
  unsupported: "This browser can't show alerts. Games still update live while they're open.",
};
async function paintAlerts(wrap) {
  const hint = wrap.querySelector('#alertHint'), ctl = wrap.querySelector('#alertCtl');
  if (!hint) return;
  const st = await alertsState();
  hint.textContent = ALERT_HINT[st];
  ctl.innerHTML = st === 'on' || st === 'off' ? `<button type="button" class="switch" role="switch" aria-checked="${st === 'on'}" aria-label="Turn alerts"><i></i></button>` : '';
  const b = ctl.querySelector('.switch');
  if (b) b.onclick = async () => {
    b.disabled = true;
    try { const now = b.getAttribute('aria-checked') === 'true' ? await disableAlerts() : await enableAlerts(); if (now === 'on') sfx('chime'); }
    catch (e) { hint.textContent = `Couldn't change alerts: ${friendly(e)}`; b.disabled = false; return; }
    paintAlerts(wrap);
  };
}

// Every page gets the toolbar (with ⚙️ Settings) as soon as it loads.
settingsButton();
