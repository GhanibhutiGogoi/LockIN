#!/bin/sh
# Run each offline benchmark from pilot through batch, then exercise the Web UI.
set -u
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
out=${1:-"$repo/evaluation-results/reproduction"}
node=${LOCKIN_EVAL_NODE:-node}
python="$repo/gaze-demo/.venv/bin/python"
eott_cache=${LOCKIN_EOTT_CACHE:-/tmp/lockin-eott}
memory_cache=${LOCKIN_MEMORY_EVAL_CACHE:-/tmp/lockin-memory-benchmark-data}
portrait=${LOCKIN_EVAL_PORTRAIT:-"-"}
mkdir -p "$out" || exit 1
out=$(cd "$out" && pwd)
status=0

run_memory() {
  dataset=$1
  script="$repo/gaze-demo/scripts/evaluate-web-memory.py"
  "$python" "$script" --dataset "$dataset" --cache "$memory_cache" --output-dir "$out/memory" --download --pilot 8 &&
    "$python" "$script" --dataset "$dataset" --cache "$memory_cache" --output-dir "$out/memory"
}

run_eott() {
  stage=$1
  shift
  folder="$out/eott/$stage"
  mkdir -p "$folder" || return 1
  "$python" "$repo/web/scripts/eval-eott-fetch.py" --cache "$eott_cache" --jobs 4 --participants "$@" > "$folder/download.log" 2>&1
  download_status=$?
  "$python" "$repo/web/scripts/eval-eott-prepare.py" --cache "$eott_cache" --participants "$@" > "$folder/prepare.log" 2>&1 || return 1
  "$node" "$repo/web/scripts/eval-eott.mjs" "$eott_cache" "$folder" "$@" > "$folder/inference.log" 2>&1
  model_status=$?
  "$python" "$repo/web/scripts/eval-eott-summary.py" "$folder" "$@" || return 1
  if [ "$stage" != supplement ]; then
    "$python" -c 'import json, sys; report = json.load(open(sys.argv[1])); assert report["tasks"]["final_dot"]["participantsWithPairedSpatialErrors"] > 0' "$folder/summary.json" || return 1
  fi
  [ "$download_status" -eq 0 ] && [ "$model_status" -eq 0 ]
}

run_memory scifact > "$out/scifact.log" 2>&1 || status=1
run_memory miracl-zh > "$out/miracl-zh.log" 2>&1 || status=1
if run_eott pilot P_01 P_02 P_06; then
  run_eott batch P_07 P_08 P_10 P_12 P_13 P_14 P_15 P_16 P_17 P_18 P_19 P_20 || status=1
  run_eott supplement P_23 P_24 P_25 P_27 || status=1
else
  status=1
fi
"$node" "$repo/web/scripts/run-model-replays.mjs" "$out/web" "$portrait" > "$out/web.log" 2>&1 || status=1
exit "$status"
