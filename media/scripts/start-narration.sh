#!/usr/bin/env bash
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
export LOCKIN_KOKORO_WEIGHTS="${LOCKIN_KOKORO_WEIGHTS:-$LOCKIN_PROJECT_DIR/models/kokoro}"
run .runtimes/narration/bin/python -m uvicorn lockin_media.narration:create_app --factory --host "${LOCKIN_NARRATION_HOST:-127.0.0.1}" --port "${LOCKIN_NARRATION_PORT:-18114}"
