#!/usr/bin/env bash
# Applies the migrations to a throw-away local PostgreSQL server and runs the SQL test-suite
# (row level security, invitations, time zones, expenses, notifications, privacy).
#
#   npm run test:db
#
# Needs PostgreSQL server binaries (apt install postgresql, or brew install postgresql@16).
# Uses its own temporary data directory and port; nothing on your machine is modified.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "${PGBIN:-/nonexistent}/initdb" ] || { echo "PostgreSQL server binaries not found (set PGBIN)"; exit 2; }
PORT="${PGTEST_PORT:-54329}"
DATA="$(mktemp -d /tmp/wanderplan-pg.XXXXXX)"

RUN=""                                   # postgres refuses to run as root: drop to the postgres user
if [ "$(id -u)" = "0" ]; then
  RUN="runuser -u postgres --"
  chown postgres "$DATA"
fi

cleanup() { $RUN "$PGBIN/pg_ctl" -D "$DATA/db" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT

$RUN "$PGBIN/initdb" -D "$DATA/db" -A trust -U postgres >/dev/null
$RUN "$PGBIN/pg_ctl" -D "$DATA/db" -o "-p $PORT -k $DATA -c listen_addresses=''" -l "$DATA/log" -w start >/dev/null

PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h "$DATA" -p "$PORT" -U postgres)
$RUN "${PSQL[@]}" -d postgres -c "create database wanderplan" >/dev/null
PSQL+=(-d wanderplan)

echo "• supabase shim";  $RUN "${PSQL[@]}" -f "$ROOT/supabase/tests/00_supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "• migration $(basename "$f")"; $RUN "${PSQL[@]}" -f "$f"
done
echo "• tests"
LOG="$DATA/tests.log"
if ! $RUN "${PSQL[@]}" -f "$ROOT/supabase/tests/${TEST_FILE:-rls.test.sql}" >"${SQL_OUT:-/dev/null}" 2>"$LOG"; then
  grep -E "NOTICE:  ok" "$LOG" | tail -3 | sed 's/^.*NOTICE: //'   # last passing assertions, for context
  grep -E "ERROR|FAIL|CONTEXT" "$LOG" | head -8
  exit 1
fi
[ -n "${VERBOSE:-}" ] && grep -E "NOTICE:  ok" "$LOG" | sed 's/^.*NOTICE:  //'
echo "$(grep -c 'NOTICE:  ok' "$LOG") assertions passed"
echo "ALL DATABASE TESTS PASSED"
