-- Fingerprints the live schema: one row per kind (tables, functions, triggers, access rules,
-- realtime tables) with a count and a hash. Run it on theGAME (Supabase connector execute_sql, or
-- SQL Editor) and on a fresh local build (tools/e2e/setup.sh, then psql -d game -f this file).
-- Identical rows mean the repo migrations and production match exactly.
with x as (
select 'table' k, table_name n, md5(string_agg(column_name||':'||data_type||':'||is_nullable, ',' order by column_name)) h from information_schema.columns where table_schema='public' group by table_name
union all
select 'func', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public'
union all
select 'trigger', c.relname||'.'||t.tgname, md5(pg_get_triggerdef(t.oid)) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and not t.tgisinternal
union all
select 'policy', tablename||'.'||policyname, md5(coalesce(qual,'')||coalesce(with_check,'')||cmd) from pg_policies where schemaname='public'
union all
select 'publication', tablename, '' from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'
)
select k, count(*) as n, md5(string_agg(n||'='||h, ';' order by n)) as fp from x group by k order by k;
