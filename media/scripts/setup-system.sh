#!/usr/bin/env bash
# Ubuntu/Debian prerequisites; NVIDIA drivers remain host-specific.
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
if [[ ${#LOCKIN_ARGS[@]} -ne 0 ]]; then echo 'Usage: setup-system.sh [--dry-run]' >&2; exit 2; fi
if [[ "$(uname -s)" != Linux && "$LOCKIN_DRY_RUN" != 1 ]]; then
  echo 'GPU deployment targets Linux. On macOS, install Python 3 and ffmpeg, then run setup.sh api.' >&2; exit 1
fi
require_command apt-get 'This script targets Ubuntu/Debian.'
LOCKIN_SUDO=()
if [[ "$EUID" != 0 ]]; then require_command sudo 'Use an account allowed to install packages.'; LOCKIN_SUDO=(sudo); fi
run ${LOCKIN_SUDO[@]+"${LOCKIN_SUDO[@]}"} apt-get update
run ${LOCKIN_SUDO[@]+"${LOCKIN_SUDO[@]}"} apt-get install -y python3 python3-venv ca-certificates git ffmpeg build-essential portaudio19-dev libsox-dev libsndfile1
