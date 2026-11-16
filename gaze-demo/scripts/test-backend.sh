#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
PYTHONPATH="$PWD/backend${PYTHONPATH:+:$PYTHONPATH}" .venv/bin/python -m pytest backend/tests -q
node --test backend/tests/js/*.test.mjs
