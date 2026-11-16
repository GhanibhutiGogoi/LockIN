#!/usr/bin/env bash
# Online processes on a Linux GPU workstation or in an SSH server session.
# Ctrl-C stops only the children started here.
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
if [[ ${#LOCKIN_ARGS[@]} -ne 0 ]]; then echo 'Usage: start-local.sh [--dry-run]' >&2; exit 2; fi
require_api
require_command ffmpeg 'Install ffmpeg or run setup-system.sh.'
require_command nvidia-smi 'Real inference needs an NVIDIA Linux host and compatible drivers.'
if [[ "$LOCKIN_DRY_RUN" == 1 ]]; then
  devices="${LOCKIN_VOICE_DEVICES:-cuda:0,cuda:1,cuda:2,cuda:3}"
else
  devices="$(uv run --no-sync python -c 'from lockin_media.settings import Settings; print(Settings().voice_devices)')"
fi
export LOCKIN_MODE=real
if [[ "$LOCKIN_DRY_RUN" == 1 ]]; then
  run uv run --no-sync lockin-media serve-voice --devices "$devices"
  run uv run --no-sync lockin-media serve-aligner
  run uv run --no-sync lockin-media serve --host 127.0.0.1 --port 8011
  exit 0
fi
pids=()
cleanup() {
  trap - EXIT INT TERM
  for pid in ${pids[@]+"${pids[@]}"}; do kill "$pid" 2>/dev/null || true; done
  for pid in ${pids[@]+"${pids[@]}"}; do wait "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Direct interpreters ensure the recorded PIDs belong to the model servers.
.venv/bin/lockin-media serve-voice --devices "$devices" & pids+=("$!")
.venv/bin/lockin-media serve-aligner & pids+=("$!")
.venv/bin/lockin-media serve --host 127.0.0.1 --port 8011 & pids+=("$!")
echo 'API: http://127.0.0.1:8011/ (models can take several minutes to load).'
echo 'First run: use initialize-voices.sh in another terminal after the model servers are ready.'
while true; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo 'A server exited; stopping this local stack. See the error above.' >&2
      exit 1
    fi
  done
  sleep 1
done
