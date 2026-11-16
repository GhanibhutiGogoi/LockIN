#!/usr/bin/env bash
# Persistent Docker deployment. Only the gateway is published, on loopback
# for SSH tunnelling or an HTTPS reverse proxy.
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
if [[ ${#LOCKIN_ARGS[@]} -ne 0 ]]; then echo 'Usage: start-server.sh [--dry-run]' >&2; exit 2; fi
require_command docker 'Install Docker with Compose and NVIDIA Container Toolkit.'
if [[ ! -f .env ]]; then run cp .env.example .env; fi
run docker compose --profile real up --build -d
echo 'Inspect startup with: docker compose --profile real logs -f'
echo 'First run: scripts/initialize-voices.sh server, then test /readyz.'
