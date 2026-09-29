#!/usr/bin/env bash
# Build the test sets and run every local backend that is reachable, then refresh the site data.
#
# Usage:  bash scripts/run-bench.sh [id-en|en-id|both]
set -euo pipefail
cd "$(dirname "$0")/.."

DIRECTIONS="${1:-both}"
FLORES="${FLORES_PAIRS:-20}"
TATOEBA="${TATOEBA_PAIRS:-40}"

deno run -A eval/deno/build_testset.ts --flores "$FLORES" --tatoeba "$TATOEBA" \
  --flores-enid 20 --tatoeba-enid 44 --out data/testset-v2.jsonl

run_direction() {
  local src="$1" tgt="$2"

  # TranslateGemma via Ollama (recommended prompt template from the paper)
  if ollama list 2>/dev/null | grep -q '^translategemma'; then
    deno run -A eval/deno/run_eval.ts --backend ollama --model translategemma:4b \
      --prompt-style translate_gemma --src "$src" --tgt "$tgt" \
      --name translategemma-4b || echo "[warn] translategemma run failed"
  fi

  # Hy-MT2 via Ollama (registered from a local GGUF by pull-models.sh)
  if ollama list 2>/dev/null | grep -qi 'hy-mt2'; then
    deno run -A eval/deno/run_eval.ts --backend ollama --model Hy-MT2-1.8B \
      --prompt-style hymt2 --src "$src" --tgt "$tgt" \
      --name hymt2-1.8b || echo "[warn] Hy-MT2 run failed"
  fi

  # A general-purpose local LLM, for comparison against a specialised MT model
  for general in qwen3:1.7b granite3.3:2b; do
    if ollama list 2>/dev/null | grep -q "${general%%:*}"; then
      deno run -A eval/deno/run_eval.ts --backend ollama --model "$general" \
        --prompt-style generic --src "$src" --tgt "$tgt" \
        --name "generic-${general//:/-}" || echo "[warn] $general run failed"
    fi
  done

}

if [[ "$DIRECTIONS" == "id-en" || "$DIRECTIONS" == "both" ]]; then run_direction id en; fi
if [[ "$DIRECTIONS" == "en-id" || "$DIRECTIONS" == "both" ]]; then run_direction en id; fi

(cd site && deno task data)
echo
echo "results/*.json refreshed the site data; deploy with cd site && deno task deploy"
