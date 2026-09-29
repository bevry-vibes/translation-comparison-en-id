#!/usr/bin/env bash
# Shared scaffolding for the sweep scripts. Source after setting ROOT:
#   ROOT="$(cd "$(dirname "$0")/.." && pwd)"
#   source "$ROOT/scripts/lib.sh"
# Provides: load_env, ensure_venv (sets PY), refresh_site_data.

load_env() {
  if [[ -f "$ROOT/.env" ]]; then
    set -a
    . "$ROOT/.env"
    set +a
  fi
}

ensure_venv() {
  PY="$ROOT/.venv/bin/python"
  if [[ ! -x "$PY" ]]; then
    echo "bootstrapping .venv with uv (never bare pip)"
    uv venv "$ROOT/.venv"
    uv pip install --python "$PY" -r "$ROOT/requirements.txt"
  fi
}

refresh_site_data() {
  "$PY" eval/build_site_data.py
}
