#!/bin/bash
# Dev entrypoint: compile mounted sources and restart Node when dist changes.
# Used with compose.dev.yaml — no Docker image rebuild needed for TS edits.
#
# DEV_USE_TS_NODE=1 — skip tsc watch + node --watch; run ts-node directly (less CPU
# overhead, but restart container manually after TS edits).
set -e

sudo chown -R smelter:smelter /home/smelter/demo/server/data 2>/dev/null || true

cd /home/smelter/demo/packages/types
pnpm build

if [ "${DEV_USE_TS_NODE:-}" = "1" ]; then
  cd /home/smelter/demo/server
  exec pnpm start
fi

pnpm dev &
TYPES_PID=$!

cd /home/smelter/demo/server
pnpm build
pnpm watch &
SERVER_TSC_PID=$!

cleanup() {
  kill "$TYPES_PID" "$SERVER_TSC_PID" 2>/dev/null || true
}
trap cleanup EXIT

exec node --watch dist/index.js "$@"
