#!/usr/bin/env bash
# No --execute means print a plan. Generate BEFORE loading voice on the same
# GPUs. Review candidates before adding them with publish-video.
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
require_api
run uv run --no-sync lockin-media generate-video ${LOCKIN_ARGS[@]+"${LOCKIN_ARGS[@]}"}
