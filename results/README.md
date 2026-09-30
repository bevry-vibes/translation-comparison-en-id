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
| `results/token-survival.json` | the scored masked-name matrix for all `*-masked-*.json` runs, emitted by `eval/deno/token_survival.ts` (the only scoring implementation) |
| `results/archive/` | results that must not be compared against live ones: `testset-v1/` (14-segment en→id runs — the test set is now 78/78, see below), `client-parity/` (one-off same-backend client comparisons), `old-testset/` (runs against test sets that no longer exist), `masked-pua-2026-09-29/` (masked-name runs against the retired private-use token scheme) |
| `site/src/data/results.json` | the joined dataset the site renders — run rows sorted per direction with best-per-column flags, category tables, the survival matrix with per-segment failures. Built by `site/tools/build_data.ts` |

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
(dialog shows best/worst 5 only when the run exceeds 10 segments), and `canonical`
(set when the row collapses same-model runs from several providers — its `runs` array
carries every provider's metrics, price and label; the row's own metrics come from the
primary provider).

## How to interpret (the rules agents get wrong)

1. **Directions are separately sized only in the archive.** Live rows are 78 id→en and 78
   en→id (testset-v2, balanced 2026-09-29). Rows from `testset-v1` (14 en→id) live only in
   `results/archive/testset-v1/` and must never be ranked against v2 rows.
2. **Token survival is a different measurement, not a column of the same run.** Survival rows
   come from the separate 10-segment masked-name set (`data/masked.jsonl`: names wrapped in
   `[[index]]` bracket markers — ASCII since the 2026-09-29 identity spike
   (`docs/identity-spike.md`), because weak tokenizers mangle private-use characters; the
   PUA-token era is archived under `results/archive/masked-pua-2026-09-29/` and its rows are
   not comparable), usually with the `engine-preserve` prompt, joined to main-table
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
6. **The same open-weight model at several providers is one model, not several.** Verified
   cross-provider pairs (temperature 0) land within ~3 chrF of each other per direction —
   serving-stack variance (quantization, kernels, snapshot drift), not quality differences;
   e.g. DeepSeek V4 Flash measured 77.10 / 75.04 / 74.23 chrF id→en (official / OpenRouter /
   Cloudflare) and 74.42 / 74.37 / 74.26 en→id, with ~0.5 chrF run-to-run nondeterminism on
   Cloudflare itself. The site collapses such runs into one row per model: which pairs
   collapse, whose scores are shown (the primary provider), and each listing's price live in
   `site/tools/models.ts`. A provider only joins the collapse when its measured numbers sit
   inside that band; models that merely share a family name across providers (kimi-k2.5
   vs kimi-k2.6/2.7, gemma-4-31b vs gemma-4-26b-a4b) stay separate rows.

## How to replicate a run

One command per family; all need `.env` (gitignored) with the provider keys:

```bash
# the off-QwenCloud sweep (OpenRouter + DeepSeek official; 11 models, both directions)
bash scripts/run-providers.sh all both            # add `masked` for the survival set

# QwenCloud legs (raisable chat set, glm fallback) + Cloudflare + Kagi
bash scripts/run-cloud.sh all both

# one-off direct run (defaults come from eval/deno/providers.ts by label prefix)
deno run -A eval/deno/run_eval.ts --backend openai --model qwen/qwen3-235b-a22b-2507 \
  --base-url https://openrouter.ai/api/v1 --api-key "$OPENROUTER_API_KEY" \
  --chat-kwargs-json '{"reasoning":{"enabled":false}}' --max-tokens 4096 \
  --prompt-style engine --src id --tgt en --name or-qwen3-235b-a22b-2507
```

After any new run: `deno run -A eval/deno/token_survival.ts` (if masked runs changed), then
`cd site && deno task deploy` (regenerates the site data, builds, and deploys).

Gotchas the hard way:

- **OpenRouter preflights credits against the model's full output ceiling** unless
  `--max-tokens` is set → HTTP 402 on a key with plenty of balance. The sweeps send 4096 so
  reasoning-mandatory models don't truncate (1024 cost DeepSeek real token drops before the
  identity spike traced it).
- **Gateway reasoning switches**: OpenRouter `{"reasoning":{"enabled":false}}`, DeepSeek
  `{"thinking":{"type":"disabled"}}` (via `--chat-kwargs-json`). glm-5.3-flash's endpoint
  mandates reasoning — it runs with it on (billed, but not leaked into content).
- **QwenCloud's data-inspection filter** hard-rejects segments its classifier flags (e.g. the
  FLORES sentence mentioning ISIS: `data_inspection_failed`, HTTP 400) and the qwen-mt/qwen-chat
  runs die there — the 2026-09-29 v2 en→id re-runs have no qwen-mt/qwen3.x legs for this reason
  (qwen-flash happened to pass). Another point for leaving QwenCloud.
- **Cline's gateway** wraps responses in `{"data": …}` (the backend unwraps it) and
  black-holes batch runs — single requests work; do not use it for sweeps.
- **Prompt styles** (see the site's Prompts section for verbatim text): `engine` = the
  production translation-engine system instruction + raw source as the user message;
  `engine-preserve` = `engine` + an explicit keep-the-`[[n]]`-markers-verbatim
  clause (required for masked segments); `none` = raw text for dedicated NMT (qwen-mt family
  via `translation_options`); `translate_gemma`/`hymt2`/`generic` = per-family templates.
- **temperature 0, sequential per-segment, warmup before timing** — the harness does this; keep
  it if you bypass the harness.
- **One benchmark at a time** (the harness's run lock) and never commit `data/*.zip`.
- **Metrics are the bundled local formulas** (`eval/deno/metrics.ts`), the same formulas
  sacrebleu implements — verified like-for-like when the client-parity rows were measured;
  `metric_backend` on every run records which implementation scored it.

## Rebuilding the derived artifacts

```bash
deno run -A eval/deno/build_testset.ts --flores 20 --tatoeba 40 --flores-enid 20 --tatoeba-enid 44 \
  --out data/testset-v2.jsonl     # deterministic (a CPython-exact MT19937 port); rebuilds are identical
deno run -A eval/deno/build_masked_testset.ts
deno run -A eval/deno/token_survival.ts
cd site && deno task data         # also writes public/data/results.json for the JSON routes
```
