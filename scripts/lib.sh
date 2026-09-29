#!/usr/bin/env bash
# Shared scaffolding for the sweep scripts. Source after setting ROOT:
#   ROOT="$(cd "$(dirname "$0")/.." && pwd)"
#   source "$ROOT/scripts/lib.sh"
# Provides: load_env.

load_env() {
  if [[ -f "$ROOT/.env" ]]; then
    set -a
    . "$ROOT/.env"
    set +a
  fi
}
