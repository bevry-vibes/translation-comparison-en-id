#!/usr/bin/env bash
# Build the test set and run every backend that is reachable, then render the table.
#
# Usage:  bash scripts/run-bench.sh [id-en|en-id|both]
set -euo pipefail
cd "$(dirname "$0")/.."

DIRECTIONS="${1:-both}"
FLORES="${FLORES_PAIRS:-20}"
TATOEBA="${TATOEBA_PAIRS:-40}"

python3 eval/build_testset.py --flores "$FLORES" --tatoeba "$TATOEBA"

run_direction() {
  local src="$1" tgt="$2"

  # TranslateGemma via Ollama (recommended prompt template from the paper)
  if ollama list 2>/dev/null | grep -q '^translategemma'; then
    python3 eval/run_eval.py --backend ollama --model translategemma:4b \
      --prompt-style translate_gemma --src "$src" --tgt "$tgt" \
      --name translategemma-4b || echo "[warn] translategemma run failed"
  fi

  # Hy-MT2 via Ollama (registered from a local GGUF by pull-models.sh)
  if ollama list 2>/dev/null | grep -qi 'hy-mt2'; then
    python3 eval/run_eval.py --backend ollama --model Hy-MT2-1.8B \
      --prompt-style hymt2 --src "$src" --tgt "$tgt" \
      --name hymt2-1.8b || echo "[warn] Hy-MT2 run failed"
  fi

  # A general-purpose local LLM, for comparison against a specialised MT model
  for general in qwen3:1.7b granite3.3:2b; do
    if ollama list 2>/dev/null | grep -q "${general%%:*}"; then
      python3 eval/run_eval.py --backend ollama --model "$general" \
        --prompt-style generic --src "$src" --tgt "$tgt" \
        --name "generic-${general//:/-}" || echo "[warn] $general run failed"
    fi
  done

  # Argos Translate (offline CTranslate2, CPU)
  if python3 -c "import argostranslate" 2>/dev/null; then
    python3 eval/run_eval.py --backend argos --src "$src" --tgt "$tgt" \
      --name argos || echo "[warn] argos run failed"
  fi

  # Dedicated NMT through transformers
  if python3 -c "import torch, transformers" 2>/dev/null; then
    python3 eval/run_eval.py --backend transformers --model facebook/nllb-200-distilled-600M \
      --family nllb --prompt-style none --src "$src" --tgt "$tgt" \
      --name nllb-600m || echo "[warn] nllb run failed"
    python3 eval/run_eval.py --backend transformers --model Helsinki-NLP/opus-mt-id-en \
      --family opus --prompt-style none --src "$src" --tgt "$tgt" \
      --name opus-mt-id-en || echo "[warn] opus-mt run failed"
  fi
}

if [[ "$DIRECTIONS" == "id-en" || "$DIRECTIONS" == "both" ]]; then run_direction id en; fi
if [[ "$DIRECTIONS" == "en-id" || "$DIRECTIONS" == "both" ]]; then run_direction en id; fi

python3 eval/summarize.py
echo
echo "see results/results.md"
