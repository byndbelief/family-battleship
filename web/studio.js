// 🎨 Design Studio votes: the family picks things about the game itself (studio.html). One vote
// per player per topic, on the server (design_votes, migration 073). The first topic: who lives
// in r4box (the resident pal: PALS in pals.js).
import { sb } from './common.js';
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
  return data || [];
}
// The leader: most votes; a tie goes to whoever reached that count first.
export function leader(rows, fallback = PALS[0].key) {
  const c = {}, reached = {};
  rows.forEach((r) => { c[r.choice] = (c[r.choice] || 0) + 1; reached[r.choice] = r.at; });   // rows are oldest first: reached = when it got its last vote
  const best = Object.entries(c).sort((a, b) => b[1] - a[1] || String(reached[a[0]]).localeCompare(String(reached[b[0]])))[0];
  return best ? best[0] : fallback;
}
// The resident pal's key, for pages that just want to draw it. Cached for the page, and in
// localStorage ('r4.pal') so the loader and the sign-in screen can draw it before any request.
let residentP = null;
export function residentNow() { try { const k = localStorage.getItem('r4.pal'); if (k && PALS.some((p) => p.key === k)) return k; } catch {} return PALS[0].key; }
export function resident() {
  residentP = residentP || tally(TOPIC_RESIDENT).then((rows) => { const k = leader(rows); try { localStorage.setItem('r4.pal', k); } catch {} return k; }).catch(() => residentNow());
  return residentP;
}
