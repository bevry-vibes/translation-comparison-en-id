#!/usr/bin/env bash
# Fetch the free/local Indonesian<->English candidates used in docs/model-survey.md.
#
# Usage:  bash scripts/pull-models.sh [translategemma|hymt2|argos|nllb|all]
set -euo pipefail

TARGET="${1:-all}"
CACHE="${MODEL_CACHE:-$HOME/.cache/indonesian-mt-models}"
mkdir -p "$CACHE"

pull_translategemma() {
  # Google TranslateGemma (Gemma 3 based). The HF repos are gated, but the Ollama
  # library build needs no HF account. Sizes: 4b, 12b, 27b.
  # Quality note: WMT24++ en->id MetricX-24 = 2.63 (4b) / 2.17 (12b) / 2.07 (27b);
  # the Gemma 3 baselines score 3.27 / 2.84 / 2.72 (lower is better).
  ollama pull translategemma:4b
  # ollama pull translategemma:12b   # better quality, ~8 GB
  # ollama pull translategemma:27b   # best quality, needs ~20 GB+ RAM/VRAM
}

pull_hymt2() {
  # Tencent Hy-MT2 (Apache-2.0, 33 languages incl. Indonesian).
  # GOTCHA: `ollama pull hf.co/tencent/Hy-MT2-1.8B-GGUF:Q4_K_M` fails with
  # "blocked redirect to a different host" because HF redirects to its CDN.
  # Download the GGUF with curl, then register it with `ollama create`.
  local gguf="$CACHE/Hy-MT2-1.8B-Q4_K_M.gguf"
  if [[ ! -s "$gguf" ]]; then
    curl -L --fail --progress-bar -o "$gguf" \
      https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q4_K_M.gguf
  fi
  # NOTE: this GGUF may require Tencent's custom STQ kernel (llama.cpp PR #22836)
  # depending on the quant. Q4_K_M/Q6_K/Q8_0 are the standard-quant options.
  printf 'FROM %s\n' "$gguf" > "$CACHE/Hy-MT2-1.8B.Modelfile"
  ollama create Hy-MT2-1.8B -f "$CACHE/Hy-MT2-1.8B.Modelfile"
}

pull_argos() {
  # Argos Translate: OpenNMT models converted to CTranslate2, ~100 MB per
  # direction, CPU-only, MIT/CC0 licensed. Fully offline, no model server.
  python3 -m pip install --user "argostranslate>=1.11"
  python3 - <<'PY'
import argostranslate.package, argostranslate.translate
argostranslate.package.update_package_index()
available = argostranslate.package.get_available_packages()
wanted = [p for p in available
          if {(p.from_code, p.to_code)} & {("en", "id")} and set((p.from_code, p.to_code)) == {"en", "id"}]
for pkg in wanted:
    print(f"installing {pkg.from_code}->{pkg.to_code} {pkg.package_version}")
    argostranslate.package.install_from_path(pkg.download())
print("installed:", [f"{t.from_lang}->{t.to_lang}" for t in argostranslate.translate.get_installed_languages()])
PY
}

pull_nllb() {
  # NLLB-200 distilled 600M / 1.3B. CC-BY-NC-4.0: research/non-commercial only.
  python3 -m pip install --user "torch" "transformers>=4.40" sentencepiece sacrebleu
  python3 - <<'PY'
from huggingface_hub import snapshot_download
for repo in ("facebook/nllb-200-distilled-600M",):
    print("downloading", repo, "->", snapshot_download(repo))
PY
}

case "$TARGET" in
  translategemma) pull_translategemma ;;
  hymt2)          pull_hymt2 ;;
  argos)          pull_argos ;;
  nllb)           pull_nllb ;;
  all)            pull_translategemma; pull_hymt2; pull_argos ;;
  *) echo "unknown target: $TARGET" >&2; exit 2 ;;
esac
echo "done: $TARGET"
