#!/usr/bin/env bash
# Voice-host installation. The workstation installs the gameplay library separately.
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
require_command uv 'Install uv on the voice host.'
require_command ffmpeg 'Install FFmpeg on the voice host.'
require_command ffprobe 'Install ffprobe on the voice host.'
if [[ ! -x .runtimes/narration/bin/python ]]; then
  run uv venv --python 3.11 .runtimes/narration
fi
run uv pip install --python .runtimes/narration/bin/python . -r runtimes/kokoro-requirements.txt
run .runtimes/narration/bin/python -m lockin_media.download_narration
