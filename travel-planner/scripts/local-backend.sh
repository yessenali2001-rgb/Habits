#!/usr/bin/env bash
# Starts a throw-away local backend for trying the app WITHOUT a Supabase project:
#   PostgreSQL (migrations applied)  +  Supabase-compatible API on http://127.0.0.1:54321
#
#   npm run backend          # keeps running until Ctrl-C; prints the .env values to use
#
# For tests and demos only. It emulates auth, REST and realtime on top of real PostgreSQL (so row level
# security is genuinely enforced) but NOT file storage or Google/OAuth sign-in. Use a real Supabase project
# for anything else — see README.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin /opt/homebrew/opt/postgresql@*/bin 2>/dev/null | sort -V | tail -1 || true)}"
[ -x "${PGBIN:-/nonexistent}/initdb" ] || { echo "PostgreSQL server binaries not found (install postgresql, or set PGBIN)"; exit 2; }
PGPORT="${LOCAL_PGPORT:-54330}"
export HARNESS_PORT="${HARNESS_PORT:-54321}"
DATA="${LOCAL_BACKEND_DIR:-$(mktemp -d /tmp/wanderplan-local.XXXXXX)}"

RUN=""
if [ "$(id -u)" = "0" ]; then RUN="runuser -u postgres --"; chown postgres "$DATA"; fi

cleanup() {
  [ -n "${HARNESS_PID:-}" ] && kill "$HARNESS_PID" 2>/dev/null || true
  $RUN "$PGBIN/pg_ctl" -D "$DATA/db" -m immediate stop >/dev/null 2>&1 || true
  [ -z "${LOCAL_BACKEND_DIR:-}" ] && rm -rf "$DATA"
}
trap cleanup EXIT INT TERM

$RUN "$PGBIN/initdb" -D "$DATA/db" -A trust -U postgres >/dev/null
$RUN "$PGBIN/pg_ctl" -D "$DATA/db" -o "-p $PGPORT -k $DATA -c listen_addresses=''" -l "$DATA/log" -w start >/dev/null
export PGHOST="$DATA" PGPORT PGUSER=postgres PGDATABASE=wanderplan

PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h "$DATA" -p "$PGPORT" -U postgres)
$RUN "${PSQL[@]}" -d postgres -c "create database wanderplan" >/dev/null
$RUN "${PSQL[@]}" -d wanderplan -f "$ROOT/supabase/tests/00_supabase_shim.sql" >/dev/null 2>&1
for f in "$ROOT"/supabase/migrations/*.sql; do $RUN "${PSQL[@]}" -d wanderplan -f "$f" >/dev/null 2>&1; done
chmod -R a+rwX "$DATA" 2>/dev/null || true

# the backend connects through the unix socket as the postgres user
node "$ROOT/tests/harness/backend.mjs" &
HARNESS_PID=$!

cat <<MSG

  Local test backend is up (PostgreSQL + Supabase-compatible API, in-memory and disposable).

  Put this in .env.local, then run  npm run seed  and  npm run dev :

    NEXT_PUBLIC_SITE_URL=http://localhost:3000
    NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${HARNESS_PORT}
    NEXT_PUBLIC_SUPABASE_ANON_KEY=harness-anon-key
    SUPABASE_SERVICE_ROLE_KEY=harness-service-key
    FEED_SIGNING_SECRET=\$(openssl rand -base64 32)
    TOKEN_ENCRYPTION_KEY=\$(openssl rand -base64 32)

  Press Ctrl-C to stop (all data is discarded).

MSG
wait "$HARNESS_PID"
