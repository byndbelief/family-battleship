// Chaos Cards: a shedding card game (plays like Uno) with chaos cards and chaos events.
// Everything is decided on the server (card_play, card_draw…); this page shows the table, your
// own hand (the only one you can read) and what just happened, and asks the robot to play.
import { sb, me, bots, signedIn, esc, nm, friendly, notify, sfx, liveGame, nextUpChip, names, gauntletBar, note, splash, chaosClock, face, avatar, livePresence, jumpToNext, announceChaos, isPhone } from './common.js';

const $ = (id) => document.getElementById(id);
let G = null;                 // { game, hand }
let liveOn = false, callLast = false, busy = false, seenMove = null, askedTimeout = -1, botAsked = '';
const log = [];               // what happened while this page was open, newest first
const COLORS = { R: 'Red', G: 'Green', B: 'Blue', Y: 'Yellow' };
const CHAOS = {
  CS: { icon: '🌀', name: 'Swap', desc: 'Swap hands with anyone' },
  CT: { icon: '🎯', name: 'Target', desc: 'Pick someone: they draw 3' },
  CP: { icon: '🔀', name: 'Pass along', desc: 'Everyone passes their hand on' },
  CB: { icon: '💣', name: 'Bomb', desc: 'Everyone else draws 2' },
};
const isWild = (c) => ['W', 'W4', 'CS', 'CT', 'CP', 'CB'].includes(c);
const playable = (c, g) => isWild(c) || c[0] === g.color || (!isWild(g.top) && c.slice(1) === g.top.slice(1));
const isBot = (id) => bots.has(id);
const who = (id) => (id === me.id ? 'You' : nm(id));
const plain = (html) => String(html).replace(/<[^>]+>/g, '');
const sym = (c) => (CHAOS[c] ? CHAOS[c].icon : c === 'W' ? 'W' : c === 'W4' ? '+4' : { S: '⊘', R: '⇄' }[c.slice(1)] ?? c.slice(1));
const label = (c) => (CHAOS[c] ? `${CHAOS[c].icon} ${CHAOS[c].name}` : c === 'W' ? 'Wild' : c === 'W4' ? 'Wild +4'
  : `${COLORS[c[0]]} ${{ S: 'Skip', R: 'Reverse' }[c.slice(1)] ?? c.slice(1)}`);
function cardHTML(c, cls = '', attrs = '') {
  const kind = CHAOS[c] ? 'chaos' : isWild(c) ? 'wild' : c[0];
  return `<${attrs ? 'button type="button"' : 'div'} class="card ${kind} ${cls}" ${attrs} aria-label="${label(c)}"><small>${sym(c)}</small><b>${sym(c)}</b></${attrs ? 'button' : 'div'}>`;
}
const order = (c) => (isWild(c) ? 9 : 'RGBY'.indexOf(c[0])) * 100 + ({ S: 20, R: 21, '+2': 22 }[c.slice(1)] ?? (Number(c.slice(1)) || 0));

// ---------------------------------------------------------------- loading
async function load(id) {
  const [{ data: game }, { data: hand }] = await Promise.all([
    sb.from('card_games').select('*').eq('id', id).maybeSingle(),
    sb.from('card_hands').select('cards').eq('game_id', id).eq('player', me.id).maybeSingle(),
  ]);
  if (!game) return false;
  G = { game, hand: hand?.cards ?? [] };
  if (game.gauntlet_id) gauntletBar(game.gauntlet_id, game.id, me.id, (p) => names[p] ?? 'someone');
  return true;
}

// ---------------------------------------------------------------- what just happened
function announce(g) {
  const lp = g.last_play;
  if (seenMove === null) { seenMove = `${g.move}|${lp ? JSON.stringify(lp) : ''}`; return; }   // first look: no replays
  const key = `${g.move}|${lp ? JSON.stringify(lp) : ''}`;
  if (!lp || key === seenMove) return;
  seenMove = key;
  const p = lp.player, name = plain(who(p));
  let line = '';
  if (lp.caught) { line = `🚨 ${name} caught ${plain(who(lp.caught))} not calling their last card: +2`; if (lp.caught === me.id) { note('🚨 Caught! You forgot to call it: +2 cards.', 'error'); sfx('buzz'); } else sfx('sneaky'); }
  else if (lp.timeout) { line = `⏱️ ${name} ran out of time and drew a card`; if (p === me.id) note('⏱️ Too slow! You drew a card.', 'error'); }
  else if (lp.passed) line = `${name} passed`;
  else if (lp.drew && !lp.card) line = `${name} drew a card`;
  else if (lp.card) {
    const c = lp.card, tgt = lp.target ? plain(who(lp.target)) : '';
    line = `${name} played ${label(c)}${isWild(c) ? ` → ${COLORS[lp.color]}` : ''}${tgt ? ` on ${tgt}` : ''}`;
    if (p !== me.id) sfx('clack');
    if (c === 'CS' && lp.target === me.id) splash(['🌀 SWAPPED', `${name} took your hand`, 'and gave you theirs'], { tone: 'red', ms: 2000 });
    else if (c === 'CT' && lp.target === me.id) { note(`🎯 ${name} targeted you: +3 cards.`, 'error'); sfx('buzz'); }
    else if (c === 'CP') splash(['🔀 PASS IT ON', 'Everyone passed', 'their hand along'], { tone: 'gold', ms: 1800 });
    else if (c === 'CB') splash(['💣 BOMB', p === me.id ? 'Everyone else draws 2' : `${name} bombed the table`, p === me.id ? 'Boom.' : '+2 for you'], { tone: 'red', ms: 1800 });
    else if (p !== me.id && (c === 'W4' || c.slice(1) === '+2') && g.players[(g.players.indexOf(p) + g.dir + g.players.length) % g.players.length] === me.id) {
      note(`${c === 'W4' ? '+4' : '+2'} for you, and you skip a turn.`, 'error'); sfx('buzz');
    }
  }
  if (lp.event === 'storm') splash(['🌪️ COLOUR STORM', `The colour is now`, COLORS[lp.color].toUpperCase()], { tone: 'gold', ms: 2000 });
  else if (lp.event === 'rain') splash(['🌧️ CARD RAIN', 'Everyone draws', 'one card'], { tone: 'gold', ms: 1800 });
  else if (lp.event === 'reverse') splash(['🔄 CHAOS REVERSE', 'The table', 'turns around'], { tone: 'gold', ms: 1800 });
  if (lp.event) line += ` · chaos: ${{ storm: `colour storm (${COLORS[lp.color]})`, rain: 'card rain', reverse: 'reverse' }[lp.event]}`;
  if (line) { log.unshift({ p, line }); log.length = Math.min(log.length, 30); }
  if (g.status === 'playing' && g.players[g.turn] === me.id && p !== me.id) sfx('chime');
}

// ---------------------------------------------------------------- the table
function render() {
  const g = G.game, mi = g.players.indexOf(me.id), over = g.status === 'over', mine = !over && g.players[g.turn] === me.id;
  announce(g);
  $('title').innerHTML = over ? (g.winner === me.id ? `${face(me.id)}You win!` : `${face(g.winner)}${nm(g.winner)} wins!`)
    : mine ? `${face(me.id)}Your turn` : `${face(g.players[g.turn])}${nm(g.players[g.turn])}'s turn`;
  $('status').textContent = over ? '' : liveOn ? `⚡ Live: ${TURN_S} s a turn` : '';
  // Opponents, in the order play reaches them from you.
  const seatOrder = g.players.map((_, k) => g.players[(mi + 1 + k) % g.players.length]).filter((p) => p !== me.id);
  $('seats').innerHTML = seatOrder.map((p) => {
    const k = g.players.indexOf(p), n = g.counts[k] ?? 0;
    return `<div class="seat ${!over && g.turn === k ? 'turn' : ''}">
      ${avatar({ username: names[p], bot: isBot(p) }, 'sav')}
      <span class="who">${esc(names[p] ?? 'someone')}</span>
      <span class="fan" aria-hidden="true">${'<i></i>'.repeat(Math.min(n, 10))}</span>
      <span class="count">${n} card${n === 1 ? '' : 's'}</span>
      ${g.called.includes(p) && n === 1 ? '<span class="tag">☝️ Last card</span>' : ''}
      ${g.exposed === p && !over ? `<button type="button" class="catch" data-catch="${p}">🚨 Catch!</button>` : ''}
    </div>`;
  }).join('');
  $('top').innerHTML = g.top ? cardHTML(g.top, 'big') : '';
  $('ring').style.setProperty('--c', `var(--${g.color})`);
  $('dir').textContent = g.dir === 1 ? '⟳' : '⟲';
  const left = g.next_chaos - g.move;
  $('chaosIn').textContent = over ? '' : left <= 1 ? '🌀 chaos next move!' : `🌀 chaos in ${left} moves`;
  // Your hand.
  const hand = [...G.hand].sort((a, b) => order(a) - order(b)), canAny = mine && hand.some((c) => playable(c, g));
  $('handLabel').innerHTML = `${face(me.id)}Your hand · ${hand.length} card${hand.length === 1 ? '' : 's'}${g.called.includes(me.id) && hand.length === 1 ? ' · ☝️ called' : ''}`;
  $('hand').className = `hand ${mine && !busy ? '' : 'off'}`;
  $('hand').innerHTML = hand.map((c) => cardHTML(c, mine && playable(c, g) ? 'can' : '', `data-card="${c}"`)).join('');
  const db = $('drawBtn'); db.disabled = !mine || g.drew || busy; db.classList.toggle('go', mine && !g.drew && !canAny);
  db.textContent = g.drew && mine ? 'DREW' : 'DRAW';
  const lb = $('lastBtn'), exposedMe = g.exposed === me.id && !over;
  lb.hidden = !(exposedMe || (mine && hand.length === 2));
  lb.setAttribute('aria-pressed', String(exposedMe ? false : callLast));
  lb.textContent = exposedMe ? '☝️ Last card! (say it before they catch you)' : callLast ? '☝️ Last card: on' : '☝️ Last card!';
  $('passBtn').hidden = !(mine && g.drew);
  $('botLiveRow').hidden = !(!over && g.players.some(isBot));
  $('del').hidden = g.created_by !== me.id;
  $('feed').innerHTML = log.map((l) => `<li>${isBot(l.p) ? '' : face(l.p)}${esc(l.line)}</li>`).join('') || '<li class="muted">Moves show up here.</li>';
  // The end.
  if (over) {
    $('endPanel').hidden = false;
    $('endPanel').innerHTML = `<h2>${g.winner === me.id ? '🏆 You emptied your hand!' : `${face(g.winner)}${nm(g.winner)} emptied their hand`}</h2>
      <p class="muted">${g.players.filter((p) => p !== g.winner).map((p) => `${face(p)}${who(p)}: ${g.counts[g.players.indexOf(p)]} left`).join(' · ')}</p>`;
    endDrama(g);
  } else $('endPanel').hidden = true;
  $('timer').hidden = !(liveOn && !over);
  robotTurn();
}
function endDrama(g) {
  const key = `drama.end.cards.${g.id}`;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { return; }
  const won = g.winner === me.id;
  splash(['🃏 CHAOS CARDS', won ? 'YOU WIN' : 'DEFEATED', won ? 'Not a card left' : `${plain(nm(g.winner))} went out first`], { tone: won ? 'gold' : 'red', ms: 2600 });
  sfx(won ? 'fanfare' : 'lose', { delay: 0.8 });
  jumpToNext('cards', g, me.id, (p) => (isBot(p) ? '🤖 ' : '') + (names[p] ?? 'someone'), 2600, $('nextSlot'));
}

// ---------------------------------------------------------------- your moves
const modal = (html) => { $('gate').hidden = false; $('gateBox').innerHTML = html; };
const closeModal = () => { $('gate').hidden = true; };
function pickColor() {
  return new Promise((done) => {
    const held = {}; G.hand.forEach((c) => { if (!isWild(c)) held[c[0]] = (held[c[0]] || 0) + 1; });
    modal(`<h2>Pick a colour</h2><div class="swatches">${Object.keys(COLORS).map((k) => `<button type="button" data-col="${k}" style="background:var(--${k})">${COLORS[k]}${held[k] ? ` · ${held[k]}` : ''}</button>`).join('')}</div>
      <button type="button" class="link" data-col="">Cancel</button>`);
    $('gateBox').querySelectorAll('[data-col]').forEach((b) => { b.onclick = () => { closeModal(); done(b.dataset.col || null); }; });
  });
}
function pickPlayer(c) {
  return new Promise((done) => {
    const g = G.game;
    modal(`<h2>${CHAOS[c].icon} ${CHAOS[c].name}</h2><p class="muted small">${c === 'CS' ? 'Swap your hand with…' : 'Who draws 3?'}</p>
      <div class="pick">${g.players.filter((p) => p !== me.id).map((p) => `<button type="button" data-p="${p}">${face(p)}${nm(p)} · ${g.counts[g.players.indexOf(p)]} cards</button>`).join('')}</div>
      <button type="button" class="link" data-p="">Cancel</button>`);
    $('gateBox').querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { closeModal(); done(b.dataset.p || null); }; });
  });
}
async function play(c) {
  const g = G.game;
  if (busy || g.status !== 'playing' || g.players[g.turn] !== me.id) return;
  if (!playable(c, g)) { note(`That doesn't match: play ${COLORS[g.color].toLowerCase()}${isWild(g.top) ? '' : ` or a ${sym(g.top)}`}, a wild, or draw.`); return; }
  let target = null, color = null;
  if (c === 'CS' || c === 'CT') { target = await pickPlayer(c); if (!target) return; }
  if (isWild(c)) { color = await pickColor(); if (!color) return; }
  busy = true; render();
  const last = G.hand.length === 2 && callLast;
  const { error } = await sb.rpc('card_play', { p_game: g.id, p_card: c, p_color: color, p_target: target, p_last: last });
  busy = false; callLast = false;
  if (error) { note(friendly(error), 'error'); await refreshNow(); return; }
  sfx(isWild(c) ? 'pop' : 'clack'); navigator.vibrate?.(20);
  if (G.hand.length === 2 && !last) note('One card left and you didn\'t call it: tap ☝️ Last card! before someone catches you.');
  notify('cards', g.id);
  await refreshNow();
}
$('hand').addEventListener('click', (e) => { const b = e.target.closest('[data-card]'); if (b) play(b.dataset.card); });
$('drawBtn').onclick = async () => {
  const g = G.game; if (busy) return;
  busy = true; render();
  const { data, error } = await sb.rpc('card_draw', { p_game: g.id });
  busy = false;
  if (error) { note(friendly(error), 'error'); await refreshNow(); return; }
  sfx('clack');
  await refreshNow();
  if (data && G.game.drew && G.game.players[G.game.turn] === me.id) note(`You drew ${label(data)}. Play it, or pass.`);
  else if (data) { note(`You drew ${label(data)}: no match, turn over.`); notify('cards', g.id); }
};
$('passBtn').onclick = async () => {
  const { error } = await sb.rpc('card_pass', { p_game: G.game.id });
  if (error) note(friendly(error), 'error'); else notify('cards', G.game.id);
  await refreshNow();
};
$('lastBtn').onclick = async () => {
  if (G.game.exposed === me.id) {
    await sb.rpc('card_last', { p_game: G.game.id }); sfx('pop'); note('☝️ Last card! You\'re safe.'); await refreshNow(); return;
  }
  callLast = !callLast; render();
};
$('seats').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-catch]'); if (!b) return;
  b.disabled = true;
  const { data, error } = await sb.rpc('card_catch', { p_game: G.game.id, p_target: b.dataset.catch });
  if (error) note(friendly(error), 'error');
  else if (data) { splash(['🚨 CAUGHT!', plain(nm(b.dataset.catch)), 'draws 2'], { tone: 'gold', ms: 1500, sound: null }); sfx('sneaky'); }
  else note('Too late: they already called it.');
  await refreshNow();
});
$('del').onclick = async () => {
  const b = $('del');
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to delete the game for everyone'; return; }
  const { error } = await sb.rpc('card_delete', { p_game: G.game.id });
  if (error) { b.textContent = friendly(error); return; }
  location.href = './';
};

// ---------------------------------------------------------------- the robot, and the live timer
// The robot plays a moment after its turn comes round (and now and then catches someone who
// forgot their last card). Any page at the table can ask; the server only lets one count.
function robotTurn() {
  const g = G.game;
  if (g.status !== 'playing' || !g.players.some(isBot)) return;
  const botsTurn = isBot(g.players[g.turn]), key = `${g.move}|${g.drew}|${g.exposed}`;
  if (!botsTurn && !(g.exposed && !isBot(g.exposed))) return;
  if (botAsked === key) return;
  botAsked = key;
  setTimeout(async () => {
    if (!G || `${G.game.move}|${G.game.drew}|${G.game.exposed}` !== key) return;
    await sb.rpc('card_bot_play', { p_game: g.id });
    await refreshNow();
  }, botsTurn ? 1300 : 2200);
}
const TURN_S = 20;   // live turn length; card_timeout (019) allows a timeout after 19.5 s
setInterval(() => {
  if (!G || !liveOn || G.game.status !== 'playing') return;
  const left = TURN_S - (Date.now() - new Date(G.game.turn_at).getTime()) / 1000;
  $('timerBar').style.width = `${Math.max(0, Math.min(1, left / TURN_S)) * 100}%`;
  if (left < -0.3 && askedTimeout !== G.game.move) {
    askedTimeout = G.game.move;
    sb.rpc('card_timeout', { p_game: G.game.id }).then(() => refreshNow());
  }
}, 200);

// ---------------------------------------------------------------- start
let refreshNow = async () => {};
(async () => {
  if (!(await signedIn())) return;
  const id = (location.hash.match(/game=([0-9a-f-]{36})/) || [])[1];
  if (!id || !(await load(id))) { $('title').textContent = 'Game not found'; return; }
  $('logFold').open = !isPhone();
  announceChaos({ gameId: id });
  refreshNow = async () => { if (await load(id)) render(); };
  render();
  let pending = false;
  const refresh = () => { if (pending) return; pending = true; setTimeout(async () => { pending = false; await refreshNow(); announceChaos({ gameId: id }); }, 150); };
  liveGame(`cards-${id}`, [{ event: '*', table: 'card_games', filter: `id=eq.${id}` }], refresh, async () => {
    if (!G) return;
    if (await chaosClock()) return refresh();   // anything overdue on a stalled turn lands now
    const { data } = await sb.from('card_games').select('updated_at').eq('id', id).maybeSingle();
    if (data && data.updated_at !== G.game.updated_at) refresh();
  });
  // Live mode: while everyone at the table has the page open, TURN_S seconds a turn.
  livePresence('cards', id, (v) => {
    liveOn = v;
    if (v && G.game.status === 'playing') splash(['⚡ LIVE TABLE', G.game.players.filter((p) => !isBot(p)).length > 1 ? "Everyone's here" : 'You vs the robot', `${TURN_S} seconds a turn!`], { tone: 'gold', ms: 1800 });
    else if (!v && G.game.status === 'playing') note('Live table over: take your time again.');
    render();
  });
  navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.url) location.href = e.data.url; });
  const upNext = () => nextUpChip(me.id, id, (p) => (isBot(p) ? '🤖 ' : '') + (names[p] ?? 'someone'));
  upNext(); setInterval(() => { if (!document.hidden) upNext(); }, 20000);
})();
