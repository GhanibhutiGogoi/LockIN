#!/usr/bin/env bash
# API and model runtimes are isolated; no weights are downloaded here.
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
kind="${LOCKIN_ARGS[0]:-api}"
if [[ ${#LOCKIN_ARGS[@]} -gt 1 ]]; then echo 'Usage: setup.sh [api|voice|video|aligner|all] [--dry-run]' >&2; exit 2; fi
case "$kind" in api|voice|video|aligner|all) ;; *) echo 'Choose api, voice, video, aligner or all.' >&2; exit 2;; esac
if [[ ( "$kind" == voice || "$kind" == video || "$kind" == all ) && "$(uname -s)" != Linux && "$LOCKIN_DRY_RUN" != 1 ]]; then
  echo 'Real GPU runtimes require Linux. Use setup.sh api for a Mac client.' >&2; exit 1
fi
if ! command -v uv >/dev/null 2>&1; then
  require_command python3 'Install Python 3 or run setup-system.sh on Linux.'
  run python3 -m venv .tools
  run .tools/bin/python -m pip install 'uv==0.11.19'
fi
run uv sync --frozen --no-dev --python 3.12
if [[ ! -f .env ]]; then run cp .env.example .env; fi
if [[ "$kind" == all ]]; then
  for runtime in voice video aligner; do run uv run --no-sync lockin-media setup-runtime "$runtime" --execute; done
elif [[ "$kind" != api ]]; then
  run uv run --no-sync lockin-media setup-runtime "$kind" --execute
fi
run uv run --no-sync lockin-media doctor
echo 'Setup complete. Download weights separately with scripts/download-models.sh.'
