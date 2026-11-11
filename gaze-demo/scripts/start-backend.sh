#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -x .venv/bin/python ]; then
  echo 'Create .venv and install backend/requirements-dev.txt first (see backend/README.md).'
  exit 1
fi
export PYTHONPATH="$PWD/backend${PYTHONPATH:+:$PYTHONPATH}"
exec .venv/bin/python -m uvicorn lockin.app:app --host 127.0.0.1 --port 8000 "$@"
