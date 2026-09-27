#!/usr/bin/env bash
# Builds a throwaway local copy of the game's backend for browser tests:
# Postgres 16 with a tiny stand-in for Supabase's auth schema, every migration in order,
# the four players, and PostgREST in front of it. Then bundles supabase-js (the page
# normally loads it from a CDN, which the test browser can't reach).
#
#   tools/e2e/setup.sh          # build (or rebuild) and start everything
#   tools/e2e/setup.sh start    # just start Postgres + PostgREST again (containers sleep)
#
# Needs: Postgres 16 binaries (/usr/lib/postgresql/16/bin), node, and network for the
# first run (PostgREST binary and npm packages). Playwright's Chromium is preinstalled
# in Claude Code's cloud containers.
set -euo pipefail
DIR=${E2E_DIR:-/var/tmp/gr-e2e}; PORT=${E2E_PG_PORT:-5499}; API=${E2E_API_PORT:-3399}
PGB=/usr/lib/postgresql/16/bin; HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd)
export PGOPTIONS="-c client_min_messages=warning"
PG="psql -h $DIR -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
asp() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else sh -c "$*"; fi; }

start() {
  asp "$PGB/pg_ctl -D $DIR/data -l $DIR/pg.log -o '-p $PORT -k $DIR' status" >/dev/null 2>&1 \
    || asp "$PGB/pg_ctl -D $DIR/data -l $DIR/pg.log -o '-p $PORT -k $DIR' -w start" >/dev/null
  if ! curl -s -o /dev/null "localhost:$API/"; then (cd "$DIR" && { nohup ./postgrest pgrst.conf > pgrst.log 2>&1 & echo $! > pgrst.pid; }); sleep 3; fi
  curl -s -o /dev/null -w "API on :$API -> %{http_code}\n" "localhost:$API/"
}
[ "${1:-}" = start ] && { start; exit; }

mkdir -p "$DIR"; [ "$(id -u)" = 0 ] && chown postgres "$DIR"
asp "$PGB/pg_ctl -D $DIR/data -m fast stop" >/dev/null 2>&1 || true
rm -rf "$DIR/data"; asp "$PGB/initdb -D $DIR/data -U postgres -A trust" >/dev/null
asp "$PGB/pg_ctl -D $DIR/data -l $DIR/pg.log -o '-p $PORT -k $DIR' -w start" >/dev/null
$PG -c "create database game"
$PG -d game <<'SQL'
create role anon nologin; create role authenticated nologin;
create role authenticator login noinherit; grant anon, authenticated to authenticator;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
create publication supabase_realtime;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
SQL
$PG -d game -f "$REPO/supabase/schema.sql" >/dev/null
for f in "$REPO"/supabase/migrations/0*.sql; do echo "applying $(basename "$f")"; $PG -d game -f "$f" >/dev/null; done
$PG -d game -c "insert into auth.users(email) values ('dad_commander@x.com'),('phoenix_lord@x.com'),('obanai_rocks@x.com'),('admiral_bot@x.com');
  insert into public.bots select id from public.profiles where username = 'admiral_bot' on conflict do nothing;"

if [ ! -x "$DIR/postgrest" ]; then
  curl -sL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar -xJ -C "$DIR"
fi
cat > "$DIR/pgrst.conf" <<CONF
db-uri = "postgres://authenticator@/game?host=$DIR&port=$PORT"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "test-secret-test-secret-test-secret-000"
server-port = $API
CONF
if [ ! -f "$DIR/supabase.esm.js" ]; then
  (cd "$HERE" && npm install --silent --no-audit --no-fund @supabase/supabase-js@2 esbuild >/dev/null \
    && echo "export * from '@supabase/supabase-js';" | npx esbuild --bundle --format=esm --outfile="$DIR/supabase.esm.js" --log-level=warning)
fi
[ -f "$DIR/pgrst.pid" ] && kill "$(cat "$DIR/pgrst.pid")" 2>/dev/null && sleep 1 || true
start
