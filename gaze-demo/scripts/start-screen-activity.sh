#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
model_dir="$PWD/.models/screen-activity"
model="$model_dir/qwen3-4b-instruct-2507-q4_k_m.gguf"
model_sha=5f9aafd13452cac6486fe42eae016debb8a4d9f6a2cb13724ca8a172a4065296
server="${LOCKIN_LLAMA_SERVER:-$PWD/.models/embeddinggemma-2/llama-b12110/llama-server}"

if [ ! -x "$server" ]; then
  echo 'Run start-embeddinggemma.sh once to install llama.cpp or set LOCKIN_LLAMA_SERVER.' >&2
  exit 1
fi

mkdir -p "$model_dir"
if [ ! -f "$model" ] || ! printf '%s  %s\n' "$model_sha" "$model" | shasum -a 256 -c --status; then
  partial=$(mktemp "$model_dir/download.XXXXXX")
  trap 'rm -f "$partial"' EXIT
  curl --fail --location --retry 2 --connect-timeout 15 --max-time 1200 --output "$partial" \
    "https://huggingface.co/LaksKodi/Qwen3-4B-Instruct-2507-GGUF/resolve/main/qwen3-4b-instruct-2507-q4_k_m.gguf"
  printf '%s  %s\n' "$model_sha" "$partial" | shasum -a 256 -c
  mv "$partial" "$model"
  trap - EXIT
fi

exec "$server" --model "$model" --alias lockin-screen-activity --jinja --parallel 1 \
  --ctx-size 4096 --gpu-layers auto --host 127.0.0.1 --port 8005 --no-ui --log-disable \
  --cors-origins 'http://127.0.0.1:8005' --no-cors-credentials
