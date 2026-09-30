# Family Game Room — working notes

A private, live multiplayer game site for one family: `dad_commander` (the owner, who
talks to Claude), `phoenix_lord` (son, ~18) and `obanai_rocks` (daughter, 14), plus the
robots `admiral_bot`, `bot1`, `bot2`, `bot3` and `bot4` (033). Logins are
`<username>@thegame.com` in Supabase Auth, made by hand in the dashboard; the site takes a bare
username. A new account only becomes a robot once it's in `public.bots`.

- **Site:** https://byndbelief.github.io/game-room/ — plain HTML/JS in `web/`, no build step.
- **Backend:** Supabase project **theGAME** (`okywhdfmdpdvrfhbkyeo`, us-west-2): Postgres with
  row-level security, `security definer` RPCs for every move, Realtime, and the `notify`
  Edge Function (Web Push, VAPID).
- **Games:** ⚓ Battleship, ⛳ Putt Post (mini golf), 💥 Hilltop Duel (artillery), 🃏 Chaos
  Cards (an Uno-style shedding game), and 🏆 **the Gauntlet**, a best-of series of random
  rounds of those four. Chaos layer on top:
  loot, curses, twists (`005_chaos.sql`). Cheating is a deliberate game mechanic.
  Loot rates (`039_more_loot.sql`): `_chaos_after_move` scales each game's loot chance by 1.8 (a
  chance over 1 is one drop for sure plus a second at the remainder) and gives any move with no
  loot chance, a miss included, a 6% "lucky find"; `_chaos_drop` gives 70% of a Battleship, Putt
  Post or Hilltop drop from that game's own items (the rest from the general table); a special
  Chaos Card drops loot 25% of the time. Add a new game item to its `own` list there too.

## Product direction (decided — apply, don't re-ask)

- **The Gauntlet is the main mode.** The lobby leads with it. **One running Gauntlet per
  rival** (a rival = a group of players): starting one with the same people resumes it,
  and when one ends the next starts automatically (same players, same length). Lobby
  shows one card per rival with titles won. The starter can **Call off** (lobby card and
  the in-game Gauntlet bar, tap twice).
- **Quick play** (a single game on its own) is **one layer down**: the lobby shows a single
  "Quick play ›" row that opens its own screen (`#quick`). It's capped at **one game of each kind per
  group of players** — starting another picks the running one back up (client-side check).
- Goal behind both: nobody should have to keep track of a pile of games.
- **Desktop** (`min-width:1000px` and `min-height:560px`, not full screen): the game area as big as
  the window allows with the controls beside it, everything on one screen. Duel: battlefield left,
  a 360px column (controls, dodge, backpack, result, shots). Putt Post: the course sized to the
  window height (`sizeCanvas`), hole info / putt bar / backpack / scorecard in a column beside it.
  Both pages are CSS grids whose rows are content-sized with a last `1fr` row, so the game area can
  span them all without spreading the side column. Battleship: boards sized to leave room for a
  compact floating fire bar that also carries the backpack (`deskBar()`). The ▶ Next chip sits top
  center on desktop. The lobby (`.lobby.lobhome`) is two columns: `.lobmain` (Gauntlet, Your move) and
  `.lobside` (scoreboard / quick play links, your games, backpack, chaos); the scoreboard likewise
  (`.smain` standings + every stat, `.sside` hall of fame + head to head). On phones those wrappers
  are `display: contents`, so the stacking order is unchanged. The scoreboard and trophy case reuse
  the `.lobby` class, so desktop lobby rules must target `.lobhome`, not `.lobby`.
- **Mobile first.** On phones the game area is the focus: lists fold (`details.mfold`),
  tips/instructions/errors are quick popovers (`note()` / `noteMirror()` in `common.js`),
  cheats and backpack are one scrollable row each. **Full screen covers only the game
  area** (`fsButton('#id')`), never the whole page.
- **Cheats are hidden** — no buttons or labels; players have to find them. Only an occasional
  cryptic 🤫 rumour hints they exist (`rumour()` in `common.js`). Don't add visible cheat UI
  or explain the gestures in the site. The gestures (`onHold` / `onTaps` in `common.js`):
  Battleship — hold a rival's square = 👀 peek, hold one of your own ships = 🚢 sneak it away,
  triple-tap the "Your turn" title = ➕ extra shot (server allows 2 cheats per game).
  Putt Post (multiplayer only) — hold your ball = 🦶 foot wedge then tap where to kick it,
  triple-tap the Strokes pill = 🔄 mulligan, hold the hole's name = ✏️ pencil whip on/off.
  Calling cheater stays visible: that's the counterplay.
- **Hilltop Duel tanks move** (`011_tank_moves.sql`): up to 40 px of fuel a turn, own side
  only, sent with the shot (`duel_fire(…, p_x)`), recorded per shot (`duel_shots.from_x`) so
  replays fire from the right spot. Engine functions take the tank positions (`xs`). The robot
  drives too: it scouts spots within its fuel with a coarse search, rolls to the best (Rookie
  more at random) and fires from there via `duel_fire_bot(…, p_x)`. The aim
  player being aimed at can **dodge** (`013_dodge.sql`, `duel_dodge`): up to 20 px from where
  their tank stood when the shooter's turn began (`turn_x`), streamed live and saved as they go;
  not against the robot (it fires too fast). Each shot records the target's spot as the shooter
  saw it (`duel_shots.target_x`) so a late dodge can't make devices disagree.
- **Live battle** (`014_live_battle.sql`): a duel stops taking turns by itself while both players
  have it open. Each duel page checks in with `duel_here()` every 3 s (and leaves on hide/close);
  "both here" = both checked in within 8 s, never with the robot. Live, either player fires
  whenever their cannon has reloaded (3 s on the page, 2.5 s enforced) via `duel_fire_live`, which
  takes damage as **amounts** (`p_dmg`) so two shells landing together both count, and drives
  freely on their own side (`duel_dodge` skips turn and fuel while live). Shells fly concurrently
  (`shells` in `duel.js`; `shot` is only a turn-based shell). Each shot records the move its wind
  was read at (`duel_shots.wind_move`). When someone leaves it goes back to turns, the player shot
  at last going first. Dodge therefore mostly matters in the few seconds before live kicks in.
- **Live chaos in Battleship and Putt Post too** (`015_live_chaos.sql`, `livePresence()` in
  `common.js`, `live_here(kind, game)` on the server; never with the robot). Battleship: while
  everyone still afloat has the game open, tap any rival's square to fire one shot (`fire_live`,
  1.5 s enforced / 2 s on the page); the view stays on your board instead of jumping to each hit;
  cheats work live; nobody calls cheater any more (065). Putt Post:
  everyone plays the current hole at once, each into their own turn slot (`golf_submit_live`; the
  slot is `hole row * n + player index`), rivals' balls show as ghosts with their face (broadcast
  `ball`), the hole moves on when all are in, first in the cup earns a sneak attack, and cheating is
  refused while live. `_golf_submit` now always advances `t` past slots already played, so turns
  pick up cleanly when live ends.
  **Sneak attacks are backpack loot** (`041_golf_attack_loot.sql`): five items `atk_ice`, `atk_wind`,
  `atk_cup`, `atk_bumpers`, `atk_butter` (attack types 1-5, `ATK_ITEMS` in golf.js), in Putt Post's
  own loot. `use_loot` plants that attack on **every other player** without one waiting (refused
  if none can be hit); usable on your own hole, or any time live. The old per-game 🎯 tokens and the
  plant panel are gone for people: a trigger on `golf_players` (`_golf_tokens_to_loot`) turns every
  token a person earns (birdie+, catching a cheater, first in the cup live) into a random attack
  item and starts them at 0; robots keep tokens and still plant one attack at one victim.
  `golf_plant` is unused by the page. **Live** (`040_golf_live_attacks.sql`): an attack touches
  `golf_games.updated_at` so every page refreshes, and the target's page (`checkLiveAttack`) lands
  it on their next putt (`attackFrom` = putts already played; mid-roll it waits for the ball to
  stop). The save sends `p_attack_from` (-1 = never saw one: the attack is left for the next hole
  via `golf.no_attack`), stored as `golf_turns.attack_from`; `replayTurn` plays the plain hole until
  that putt. A robot racing live asks `golf_bot_live_attack` before each putt.
- **Live vs the robot** (`017_robot_live.sql`): a "⚔️ Live battle vs robot" switch on each game page
  when the robot plays (`set_live_bot`, column `live_bot`); while on, the robot counts as always
  "here". It acts from the watching page: Duel `botLiveShot` (drives a little, aims at where you are
  now, reload Rookie 2.3 s / Pro 1.6 s / Ace 1.3 s — yours 1.5 s, server floor 1.2 s (025) — wobble 1.8× turn-based, 4 s grace) →
  `duel_fire_live_bot`; Battleship the page asks `fire_live_bot` every 1.2 s and the server picks
  target and square and allows one shot per 1.2 s, asked every 0.6 s (026; your guns: 1 s, server floor 0.8 s); Putt Post `botLiveHole` plays its ball as a 🤖
  ghost (think Rookie 3.6 s / Pro 2.6 s / Ace 2 s per putt) → `golf_submit_live_bot`. In a live
  Battleship game `fire` no longer also runs `_bot_maybe_play`. The aim
  hint is deliberately a rough guide — a hidden per-turn error, a wobble, 65% of the flight —
  because the family found an accurate one made every shot a hit. Don't make it exact again.
- **Chaos Cards** (`018_chaos_cards.sql`, `web/cards.html` + `cards.js`): 2–4 players, 7 cards,
  match colour or number/symbol, first to empty their hand wins. Cards are text codes (`R5`, `GS`,
  `B+2`, `YR`, `W`, `W4`) plus four chaos wilds: `CS` swap hands, `CT` target draws 3, `CP` everyone
  passes their hand along, `CB` bomb (everyone else draws 2). Every 4–6 moves a random event hits
  the table (colour storm, card rain, reverse). One card left without calling "Last card!" leaves
  you `exposed`; anyone can catch you (+2) until you call it late or the next move is made. Hands
  are secret (`card_hands` RLS: own row only); `card_piles` has no policy at all, so the deck never
  leaves the server — keep it that way. Live (`live_here` kind `'cards'`): 20 s turns (`019_cards_turn_time.sql`; `TURN_S` in cards.js), any player's
  page calls `card_timeout` (slow player draws 1). The robot plays via `card_bot_play` from a
  watching page and counts as always present. Gauntlet deals it for any player count; the chaos
  clock makes a staller draw 2/4, and a 24 h Gauntlet forfeit goes to the fewest cards.
- **Toolbar** (`setGameTools` in common.js): one fixed cluster at the top-right of *every* page —
  ⚙️ Settings always, and in games 🤖 live-vs-robot (`bot: { on, label, onToggle }`), ⛶ full screen
  and 🗑 delete. Notes (toasts) start below it; don't put per-page full-screen or delete buttons
  back. In a game (`onGamePage()`) chaos news (loot, curses, twists) does *not* toast: it collects
  in the toolbar's 🔔 (badge + one tick sound; tap for the list), unless the `gamePopups` Setting
  (default off) asks for pop-ups. In-game `note()`s are smaller and shorter; errors keep full size.
  **Nothing may block a live game on a phone**: "Live!" splashes use `splash(…, { passThrough: true })`
  (touches go through, 1.4 s); notes on game pages are `pointer-events:none`; golf's `noteMirror`
  skips tip changes while you aim or roll in a live race; a sneak attack at tee-off in a live race
  lands without its "Bring it on" box (and a race starting with that box open closes it).
  Grid children holding the scrolling backpack row need `min-width:0`, or the row widens the page
  past a phone's width (duel.html `.controls`).
  Pages call `setGameTools({ fs, canDelete, onDelete })` on render (onDelete returns an error
  message or navigates away); app.js's `view()` hides it so only the Battleship game view shows it.
  The page's top row carries class `gtop` to leave room. While full screen is on, the toolbar and
  ⚙️ Settings move *inside* the `.fs-on` element (`fsHost`): native full screen puts that element
  on the browser's top layer, above any z-index. In full screen Settings sits top-left.
- **Chaos Cards loot** (`024_card_loot.sql`): 👀 `xray` (see a hand; the cards come back only to
  the user's page), 🎨 `paint` (set the colour), 🗑️ `trash` (discard a card), 🎁 `gift` (hand a card
  to an opponent), all through `card_use_loot` on your own turn, none ending it. Trash and Gift
  need 3+ cards in hand so they can never take you out. Uses write `last_play.loot` (with `at`, so
  every use is a new event) for the other pages' log. Card games drop card items; action and chaos
  cards drop one 1 in 8 (`card_play`).
- **Hilltop Duel for 3-4 players** (`023_duel_multi.sql`): free-for-all, last tank standing.
  Everything is sized by `n = players.length`, and **a 2-player duel must play exactly as before**
  (keep the `n = 2` branches). Tanks start at `startXs(n)` / `_duel_start_x(n)` and drive within
  `zones(n)` / `_duel_zone(n, i)` (engine and SQL must agree). With 3+ the angle is absolute, 5-175
  (past 90 fires left, `aimDir`); 2 players keep 5-85 facing each other. Shells stop at any other
  tank; a null in `xs` is a tank that's out (`standing()` in duel.js, by the HP *before* the shot, so
  replays of a knockout still hit). Turns skip dead tanks (`_duel_next`); `duel_shots.xs` records
  every tank's position for replays (`from_x`/`target_x` remain for 2). Live messages carry `from`
  (seat); a message without it is from "the other one" of two. Each robot picks its own target
  (`botTarget`: nearer, whoever last hit it, a tank at ≤ 25 HP, plus a big random share) and keeps
  it 3 shots; people and robots count alike. It was "the weakest tank standing" for every robot,
  so the table ganged up on whoever took the first hit, usually the person. Live only the first human still standing drives it (`botDriver`). **Never rebuild
  `hp` as a two-value array**: curses, repairs and the chaos clock update `hp[i]` in place.
  The Gauntlet deals duels for any group size (`_duel_new`); 24 h forfeit = `_duel_knockout`.
- **Battleship themes** (`027_bs_themes.sql`, art in `web/bs-themes.js`): the board is a sea view —
  one water layer (`.sea-<theme>`) under the grid, ships drawn as SVG across their squares
  (`vesselSVG`), see-through squares on top; cells are placed explicitly (grid-area) because the
  water overlaps them. Each fleet is drawn in its **owner's** theme (`profiles.bs_theme`, read by
  everyone). 🌊 sea free, 🏴‍☠️ pirate at 3 Battleship wins, ⚔️ viking at 10 (counted from `results`;
  a crossing win posts a chaos note), 👽 ufo is an easter egg: five quick taps on a board's empty
  top-left corner → `unlock_bs_theme('take me to your leader')`. Don't advertise it in the UI.
  Picked on the **ship placement screen** (`themeTiles()` in common.js, cached per page; `set_bs_theme`), no longer in ⚙️ Settings; 030 rewords the unlock notes to match. Opponents' ships show only once sunk, as wrecks.
- **Shared Ocean** (Battleship mode 2, `028_bs_shared.sql`): every fleet (4,3,3,2 each) hides on one
  12×12 grid and you fire at the ocean, not a player. The page's board owner is the sentinel
  `'ocean'` (`OCEAN`, `isShared()` in `app.js`); `fire`/`fire_live` get `p_target: null` and the
  server (`_fire_ocean`) records `shots.target` = the owner of the ship hit, **null for a miss**
  (so `target` is nullable now — code reading shots must not assume it). Placing goes through
  `bs_shuffle()` because nobody can see the others' fleets; `set_fleet` refuses an overlap
  ("anchored there first") and the page reshuffles. Your own squares aren't clickable (server
  refuses them too). No cheats or accusations there (a trigger refuses them) and the page hides
  Sonar; Double Salvo, live battles and the robot (`_bot_pick_shared`) all work.
- **Battleship ready check** (`022_fleet_ready.sql`): fleets are secret until the game ends, so
  who has placed theirs is `games.ready`, kept by a trigger on `fleets` insert. The setup screen
  lists every player as ✅ Ready or ⏳ Placing ships from it.
- **Who's live** (`021_online.sql`): every page checks in every 15 s through `here_now(page, game,
  away)`, which returns the whole family's status (live = checked in < 45 s ago and not away; a
  hidden tab reports away at once). `common.js` `startOnline` runs it (from `signedIn`, and from
  `loadMe` in app.js) and paints any avatar carrying `data-u` (every `avatar()`/`face()` does):
  green ring `.is-on` while live, glowing `.is-here` while at your game. The lobby header's Who's
  here row (`renderHere`, on the `online` event) lists everyone else with where they are or when
  last seen; Your move cards get a "Live now" / "At the table now" badge (`paintUpLive`, repainted
  in place). Robots are left out. It's a DB heartbeat on purpose: the e2e stack's Realtime is a
  stub with no presence.
- **Deleting finished games** (`020_hide_finished.sql`): 🗑 on each finished game, each Gauntlet
  bundle and each round inside one, plus "Clear all" — two taps. It is **per player**: a row in
  `hidden_games` (`hide_finished`, `hide_all_finished`) that `loadGames` filters out. Games are
  shared, so never turn this into a real delete: the other players still have the game, and the
  results log and the rival cards' Gauntlet titles keep counting it. Only finished games qualify.
  A half-confirmed 🗑 (`armedDel`) and an opened bundle (`openBundles`) survive the list
  re-rendering, which any realtime change in the family triggers.
- **Duel weapons** (`016_duel_weapons.sql`; physics in `duel-engine.js`: `simulateWeapon`,
  `weaponCraters`, `weaponDamage`): loot shells beside 💣 Big Bertha, loaded from the backpack on
  your turn (or any time live), one special shell at a time (`duel_games.armed`, player → weapon).
  🎆 Cluster Bomb splits at the top of its arc into three bomblets (up to 3 craters, saved as a
  list); 🚀 Homing Missile steers at the enemy on the way down; ⚡ Railgun is a straight beam
  through hills (the angle setting maps to -40°..+40°, power is ignored, 45 on a direct hit only);
  🪨 Dirt Bomb piles a hill (a mound crater `[x, y, r, 1]`). The server checks craters fit the
  weapon and records it on the shot (`duel_shots.weapon`) so replays match. Everyone got a
  starter crate of all four; about a third of loot drops are weapons now. Robots don't use them.
- **Digging** (`029_duel_dig.sql`): two new terrain edits in `duel_games.craters`, both
  **relative** to the ground at that point in the list (so the server never needs hill heights):
  a cut `[a, b, from, 2]` (⛏️ Dig mode on the Move bar, a tunnel: see below; `digCut()` in the engine and `_duel_cut()` on the server must stay identical) and a pit
  `[x, depth, r, 3]` (🕳️ Foxhole loot). `duel_games.foxholes` is player → x; you're dug in while
  your tank stands at that x: blasts × 0.6 (× 0.5 more with a Shield) — the `shielded` damage arg
  now takes multipliers (`guards()` in duel.js). Digs save with the shot (`duel_fire p_dig`) or,
  live, with the drive (`duel_dodge p_dig`); until then `pendingCuts()` draws them. Since edits can
  land after a shot, replays find the ground before a shot with `cratersBefore()`, not by count.
  **Tunnels**: a dig slopes down 0.8 px/px from the tank's footing; where there's ≥ 6 px of hill
  above the 22 px hollow it becomes a tunnel (`top.under[x]` = its floor; `top[x]` stays the
  surface), else an open trench. A tank in a tunnel stands on the floor (`standY`) and is covered
  (`coveredAt`, ⛰️ in the HP chip). A hollow is air (`solidAt`): shells fly inside it, so a tank in a
  tunnel fires out of its mouth or into its own roof (`hitAt`: a roof hit from inside explodes
  there). A blast with more than ~8 px of solid hill between it and a covered tank does nothing to
  it (`blocked`, 035); the railgun ignores hills. A crater that bites into the hollow opens it.
  A blast whose centre is *inside* the hill (fired into your own roof) hollows it out instead:
  the hollow's ceiling rises (`top.ceil[x]`, read through `ceilAt`; default floor − 22), columns
  with no hollow get a cave, and a roof left under 4 px falls in, so repeated shots bore out.
  Surface hits never make hollows (a slope beside a crater stays solid).
  **🔻 Bunker Buster** (`buster`, 035): flies like a shell, bores up to 80 px down from where it
  lands, goes off at the end or on breaking into a hollow, and saves a shaft `[x, y, r, 4]` (dug
  from the surface down through its blast) — the one weapon that reaches a dug-in tank. The server
  accepts a 4-element crater only from a loaded Dirt Bomb (…, 1) or Bunker Buster (…, 4).
  **🚁 Drone Strike** (`drone`, 038): no shell from the tank. You pick a spot along the map
  (`dropX`: tap the battlefield or the Drop slider, which replaces Angle/Power while it's loaded);
  a drone flies in from your side at `droneY()` (a fifth of the way down, below the score bar and
  above every hill) and drops a bomb that falls straight down, drifting with half a shell's wind.
  The spot is **saved as the shot's angle and power** (`droneAim(x)` → angle 5-85 fine, power
  coarse, 81×81 steps; `droneX(angle, power)` reads it back, exact on every map width), so shots,
  replays, the live channel and the server's shot check need nothing new. `myAim()` is what every
  fire path and `sendAim` send. Plain crater `[x, y, 26]`; it can hit the shooter.
- **Battlefield size** (`031_duel_world.sql`): `duel_games.world` is the width — 800 for 2 tanks,
  1000 for 3, 1200 for 4 (`_duel_world`); height is 440 × world / 800, so the same canvas shows
  more ground: zoomed out. The engine's `W`/`H` are live `let` exports set by `setWorld()` (the duel
  page on load, the lobby per preview). Start spots and stretches scale with the width and match
  the server's `_duel_start_x(n, w)` / `_duel_zone(n, i, w)`; at 800 they're the old numbers, and
  duels made before 031 stay 800.
  **Up to 6 tanks** (`032_six_players.sql`): 5 → 1400, 6 → 1600, tanks evenly spread; HP chips go
  to two rows of three. Shell speed per power point is `0.12 × √(W/800)` (`PV()`), so full power
  spans any field (range ∝ speed²); at 800 it's unchanged. Putt Post also takes 6 (just the cap).
  Battleship and the Gauntlet went to 6 as well (034); Chaos Cards stays 4. Local e2e: add `test_five` / `test_six` to
  `auth.users` to have 6 players.
- **Several robots in one game** (`033_more_bots.sql`): turns always worked for whichever robot's
  turn it is; after a robot, the first person still at the table drives the next one (duel.js
  `decide`, golf.js `decide`). In Hilltop, once every person is knocked out the first person in
  the duel keeps driving the robots (`botHost`), so a robots-only ending plays out. Live modes act per robot: Battleship's `fire_live_bot` fires for
  every robot whose guns have reloaded (each shot in its own sub-transaction), and Hilltop /
  Putt Post pass `p_bot` to `duel_fire_live_bot` / `golf_submit_live_bot` (per-seat reload timers
  in duel.js, per-robot hole rows in golf.js). Local e2e only has `admiral_bot`: add `bot1@x.com`
  and `bot2@x.com` to `auth.users` and re-run 033 to get more.
- **Fresh code after a push** (`web/sw.js`): GitHub Pages sends `max-age=600`, so for 10 minutes
  after a push a browser could run the old scripts (a 6-robot duel where only admiral_bot fired
  was just that). The service worker re-fetches the site's own pages/JS/CSS with `cache:
  'no-cache'` (a cheap 304 when unchanged). The e2e harness blocks service workers
  (`serviceWorkers: 'block'`) because Playwright's `page.route` can't see a worker's requests.
- **Hilltop camera** (4+ tanks, `cam` in duel.js): zoom 1–3× around a battlefield point. Pinch
  (two fingers) zooms and pans; one finger aims on your shot and pans otherwise when zoomed; the
  wheel zooms on desktop; ＋ － 🎯 ⤢ buttons (`#camBar`). A flying shell pulls the view along unless
  the person moved it in the last 4 s (`camHeld`). Every screen→battlefield conversion must go
  through `toWorld()`. On phones with 4+ tanks the HP chips, wind and zoom buttons sit above the
  battlefield (`.stage.bighud`) instead of covering it; in full screen they overlay as before.
- **Battleship player colours**: `PCOLS[seat]` (`pcol`, `pdot` in app.js) — a halo and corner dot
  on each ship (`.vessel.pc`), a ring on each hit (`.cell.owned`, by the ship's owner), a dot by
  every name (strip, tabs, board headers, Fleets list). Same palette as Hilltop's tanks.
- **Live Battleship bursts** (`037_bs_burst.sql`): 3 shots, then reload. `fire_live` refuses a 4th
  within 2.3 s; the page keeps its own shot times (`bsShots`, 2.4 s window) and shows ammo pips /
  a countdown in the fire bar. No minimum gap between shots in a burst. Robots are unchanged.
- **More chaos** (`042_more_chaos_hilltop.sql`, `043_more_chaos_golf.sql`): twists fire on 16% of moves.
  Hilltop (`_chaos_twist_duel`): ☄️ meteor shower `[x, depth, r, 5]` and 🌋 earthquake heaves/dips
  `[x, dh, r, 6]`, craters placed *relative to the ground* (the server doesn't know the terrain;
  `applyCrater` types 5/6), 🔀 shuffle (each tank to a random spot in its own `_duel_zone`), plus
  hurricane and repairs. Chaos never knocks a tank out (min 1 HP): only a shot ends a duel. The
  page animates new ones (`newTwists`/`twistFx`; never on first load). An old page draws a type 5/6
  crater as a mound, so ship page changes to crater kinds *before* the migration that makes them.
  Putt Post (`_chaos_twist_golf`): 🚩 moved cup and 🐹 gopher pair, in `golf_games.twists`
  `{ "<hole>": [{k, s: seed, t: from turn}] }` (max 3 a hole). The page places them from the seed in
  the base course (`holeWithTwists`, so `reachable()` can vet a moved cup) for turns `>= t`; turn by
  turn a twist starts at the next turn, live at the next hole row. Every hole lookup in golf.js
  goes through `holeAt(hole, attack, t)` / `myT()`. Gophers: in one, out its partner (`i^1`) at 70%
  speed (`tick`, event `'gopher'`). ⛳ **Chip Shot** loot (`chip`): the next putt is saved with a 5th
  number `1`; it flies `CHIP_AIR` ticks over everything, lands at 55% speed, and landing off the
  course, in water or in a hedge counts as water.
- **Even more chaos** (`044_even_more_chaos.sql`): twists on 25% of moves. Hilltop 🌙 low gravity
  rides on the shot's wind multiplier: `wind_x` = 1 or 3 (hurricane) **+10** in low gravity
  (`duel_games.lowgrav` = the move, like `gust`); `windFor` uses `x % 10` and `gravOf(windX)` halves
  gravity at ≥ 10, so shots, replays, the live channel and robots need nothing new. Every page-side
  wind multiplier goes through `windXOf(g, move)`. Hilltop 🎁 supply drop (loot for every person);
  Putt Post 🌫️ fog (drawing: a clearing round the ball) and 🌊 flood (a pond vetted by
  `reachable()`) as `twists` kinds; Battleship crates are a supply drop for all half the time.
- **Hilltop landscape full screen covers the screen** (phones, `(orientation:landscape) and
  (max-height:520px)` in duel.html): `fitCanvas()` gives `#cv` the screen's shape (buffer 1600×h, h < 880)
  and `viewH()` is the world height that shows at 1×; `camClamp()` sits 1× on the ground, so a wider
  screen trims the top of the sky. Everything that maps screen↔world uses `viewH()`, never `H`. The
  controls float in the corners (`#controls` is `display:contents`; aim bottom right beside a round
  FIRE, backpack up the right edge, drive bottom left, zoom down the left edge, tank cam top left).
- **Hilltop day and night** (`dayTarget`/`dayStep`/`dayNow` in duel.js): the sky follows the
  viewer's local clock (night before 6 and from 20, dawn 6-7, dusk 19-20). `draw()` blends every sky
  colour by `dayNow` (`mixHex`): stars fade, clouds drift in, the moon's glow warms into a sun with
  turning rays. On opening in daylight it morphs from moon to sun over 2.5 s (reduced motion: no morph).
- **Shot camera** (`rideStart`/`rideStep` in duel.js): zoomed in, the view stays where the person put
  it. A shot glides it to the shooter (turn by turn the shell waits ~650 ms for the camera, sounds
  delayed to match), follows the shell, holds on the impact, then returns to the saved spot. It's a
  critically damped spring capped at ~2 screens/s; any touch, wheel or zoom button (`camHeld`) drops
  the ride on the spot. `window.__duelCam()` exposes the camera read-only for tests.
- **Rotating start** (`048_duel_rotate_start.sql`): `_duel_new` turns `players` round by the number of
  earlier duels between the same people, so spots and first shot rotate. A robot can therefore open:
  the first person standing plays its opening shot (the `!last && host` case in duel.js). Tests that
  need the creator first reorder `players` themselves.
- **Robots-only fast-forward** (`botsOnly`/`ff`/`pause` in duel.js): once every person in a Hilltop
  duel is knocked out, turn-based robot turns run 3× faster (pauses, driving, shell flight; no slow
  motion, no camera wait) and the status says ⏩. Live battles keep their pace (the server times
  reloads). Battleship needs nothing: `_bot_maybe_play` already plays robot turns back to back.
- **Shoot the moon** (`049_shoot_the_moon.sql`; `setMoon`/`moonAt` in duel-engine.js): the moon is a
  target every page flies the same (a shell into it ends `{ impact: null, moon: true }`). The page
  says whether it's up for the move being flown (`moonUp(move)`: up while `duel_games.sun` is -1, and
  for the shell that downed it). Any page that flies it calls `duel_moon_hit` (first one counts);
  `load()` keeps a moon it saw fall (`moonGone`) until the server catches up. With a sun the sky is day
  for everyone (`dayTarget`), the sun has an angry face, and `_chaos_after_move` gives it a 30% shot
  per move (`_duel_sun_fire`: 6-14, never below 1 HP) saved in `sun_shot` = [count, tank, dmg]; pages
  draw the beam for a count newer than they've seen (`sunCheck`, not on opening).
- **Orogeny** (`050_orogeny.sql`, patching `_chaos_twist_duel`): an earthquake also thrusts up 1-2
  mountains ([x, 60-120, 55-100, 6] heaves) between neighbouring tanks still in. `twistFx` grinds the
  quake up over the shaking (1.8 s with mountains) by re-applying the heaves scaled on a copy of the
  ground each frame; `decide()` then rebuilds the ground exactly.
- **Regrowth** (`051_regrowth.sql`): every shell digs and shells land round the tanks, so duels used
  to end on a bare floor there. After a move, half the time, `_duel_regrow` swells the ground by one
  of the last 6 digging craters ([x, dh, 60-90, 6, 1]: about two craters' worth; the 5th number 1 tells
  `twistFx` to grow it gently via `riseGround` instead of shaking). Simulated over 80-move duels the
  ground by the tanks holds near 117 px (was falling to 23). Quakes now raise 2-3 mountains, 80-150 px.
- **Fire where you let go** (`fireHereShow`/`#fireHere` in duel.js/duel.html): a pull that aimed and
  ends over the battlefield pops a round Fire button under the finger/pointer (clamped inside the
  stage; a pull let go on the portrait panel shows none: its Fire is right there). New pull, firing or
  losing the turn hides it. Tests that click `#fire` still work.
- **The Fire cluster** (`#fireHere` in duel.html; `fhPlace`/`fhTick` in duel.js): the pop-up Fire is
  see-through and carries the fine-tune buttons (⤴⤵ left, −+ right, `data-step` so the usual hold-to-
  repeat binding picks them up) with the aim under it. In landscape full screen it replaces the corner
  Fire and nudger (both `display:none` there; `#fire` stays in the DOM and `fireHere` calls its
  onclick): `fhTick` keeps it up on your shot, where the last pull ended (bottom right, left of the
  backpack, to start). A pull that starts on the cluster turns into a normal pull after 12 px (undoing
  the nudge the press made); its buttons are `touch-action:none` so the browser doesn't scroll it away.
- **Tanks stand out**: dark outline, own-colour glow, top highlight, and a name tag ("You" for yours,
  💀 when out) sized by √(W/800). The aiming arrow sits above the tag. In landscape full screen the 1×
  view also shows a strip below the ground's bottom (`camClamp`, up to 60 world px; the ground fill
  runs to H+200) so the end tanks sit clear of the corner controls.
- **Holes fill, peaks capped** (`052_fill_holes.sql` + `applyCrater` in duel-engine.js): a heave with
  a 5th number 1 is now a *fill*: within ±r the ground rises toward the line between its rims (and 30%
  of dh over it), only where it's below that, so holes silt up and hilltops are left alone. Regrowth
  drops one on a recent crater (± 8 px, [x, 40, 45-75, 6, 1]) on 80% of moves. Rising heaves ease off
  above a ceiling at H - 285 (15 px over the tallest starting hill: a quarter as far, 25 px at most).
  Quakes raise 1-2 mountains of 50-90 px. Simulated 80-move duels: ground by the tanks ~120 px (start
  142), holes 60% shallower than 051, highest peak ~280.
- **Wind you can see** (`windStep`/`drawStreaks` in duel.js): the next shot's wind (multiplier
  included) eases into `windNow`; clouds (white by day, dim grey at night) drift with it and streaks
  blow through the sky, their length and strength with the wind, none in a calm.
- **Tank cam** (`drawTankCam` in duel.js, `#tankCam` in duel.html): zoomed in (4+ tanks) with your
  tank off screen, a corner window re-runs `draw()` with `ctx`/`cam` swapped for its own canvas and a
  camera on your tank (`camPass` stops the shell-follow from steering the real camera). It shows your
  HP, flashes with the damage when you're hit, and a tap looks back at your tank. `draw()` sizes from
  `ctx.canvas.width`, never `cv.width`, so it can draw into either.
- **Chaos extras** (`047_chaos_extras.sql`): twists on 33% of moves. Hilltop 🌀 tornado is wind
  multiplier **5** (`duel_games.tornado`, beats a hurricane; `windFor` never lets it be calm), so
  `wind_x` ∈ {1,3,5,11,13,15}; 🌧️ healing rain (+12 all) and 🔄 HP swap (up-next tank ↔ a random rival).
  Putt Post `twists` kinds 🌀 `windmill` (spinner + hub bumper, clear of rails by its blade length),
  🟤 `mud` (`h.mud` rects, friction 0.86, scaled by `scaleHole`) and 🍃 `gust` (adds to `h.wind`).
  Battleship `_chaos_twist_bs(game, 'whirlpool'|'fog')`: a whirlpool moves a rival's unhit ship clear
  of every ship and fired square; fog is `games.fog_player/fog_move/fog_shots` (their last 6 non-sinking
  shots draw as `.cell.fog` and 🌫️ in the feed while `move <= fog_move`, i.e. until their turn ends).
  047 also fixed the scoreboard glitch, whose `hole = h1` had been ambiguous (and failing putts) since 043.
- **Gauntlet Battleship at 4+** (`046_gauntlet_big_ocean.sql`): `_gauntlet_next` deals the 16×16 shared
  ocean (mode 3, robot fleets via `_random_fleet_avoid`) like `create_game` does; below 4 it's classic
  boards. Hilltop/Putt Post rounds were already sized by `_duel_new` / the course trigger.
- **Live countdown** (`045_live_countdown.sql`): presence rows keep `since` (arrival; a heartbeat
  after 8 s away is a new arrival) and `live_go(kind, game)` returns GO = last arrival + 5 s plus the
  server clock. `liveCountdown()` in common.js shows 3-2-1-GO to that moment on every screen (they
  land within a few ms), pass-through; Putt Post, Hilltop and Battleship hold putts/fire and robots
  until GO (`liveGo` / `bsGo`). A robot-only game gets a local 3 s. Cards has no countdown (turns).
- **Landscape full screen on phones** (`orientation:landscape` and `max-height ≤ 520/559px`, 047): the
  game as big as it goes, its controls in a side column under the toolbar. Putt Post turns the course
  sideways (`rot` in golf.js: drawn with `setTransform(0,k,−k,0,LH·k,0)`, `toLogical` maps touches
  back; tee left, cup right; physics untouched; resized on the `#play` class change). Hilltop: the
  battlefield full height, controls in a 212px column. Battleship: no header, boards as tall as the
  screen in a sideways-scrolling row, the fire bar a right-hand column.
- **Next-up chip** on a game page docks in the toolbar as a compact `▶ icon +n` (`.intools`); it used
  to sit bottom-left on the Putt!/Fire! bars. The lobby keeps the full chip.
- **Hilltop health** is one slim strip of pills for any number of tanks (`#hpRow`, `.hpc`): dot, face,
  HP, the pill filling with the tank's colour (`--hp`); names only from 700 px; 5-6 tanks on a phone
  drop the faces (`.tight`). The old 2-tank `.hp` labels are hidden (`.hud.multi` always).
- **Hilltop aiming is a slingshot** (like Putt Post): pull back from anywhere on the battlefield or
  the controls panel's empty space (`slingStart`/`slingMove`); the shell goes the other way, the pull
  length is power (`SLING_FULL`). The Angle/Power sliders are gone for an aim bar (`#aimbar`: ⤴ ⤵,
  readout, − +); the hidden `#angle`/`#power` ranges still hold the aim. The railgun's pull aims its
  beam; a 🚁 drone still points at its spot (`aimFromPointer`). The panel is `touch-action:none`
  while you can aim.
- **Putt Post looks**: `setGolfTheme('classic' | 'natural')` in golf-engine switches `drawHole` only
  (the physics is identical, so players in one game can each pick their own). Natural: rough with
  trees (`treesFor`, placed once per hole clear of the course), a cross-mown fairway, a green round
  the cup, rough-grass edges for rails, hedges for blocks, boulders for bumpers, raked bunkers,
  ponds with a bank, a tee box, a yellow flag. The choice is per device (`golfTheme()` /
  `setGolfThemePref()` in common.js, pref `golfTheme`), toggled by the 🌳/⛳ pill on the golf page
  (icon only on phones) and used by the lobby's hole preview too.
- **Putt Post course size** (`036_golf_course_size.sql`): `golf_games.course` (%) is set by a
  trigger from the players: 100 for 1–3, 120 for 4, 135 for 5, 150 for 6. The engine's `setCourse()`
  (golf.js on load, the lobby per preview) makes `LW`/`LH` live and `holeWithAttack()` return the
  hole scaled (`scaleHole`: every coordinate, bumper radius, slope and wind ×s, cup speed ×s; ball
  and cup radius unchanged). Holes and random obstacles are still generated in the base 360×560
  space (`BW`/`BH`), then scaled. Putt speed is `(0.6 + p·10.4) × COURSE` everywhere, and full-power
  drag is `150 × COURSE` course units (the same on screen). Friction is proportional, so the same
  power rolls the same share of the hole at any size. Games made before 036 stay 100.
- **Battleship and the Gauntlet for 6** (`034_six_gauntlet_battleship.sql`): 1–5 opponents.
  Per-opponent boards need nothing new (phones get a scrolling tab row, `.boardtabs.many`). The
  shared ocean becomes **mode 3** (16×16, same ships) when 4+ play — `create_game` switches it, so
  "the shared ocean" is `mode in (2, 3)` everywhere (`isShared()` on the page). Robot turns run in
  a loop in `_bot_maybe_play` (`_bot_play_one` is one turn); they used to call each other nested,
  200+ deep when robots finish a game between them. A Gauntlet deals only games that seat
  everyone: Putt Post, Hilltop, Battleship (6), Chaos Cards (≤ 4).
- **`live` settings default to false** (033): `fire` and `_golf_submit` read `bs.live` / `golf.live`
  with `coalesce(..., false)`. Without it, a connection that never ran a live shot read NULL and
  `if not live` skipped the robot's Battleship turn. Use the same `coalesce` for any new
  `current_setting` flag.
- **Compact backpack**: `compactPack()` in common.js (phone width *or* a touch screen) picks the
  icon row; by width alone a redraw while a phone was sideways swapped in the full panel mid-game.
- **The robot is meant to be hard at Pro and Ace, easy at Rookie.** Battleship (`012`): hunts by
  probability (every way each unsunk ship could still fit) — ~45 shots to clear a 10×10 fleet vs
  ~52 before. Duel: tight aim that steadies with every shot it takes (Pro hits ~52% → ~75% by its
  4th shot), dodges away from your last impact. Putt Post: `BOT_SKILL` tightened for Pro/Ace.
  Gauntlet rounds use Pro.
- **Clocks push play along** (`008_clocks.sql`, `shotClock` / `chaosClock` / `chaosIn` in
  `common.js`). Shot clock on your turn while on the page (Battleship 45 s, duel 30 s, Putt Post
  30 s per putt; never solo or vs the robot; pauses when the page is hidden) — at zero the
  server hits you once per turn (one shot fewer / a hurricane / +1 stroke). Chaos clock for a
  waiting turn (`turn_at`): 2 h a hit, 8 h a harder hit, 24 h the slow player forfeits a
  Gauntlet round. Pages call `chaos_clock()` (throttled) and the lobby shows "⏰ chaos in …".
- **Family scoreboard** (`#stats`, `009_scoreboard.sql`): every finished game and Gauntlet
  writes one row to `results` (trigger on status → over) with per-player numbers taken at that
  moment, so deleting games never erases history. Players can't read `results`; the page calls
  `family_stats()`, which returns totals, streaks and head-to-head only.
  Each player has a **trophy case** (`#player=<id>`, `010_trophies.sql` → `player_trophies()`):
  a shelf with a cup per Gauntlet title, and badges (`BADGES` in `app.js`) earned from the same log.
- **Player pictures:** `AVATARS` in `common.js` maps a username to a file in `web/avatars/` or an emoji
  (256 px square JPEG); `avatar(p)` renders it, or the initial for anyone without one. Shown on the
  trophy-case header, the scoreboard cards, the lobby's Gauntlet rival cards and the Your move strip
  (people only there; the robot's name already carries 🤖). In the games, `face(id)` puts a small
  one beside each name (duel HP labels, Putt Post turn pill and scorecard, Battleship board tabs and
  headers); it styles itself, so golf/duel pages need no CSS for it. The lobby's chaos feed pins the face of whoever
  caused an event (`chaos_events.actor`) to its icon; pure chaos and the robot keep just the icon. phoenix_lord has the golden phoenix, dad_commander 😎, obanai_rocks 🐍.
- **Game over → next game** (`jumpToNext()` in `common.js`): after the win/lose screen, a banner
  counts down 3 s and goes to the next Gauntlet round (or the rivalry's next Gauntlet), else the next
  game waiting on you; "Stay here" cancels. Quick-play games also get 🔁 Rematch (same players,
  same settings; not Gauntlet rounds, where the next round is the rematch); with nothing else
  waiting, the banner counts down 5 s to a **new game** (an automatic rematch). There is no "Back to all games"
  button after a match: the duel shows "Coming next" in `#nextSlot` under its result panel, Putt Post
  inside its result card (`jumpToNext(…, mount)`, which falls back to the floating banner when that
  spot isn't on screen); Battleship keeps the floating banner. The "← All games" link stays. A rematch joins a
  running game of that kind for exactly those players if there is one (one per group, like Quick
  play); on an automatic countdown only one player's page (lowest human id) creates it and the
  others wait up to ~6 s to join, so both screens land in the same single new game. Only the first time a device sees a game end, and only
  within 10 minutes of it ending, so opening an old result never bounces you away.
- Sound effects are synthesized (`web/sfx.js`, no audio files).
- **Settings** (⚙️ in the corner of every page, `openSettings` in `common.js`): per-device
  switches for Sound, Vibration (every `navigator.vibrate` goes through it) and Big moments
  (`dramaOn()`: off turns splashes into quick notes and drops the danger pulse and slow motion),
  a default Gauntlet length, **turn alerts** (the only place they live: an on/off switch that
  subscribes or unsubscribes this device's push; old `#alerts` links open Settings), My trophies,
  change password (`auth.updateUser`) and sign out. The lobby header is just the greeting. Game rules (shot clock, aim hints) are deliberately not settings.

## Layout

- `web/index.html` + `app.js` — sign-in, lobby, and Battleship (the lobby and Battleship
  share one page, routed by `#game=<id>`). `style.css` is theirs.
- `web/golf.html` + `golf.js` + `golf-engine.js`; `web/duel.html` + `duel.js` + `duel-engine.js`;
  `web/cards.html` + `cards.js` (all rules server-side, no engine).
  The engines are deterministic (seeded), so every device replays a shot identically;
  the lobby imports them for previews.
- `web/common.js` — shared by all pages: Supabase client, sign-in state, `notify`, loot,
  chaos toasts, `liveGame` (realtime + fallbacks), `nextUpChip`/`myTurns`, `gauntletBar`,
  full screen, `note`. `web/sfx.js` — sounds.
- `web/config.js` — Supabase URL, anon key, VAPID public key, username domain. All public.
- `supabase/schema.sql` (the first migration, historically unnumbered) and
  `supabase/migrations/002_…` → `007_…`, applied **in that order**.
- `supabase/functions/notify/index.ts` — turn alerts for all kinds plus Gauntlet nudges.
- `tools/e2e/` — local test stack (below).

## Deploying

- **Site:** pushing to `main` publishes via `.github/workflows/pages.yml`. The workflow
  stamps `?v=<sha>` onto every script import/link so phones never mix cached old and new
  modules — keep imports as plain `from './x.js'` and `src="x.js"`; don't hand-version.
- **Database:** every schema change is a new numbered, re-runnable file in
  `supabase/migrations/` (use `create or replace`, `drop trigger if exists`, etc.).
  Commit it, then apply it. With the Supabase connector, apply via `apply_migration`;
  otherwise the owner pastes it into Supabase → SQL Editor.
- **theGAME is the starting block.** `schema.sql` + 002–007 are the baseline, verified
  identical to production on 2026-09-27 (`supabase/BASELINE.md`). New changes are
  `008_…` onward (008_clocks, 009_scoreboard, 010_trophies, 011_tank_moves, 012_smarter_robot, 013_dodge, 014_live_battle, 015_live_chaos, 016_duel_weapons, 017_robot_live, 018_chaos_cards, 019_cards_turn_time, 020_hide_finished, 021_online, 022_fleet_ready, 023_duel_multi, 024_card_loot, 025_duel_fast_reload, 026_bs_fast_reload, 027_bs_themes, 028_bs_shared, 029_duel_dig, 030_bs_theme_wording, 031_duel_world, 032_six_players, 033_more_bots, 034_six_gauntlet_battleship, 035_bunker_buster, 036_golf_course_size, 037_bs_burst applied 2026-09-28; 038_drone_strike, 039_more_loot, 040_golf_live_attacks, 041_golf_attack_loot, 042_more_chaos_hilltop, 043_more_chaos_golf, 044_even_more_chaos, 045_live_countdown, 046_gauntlet_big_ocean, 047_chaos_extras, 048_duel_rotate_start, 049_shoot_the_moon, 050_orogeny, 051_regrowth, 052_fill_holes, 053_bs_volleys_kraken, 054_bs_shared_misses, 055_golf_big_course, 056_bs_always_shared, 057_golf_long_course, 058_chaos_curve, 059_hilltop_fractals, 060_bs_fractals, 061_cards_butterfly_recursion, 062_route_to_chaos, 063_solo_scores 2026-09-29), applied with `apply_migration` under the same name so Supabase's history
  matches the repo. `tools/drift-check.sql` compares production with a local build.
- **Edge function:** `notify` is deployed by hand (or `deploy_edge_function`); redeploy
  only when `supabase/functions/notify/` changes.
- Ask before running anything destructive against production data.

## How things work (non-obvious)

- **Moves are server-validated.** Clients never write tables directly; RPCs check turns
  and inputs. Battleship's robot plays server-side (impersonation via
  `set_config('request.jwt.claim.sub', …)`); golf and duel robots compute their shot in
  the browser of whoever is watching and submit via `*_bot` RPCs.
- **Live updates have three paths** (`liveGame` in `common.js`): Realtime postgres changes,
  a broadcast "moved" nudge from the mover's page, and a 5 s `updated_at` poll plus a
  refresh on `visibilitychange`. The duel also streams aim and the shot itself over
  broadcast so the watcher sees it instantly. Realtime joins with `realtime.setAuth` or
  RLS hides everything.
- **Deletes don't arrive over Realtime** under RLS, so the lobby also refreshes every 30 s
  and on return. Deleting a game cascades (006): its chaos events, and a Gauntlet whose
  current round it was.
- Gauntlet rounds are ordinary games with `gauntlet_id`; `_gauntlet_round_over` triggers
  score them and start the next round (or the next Gauntlet).

## Testing

Real browsers against a local copy of the backend, not mocks of the page:

```sh
tools/e2e/setup.sh            # builds Postgres 16 + all migrations + the 4 players + PostgREST, bundles supabase-js
tools/e2e/setup.sh start      # restart both after the container sleeps
PLAYWRIGHT=/opt/node22/lib/node_modules/playwright node tools/e2e/smoke.cjs
```

`tools/e2e/harness.cjs` serves `web/` at `http://app.test/`, points `config.js` at local
PostgREST, signs a player in with a locally signed JWT, and stands in for Realtime
(joins succeed; broadcasts relay between test pages; postgres changes aren't simulated).
Use `open(browser, userId, username, '#game=…', { mobile: true })` for a phone-sized touch
context. To act as a player in SQL: `select set_config('request.jwt.claim.sub', '<uuid>', true);`.

After applying a migration to a running local stack, `notify pgrst, 'reload schema'` or new
RPCs 404 (Supabase does this itself).

Gotchas: pulsing buttons (Fire!, Putt!, Gauntlet buttons) need `click({ force: true })`;
use CDP `Input.dispatchTouchEvent` for real touch drags; the jsDelivr CDN is unreachable from
the test browser (hence the local supabase-js bundle).

Before pushing: `node --check` every changed `.js`, re-run the relevant test, and for
SQL, apply it locally twice (it must be re-runnable).

## Conventions and gotchas

- plpgsql: wrap `CASE` in parentheses inside comparisons; don't name variables `found`,
  or after columns (`ships`, `hole`, `fine` bit us before).
- `app.js` is one big module — check for an existing top-level name before adding one
  (a duplicate `let` breaks the whole page).
- Per-device conveniences (mute, remembered aim, seen replays) use `localStorage` wrapped
  in try/catch; anything shared lives in the database.
- Write user-facing copy for kids and a busy parent: short, plain, a little playful.

### Battleship: your shells leave at once
`launchShell(owner, cell)` (app.js) flies your shell the moment you press Fire (or tap in a live
battle), before the server answers; `launched` remembers each square and when its shell lands. When
the shot comes back in a load, `animateShots` reveals it (`revealShot`) as soon as that shell has
arrived, with no second flight; other players' shots fly as before. An error un-launches them.
`loadGame` is one round trip now (the fleets' themes are cached in `G.themes` between loads of the same
game; the `bstheme` event clears it). Locally: Fire to first result 3.1 s → 0.55 s.

### Battleship live volleys, zoom, kraken & tornado (053)
Live battles fire in **volleys**: tapping stages squares (`stageLive`), and a full volley
(`volleySize()` = 3 + `G.shotMod`, so a ⚓ Double Salvo or a Frenzy makes it 5) goes off at once through
`fire_live_volley` (squares someone beat you to are skipped; the extra/jam is used up). The guns reload
for `BS_RELOAD` (2 s) while it flies; a volley staged during the reload fires when it ends; "Fire now"
lets a part volley go. `use_loot` allows Sonar/Salvo in a live battle. `loadGame` keeps staged squares
across live moves (it only drops ones someone fired at). 🔍 Board zoom: pinch a board (two fingers; trackpad pinch /
Ctrl + wheel) for 1×–3× around the fingers (`zoomAround`; `.bzoom` is `touch-action: pan-x pan-y` so the
page itself doesn't zoom), or step with `zoomBar()`'s buttons; `bz` is kept per device (`bs.zoom`). Chaos: 🐙 kraken (up to 2 squares
of one ship) and 🌪️ tornado (a row/column, up to 3), both never a ship's last square, saved as hits with
`shots.chaos` set and the victim as `shooter` (`_log_result` skips chaos rows); the page shows them
without a shell (`.seabeast`) and on feed lines of their own. Fog also lasts 20 s live (`fog_until`).
Old tests that tapped once to fire (t_bslive, t_burst, t_bsreload) now stage; see t_volley.

### Battleship: your own misses only (054)
Boards you fire at (a rival's, the shared ocean) hide other players' misses (`hiddenMiss` in app.js:
not on your own fleet's board, not once the game is over); the feed says "a miss" without the square,
and no shell flies to one. Everyone may miss on the same square: rows are unique per hit
(`shots_one_hit`) and per player per square (`shots_one_each`, `shots_ocean_each`), and `fire` /
`_fire_ocean` count a square taken for you only if anyone hit it or you fired at it (`openSquares`
matches). Robots still steer clear of every shot fired.

### Full-screen toolbar (common.js)
In full screen the toolbar drops ⚙️ Settings and 🗑 Delete and becomes one slim see-through strip
(`body.fs-lock #gameTools`). No strip is kept empty for it: `.fs-on` has an 8 px top pad, and each game's
top row leaves `--gtw` (the toolbar's width, re-measured by `fit()` on every full-screen change in
`fsSync`) on the right in portrait: golf's `.hudbar` (one line, title hidden), duel's `.hud`, Battleship's
tabs (its 🔍 zoom moves into the strip on the left; the shared ocean's heading row pads instead). The
page's own ← row is hidden in full screen (✕ leaves it).

### Putt Post: the big course, its camera and the labyrinths (055)
New games get a stage bigger than the screen, and holes take longer the more players (057):
`_golf_course_size` gives 200 (1–2 players), 250, 300, 350, 400 (6); the constraint allows 100–400. On a
**long course** (`course >= 160`, `LONG` in golf-engine.js) putts keep a 1-player course's power
(`POWER` = 1, not `COURSE`), and `scaleHole` leaves slopes, wind and cup speed unscaled; only the
geometry grows. Par grows with it: `parOf(hi)` = base + `(base·(course−100)·110 + 30000) / 60000`
(integers), the same as `_golf_par(hole, course)` on the server (used by `_golf_submit`, `golf_best`,
`_log_result`); calibrated by simulating a Pro robot on all 18 holes (a par 3 is 4 at 200–300, 5 at 400).
You pick up at `maxStrokes(hi)` = par + 5 there (8 elsewhere); the server takes up to 20 strokes / 24
putts. Courses 100–150 (made before 055) keep scaled putts, their par and 8. No game was ever made on
055's 170–240 sizes. golf.js has a camera (`cam`:
centre + zoom in course units, composed onto the canvas transform in `loop`; `toLogical` inverts it):
in play it sits at `z = COURSE`, so ball and cup look their 1-player size, and follows the ball
(`camStep`); idle/waiting/over shows the whole hole. `camIntro(key)` opens each hole (once per
`holeKey`) on the whole layout and zooms to the tee; in a live race it's timed to land on GO (setLive
forces it). A tap during the intro jumps to the end first. Drag power is `150 × COURSE / cam.z`, so a
full drag is the same length on screen at any zoom. 🗺️ (`#mapBtn`) toggles the whole hole; `cupPointer`
flags an off-screen cup at the edge. Bursts and confetti use the view (`viewW/viewH`).
At `course >= 160` every par-4 hole is a labyrinth (`mazeHole` in golf-engine.js, names from
`holeName()`, which the page and lobby use instead of `HOLES[i].name`): a seeded straight-biased
backtracker, `min(16, floor(320·C/62))` columns (lanes ≈ 5 balls wide as played), 20% of dead ends knocked
through; the cup is the farthest cell whose best route needs 4 straight runs; ponds in off-route dead
ends, sand on the route. Walls are zero-width segments in `h.walls` (added to `segs`, scaled by
`scaleHole`). `tick` checks rails through a grid (`railsNear`) when a hole has more than 24: same
rails in the same order within reach, so a roll is identical to the full scan (checked over 2,808
putts). Robots aim by
`flowTo(h)` (distance round walls and ponds to the cup, a flood that never crosses a rail) instead of
straight-line distance, and a foot wedge can't kick through a rail (`overRail`). The scorecard shows
each hole's total with penalties; a hole with any (splashes `actual − putts`, a false call or slow clock
`written − actual`, a busted `fine`) shows `putts+penalty` under it, and your hole in play shows its
count so far (italic `.going`).

### Battleship: always the Shared Ocean (056)
Every new Battleship game is the shared ocean: mode 2 (12×12), mode 3 (16×16) for 4+. `create_game`
ignores `p_mode` (old pages and rematches of old games still send 0/1) and `_gauntlet_next` deals mode 2
instead of Quick 8×8 for under 4, robots' fleets clear of each other. The lobby's board picker is gone
(a note says it's the shared ocean); modes 0/1 stay in `MODES` for games made before 056.

### The chaos curve (058): x → r·x·(1−x)
Chaos and fractals are the games' philosophy. Twists no longer roll a flat 33%: `_chaos_curve(kind, game)`
steps the logistic map for that game (`chaos_curve`: n, r, x, last 48 x's in `hist`, players for RLS)
and a move twists when x > 0.75. x starts at 0.05–0.95 (random), r = min(4, 2.9 + 0.04·n): calm (no
twists), then a rhythm of 2 (r ≥ 3), 4 (3.449), 8… (3.544), chaos from 3.5699 (≈ a third twist at r = 4).
Each crossing is 🌀 news to every player (the most advanced crossing wins when a step skips one).
`_chaos_after_move` calls it for Battleship, Putt Post and Hilltop; Chaos Cards steps it every
`card_play`, and an action card's chaos drop fires with it (was 25%). The page side is a 🌀 toolbar
button (`setGameTools({ chaos: { kind, id } })`, common.js `curveFor`, refetched at most every 1.5 s):
a sparkline of the last 14 x's against the twist line; tapped, `#curveBox` draws the bifurcation
diagram (built once, 720×360) with this game's path through it and r now.
**The loader** (common.js, `#chaosLoader`): every page opens on the curve playing itself while it loads:
r sweeps 2.8 → 4 over 5.2 s, a cobweb walks x round y = r·x·(1−x), and the bifurcation diagram draws
itself column by column beneath it. `loaderDone()` fades it: the first `setGameTools` call (every page's
first render, the lobby's `view()` included), or 6 s at most. Reduced motion: one still frame.

### Putt Post: the fractal cup and trees (page only)
Down in every cup is the next hole in miniature (`scene.cupArt`, drawn by golf.js `cupArtFor` at the
canvas's own resolution; the last hole's cup holds the first, and each miniature's cup holds the hole
after it, at 1/5 size). drawHole draws it as the rectangle inscribed in the cup circle, under a shadow
(`scene.cupDark`). Holing out starts `startDive()`: the camera zooms from where it is to `LW / width of
that rectangle` over 1.7 s, so the end frame is exactly the next hole's opening overview; finishTurn
waits for it (`diveDone`). If the next scene is the next hole, its `camIntro` carries on from there;
otherwise the camera eases back out of the cup. Natural-theme trees are fractal sprites (`treeSprite`:
5 limbs forking 4 deep, leaves at the tips), six looks, drawn once.

### Hilltop fractals (059)
❄️ **Fractal Shell** (loot `fractal`): flies like a Cluster Bomb to the top of its arc, then forks in two,
each branch forking again every 24 ticks, 3 times (kick 1.1, ×0.65 a fork): up to 8 bomblets, craters
`[x, y, 11]`, `22 − d` damage each (60 cap). It saves a crater list like the cluster (`MULTI` in
duel-engine.js); `_duel_fire` takes up to 8. **Fractal hills**: `duel_games.terrain` (default 1 from 059,
0 for older games) → `setTerrain()` beside `setWorld()` (duel.js load, lobby preview). `baseTerrain` then
uses two slow swells plus `fractalLine` (midpoint displacement, level ends, amp 200, roughness 0.55), and a
rising quake heave `[x, dh, r, 6]` gets its own seeded crag-line. Server never builds terrain, so no SQL
change beyond the column.

### Putt Post: zoom and pan (page only)
A capture-phase gesture layer on the canvas (golf.js, before the aim handlers) takes any pointer that
isn't a one-finger aim: two fingers pinch/pan, one finger pans when `mode` isn't aim/wedge, mouse
right-drag pans, the wheel zooms round the pointer (ctrl-wheel, a trackpad pinch, faster). It stops the
event so the aim never sees it, and cancels an aim in progress. `viewAt(z, w, L)` keeps course point w
under canvas point L (z from 1 to `max(3, 2.5·zPlay)`), sets `cam.uz` (your zoom) and `cam.hold` (stay
put). camStep then targets `uz` and only follows the ball when not held, or while it rolls; `putt()`
drops the hold, so the next putt is followed at your zoom. 🗺️ and `camIntro` clear both.
`toL()` is a screen point in canvas units, `worldOf()` puts it through the camera.

### Battleship fractals (060)
🏝️ **Islands**: a `games_islands` trigger gives every new shared ocean `games.islands` (mode 2: 2 islands,
mode 3: 3; 3–6 squares each, 2 in from the edge). `_ocean_taken` includes them (placement, shuffles,
robots' fleets, whirlpools), `_fire_ocean` counts them as fired, `_bot_pick_shared` as fired too. The
page (`coastSVG` in app.js) traces each island's outline and breaks every edge with midpoint
displacement (3 levels, seeded by the corners), drawn green with a beach and surf under the squares;
island squares aren't buttons and `openSquares` leaves them out. 🔺 **Sierpiński Salvo** (loot
`sierpinski`, ocean only): arm it, tap the triangle's top; `use_loot` takes Pascal's triangle mod 2, 4
rows down-right from p_cell (`(k & row) = k`), minus the board edge, islands, your ships and squares
taken for you, adds that many to `shot_mod`, returns `{cells}`; the page stages them (`doTriangle`), and
live fires them as a volley. 🐙 A kraken strike now also grows fractal arms (`krakenArms`: 6 tentacles
forking 3 deep, drawn as they grow). Tests that set fleets on an ocean need `_random_fleet_avoid`.

### Chaos Cards: Butterfly and Recursion (061)
Two new chaos wilds, 2 each in `_card_deck`: 🦋 **CF** gives the players after you +1, +2, +3… in the
direction of play (no skip); 🔁 **CR** plays again what the card under it did. `_card_play` works on
`eff` (`_card_as(top, top_as)` for a CR, else the card): target checks and every effect branch use it,
the top stays `CR`, and `card_games.top_as` keeps the card it counted as (a CR under a CR recurses; at
the bottom a Wild/number does nothing). `last_play.as` tells the page; its effect splash reads
"🔁 RECURSION: …". The robot targets its lead player when its CR replays a Swap or Target. cards.js
`topAs(g)` mirrors `_card_as`; a CR that replays CS/CT asks for a player like they do.

### Players' colours on shots (page only)
Battleship: `fx.shell(…, dur, col)` flies in the shooter's `pcol` (trail, glow, a landing ring), yours
and everyone else's. Hilltop: `drawShell` trails and glows in `COLS[sh.p]` (the head keeps its
weapon's look; the railgun beam's glow too), and your aim (hint dots, drag line, drone marker) is in your
tank's colour with a dark outline, so it reads on sky and hill.

### Chaos news toasts (lobby)
Quiet by design: `announceChaos` shares one fetch between overlapping calls (`chaosBusy`) and never
shows an event id twice (`chaosShown`); identical messages merge (`×n`); at most two toasts per batch,
the rest one "+n more chaos news" line (no sound). Toasts are compact (13px, 2-line clamp, colour on
the left edge), sit at the bottom of the screen, never more than two at once, and go after 3.5 s.
In a game they still wait in the 🔔 (unless Settings says pop-ups).

### Putt Post on phones: the whole screen, and the slingshot Putt (page only)
The canvas is any shape now. golf.js works in the canvas's own pixels: `lw()`×`lh()` (before the sideways
turn), `kFit` (px a course unit with the whole hole in view, zoom 1), `kNorm` (a 1-player hole on this
screen: the ball's normal size), `kNow = kFit·cam.z`, `zPlay = kNorm/kFit`; `camClamp` centres an axis
the view is bigger than, and `loop` fills past the course's edge. Drag power is `150·kNorm/kNow` units.
On touch screens under 760 px wide and in full screen (`fullCourse()`), `sizeCanvas` makes the course
fill the width (edge to edge, margins measured) and the height down to the backpack row (re-fitted by a
ResizeObserver on it and the header); tablets/desktop keep the hole's own shape. Touch putting is
Hilltop's slingshot: let go of a pull and `#puttHere` pops up where the finger lifted (⛳ PUTT, ↺ ↻,
− +, ✕, the power under it; `phShow`), and the Putt! bar is gone on touch screens (mouse still putts
on release). Tests tap `#phGo`, not `#puttGo`.

### The Gauntlet is the Route to Chaos (062)
Players never see "Gauntlet" now: the lobby card is 🌀 **Route to Chaos** ("Start Chaos 🌀", "Go to your
Chaos ›"), a running one is "Chaos #n", the game-page bar "🌀 Route to Chaos · Round …", titles and
trophies "Chaos". Code, tables and RPCs keep the gauntlet names. The rounds walk the logistic map's route:
`_chaos_curve` starts a round's game at n = (round − 1)·6, so round 1 is calm (r 2.90) and round 4 on
opens in chaos. The server's messages (round news, champion, call-off, chaos-clock forfeits) say Chaos.

### 🔺 Fractal Dash (066): the second solo game
`fractal.html` / `fractal.js`, linked from the lobby's quick entries. An endless runner: you're a
Sierpiński triangle dashing right over a ridge of 5-octave value noise (`groundY`, seeded per run and
depth; the small octaves scale with `rough()`, which climbs with depth and the chaos curve's r). Tap =
jump (double jump in the air), hold ≥170 ms = dash (×1.8 speed, phases through spikes, meter `dash`
of 1.4 s, refills on the ground); keys Space/↑/W and Shift/→. The chaos curve beats every 0.8 s
(r = min(4, 2.85 + 0.02·n)): a peak x > 0.75 spawns spikes, a hop |Δx| > 0.08 a chasm as wide as the
hop (≤150), a trough x < 0.35 (or every 3rd calm beat) an arc of shards; a peak x > 0.96 in chaos
starts a twist (tailwind, fog, quake, shard rain, low gravity). Spikes and falling cost a heart (3;
+1 per depth); every 25 s a dive (zoom-in) to the next depth with a new palette, seed and speed. Score =
m/10 + shards (50 × combo ≤ 8). Saved with `solo_submit('fractal', score, depth)`; 066 widens
solo_scores' game check to ('squirrel', 'fractal'). Test hook `window.__fd()` (state, `jump`, `hurt`,
`gyAt`). Test: scratch t_fractal (auto-plays 30 s, all three obstacle kinds, dash, death saves a row).

### Putt Post: no replay of finished holes (page only)
`decide()` no longer replays the previous player's hole before your turn, nor the last hole before the
result screen: the replay was there for calling cheater (gone in 065). It marks the turns seen and goes
straight to your turn / the result. The replay code is gone too (`replayTurn`, the Skip replay button,
`skipReplay`, mode `'replay'`). Test: scratch t_noreplay (after the other player's hole, the page is in
aim mode within ~300 ms, no gate).

### Effects show in full screen (page only)
Native full screen shows only the full-screen element, so overlays added to `<body>` (Battleship's `#fx`
canvas with shells, explosions and fireworks, the 🌪️/🐙 seabeasts and kraken arms, stamps, banners,
the quake vignette, splashes, the live countdown, the danger pulse, Hilltop's flash) were invisible on a
phone in full screen. `overlayHost()` in common.js (`.fs-on` element or body) is where they go now, and
`fsHost` moves the long-lived ones (`gameTools`, `fx`, `dangerV`, `dramaSplash`, `nextJump`) across when
full screen toggles. Never `document.body.appendChild` a game overlay. Test: scratch t_fsfx.

### Chaos rounds move on by themselves; Putt Post live holes start together (065)
Why rounds stalled: Battleship (`index.html`) had no fallback poll (the other pages' `liveGame` checks
every 5 s), so a page that missed the realtime event never learned the game was over, and its presence
callback on "live battle over" only redrew. Now `openGame` polls `games` (updated_at/status/move) every
5 s (`bsPoll`, cleared on leaving) and the live-over callback reloads. `jumpToNext` (common.js) retries
the Chaos lookup for ~6 s, spends its once-per-device `next.jumped.<id>` key only once it has something
to jump to, and mounts its floating banner inside the `.fs-on` element (native full screen on a phone
shows nothing outside it: that was the missing "Coming next" countdown). Putt Post's refresh calls
`decide()` when the game is over whatever mode the page is in (an aiming page used to sit there).
Putt Post live: `golf_games.hole_go` (set by `_golf_submit` when the last player's turn ends a live
hole: now + 6 s) is when the next hole goes for everyone; `live_go` answers with it, so `liveCountdown`
counts down to it (`myTurnLive` runs one per hole: "⛳ HOLE n"), `goAt()` = max(liveGo, holeGo) gates
putts and the robots' holes (`srv.offset` in common.js turns server time into the device's), and a live
submit nudges the other pages so their countdown starts at once. Cheat call-outs are gone: no "Did X
cheat?" judge step, no robot accusations (`golf_submit_bot_turn` patched), `golf_call` unused. A Chaos
rolling into the next keeps `live_bot`. Test hook `window.__golf()`. Tests: scratch t_chaosjump (five
rounds, both pages jump), t_bsjump / t_golfjump / t_dueljump (banner and countdown second by second),
t_holego (hole_go set, countdown shown, early putt refused, robot waits).

### Route to Chaos card: only for starting one (page only)
The lobby's Route to Chaos section no longer lists running Chaos matches (the per-rival cards with
scores, round track and Call off took too much room). It is the start form only, always open. A running
Chaos shows as its current round under Your move / Waiting on others (Round pill), and the game page's
Chaos bar (`gauntletBar`) carries scores and Call off. `renderGauntlets(gts)` only fills `rivalGroups`
so the form says "Go to your Chaos ›" for a rival that already has one. `#gtLive` and its styles are gone.

### Live sticks for the whole Route to Chaos (064)
`gauntlets.live_bot` carries the 🤖 live-vs-robot setting across rounds: `_gauntlet_next` starts each
round's game (Battleship, Putt Post, Hilltop) with it, `set_live_bot` on a round's page writes it back to
the Chaos, and `gauntlet_create` starts it **on** when two or more people play robots
(`_gauntlet_live_default`), so a round goes live by itself once the people are all on the page. One person
vs robots still starts turn by turn. Chaos Cards never had the switch (robots always count as here). Also
fixed: `GT_NAME` lacked `cards`, so the "Route to Chaos · Round n" splash threw on every Cards round.
Test: scratch t_chaoslive (two people + two robots, three rounds: switch reads LIVE, `_*_live(g)` true).

### Hilltop shot camera: yours only
`rideStart(p)` returns at once unless `p === myIdx()`: zoomed in, the camera rides only your own shots;
other players' shots, robots' and chaos (meteors, quakes, the sun) leave your view where it is (the tank
cam still shows your tank when it's hit off screen). t_ride checks both (robot table: others' max move 0).

### Picking robots: one counter (lobby)
The new-game form and Route to Chaos list people as chips and every robot as one "🤖 Robots − N +"
counter (`data-botstep` n / g). The robot chips are still in the form, `hidden` with `data-bot`, so
picking, limits, "already running" and create calls are unchanged: `wireBotStep` presses the first N
(by name) up to the table's room (`LIMITS[kind][1]` or 5, less the people picked), and `refreshForm`
drops robots first when a table overflows. Tests pick robots with the counter, not `[data-opp="bot1"]`.

### Battleship: fleets by outline, fireballs by target, shots stay staged (page only)
Ships carry no colour dot any more: each fleet is told apart by a thick outline in its player's colour
(`.vessel.pc` drop-shadows). A hit explodes in the colour of the player whose ship was hit
(`fx.explode(…, col)`: ring and sparks in `pcol(s.target)`); shells in flight keep the shooter's colour.
Fired squares stay marked (`inFlight`, keyed like `shotKey`) as staged, then landing, until each one's
result is revealed (`revealShot` clears it; `unlaunch` on an error; 6 s at most), and they can't be tapped
meanwhile. t_bsflight: staged/landed counts go 3/0 → 2/1 → 1/2 → 0/3 as the results come in.

### 🐿️ Squirrel Chaos (solo, squirrel.html / squirrel.js, 063)
A solo arcade game, linked from the lobby beside Quick play. Played entirely on the page (no turns, no
realtime): three 30 s levels in a fractal forest (`grow`: three trees forking 2-3 ways, 0.72 as long,
5-7 deep; each branch is a segment with parent/kids, the graph the squirrels run on, hopping between
nearby branches now and then). Tap fires the stapler (bottom centre; tap it or R to reload, 12 staples);
a staple lands after its flight (1500 u/s), so you lead a running squirrel. Size-3 and size-2 squirrels
split in two when stapled (20·size points); size-1 ones are pinned and score 100 × combo (1000 for a
✨ golden one). Spawns follow the chaos curve: every 1.2 s x → r·x·(1−x) with r from 2.85 (+0.03 a step,
to 4); x decides 0-3 new squirrels, x > 0.93 a twist (gust, stampede, frenzy, leaf storm), x > 0.97 a golden
squirrel; the HUD meter shows x's last 24 values. Each level ends by zooming into the middle trunk's
knothole; the next forest grows out of a dot, 15% faster. The score goes to `solo_submit(game, score,
level)` (`solo_scores`, readable by everyone; one run per 20 s), which answers with your best and the
family's top five. `window.__sq()` is a read-only test hook (t_squirrel plays a full run).
**Arsenal and fighting back (page only):** 📦 crates parachute in every 7-12 s (faster as x rises, and on
every twist); shoot one to open it (`openCrate`) and the weapon bar (`#wbar`, bottom right) loads it:
🔩 nail gun (40, hold to fire, `hold`), 💥 shotgun (8, five staples ±0.11 rad), 🧨 tack bomb (4, lobbed,
`explode` r 58, screen shake), ⚡ chain stapler (6, `chain`: forks to the two nearest, twice: up to 7,
drawn as midpoint-displacement bolts), 🌀 chaos cannon (3, a 15-point fractal burst). Empty → back to the
stapler. Angry squirrels (red eyes) lob 🌰 acorns at the stapler when x > 0.55 (at most 2 in the air, 2.2 s
flights): tap one to swat it (any weapon; the stapler spends a staple), else BONK: −1 ❤️ of 3, 0.7 s stun,
combo lost; 0 hearts is KNOCKED OUT (the run ends and still saves). Each new level gives a heart back.
A tap near the stapler reloads only when no acorn or crate is there. Cartoon impact, no gore: comic words
(KA-CHUNK!, THWACK!…), fur tufts, dizzy ✦ on split squirrels, 70 ms hit-stop from a 3× combo.

