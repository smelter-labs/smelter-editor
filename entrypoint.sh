#!/bin/bash
set -e

sudo chown -R smelter:smelter /home/smelter/demo/server/recordings /home/smelter/demo/server/configs /home/smelter/demo/server/mp4s /home/smelter/demo/server/pictures 2>/dev/null || true

exec node ./dist/index.js "$@"
