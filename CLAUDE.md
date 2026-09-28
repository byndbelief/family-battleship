# Family Game Room — working notes

A private, live multiplayer game site for one family: `dad_commander` (the owner, who
talks to Claude), `phoenix_lord` (son, ~18) and `obanai_rocks` (daughter, 14), plus the
robot `admiral_bot`. Logins are `<username>@thegame.com` in Supabase Auth; the site
takes a bare username.

- **Site:** https://byndbelief.github.io/game-room/ — plain HTML/JS in `web/`, no build step.
- **Backend:** Supabase project **theGAME** (`okywhdfmdpdvrfhbkyeo`, us-west-2): Postgres with
  row-level security, `security definer` RPCs for every move, Realtime, and the `notify`
  Edge Function (Web Push, VAPID).
- **Games:** ⚓ Battleship, ⛳ Putt Post (mini golf), 💥 Hilltop Duel (artillery), and
  🏆 **the Gauntlet**, a best-of series of random rounds of those three. Chaos layer on top:
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
- `web/golf.html` + `golf.js` + `golf-engine.js`; `web/duel.html` + `duel.js` + `duel-engine.js`.
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
  `008_…` onward (008_clocks, 009_scoreboard, 010_trophies applied 2026-09-28), applied with `apply_migration` under the same name so Supabase's history
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
