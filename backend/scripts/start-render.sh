#!/bin/sh
set -eu
if [ -n "${FORECAST_HOST:-}" ]; then
  export FORECAST_SERVICE_URL="https://${FORECAST_HOST}"
fi
node dist/db/migrate.js
if [ "${SEED_DEMO_IF_EMPTY:-false}" = "true" ]; then
  node scripts/seed-if-empty.cjs
fi
exec node dist/index.js
