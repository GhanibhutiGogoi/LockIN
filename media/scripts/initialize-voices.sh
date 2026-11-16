#!/usr/bin/env bash
# Stable synthetic references, never overwriting existing voices.
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
target="${LOCKIN_ARGS[0]:-local}"
if [[ ${#LOCKIN_ARGS[@]} -gt 1 ]]; then echo 'Usage: initialize-voices.sh [local|server] [--dry-run]' >&2; exit 2; fi
case "$target" in
  local)
    require_api
    export LOCKIN_MODE=real LOCKIN_REQUEST_TIMEOUT=300
    for voice in hype chill; do
      if [[ "$LOCKIN_DRY_RUN" != 1 ]] && uv run --no-sync python -c 'import sys; from lockin_media.settings import Settings; sys.exit(not (Settings().data_dir / "voices" / (sys.argv[1] + ".json")).is_file())' "$voice"; then
        echo "Keeping existing $voice reference."
      else
        run uv run --no-sync lockin-media create-voice "$voice"
      fi
    done
    ;;
  server)
    require_command docker 'Install Docker with Compose.'
    for voice in hype chill; do
      if [[ "$LOCKIN_DRY_RUN" != 1 ]] && docker compose --profile real exec -T api python -c 'import sys; from lockin_media.settings import Settings; sys.exit(not (Settings().data_dir / "voices" / (sys.argv[1] + ".json")).is_file())' "$voice"; then
        echo "Keeping existing $voice reference."
      else
        run docker compose --profile real exec -T -e LOCKIN_REQUEST_TIMEOUT=300 api lockin-media create-voice "$voice"
      fi
    done
    ;;
  *) echo 'Choose local or server.' >&2; exit 2;;
esac
echo 'Listen to the generated voices in data/voices before using them.'
