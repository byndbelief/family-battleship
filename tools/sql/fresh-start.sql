-- 🧹 FRESH START: wipe every game, score, ledger and drop; keep the people.
-- Run by hand (not a migration): psql ... -f tools/sql/fresh-start.sql, or through the Supabase SQL editor.
-- Keeps: profiles (accounts and names), bots, push_subscriptions. Resets each profile's Battleship
-- theme and eggs. Everything else is truncated in one statement, so the foreign keys don't mind.
do $$ declare t text; list text := ''; begin
  for t in select table_name from information_schema.tables
           where table_schema = 'public' and table_type = 'BASE TABLE'
             and table_name not in ('profiles', 'bots', 'push_subscriptions')
  loop list := list || case when list = '' then '' else ', ' end || format('public.%I', t); end loop;
  execute 'truncate ' || list || ' restart identity cascade';
  update public.profiles set bs_theme = 'sea', bs_eggs = '{}';
  raise notice 'fresh start: truncated %', list;
end $$;
