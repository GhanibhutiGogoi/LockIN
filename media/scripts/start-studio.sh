#!/usr/bin/env bash
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
require_api
require_command ffmpeg 'Install FFmpeg with libass and libx264.'
require_command ffprobe 'Install ffprobe on the workstation.'
run uv run --no-sync uvicorn lockin_media.studio:create_app --factory --host 127.0.0.1 --port 8013
