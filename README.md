# Family Battleship

Live Battleship for three players: `dad_commander`, `phoenix_lord` and `obanai_rocks`.
Games are one-on-one or a three-way battle. Moves show up instantly on any open
page, and a "your turn" notification goes out when the page is closed.

- `web/` is the site (plain HTML/JS, no build step), published by GitHub Pages.
- `supabase/schema.sql` is the database: tables, access rules, and the move logic.
- `supabase/functions/notify/` sends turn notifications.

## How it stays fair

Players can't write to the database directly. Every move goes through a server
function (`create_game`, `set_fleet`, `fire`) that checks it's your turn, that the
squares are real and unused, and works out hits and sinks. Each fleet is readable
only by its owner until the game ends, so nobody can peek at ships from the
browser.

## Cheating (on purpose)

Each player gets 2 cheats per game, run by the server so nobody can fake them:

- **👀 Peek**: spy on a 3×3 patch of an opponent's waters.
- **➕ Extra shot**: fire one more shot this turn.
- **🚢 Sneak a ship away**: one of your unhit ships slips to a new spot.

Cheats are secret until the game ends. After any turn, another player can
**call cheater** (once per turn): if they're right, the cheater loses their next
turn; if they're wrong, the accuser fires one shot fewer next time. At the end,
everyone sees who cheated and when, plus awards for Sneakiest and Sharpest eye.

## One-time setup

### 1. Supabase (free plan)

1. Create a project at https://supabase.com.
2. **SQL Editor** → paste all of `supabase/schema.sql` → **Run**.
   Then do the same with each file in `supabase/migrations/`, in order.
3. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up"
   (only the three players below may play), and turn off "Confirm email".
4. **Authentication → Users → Add user → Create new user**, three times, with
   **Auto Confirm User** ticked:
   - `dad_commander@<your domain>`
   - `phoenix_lord@<your domain>`
   - `obanai_rocks@<your domain>`

   The part before the @ is the username. The domain is never emailed; use a
   subdomain of a domain you own (e.g. `players.yourdomain.com`) and put the same
   domain in `web/config.js` as `USERNAME_DOMAIN`.
5. **Edge Functions → Deploy a new function → Via Editor**, name it `notify`,
   paste `supabase/functions/notify/index.ts`, deploy.
6. **Edge Functions → Secrets**, add:
   - `VAPID_PUBLIC_KEY` (the same value as in `web/config.js`)
   - `VAPID_PRIVATE_KEY` (kept out of this repo; never commit it)
   - `VAPID_SUBJECT` = `mailto:you@yourdomain.com`
7. **Project Settings → API**: copy the Project URL and the `anon` public key into
   `web/config.js`.

### 2. GitHub Pages

**Settings → Pages → Source: GitHub Actions.** The `Publish site` workflow then
publishes `web/` on every push to `main`, at
`https://<user>.github.io/family-battleship/`.

GitHub Pages needs a public repository on a free GitHub plan. Nothing secret is in
the repo: the anon key is designed to be public, and the database rules do the
protecting.

### 3. On each phone

Open the site, sign in, and tap **Turn on turn alerts**. On iPhone/iPad, first tap
**Share → Add to Home Screen** and open the game from the home screen; Apple only
allows web notifications for home-screen apps.

## Adding a player later

Add a user in Supabase with `<username>@<your domain>`. Their profile is created
automatically, and they appear as an opponent the next time anyone signs in.
