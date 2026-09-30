// 🎨 Design Studio picks: what each player chose about the game itself (studio.html). One row per
// player per topic, on the server (design_votes, migration 073). Topic 'resident': the player's
// COMPANION, who goes with them on chaos adventures (PALS in pals.js; the server doubles its pillar's
// events in their rating, 077). leader() still says who the family favourite is.
import { sb, me } from './common.js';
import { PALS } from './pals.js';

export const TOPIC_RESIDENT = 'resident';

// Everyone's vote on a topic: [{ player, name, choice, at }], oldest first.
export async function tally(topic) {
  const { data, error } = await sb.rpc('design_tally', { p_topic: topic });
  return error ? [] : data || [];
}
export async function vote(topic, choice) {
  const { data, error } = await sb.rpc('design_vote', { p_topic: topic, p_choice: choice });
  if (error) throw error;
  if (topic === TOPIC_RESIDENT) { residentP = null; try { localStorage.setItem('r4.pal', choice); } catch {} }   // a new companion: forget the cached one
  return data || [];
}
// The leader: most votes; a tie goes to whoever reached that count first.
export function leader(rows, fallback = PALS[0].key) {
  const c = {}, reached = {};
  rows.forEach((r) => { c[r.choice] = (c[r.choice] || 0) + 1; reached[r.choice] = r.at; });   // rows are oldest first: reached = when it got its last vote
  const best = Object.entries(c).sort((a, b) => b[1] - a[1] || String(reached[a[0]]).localeCompare(String(reached[b[0]])))[0];
  return best ? best[0] : fallback;
}
// This player's own pick, or null if they haven't chosen a companion yet.
// Who am I: common.js's me on pages that call signedIn(); the session on the lobby, which signs in its own way.
const myId = async () => me.id || (await sb.auth.getSession()).data.session?.user?.id || null;
export async function picked() { const [rows, id] = await Promise.all([tally(TOPIC_RESIDENT), myId()]); return rows.find((r) => r.player === id)?.choice || null; }
// The companion's key, for pages that just want to draw it (Fig until you pick). Cached for the page,
// and in localStorage ('r4.pal') so the loader and the sign-in screen can draw it before any request.
let residentP = null;
export function residentNow() { try { const k = localStorage.getItem('r4.pal'); if (k && PALS.some((p) => p.key === k)) return k; } catch {} return PALS[0].key; }
export function resident() {
  residentP = residentP || Promise.all([tally(TOPIC_RESIDENT), myId()]).then(([rows, id]) => { const mine = rows.find((r) => r.player === id)?.choice; const k = mine && PALS.some((p) => p.key === mine) ? mine : PALS[0].key; try { localStorage.setItem('r4.pal', k); } catch {} return k; }).catch(() => residentNow());
  return residentP;
}
