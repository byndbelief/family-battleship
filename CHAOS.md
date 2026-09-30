# 🌀 THE BOX — the chaos standard

Every game in the room runs on one curve, and reads the same seven events off it. A player who learns
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

`hop` (\|x − x_prev\|) is the beat's intensity, for games that want a size (Fractal's chasm width).

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

## A new game must

1. `import { makeCurve, stepCurve, drawMeter, meterText, NEWS } from './chaos.js'` (solo) or call
   `_chaos_curve` from its move function via `_chaos_after_move` (server).
2. Never redefine the numbers: no local `2.9`, `0.04`, `0.75`, `0.93`, `3.5699` for chaos.
3. Map **all seven events** to something the player can see (a table in the game's CLAUDE.md note).
4. Show the meter, announce the phases with `ev.crossed`, and the window with `NEWS.window`.
5. Continue the curve across its levels; never reset it inside a run.
