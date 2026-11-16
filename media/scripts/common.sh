#!/usr/bin/env bash
# .env is data, never executable shell code. Pydantic/Compose read it.
set -euo pipefail
LOCKIN_PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$LOCKIN_PROJECT_DIR"
export PATH="$LOCKIN_PROJECT_DIR/.tools/bin:$PATH"
LOCKIN_DRY_RUN=0
LOCKIN_ARGS=()
for arg in "$@"; do
  if [[ "$arg" == --dry-run ]]; then LOCKIN_DRY_RUN=1; else LOCKIN_ARGS+=("$arg"); fi
done
run() {
  if [[ "$LOCKIN_DRY_RUN" == 1 ]]; then printf '%q ' "$@"; printf '\n'; else "$@"; fi
}
require_command() {
  if [[ "$LOCKIN_DRY_RUN" != 1 ]] && ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing %s. %s\n' "$1" "$2" >&2; exit 1
  fi
}
require_api() {
  require_command uv 'Run scripts/setup.sh api first.'
  if [[ "$LOCKIN_DRY_RUN" != 1 && ! -x .venv/bin/lockin-media ]]; then
    printf 'API environment missing. Run scripts/setup.sh api first.\n' >&2; exit 1
  fi
}
