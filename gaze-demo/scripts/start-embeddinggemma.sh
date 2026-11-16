#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
model_dir="$PWD/.models/embeddinggemma-2"
model="$model_dir/embeddinggemma-2-Q8_0.gguf"
model_revision=6ea3e3a309d12a4779cfda98b8c19800d2d5da71
model_sha=2188ac1deca4b77dffefd603c2776a9d76d9d74ec01841392982ebb840b09135
llama_release=b12110
archive="llama-${llama_release}-bin-macos-arm64.tar.gz"
archive_sha=4f5b8de12e0b9516658ca6a5764c6ffb3d7c659c3dd538556b1413c7b4050662
server="${LOCKIN_LLAMA_SERVER:-$model_dir/llama-$llama_release/llama-server}"
port="${LOCKIN_EMBEDDING_PORT:-8003}"

mkdir -p "$model_dir"
download_verified() {
  target=$1
  expected=$2
  url=$3
  if [ -f "$target" ] && printf '%s  %s\n' "$expected" "$target" | shasum -a 256 -c --status; then
    return
  fi
  partial=$(mktemp "$model_dir/download.XXXXXX")
  trap 'rm -f "$partial"' EXIT
  curl --fail --location --retry 2 --connect-timeout 15 --max-time 1200 --output "$partial" "$url"
  printf '%s  %s\n' "$expected" "$partial" | shasum -a 256 -c
  mv "$partial" "$target"
  trap - EXIT
}

if [ ! -x "$server" ]; then
  if [ -n "${LOCKIN_LLAMA_SERVER:-}" ] || [ "$(uname -s):$(uname -m)" != Darwin:arm64 ]; then
    echo 'Set LOCKIN_LLAMA_SERVER to a llama-server binary with EmbeddingGemma 2 support.' >&2
    exit 1
  fi
  download_verified "$model_dir/$archive" "$archive_sha" \
    "https://github.com/ggml-org/llama.cpp/releases/download/$llama_release/$archive"
  tar -xzf "$model_dir/$archive" -C "$model_dir"
fi

download_verified "$model" "$model_sha" \
  "https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/resolve/$model_revision/embeddinggemma-2-Q8_0.gguf"

exec "$server" --model "$model" --alias embeddinggemma-2 \
  --embeddings --pooling mean --ctx-size 4096 --batch-size 2048 --ubatch-size 2048 \
  --parallel 1 --host 127.0.0.1 --port "$port" --no-ui \
  --cors-origins "http://127.0.0.1:$port" --no-cors-credentials
