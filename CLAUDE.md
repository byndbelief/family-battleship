# Family Game Room — working notes

A private, live multiplayer game site for one family: `dad_commander` (the owner, who
talks to Claude), `phoenix_lord` (son, ~18) and `obanai_rocks` (daughter, 14), plus the
robot `admiral_bot`. Logins are `<username>@thegame.com` in Supabase Auth; the site
takes a bare username.

- **Site:** https://byndbelief.github.io/game-room/ — plain HTML/JS in `web/`, no build step.
- **Backend:** Supabase project **theGAME** (`okywhdfmdpdvrfhbkyeo`, us-west-2): Postgres with
  row-level security, `security definer` RPCs for every move, Realtime, and the `notify`
  Edge Function (Web Push, VAPID).
- **Games:** ⚓ Battleship, ⛳ Putt Post (mini golf), 💥 Hilltop Duel (artillery), 🃏 Chaos
  Cards (an Uno-style shedding game), and 🏆 **the Gauntlet**, a best-of series of random
  rounds of those four. Chaos layer on top:
  loot, curses, twists (`005_chaos.sql`). Cheating is a deliberate game mechanic.

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
  cheats work live, but the "call cheater" box is hidden (its penalties are about turns). Putt Post:
  everyone plays the current hole at once, each into their own turn slot (`golf_submit_live`; the
  slot is `hole row * n + player index`), rivals' balls show as ghosts with their face (broadcast
  `ball`), the hole moves on when all are in, first in the cup earns a sneak attack, and cheating is
  refused while live. `_golf_submit` now always advances `t` past slots already played, so turns
  pick up cleanly when live ends.
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
  back. Pages call `setGameTools({ fs, canDelete, onDelete })` on render (onDelete returns an error
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
  (seat); a message without it is from "the other one" of two. The robot targets the weakest tank
  standing, and live only the first human still standing drives it (`botDriver`). **Never rebuild
  `hp` as a two-value array**: curses, repairs and the chaos clock update `hp[i]` in place.
  The Gauntlet deals duels for any group size (`_duel_new`); 24 h forfeit = `_duel_knockout`.
- **Battleship themes** (`027_bs_themes.sql`, art in `web/bs-themes.js`): the board is a sea view —
  one water layer (`.sea-<theme>`) under the grid, ships drawn as SVG across their squares
  (`vesselSVG`), see-through squares on top; cells are placed explicitly (grid-area) because the
  water overlaps them. Each fleet is drawn in its **owner's** theme (`profiles.bs_theme`, read by
  everyone). 🌊 sea free, 🏴‍☠️ pirate at 3 Battleship wins, ⚔️ viking at 10 (counted from `results`;
  a crossing win posts a chaos note), 👽 ufo is an easter egg: five quick taps on a board's empty
  top-left corner → `unlock_bs_theme('take me to your leader')`. Don't advertise it in the UI.
  Picker in ⚙️ Settings (`set_bs_theme`). Opponents' ships show only once sunk, as wrecks.
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
  (`coveredAt`, ⛰️ in the HP chip): shells hit the roof, blasts are measured along the ground and
  halved (so a thick hill never makes you immune), the railgun ignores cover, and its own shells
  leave from the surface above it (`muzzleY`). A crater that bites into the hollow opens it.
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
  `008_…` onward (008_clocks, 009_scoreboard, 010_trophies, 011_tank_moves, 012_smarter_robot, 013_dodge, 014_live_battle, 015_live_chaos, 016_duel_weapons, 017_robot_live, 018_chaos_cards, 019_cards_turn_time, 020_hide_finished, 021_online, 022_fleet_ready, 023_duel_multi, 024_card_loot, 025_duel_fast_reload, 026_bs_fast_reload, 027_bs_themes, 028_bs_shared, 029_duel_dig applied 2026-09-28), applied with `apply_migration` under the same name so Supabase's history
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
