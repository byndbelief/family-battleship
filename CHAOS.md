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

## 🧘 Calm within the chaos

Some games need a think: a putt lined up, a hand planned. Those are the **calm category** (`CALM` in
`chaos.js`: the kinds Putt Post, Chaos Cards and Hilltop Duel; the run organs Putt and Hilltop), and the box gives them
a breather before the curve comes back:

- **A hold.** A calm game's curve starts held: for its first **8 moves** (a run organ: **10 beats**)
  r doesn't climb and no move twists. x still walks, so mirrors, gifts and golden cuts still land.
  The hold opens with 🧘 *CALM WITHIN THE CHAOS: take your time*, and the last held beat says
  😎 *HERE COMES THAT CHAOS CURVE AGAIN* (3 beats early in the run). Then it's the same curve as
  everywhere, further along. Server: `chaos_curve.hold` (074); pages: `stepCurve(c, { hold: true })`.
- **No morphs during a calm.** The run enters a calm organ and stays for the whole hold, whatever the
  curve does; the corner chip counts the beats down. Calm organs are interleaved with the wild ones in
  `run.html`, so one calm can't lead straight into another.
- **A breather before the round.** When the next round of a Chaos is a calm game, the jump waits
  12 s instead of 3, and says so. Leaving a calm game for a wild one, the countdown says the chaos is
  back on.

- **The chaos leaks through: ⚡ glitches.** A calm is never quite calm. A held beat whose x lands
  above **0.7** (`CALM.GLITCH`) is a glitch: the rules don't move, but for a second the world does.
  The page tears and its theme swaps for another game's, tanks turn into squirrels (Hilltop Duel, and
  the run's Hilltop), the ball is a squirrel (the run's Putt), the cards show squirrels. **A glitch is
  somebody's**: the move that leaked was a player's, and it is *their companion* that leaks, its own way,
  for everyone at the table (078): Fig tears the page (chaos), Kit mirrors it (symmetry), Bit zooms it in
  and out (fractals), Phi spins it (geometry); tanks, balls and cards become that companion, and its
  owner's name hangs under it. Your pal against theirs. Server: a `glitch:<pal>` event with the mover as
  actor; run: `ev.glitch` from `stepCurve` and your own companion. Reduced motion keeps the theme swap
  and skips the motion.

The 🌀 button shows 🧘 and the moves left while a game is held.

## Fig (who lives in r4box), in four personalities

Fig lives in r4box (`web/pals.js`) and goes with everyone: nobody picks a companion. One creature that
carries a bit of every pillar (the forking tail, a pair of mirror wings, a box on its back with a box
inside, a golden spiral on its belly), and **four personalities the curve brings out during play**. The
mood is the curve's own, the same rule on the server (`_chaos_curve`, 080) and in the pages
(`moodOf` in `chaos.js`), so everyone at a table sees one Fig:

| after a beat with… | Fig becomes | which bends the edges | and pays double for |
|---|---|---|---|
| a golden cut, a golden beat or a Fibonacci beat | 🌻 **Golden Fig** | golden cut 0.03 wide (not 0.012), Fibonacci luck ×2 | golden cuts, Fibonacci beats |
| a mirror or a balance | ✨ **Mirror Fig** | mirror 0.05 wide (not 0.02), balance 0.03 (not 0.01) | mirrors, balances |
| entering the window, or a phase crossed | 🔁 **Boxy Fig** | the window runs 7 beats (22–28), not 3 | window beats, phases crossed |
| a peak or a big beat | 🌀 **Wild Fig** | the peak line at 0.68 (not 0.75) | peaks, big and golden beats, r = 4 |

A mood holds **3 beats**, then Fig settles: calm below r = 3.57 (the plain edges), wild above. A beat is
judged by the mood Fig was in when it began. The double is a `bond` row in the ledger (the run hands
its bond in as points). You see which Fig you're with in the corner of every solo game (the drawing
blends toward the mood), on every game's 🌀 button and curve box, in the room's colours (`data-pal`
follows the mood: teal, red, violet, lilac, gold), in a banner when the mood moves, and in what leaks
through a glitch (a glitch wears the mood of the moment, and names whose move let it out).

## The run's stages, zoom and lenses

The Chaos Run (`run.html`) eases into chaos so a new player can learn the organs. **Stages** are
stretches of beats: Stage 1 · learn (beats 0–29) lets r climb only every 5th beat, Stage 2 · warm
(30–59) every 2nd, Stage 3 · wild (60–99) and Stage 4 · chaos (100+) every beat. On a frozen beat r
stays but x walks, so the nine events and **Fig's moods still land: a hint of what's coming** (the
banner says so). Morphs need more tenure early (10, 8, 6, 4 beats). As the stages get harder the
**world expands, sideways more than up**: its width grows ×1, 1.15, 1.3, 1.45 (400 → 580) while the
visible height grows only ×1, 1.06, 1.14, 1.22. On a phone upright that leaves a thin band of the
organ's colour above and below; on its side the world just fills more of the screen.

**The world fills as it grows.** Organs read the stage (`host.stage()`). Hilltop: from Stage 2 you
drive to the middle and tanks come from both sides; 🕳️ moles surface from the hill, lob a shell and
sink; from Stage 3 a dip becomes a 🌊 lake with a serpent that rises and spits, and 🎈 balloons drift
over and drop a bomb when above you. All of it is shellable (120 / 200 / 150, with the combo).
Squirrel Chaos: from Stage 2 🦉 owls glide over the stapler and drop a pinecone on it (a bonk unless
you swat the cone, +60; swat the owl, +150); from Stage 3 🐍 snakes slither in along the ground and bite
the stapler (shoo them, +120). Fractal Dash: from Stage 2 🛸 drones hunt you at jump height; dash
through one for +150, touch it any other way and it stings. Salvo: from Stage 2 ✈️ planes cross the
lanes and drop a bomb over your boat (tap the plane, +150, or the bomb, +50); from Stage 3 🫧 submarines
surface, fire a torpedo and dive (tap one while it's up, +250). From Stage 2 your gunboat sails to the
middle of the sea and the lanes spread above and below it, so the ships, planes, subs and torpedoes come
from all sides. Taps and shells in Salvo and Hilltop are forgiving: a near miss still counts. Shells in flight hit what they
meet: in Hilltop a shell that touches a ☄️ meteor breaks it up (120) and one that meets a falling 💣 bomb or
enemy shell intercepts it (60), and the 🎯 target takes those on a tap too; in Salvo a shell takes a plane, a bomb, a
torpedo or a surfaced sub on its way, and one passing low over an enemy ship lands on it. Fractal Dash: from Stage 2 Fig
runs from the middle of the screen, so drones hunt from behind as well as ahead; a dash takes a drone on a
near miss and shards come to you. Squirrel Chaos: from Stage 2 Fig and the stapler climb to a perch in the
middle of the wood, so squirrels, owls, cones and snakes come from above and below; staples land on a near
miss. Putt: from Stage 2 a 🐹 gopher pops up
while your ball sits still, runs over and drags it off (+1 putt) unless you tap it first (+100).

**Fractal Dash's track is a fractal itself: a Mandelbrot coast.** Big domes sit on the base line, smaller
bulbs hang off their rims, smaller still off those (circles on circles, the way the set's bulbs hang off its
cardioid), and the ground is their skyline. Deeper down, and the wilder the curve, the more levels there are.
The set's escape-time bands hug the coast, gold at the edge into deep blue. **Putt's map widens through the
courses**: the fairway's walk may use a wider and wider slice of the field (40% on course 1, the whole
width from course 5) and from course 4 the bends lean sideways.

**Hilltop's taps and artillery.** A tap on an enemy is a weapon of its own, unlimited and never shown: ⚡
lightning strikes what is on or under the ground (moles, serpents, 🪱 magma worms, even one still tunnelling
up from the core, for 300), a 🎯 target locks what flies (balloons, meteors) and it drops. The cannon (drag)
still works on everything. From Stage 2 an ally drone crosses now and then and drops a crate near you; tap it
to pick up a few rounds of artillery the cannon then fires: 🧨 cluster (three shells a shot), 💣 heavy (a
bigger crater), 🔥 napalm (a wide burn), 🎯 guided (steers to the nearest tank). The bar bottom-right shows
what's loaded and how many rounds are left.
**Putt repairs.** From course 2 each hole comes with repairs (🔧 2, then 3 from course 3, 4 from course 5, 5 from
course 7):
tap a bumper, a sand trap or a pond to fix it; the par is re-estimated.

**🏎️ Rally** (an organ of the run, calm category): Micro Machines on a kitchen table. Fig drives a toy car
around a loop of masking tape; hold the left or right half of the screen to steer (the car always goes),
hold both to brake. Rivals (two at Stage 1, up to five) race the same loop, rubber-banded to you; a rival
pushed far enough behind the camera is out of the lap and pays 150 (once a lap each). Three laps a course,
200 + 60 per rival behind a lap (× a capped Fibonacci combo), 300 × course for a course won, then a new
course: the track is a fractal, a loop whose radius is a sum of Fibonacci harmonics (3, 5, 8, 13, 21 bumps,
amplitudes falling like 1/k^0.8), rougher and narrower course by course (see the camera note below for the widths), the cars faster by
course and by stage (230 at the start, about 1.7× by course 4 at Stage 4), and a chase camera: top-down, but turned so the car always
points up the screen and sits low in it, following from behind, close in at the start (2×) and pulling back
as the stages come. The window's table spin turns it further. The cars are big (1.5× sprites) and the tape
is wide: 180 on course 1, down to 120. Hazards: 🥛 spilled milk (ice),
🍞 a toaster (a ramp), 🕳️ the pocket (from course 2; a life from course 3), 📦 cereal boxes (walls that turn
you back onto the tape). The nine events: a **peak** stands a 🪖 toy soldier on the road (a bonk and a spin),
the **window** spins the table a quarter turn a beat, the **mirror** reverses the circuit, the **balance**
drains the milk, the **golden cut** lays eight pennies ahead (+161, 20 each), a **big hop** drops a cereal
box on the road, **gift** is a bumper, **fib** a nitro, and a **glitch** puts Fig in every rival's seat.
Twists: 🧲 fridge magnet (pulled sideways), 🌀 ceiling fan (wind), 🔦 lights out (headlights only), 🐈 the
cat's paw (sweeps along the track and swats whoever it meets). Off the table's edge costs a life.

**A gentle start, in every organ.** The first stretch of a run teaches the organ before the world fills.
Putt's ⛳ **courses** are corridors: a fairway of straight legs from the tee to the cup. Course 1 is one
short straight leg, a single putt (par 1); Course 2 adds a bend, Course 3 is an S, then more bends, longer
legs and a much wider fairway (44, 66, 88 … 190), with bumpers (course 3+), sand (2+) and water (5+) on the way. Every
fairway sits centred in the field. Par is the bends + 1 (+1 for two
or more bumpers, +1 for water), par + 2 putts allowed; make the course's par over three holes and you move
up, miss it and you play it again; birdies and eagles pay, and a course made pays 300 × the course.
Squirrel Chaos Day 1 is a single fractal tree and one small squirrel at a time, no acorns; Day 2 two trees
and a few, Day 3 the wood. Hilltop in Stage 1 digs in two tanks at most, firing slowly, with no wind.
Fractal Dash at Depth 1 in Stage 1 runs slower with no chasms and spike rows of two. Salvo in Stage 1
sails three short slow ships and nobody fires back.

**Every organ is its own little game inside the run.** Each has three lives of its own (the dots under
the run's hearts, `⛳ ●●○`). Lose them and that organ starts over at its easy beginning (course 1, Day 1,
Depth 1, two tanks, three ships) and the run pays one of its own three hearts; the run ends when the run's
hearts are gone. Healing (a dive, a new day, the mirror) refills the organ's lives, not the run's hearts.
In Squirrel Chaos a staple takes the first squirrel in its path, not just the one where it lands; a
near miss takes an acorn or a pinecone too; 📦 crates are easy: they drift down slowly,
breathe bigger and smaller as they fall and grow with the stage (so they stay an easy tap as the board zooms
out),
wait a while, and a tap on one opens it with no staple spent.
There is no weapon picker: the last weapon you picked up is the one in your hand until its rounds are gone,
and the bar bottom-right only shows it.

**The chaos comes from Fig, visibly.** During play Fig stays in its corner and reacts there, big: every twist
of the curve (a peak, the window, the mirror, the golden cut, a mood, a lens, a glitch, a stage change) makes
the chip swell and turn, and what it causes on the board (the glitch tear, the lens, the twist itself) is the
only trace of it in the field. It turns to look where things happen and flinches, bounces or beams, but it
never reaches in. A morph is Fig's doing and the one time it leaves the corner: the chip flies into the middle
of the field, grows, and takes the old world apart **in whichever personality it's in**, with a wave of that
colour, then flies back to the corner as the new world surfaces underneath. 🌀 **Wild Fig** spins twice and
tears the world into strips that fly off every which way, colour bands bleeding between them. ✨ **Mirror
Fig** flips, and the world folds shut like a page on Fig's axis, its two halves meeting as mirror images with
a fainter reflection behind, then thins to nothing. 🔁 **Boxy Fig** turns a quarter, and the world tiles
itself into copies of itself, 1 → 4 → 16 → 64, each smaller and pulled toward Fig, pixel edges and all. 🌻
**Golden Fig** turns once, and the world spirals into Fig, shrinking by φ as it turns, its golden rectangles
drawn behind it. Calm Fig just pulls it in.

**You are Fig.** In every organ the thing you steer is Fig, in the run's current mood: rolled up into
Putt's ball, at the wheel of Hilltop's tank, working the stapler in Squirrel Chaos, running Fractal
Dash, at the helm of Salvo's gunboat; a hit makes Fig wince. And **the notices go through Fig**: there
are no hint pills and no banners over the field any more. The pal in the corner acts each event out (a
golden cut makes it glow, a mirror flips it, a glitch or a hit makes it dizzy, a stage or a morph makes it
bounce) with a short word beside it for a moment.

**Lenses**: Fig's personalities bend the picture itself. When a mood comes on, sometimes (50% in
Stage 1 up to always in Stage 4) a lens goes over the screen for a while (2 s in Stage 1 up to 7 s):
🌀 Wild Fig inverts the colours · ✨ Mirror Fig mirrors the screen (and your touches) · 🔁 Boxy Fig
leaves only the wireframe · 🌻 Golden Fig gilds everything. Reduced motion still gets them: they're
stills, not motion.

## A new game must

1. Be an organ of the shell (solo: `organs/<key>.js` + a page that calls `runShell`, and an entry in
   `run.html`'s organ list) or call `_chaos_curve` from its move function via `_chaos_after_move` (server).
2. Never redefine the numbers: no local `2.9`, `0.04`, `0.75`, `0.93`, `3.5699` for chaos.
3. Map **all nine events** to something the player can see (a table in the game's CLAUDE.md note),
   score combos with `fibMult`, and put a fractal on screen.
4. Show the meter, announce the phases with `ev.crossed`, and the window with `NEWS.window`.
5. Continue the curve across its levels; never reset it inside a run.
