#!/usr/bin/env bash
# Explicit, resumable downloads using models.json revisions.
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
kind="${LOCKIN_ARGS[0]:-all}"
if [[ ${#LOCKIN_ARGS[@]} -gt 1 ]]; then echo 'Usage: download-models.sh [voice|video|aligner|all] [--dry-run]' >&2; exit 2; fi
case "$kind" in voice|video|aligner|all) ;; *) echo 'Choose voice, video, aligner or all.' >&2; exit 2;; esac
require_api
if [[ "$kind" == all ]]; then
  for model in voice aligner video; do run uv run --no-sync lockin-media download "$model"; done
else
  run uv run --no-sync lockin-media download "$kind"
fi
