#!/bin/bash
# tsc emits only .js, but the AI-model manifests resolve worker.py,
# requirements.txt and YOLO weights via __dirname — which is dist/ai-models/*
# when the server runs from dist. Copy those runtime assets next to the
# compiled output so the sidecars work outside ts-node.
set -e
cd "$(dirname "$0")/.."

for src_dir in src/ai-models/*/; do
  model=$(basename "$src_dir")
  dst_dir="dist/ai-models/$model"
  mkdir -p "$dst_dir"
  find "$src_dir" -maxdepth 1 \
    \( -name '*.py' -o -name 'requirements*.txt' -o -name '*.pt' \) \
    -exec cp {} "$dst_dir/" \;
done
