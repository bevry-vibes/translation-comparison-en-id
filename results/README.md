# Results: how to read and replicate them

This directory holds the measured outputs of the benchmark harness. **The rendered results
live on the site** — https://translation-comparison-en-id.bevry.workers.dev (Worker
`translation-comparison-en-id`, source in `site/`). Markdown result files are retired; do not
reintroduce them. If you are an agent interpreting or extending these results, read this file
first.

## Artifacts

| path | what it is |
| --- | --- |
| `results/<label>.json` | one benchmark run: a backend translating the test set in one direction, with corpus metrics, per-category chrF and every source/reference/hypothesis sample |
| `results/token-survival.json` | the scored masked-name matrix for all `*-masked-*.json` runs, emitted by `eval/token_survival.py` (the only scoring implementation) |
| `results/archive/` | results that must not be compared against live ones: `testset-v1/` (14-segment en→id runs — the test set is now 78/78, see below), `client-parity/` (one-off same-backend client comparisons), `old-testset/` (runs against test sets that no longer exist) |
| `site/src/data/results.json` | the joined dataset the site renders — run rows sorted per direction with best-per-column flags, category tables, the survival matrix with per-segment failures. Built by `eval/build_site_data.py` |

## Field dictionary: a run JSON

`label`, `backend`, `model`, `prompt_style` — identity (label = filename stem).
`src`, `tgt`, `testset`, `pairs` — what was translated; `testset` is `testset-v2.jsonl`
(78 segments per direction) for live rows, `masked.jsonl` (10 per direction) for
`*-masked-*` rows. `metrics` — corpus `chrf`, `chrfpp`, `bleu`, 0–100, higher is better.
`metric_backend` — `sacrebleu` or the bundled fallback. `seconds_per_sentence` — wall clock
per segment after warmup. `chrF_by_category` — average per-sentence chrF per category.
`samples` — every segment with per-sentence chrF.

The site's joined rows add: `provider` (gateway label), `hosted` (latency comparability
class), `best` (per-column best flags within a direction), `samples_capped`
(dialog shows best/worst 5 only when the run exceeds 10 segments).

## How to interpret (the rules agents get wrong)

1. **Directions are separately sized only in the archive.** Live rows are 78 id→en and 78
   en→id (testset-v2, balanced 2026-09-29). Rows from `testset-v1` (14 en→id) live only in
   `results/archive/testset-v1/` and must never be ranked against v2 rows.
2. **Token survival is a different measurement, not a column of the same run.** Survival rows
   come from the separate 10-segment masked-name set (`data/masked.jsonl`: names wrapped in
   `U+E000 + index + U+E001`), usually with the `engine-preserve` prompt, joined to main-table
   rows **by model id**. A model can have several survival variants (different prompts).
   `restored_chrf` is measured against the masked-set references — a secondary hint, never a
   quality rank. Verdicts are strict: one dropped name fails the run.
3. **Latency classes don't mix.** Hosted rows time one network round trip on warm models;
   local (Ollama) rows time local GPU/CPU inference. Compare only within a class.
4. **chrF differences under ~1 point are noise** at n=78 (one reference per segment penalizes
   valid alternatives). Use the per-category tables and the samples to understand *why*, and
   prefer BLEU/chrF++ agreement before claiming a ranking.
5. **Thinking models are not comparable on latency or content cleanliness** unless reasoning
   was disabled for the run (see replication flags below) — reasoning tokens inflate
   s/sentence and can leak into content.

## How to replicate a run

One command per family; all need `.env` (gitignored) with the provider keys:

```bash
# the off-QwenCloud sweep (OpenRouter + DeepSeek official; 11 models, both directions)
bash scripts/run-providers.sh all both            # add `masked` for the survival set

# QwenCloud legs (qwen-mt family, raisable chat set, glm fallback) + Cloudflare + Kagi
bash scripts/run-cloud.sh all both

# one-off direct run
.venv/bin/python eval/run_eval.py --backend openai --model qwen/qwen3-235b-a22b-2507 \
  --base-url https://openrouter.ai/api/v1 --api-key "$OPENROUTER_API_KEY" \
  --chat-kwargs-json '{"reasoning":{"enabled":false}}' --max-tokens 1024 \
  --prompt-style engine --src id --tgt en --name or-qwen3-235b-a22b-2507
```

After any new run: `python3 eval/token_survival.py` (if masked runs changed), then
`.venv/bin/python eval/build_site_data.py`, then `cd site && npx wrangler@latest deploy`.

Gotchas the hard way:

- **OpenRouter preflights credits against the model's full output ceiling** unless
  `--max-tokens` is set → HTTP 402 on a key with plenty of balance. The sweeps send 1024.
- **Gateway reasoning switches**: OpenRouter `{"reasoning":{"enabled":false}}`, DeepSeek
  `{"thinking":{"type":"disabled"}}` (via `--chat-kwargs-json`). glm-5.3-flash's endpoint
  mandates reasoning — it runs with it on (billed, but not leaked into content).
- **Cline's gateway** wraps responses in `{"data": …}` (the backend unwraps it) and
  black-holes batch runs — single requests work; do not use it for sweeps.
- **Prompt styles** (see the site's Prompts section for verbatim text): `engine` = the
  production translation-engine system instruction + raw source as the user message;
  `engine-preserve` = `engine` + an explicit keep-the-`U+E000<digits>U+E001`-tokens-verbatim
  clause (required for masked segments); `none` = raw text for dedicated NMT (qwen-mt family
  via `translation_options`); `translate_gemma`/`hymt2`/`generic` = per-family templates.
- **temperature 0, sequential per-segment, warmup before timing** — the harness does this; keep
  it if you bypass the harness.
- **One benchmark at a time** (`eval/memguard.py` run lock) and never commit `data/*.zip`.

## Rebuilding the derived artifacts

```bash
python3 eval/build_testset.py --flores 20 --tatoeba 40 --flores-enid 20 --tatoeba-enid 44 \
  --out data/testset-v2.jsonl     # deterministic; id->en is byte-identical across runs
python3 eval/build_masked_testset.py
python3 eval/token_survival.py
.venv/bin/python eval/build_site_data.py
```
