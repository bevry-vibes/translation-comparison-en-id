#!/usr/bin/env bash
# Run the off-QwenCloud provider sweep: open-weight models served by OpenRouter,
# DeepSeek (official) and Cline, both directions, production `engine` prompt.
# Usage: scripts/run-providers.sh [openrouter|deepseek|cline|all] [id-en|en-id|both] [plain|masked]
#
# Needs .env (gitignored) with OPENROUTER_API_KEY, DEEPSEEK_API_KEY, CLINE_API_KEY.
# The OpenCode Zen leg is not wired here: its account was unfunded and its free-tier
# ids returned "Upstream request failed: Model is unavailable" (verified 2026-09-29);
# re-add it if either changes. Thinking/reasoning is disabled where the gateway allows
# (glm-5.3-flash's OpenRouter endpoint mandates reasoning; it runs with it on).
# masked mode runs the same models over data/masked.jsonl with the `engine-preserve`
# prompt (the production engine instruction plus the keep-the-placeholder-tokens
# clause) for eval/token_survival.py scoring instead of the summarize tables.
# Runs are sequential and the memguard run lock enforces one benchmark at a time.

set -euo pipefail

PROVIDER="${1:-all}"
DIRECTION="${2:-both}"
MODE="${3:-plain}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source "$ROOT/scripts/lib.sh"
load_env
ensure_venv

OR_URL="https://openrouter.ai/api/v1"
DS_URL="https://api.deepseek.com"
CL_URL="https://api.cline.bot/api/v1"
OR_REASON_OFF='{"reasoning":{"enabled":false}}'
DS_THINK_OFF='{"thinking":{"type":"disabled"}}'

# provider|base-url|api-key-var|model-id|result-name|chat-kwargs
# keep in sync with the gateway metadata in eval/providers.py
MODELS=(
  "openrouter|$OR_URL|OPENROUTER_API_KEY|qwen/qwen3-30b-a3b-instruct-2507|or-qwen3-30b-a3b-2507|"
  "openrouter|$OR_URL|OPENROUTER_API_KEY|qwen/qwen3-235b-a22b-2507|or-qwen3-235b-a22b-2507|"
  "openrouter|$OR_URL|OPENROUTER_API_KEY|google/gemma-4-31b-it|or-gemma-4-31b-it|$OR_REASON_OFF"
  "openrouter|$OR_URL|OPENROUTER_API_KEY|nvidia/nemotron-3.5-lightning|or-nemotron-3.5-lightning|$OR_REASON_OFF"
  "openrouter|$OR_URL|OPENROUTER_API_KEY|deepseek/deepseek-v4-flash|or-deepseek-v4-flash|$OR_REASON_OFF"
  "openrouter|$OR_URL|OPENROUTER_API_KEY|qwen/qwen3.5-397b-a17b|or-qwen3.5-397b-a17b|$OR_REASON_OFF"
  "openrouter|$OR_URL|OPENROUTER_API_KEY|z-ai/glm-5.3-flash|or-glm-5.3-flash|"
  "openrouter|$OR_URL|OPENROUTER_API_KEY|moonshotai/kimi-k2.5|or-kimi-k2.5|$OR_REASON_OFF"
  "openrouter|$OR_URL|OPENROUTER_API_KEY|z-ai/glm-5|or-glm-5|$OR_REASON_OFF"
  "deepseek|$DS_URL|DEEPSEEK_API_KEY|deepseek-flash|ds-deepseek-flash|$DS_THINK_OFF"
  "deepseek|$DS_URL|DEEPSEEK_API_KEY|deepseek-v4-pro|ds-deepseek-v4-pro|$DS_THINK_OFF"
  "cline|$CL_URL|CLINE_API_KEY|google/gemma-4-31b-it|cl-gemma-4-31b-it|$OR_REASON_OFF"
)

case "$DIRECTION" in
  id-en) DIRECTIONS=(id en) ;;
  en-id) DIRECTIONS=(en id) ;;
  both)  DIRECTIONS=(id en en id) ;;
  *) echo "usage: scripts/run-providers.sh [openrouter|deepseek|cline|all] [id-en|en-id|both] [plain|masked]"; exit 2 ;;
esac

case "$MODE" in
  plain)
    TESTSET_ARGS=()
    PROMPT=engine
    NAME_SUFFIX=""
    ;;
  masked)
    TESTSET_ARGS=(--testset data/masked.jsonl)
    PROMPT=engine-preserve
    NAME_SUFFIX="-masked"
    ;;
  *) echo "usage: scripts/run-providers.sh [openrouter|deepseek|cline|all] [id-en|en-id|both] [plain|masked]"; exit 2 ;;
esac

for entry in "${MODELS[@]}"; do
  IFS='|' read -r provider url key_var model name kwargs <<<"$entry"
  if [[ "$PROVIDER" != all && "$PROVIDER" != "$provider" ]]; then
    continue
  fi
  key="${!key_var:-}"
  if [[ -z "$key" ]]; then
    echo "skip $name: \$$key_var not set in environment"
    continue
  fi
  for ((i = 0; i < ${#DIRECTIONS[@]}; i += 2)); do
    SRC="${DIRECTIONS[$i]}"
    TGT="${DIRECTIONS[$((i + 1))]}"
    "$PY" eval/run_eval.py --backend openai --model "$model" \
      --base-url "$url" --api-key "$key" \
      --chat-kwargs-json "$kwargs" --max-tokens 1024 \
      --prompt-style "$PROMPT" "${TESTSET_ARGS[@]}" \
      --src "$SRC" --tgt "$TGT" --name "$name$NAME_SUFFIX"
  done
done

if [[ "$MODE" == masked ]]; then
  "$PY" eval/token_survival.py
else
  refresh_site_data
fi
