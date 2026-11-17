#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
model_dir="$PWD/.models/memory-reranker"
model="$model_dir/qwen3-reranker-0.6b-q8_0.gguf"
model_revision=a02f48bb4f057028298c21fa033da2b30d7742d5
model_sha=22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48
server="${LOCKIN_LLAMA_SERVER:-$PWD/.models/embeddinggemma-2/llama-b12110/llama-server}"
port="${LOCKIN_RERANKER_PORT:-8004}"
parallel="${LOCKIN_RERANKER_PARALLEL:-4}"

if [ ! -x "$server" ]; then
  echo 'Run start-embeddinggemma.sh once to install llama.cpp b12110 or set LOCKIN_LLAMA_SERVER.' >&2
  exit 1
fi

mkdir -p "$model_dir"
if [ ! -f "$model" ] || ! printf '%s  %s\n' "$model_sha" "$model" | shasum -a 256 -c --status; then
  partial=$(mktemp "$model_dir/download.XXXXXX")
  trap 'rm -f "$partial"' EXIT
  curl --fail --location --retry 2 --connect-timeout 15 --max-time 1200 --output "$partial" \
    "https://huggingface.co/ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/resolve/$model_revision/qwen3-reranker-0.6b-q8_0.gguf"
  printf '%s  %s\n' "$model_sha" "$partial" | shasum -a 256 -c
  mv "$partial" "$model"
  trap - EXIT
fi

exec "$server" --model "$model" --alias lockin-reranker \
  --reranking --pooling rank --ctx-size "$((2048 * parallel))" --batch-size 1024 --ubatch-size 1024 \
  --parallel "$parallel" --gpu-layers auto --host 127.0.0.1 --port "$port" --no-ui \
  --cors-origins "http://127.0.0.1:$port" --no-cors-credentials
