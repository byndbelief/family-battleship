# 🌀 THE BOX — chaos, symmetry, fractals, Fibonacci

The four things every game in the room is made of. One curve (chaos), the order hidden in it
(symmetry), a shape that repeats itself inside itself (fractals), and our friend Fibonacci (1, 1, 2,
3, 5, 8, 13… and the golden ratio φ its ratios close on). Every game reads the same nine events off
the curve. A player who learns
the curve in one game knows it in all of them. Code: `web/chaos.js` (pages) and `_chaos_curve` +
`_chaos_after_move` (server, migrations 058 / 062 / 068). `tools/e2e` scratch test `t_chaosbox`
runs both from one starting x and checks they agree beat for beat.

## The curve

`x → r·x·(1−x)`. r starts at **2.9** (calm) and climbs **0.04 a beat** to **4** (full chaos).
x starts at random in [0.05, 0.95]. Stuck on 0 or 1, x is nudged to 0.5 ± 0.001 (a butterfly flaps).

A **beat** is one move in a turn game (the server steps the curve after every move), or one tick of a
solo game's clock (Squirrel Chaos 1.2 s, Fractal Dash 0.7 s). The Route to Chaos starts each round's
game **6 beats further along** (round 1 calm, round 4 in chaos): self-similarity, the same curve again,
deeper in. A solo game's levels, depths and days never reset the curve either.

## The phases (announced once, the same words everywhere)

| r | name | what it means |
|---|---|---|
| < 3 | calm | x settles on one value: no twists yet |
| 3 | RHYTHM ×2 | the curve split in two: x flips between two values |
| 3.449 | RHYTHM ×4 | split again: period doubling has begun |
| 3.544 | 8, 16, 32… | the splits come faster and faster (each one δ ≈ 4.669 times sooner: the Feigenbaum constant) |
| 3.5699 | CHAOS | no rhythm left: anything can happen now |
| 4 | r = 4 | the top of the curve: full chaos |

## The seven events (what a beat's x means)

| event | when | the standard meaning, in every game |
|---|---|---|
| **peak** | x > 0.75 (not in the window) | a wild beat. Server games: the move twists. Solo games: the most of whatever comes (spawns, spikes) |
| **big** | x > 0.93 (not in the window) | a named twist may start (solo games; one at a time, with a cooldown) |
| **gold** | x > 0.97 | a golden beat: something rare and good (a golden squirrel) |
| **gift** | x < 0.25 | a calm beat: a small reward (shards, a breather) |
| **mirror** ✨ | \|x − (1 − x_prev)\| < 0.02 | **symmetry**: this beat landed on the mirror of the last, and f(x) = f(1−x). A gift in every game: a drop (server), a crate + 250 (Squirrel), a heart or 300 (Fractal) |
| **balance** ⚖️ | \|x − (1 − 1/r)\| < 0.01 | x found the point the curve would settle on: a calm reward (a reload / a full dash) |
| **window** 🔁 | beats 24–26 (r 3.86 … 3.94, as r passes 1 + √8 ≈ 3.8284, the period-3 window) | inside chaos, a rhythm of 3: **no twists**, things come in threes. Announced once |
| **golden** 🌻 | \|x − 0.618\| < 0.012 (the golden cut, 1/φ) | a reward: a drop (server), every squirrel stops for a moment + 161 (Squirrel), eight shards on a golden spiral + 161 (Fractal) |
| **fib** 🌻 | beat n ∈ 1, 2, 3, 5, 8, 13, 21, 34, 55, 89 | luck runs higher: a 35% extra drop (server), a crate half the time (Squirrel), an extra shard arc (Fractal). The meter shows an F |

`hop` (\|x − x_prev\|) is the beat's intensity, for games that want a size (Fractal's chasm width).

## Fractals

Every game shows a shape that holds itself inside itself, and zooming in is always allowed to find
the whole again: Putt Post's fractal cup (the hole around the cup is the hole), Hilltop's fractal
ridges and splitting shell, Battleship's coastlines, Sierpiński salvo and branching kraken, Chaos
Cards' Butterfly and Recursion, Squirrel Chaos's fractal trees (a branch is a smaller tree) and the
forest inside the knot, Fractal Dash's Sierpiński hero and ranges over fractal-noise ground, and the
🌀 box's bifurcation diagram, which is the chaos curve's own fractal. The loader draws it too.

## Fibonacci

1, 1, 2, 3, 5, 8, 13, 21, 34… Each is the sum of the two before, and the ratio of neighbours closes on
**φ = 1.618…**, the golden ratio; **1/φ = 0.618** is the golden cut of [0, 1]. In the box:

- **Combos count in Fibonacci.** The k-th hit of a combo pays F(k) times: 1, 1, 2, 3, 5, 8, 13, 21
  (`fibMult(k)`). A combo of 5 pays 8×, of 8 pays 34×. Squirrel Chaos and Fractal Dash score this way.
- **The golden cut** and **Fibonacci beats** are events on the curve (table above).
- **Shapes shrink by φ.** Squirrel Chaos's branches are 0.618 of their parent; Fractal Dash's three
  ranges are 233, 144 and 89 wide.
- **The meter** carries a faint gold dashed line at 0.618 and an F on Fibonacci beats.

## Finding symmetry in chaos

The map looks lawless past 3.57 and isn't. The games reward the player for noticing:

- **The mirror.** x and 1−x always map to the same next value. Watch the meter: a beat that lands
  where the last one would have, reflected, is ✨ symmetry.
- **The balance.** x* = 1 − 1/r is the value the curve would rest on if it could. Landing on it is ⚖️.
- **The window.** Zoom into the chaos and there is order in it: at r ≈ 3.83 the map runs in threes.
  For three beats the games run in threes too, and nothing twists.
- **Self-similarity.** Every split repeats the whole in miniature (the bifurcation diagram in the 🌀
  box is a fractal). Every round, dive and day is the same curve, further along.

## The meter (the same in every HUD)

The last 24 beats of x, a red dashed line at the peak (0.75), teal until chaos then orange, a faint
violet wash while in the window; the label `phase · r x.xx` (`window ×3` inside the window).
`drawMeter(canvas, curve)` and `meterText(curve)` draw it.

## Keeping score: the chaos rating

Every game feeds one rating per player, kept beside the game scores. A move (or a solo beat) that meets
an event of the box is marked in `chaos_ledger` with the event's weight, and the rating is the sum:

| event | peak | gift | fib | phase crossed | big | window | balance | mirror | golden | gold | r = 4 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| points | 1 | 1 | 2 | 2 | 3 | 4 | 5 | 8 | 8 | 10 | 10 |

Ranks are the phases of the curve: 🌱 Calm · 🎵 Rhythm ×2 (60) · 🎶 Rhythm ×4 (160) · 🌊 Cascade (320) ·
🌀 Chaos (640) · 🦋 Strange Attractor (1280). The family scoreboard shows the board (`chaos_ratings()`);
a solo game's end screen shows what the run earned (`solo_submit` takes the game's `tally`); multiplayer
moves are marked on the server (`_chaos_mark_move`, from `_chaos_after_move` and `card_play`). Robots
don't rate. `tally(ev, t)` in `chaos.js` counts a beat's events; the weights in `WEIGHTS` mirror
`_chaos_weight`.

## The shell and the organs (the Frankenstein game)

`web/shell.js` is the one body every solo game wears. A solo game is an **organ** (`web/organs/*.js`):
a module that draws a world and maps the nine events to its own nouns, and owns nothing else. The shell
owns the canvas, the beat clock and the curve, the tally and the rating, hearts, score and combo, the
HUD and meter, banners, the intro and end cards, the leaderboard, full screen, input and the save.

One organ makes an ordinary game page (`squirrel.html`, `fractal.html`). Several make a **Chaos Run**
(`run.html`): the curve decides which organ you're in, and the world morphs when it says so:

| cue | morph |
|---|---|
| a **peak**, after ≥ 6 beats in this organ (3 in chaos) | flips to the next organ: the world twists |
| the **mirror** | brings back the organ before |
| the **window** | rotates every beat (the rhythm of 3) |
| the **golden cut** | dives into the organ you've been away from longest (a long zoom) |

Hearts, score, combo and the curve carry across the seams; each organ keeps its own world alive while
it's away and picks up where it left off; a morph lands you mid-action with a breath of grace, and the
corner chip shows the live organ's verb and glows gold when a morph is close. Organ interface: `key,
name, icon, verb, beat, theme, init(host), start(), enter(from, anchor), leave() → anchor, update(dt),
draw(t), onBeat(ev), pointer(type, p), keydown/keyup, resize, hudLine, level, overText(how), endStats,
debug`. The host gives `cv, ctx, W, H, k, dpr, reduceMotion, S, banner, add, hurt, heal, over, sfx, ui,
morphs`. Adding an organ to the run is one import and one array entry. The organs so far, and their verbs:
🐿️ Squirrel Chaos (tap to staple) · 🔺 Fractal Dash (tap to jump, hold to dash) · ⚓ Salvo (tap the sea to
fire, tap torpedoes) · ⛳ Putt (drag back and let go) · 💥 Hilltop (drag to aim, let go to fire). The last
three are the multiplayer games' DNA in thirty-second bites, solo: every cell of a ship must burn; five
putts a cup on a green of fractal bumps; a fractal ridge that craters, and tanks that fire back.

## A new game must

1. Be an organ of the shell (solo: `organs/<key>.js` + a page that calls `runShell`, and an entry in
   `run.html`'s organ list) or call `_chaos_curve` from its move function via `_chaos_after_move` (server).
2. Never redefine the numbers: no local `2.9`, `0.04`, `0.75`, `0.93`, `3.5699` for chaos.
3. Map **all nine events** to something the player can see (a table in the game's CLAUDE.md note),
   score combos with `fibMult`, and put a fractal on screen.
4. Show the meter, announce the phases with `ev.crossed`, and the window with `NEWS.window`.
5. Continue the curve across its levels; never reset it inside a run.
