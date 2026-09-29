# Indonesian ⇄ English: free/local model exploration + benchmark harness

A survey of **free, locally runnable** AI models for translation between Indonesian (`id`) and English (`en`), plus two hosted options for comparison: **Cloudflare Workers AI** (the deployment target) and **Kagi Translate**. A small stdlib-first harness scores the models on your machine.

- 📊 **[docs/model-survey.md](docs/model-survey.md)** — the survey: candidates, licences, published quality, hardware sizing, runtimes, evaluation options and the measured results from this repo.
- 🇮🇩 **[docs/indonesian-notes.md](docs/indonesian-notes.md)** — linguistic/pipeline checklist (register, reduplication, `-nya`, numbers, entities, do-not-translate lists).
- 🌐 **[the results site](https://translation-comparison-en-id.bevry.workers.dev)** — the canonical rendered results: per-direction run tables (Quality | Token survival toggle), category chrF, the current model recommendation, and the verbatim prompts — served from a Cloudflare Worker; data rebuilt from `results/*.json` by `eval/build_site_data.py`.
- 📖 **[results/README.md](results/README.md)** — how to interpret the results (comparability rules, field dictionary) and how to replicate a run. Read it before reasoning about the numbers.

## Quick start

```bash
# 1. get models (pick what you want; all free)
ollama pull translategemma:4b        # Google TranslateGemma 4B, ~3.3 GB, needs no HF account
bash scripts/pull-models.sh hymt2    # Tencent Hy-MT2-1.8B (Apache-2.0) incl. the HF-download workaround
bash scripts/pull-models.sh argos    # Argos Translate en<->id (tiny, CPU-only, fully offline)

# 2. build the test set (testset-v2: FLORES-101 devtest + Tatoeba + curated probes, 78 segments per direction)
python3 eval/build_testset.py --flores 20 --tatoeba 40 --flores-enid 20 --tatoeba-enid 44 \
  --out data/testset-v2.jsonl

# 3. run any backend
python3 eval/run_eval.py --backend ollama --model translategemma:4b \
  --prompt-style translate_gemma --src id --tgt en --name translategemma-4b

# 4. or run the hosted sweeps (Cloudflare Workers AI + Kagi Translate + Qwen-MT; needs .env)
bash scripts/run-cloud.sh all

# 4b. or the off-QwenCloud provider sweep (OpenRouter + DeepSeek official; needs .env)
bash scripts/run-providers.sh all both           # plain set, both directions
bash scripts/run-providers.sh all both masked    # masked names -> token survival

# 5. or run everything that is installed and refresh the results-site data
bash scripts/run-bench.sh
python3 eval/build_site_data.py
```

`scripts/run-bench.sh` auto-detects which backends are available (Ollama models, Argos, transformers) and skips the rest.

## What the harness does

| file | purpose |
| --- | --- |
| `eval/build_testset.py` | builds `data/testset.jsonl` from FLORES-101 devtest (ungated mirror), Tatoeba (OPUS) and `data/curated.jsonl` |
| `eval/build_masked_testset.py` | builds `data/masked.jsonl`: name-heavy segments with production-style masking — every name wrapped in `U+E000 + index + U+E001`, longest-form-first glossary, exactly patipeaceplace's `protectTerms` |
| `eval/run_eval.py` | runs a backend over one direction, scores it, dumps every source/reference/hypothesis to `results/*.json` |
| `eval/backends.py` | Ollama, OpenAI-compatible (LM Studio / llama-server / vLLM / hosted MaaS gateways), Transformers (NLLB, M2M-100, MADLAD, OPUS-MT), Argos, Cloudflare Workers AI (official SDK, NMT and chat shapes), Kagi Translate, and Qwen-MT (QwenCloud MaaS) adapters, plus the per-family prompt templates (the single source the site renders) |
| `eval/providers.py` | the provider manifest: gateway labels, endpoints, key env vars, reasoning switches — one source for the harness, the site data and the replication recipes |
| `eval/metrics.py` | corpus chrF / chrF++ / BLEU + per-sentence chrF; uses `sacrebleu` when installed, otherwise a stdlib fallback |
| `eval/token_survival.py` | scores masked-set runs: did every token + index survive, was anything renumbered or left behind, and does every name round-trip after restoration; writes `results/token-survival.json` |
| `eval/deno/run_eval.ts` | like-for-like Deno harness — kept working as the TypeScript consumer proof (smoke-verified; not used for measurement rows) |
| `eval/memguard.py` | RAM-fit check, single-run lock and Ollama model eviction — stops a benchmark from exhausting the machine's memory |
| `eval/build_site_data.py` | renders `results/*.json` + the survival matrix + `docs/recommendation.json` + the prompt catalogue into `site/src/data/results.json` for the results site |
| `scripts/pull-models.sh` | model acquisition, including the HF-CDN redirect workaround for Ollama |
| `scripts/run-bench.sh` | builds the test set, runs every available backend, regenerates the table |
| `scripts/run-cloud.sh` | runs the hosted sweeps (Cloudflare Workers AI, Kagi Translate) in both directions, then refreshes the results-site data |
| `scripts/run-providers.sh` | runs the off-QwenCloud provider sweep (OpenRouter + DeepSeek official, plain or `masked`) in both directions, then refreshes the results-site data |

Design choices worth knowing:

- **stdlib-first**: the HTTP backends need only the Python standard library. You can benchmark Ollama and LM Studio models on any machine, with no torch install.
- **prompt-style per family**: `translate_gemma` uses Google's published evaluation prompt, `hymt2` uses Tencent's instruction wording, `generic` for general LLMs, `none` for dedicated NMT, `engine` mirrors the production translator's request shape (a translation-engine system instruction plus the raw source text as the user message — the exact contract of patipeaceplace's `glmTranslate`), and `engine-preserve` adds an explicit keep-the-U+E000..U+E001 placeholder-tokens-verbatim clause for masked segments.
- **warm-up before timing**: the first call loads the model, so it is executed before the clock starts (`--no-warmup` to disable).
- **per-category chrF**: aggregate scores hide exactly the failures that matter (idioms, numbers, do-not-translate entities), so scores are also grouped by category.
- **memory-guarded runs**: `eval/memguard.py` refuses to start a run that does not fit in available RAM. It allows one benchmark at a time, and it evicts the Ollama model after the run. A benchmark can no longer push the machine into swap.

## Memory guards

Every model-loading run is wrapped by `eval/memguard.py`:

- **Run lock** — only one benchmark at a time (`/tmp/indonesian-mt-bench.lock`, override with `MTBENCH_LOCK`). A second concurrent run fails fast with a pointer to the running pid instead of stacking another multi-GB model in RAM. Stale locks (dead pid or >3 h old) clear automatically.
- **Fit check** — before loading, the runner estimates the RAM need from parameter count and quantisation (override with `--est-gb`). It refuses to start unless `estimate + --min-free-gb` (default 2 GB) fits in `MemAvailable`. Swap is never counted as headroom. `--force` overrides at your own risk.
- **Auto-eviction** — the Ollama model is unloaded (`keep_alive=0`) when a run finishes (`--keep-loaded` disables this), so the next backend always starts from a clean memory state.

Server-side, start Ollama with `OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_NUM_PARALLEL=1` so it can never hold two models at once (these are read at server startup only). The lock does not cover `pip install torch` (≈2 GB). Do not install packages while a benchmark runs.

## Hosted providers (Cloudflare Workers AI + Kagi Translate + Qwen-MT + off-QwenCloud gateways)

The hosted backends load no model on this machine, so `memguard` skips the RAM fit check for them; the single-run lock still applies. `bash scripts/run-cloud.sh [cloudflare|kagi|qwen|qwen-chat|glm|replacement|both|all] [id-en|en-id|both]` runs each provider's sweep in both directions and refreshes the results-site data.

- `qwen` — the `qwen-mt` dedicated translation family through `translation_options`.
- `qwen-chat` — regular QwenCloud chat models (`qwen-flash`, `qwen3.6-flash`, `qwen3.5-flash` — the console-raisable-rate-limit set) through the compatible-mode endpoint with the production `engine` prompt.
- `glm` — the production Workers AI chat fallback (`@cf/zai-org/glm-4.7-flash`) through the same `engine` prompt.
- `replacement` — the qwen-mt-turbo retirement sweep in one go: `qwen-mt-flash` (survivor) + `qwen-mt-turbo` (retiring baseline) + the chat set + glm.

`bash scripts/run-providers.sh [openrouter|deepseek|cline|all] [id-en|en-id|both] [plain|masked]` runs the off-QwenCloud sweep: twelve open-weight models (qwen3, glm-5, kimi-k2.5, gemma-4, deepseek-v4 tiers, nemotron) through OpenRouter and DeepSeek official, with gateway reasoning switches disabled where possible. `masked` runs the same models over the masked-name set with `engine-preserve` for token-survival scoring. Cline is wired but its gateway black-holes batch runs (documented in the survey); OpenCode Zen is not wired (unfunded account, dead free-tier ids as of 2026-09-29).

Setup:

```bash
# .env (gitignored) — never commit these
CLOUDFLARE_API_TOKEN=...        # token with Workers AI permission
CLOUDFLARE_ACCOUNT_ID=...       # your Cloudflare account id
KAGI_SESSION=...                # the kagi_session cookie of translate.kagi.com
KAGI_CLIENT_REPO=/path/to/kagi-translate-client   # clone of bevry-vibes/kagi-translate-client
QWENCLOUD_API_KEY=...           # QwenCloud MaaS API key (maas.qwencloudapi.com)
OPENROUTER_API_KEY=...          # openrouter.ai key (the off-QwenCloud sweep)
DEEPSEEK_API_KEY=...            # api.deepseek.com key (the off-QwenCloud sweep)
CLINE_API_KEY=...               # api.cline.bot key (gateway unstable for batch runs)

# one-time bootstrap (uv; never bare pip on the system)
uv venv .venv
uv pip install --python .venv/bin/python -r requirements.txt   # cloudflare SDK + sacrebleu
```

Direct runs:

```bash
# Cloudflare Workers AI, Python (official `cloudflare` SDK)
.venv/bin/python eval/run_eval.py --backend cloudflare --model '@cf/meta/m2m100-1.2b' \
  --prompt-style none --src id --tgt en --name cf-m2m100-1.2b

# Cloudflare Workers AI, Deno (npm `cloudflare` SDK) — the TypeScript consumer proof;
# smoke-check it, don't use it for measurement rows (python harness is the measurement path)
deno run --allow-net --allow-env --allow-read --allow-write --allow-run \
  eval/deno/run_eval.ts --model '@cf/meta/m2m100-1.2b' --src id --tgt en --name cf-m2m100-1.2b-deno

# Kagi Translate through bevry-vibes/kagi-translate-client (python runtime; deno available via --kagi-runtime deno)
.venv/bin/python eval/run_eval.py --backend kagi --kagi-runtime python \
  --prompt-style none --src id --tgt en --name kagi

# Qwen-MT dedicated translation models on QwenCloud MaaS
.venv/bin/python eval/run_eval.py --backend qwen --model qwen-mt-flash \
  --prompt-style none --src id --tgt en --name qwen-mt-flash

# QwenCloud chat models through the production `engine` prompt (raisable rate limits)
.venv/bin/python eval/run_eval.py --backend openai --model qwen-flash \
  --base-url https://maas.qwencloudapi.com/compatible-mode/v1 \
  --api-key "$QWENCLOUD_API_KEY" --prompt-style engine --src id --tgt en --name qwen-flash

# Workers AI chat fallback (glm-4.7-flash), production request shape
.venv/bin/python eval/run_eval.py --backend cloudflare-chat --model '@cf/zai-org/glm-4.7-flash' \
  --prompt-style engine --src id --tgt en --name glm-4.7-flash

# Token survival on masked names: does the model eat private-use placeholders?
python3 eval/build_masked_testset.py
.venv/bin/python eval/run_eval.py --backend qwen --model qwen-mt-lite \
  --prompt-style none --testset data/masked.jsonl --src id --tgt en --name qwen-mt-lite-masked
python3 eval/token_survival.py   # scores every masked run into results/token-survival.json

# OpenRouter model through the production `engine` prompt (reasoning disabled, capped
# completions so the credit preflight passes; results labelled or-*)
.venv/bin/python eval/run_eval.py --backend openai --model qwen/qwen3-235b-a22b-2507 \
  --base-url https://openrouter.ai/api/v1 --api-key "$OPENROUTER_API_KEY" \
  --chat-kwargs-json '{"reasoning":{"enabled":false}}' --max-tokens 1024 \
  --prompt-style engine --src id --tgt en --name or-qwen3-235b-a22b-2507
```

## The results site

`site/` is a Vite + React + shadcn/ui single-pager served by a Cloudflare Worker with
static assets. Rebuild and redeploy:

```bash
.venv/bin/python eval/build_site_data.py   # results/*.json -> site/src/data/results.json
cd site && npm run build
cd site && npx wrangler@latest deploy      # needs a wrangler login (OAuth) or a
                                           # CLOUDFLARE_API_TOKEN with Workers scripts+assets edit
```

Live at **https://translation-comparison-en-id.bevry.workers.dev**.

Notes:

- **Workers AI sweep** lists every model Cloudflare tags "Translation" that serves Indonesian — currently only `@cf/meta/m2m100-1.2b`. `@cf/ai4bharat/indictrans2-en-indic-1B` is also tagged Translation but covers English and the 22 Indic languages; for Indonesian it silently returns Hindi, so it is excluded (see the survey for details).
- **Qwen sweep** drives the `qwen-mt` text-translation family (`qwen-mt-plus/-turbo/-flash/-lite`) through the OpenAI-compatible endpoint with `translation_options`. The LiveTranslate models on the same host are realtime and audio-input-only — the offline sibling `qwen3.8-livetranslate-flash` does not exist on the API — so they cannot join a text benchmark (details in the survey). The **qwen-chat sweep** drives regular QwenCloud chat models through the same endpoint's compatible mode with the production `engine` prompt; the chat ids accept console rate-limit raises where the `qwen-mt` family does not.
- **Cost**: Workers AI bills in neurons; the free tier grants 10,000/day. One 78-segment m2m100 run costs well under 1,000 neurons. Kagi Translate usage draws on your Kagi account's translate allowance (check `kagi-translate credits`). Qwen-MT bills per token on your QwenCloud account; a full sweep costs cents.
- **Latency semantics**: hosted rows time one network round trip per sentence against already-warm models, so compare their `s/segment` against local rows accordingly.
- **AI Gateway vs Workers AI**: Workers AI is the inference platform; AI Gateway is an optional proxy in front of any provider that adds analytics, caching, rate limiting and fallbacks. Direct Workers AI calls need no gateway.

## Requirements

- [uv](https://docs.astral.sh/uv) for the Python environment (`.venv` bootstrap; never bare pip). Python 3.9+ for the stdlib-only paths.
- [Deno](https://deno.com) for the Workers AI Deno harness.
- `sacrebleu` recommended for metrics (it rides in `requirements.txt` for the `.venv`).
- `ollama` for the LLM backends; `argostranslate` for the Argos backend; `torch` + `transformers` + `sentencepiece` only if you want the classic NMT backends.
- Hosted: a Cloudflare API token with Workers AI permission plus your account id, and a local clone of [bevry-vibes/kagi-translate-client](https://github.com/bevry-vibes/kagi-translate-client) with a Kagi session cookie — all through the gitignored `.env`.
- The curated set in `data/curated.jsonl` has hand-written references. Treat them as a starting point for your own review, not as gold standard. Replace them with references from your domain before you make decisions.

<!-- LICENSE/ -->

## License

Unless stated otherwise all works are:

- Copyright &copy; [Benjamin Lupton](https://balupton.com)

and licensed under:

- [Reciprocal Public License 1.5](http://spdx.org/licenses/RPL-1.5.html)

<!-- /LICENSE -->
