#!/usr/bin/env bash
# Full end-to-end run on a FRESH throw-away stack, then clean everything up:
#   PostgreSQL (migrations applied) → Supabase-compatible test backend → demo seed → production build of the
#   app → Chromium user journeys (tests/e2e/journeys.mjs).
#
#   npm run test:e2e            # E2E_SKIP_BUILD=1 reuses an existing .next build made with the same env
#
# Needs: PostgreSQL server binaries, and Playwright's Chromium (npx playwright install chromium).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_PORT="${E2E_APP_PORT:-3100}"
API_PORT="${HARNESS_PORT:-54321}"
DIR="$(mktemp -d /tmp/wanderplan-e2e.XXXXXX)"

export NEXT_PUBLIC_SITE_URL="http://localhost:${APP_PORT}"
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:${API_PORT}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="harness-anon-key"
export SUPABASE_SERVICE_ROLE_KEY="harness-service-key"
export FEED_SIGNING_SECRET="$(openssl rand -base64 32)"
export TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)"
export CRON_SECRET="e2e-cron-secret"
export HARNESS_PORT="$API_PORT"

BACKEND_PID=""; APP_PID=""
cleanup() {
  [ -n "$APP_PID" ] && kill -TERM -- "-$APP_PID" 2>/dev/null || true
  [ -n "$BACKEND_PID" ] && kill -TERM -- "-$BACKEND_PID" 2>/dev/null || true
  sleep 1; rm -rf "$DIR"
}
trap cleanup EXIT

for url in "http://localhost:${APP_PORT}/login" "http://127.0.0.1:${API_PORT}/health"; do
  if curl -s -m 2 -o /dev/null "$url"; then echo "Port already in use ($url answers). Stop the other process first, otherwise the tests would run against it."; exit 1; fi
done

echo "• starting PostgreSQL + test backend"
LOCAL_BACKEND_DIR="$DIR" setsid bash scripts/local-backend.sh >"$DIR/backend.log" 2>&1 &
BACKEND_PID=$!
for _ in $(seq 1 60); do curl -fs "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fs "http://127.0.0.1:${API_PORT}/health" >/dev/null || { echo "backend did not start:"; tail -20 "$DIR/backend.log"; exit 1; }

echo "• seeding demo data"
npx tsx scripts/seed.ts | tail -3

if [ -z "${E2E_SKIP_BUILD:-}" ]; then echo "• building the app"; npx next build >"$DIR/build.log" 2>&1 || { tail -30 "$DIR/build.log"; exit 1; }; fi
echo "• starting the app on :${APP_PORT}"
setsid npx next start -p "$APP_PORT" >"$DIR/app.log" 2>&1 &
APP_PID=$!
for _ in $(seq 1 60); do curl -fs "http://localhost:${APP_PORT}/login" >/dev/null 2>&1 && break; sleep 1; done

echo "• running the journeys"
E2E_BASE="http://localhost:${APP_PORT}" E2E_API="http://127.0.0.1:${API_PORT}" node tests/e2e/journeys.mjs
