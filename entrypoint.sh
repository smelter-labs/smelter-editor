#!/bin/bash
set -e

sudo chown -R smelter:smelter /home/smelter/demo/server/data 2>/dev/null || true

exec node ./dist/index.js "$@"
