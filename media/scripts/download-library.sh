#!/usr/bin/env bash
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
if (( ${#LOCKIN_ARGS[@]} )); then echo 'Usage: download-library.sh [--dry-run]' >&2; exit 2; fi
require_api
run uv run --no-sync python -m lockin_media.library
