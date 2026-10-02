-- 081 · the leftovers go: the pre-wipe backup schema of 2026-09-30 (33 tables, no longer needed) and the
-- companion-pick era's table and functions (design_votes, design_vote, design_tally, _chaos_companion),
-- unused since 080 made Fig's mood the curve's. Nothing in public references them. Safe to re-run.
drop schema if exists backup_20260930 cascade;
drop function if exists public.design_vote(text, text);
drop function if exists public.design_tally(text);
drop function if exists public._chaos_companion(uuid);
drop function if exists public._chaos_companion(uuid, uuid);
drop table if exists public.design_votes;
