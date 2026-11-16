#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -x .venv/bin/python ]; then
  echo 'Create .venv and install backend/requirements-dev.txt first (see backend/README.md).'
  exit 1
fi
if [ "$(uname -s)" = Darwin ] && [ scripts/screen-text.m -nt .models/screen-text ]; then
  mkdir -p .models
  ocr_build=$(mktemp .models/screen-text.XXXXXX)
  if xcrun clang -fobjc-arc -framework Foundation -framework ImageIO -framework CoreGraphics -framework Vision scripts/screen-text.m -o "$ocr_build"; then
    mv -f "$ocr_build" .models/screen-text
  else
    rm -f "$ocr_build"
    echo 'Local screen text recognition is unavailable.'
  fi
fi
export PYTHONPATH="$PWD/backend${PYTHONPATH:+:$PYTHONPATH}"
exec .venv/bin/python -m uvicorn lockin.app:app --host 127.0.0.1 --port 8000 "$@"
