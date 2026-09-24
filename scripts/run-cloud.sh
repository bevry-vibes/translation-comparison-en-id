#!/usr/bin/env bash
# Run the hosted (cloud) benchmark sweeps and regenerate results/results.md.
# Usage: scripts/run-cloud.sh [cloudflare|kagi|qwen|both|all] [id-en|en-id|both]
#
# Needs .env (gitignored) with CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
# KAGI_SESSION, KAGI_CLIENT_REPO and QWENCLOUD_API_KEY. The Cloudflare sweep
# drives the Translation-tagged model that serves Indonesian
# (@cf/meta/m2m100-1.2b); indictrans2-en-indic-1B is also tagged Translation
# but silently returns Hindi for Indonesian, so it is excluded (see
# docs/model-survey.md). The qwen sweep drives the qwen-mt text-translation
# family; the LiveTranslate models on this host are realtime/audio-only.
# Runs are sequential and the memguard run lock enforces one benchmark at a time.

set -euo pipefail

PROVIDER="${1:-both}"
DIRECTION="${2:-both}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  . ./.env
  set +a
fi

PY="$ROOT/.venv/bin/python"
if [[ ! -x "$PY" ]]; then
  echo "bootstrapping .venv with uv (never bare pip)"
  uv venv "$ROOT/.venv"
  uv pip install --python "$PY" -r "$ROOT/requirements.txt"
fi

QWEN_MODELS=(qwen-mt-flash qwen-mt-lite qwen-mt-turbo qwen-mt-plus)

run_cf() { # $1 src, $2 tgt
  "$PY" eval/run_eval.py --backend cloudflare --model '@cf/meta/m2m100-1.2b' \
    --prompt-style none --src "$1" --tgt "$2" --name cf-m2m100-1.2b
  deno run --allow-net --allow-env --allow-read --allow-write --allow-run \
    eval/deno/run_eval.ts --model '@cf/meta/m2m100-1.2b' \
    --src "$1" --tgt "$2" --name cf-m2m100-1.2b-deno
}

run_kagi() { # $1 src, $2 tgt
  "$PY" eval/run_eval.py --backend kagi --kagi-runtime python \
    --prompt-style none --src "$1" --tgt "$2" --name kagi-py
  "$PY" eval/run_eval.py --backend kagi --kagi-runtime deno \
    --prompt-style none --src "$1" --tgt "$2" --name kagi-deno
}

run_qwen() { # $1 src, $2 tgt
  local model
  for model in "${QWEN_MODELS[@]}"; do
    "$PY" eval/run_eval.py --backend qwen --model "$model" \
      --prompt-style none --src "$1" --tgt "$2" --name "$model"
  done
}

case "$DIRECTION" in
  id-en) DIRECTIONS=(id en) ;;
  en-id) DIRECTIONS=(en id) ;;
  both) DIRECTIONS=(id en en id) ;;
  *)
    echo "usage: scripts/run-cloud.sh [cloudflare|kagi|qwen|both|all] [id-en|en-id|both]"
    exit 2
    ;;
esac

for ((i = 0; i < ${#DIRECTIONS[@]}; i += 2)); do
  SRC="${DIRECTIONS[$i]}"
  TGT="${DIRECTIONS[$((i + 1))]}"
  case "$PROVIDER" in
    cloudflare) run_cf "$SRC" "$TGT" ;;
    kagi) run_kagi "$SRC" "$TGT" ;;
    qwen) run_qwen "$SRC" "$TGT" ;;
    both) run_cf "$SRC" "$TGT" ; run_kagi "$SRC" "$TGT" ;;
    all) run_cf "$SRC" "$TGT" ; run_kagi "$SRC" "$TGT" ; run_qwen "$SRC" "$TGT" ;;
    *)
      echo "usage: scripts/run-cloud.sh [cloudflare|kagi|qwen|both|all] [id-en|en-id|both]"
      exit 2
      ;;
  esac
done

"$PY" eval/summarize.py
