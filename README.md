# Indonesian ⇄ English: free/local model exploration + benchmark harness

A survey of **free, locally runnable** AI models for translation between Indonesian (`id`) and English (`en`), plus two hosted options for comparison: **Cloudflare Workers AI** (the deployment target) and **Kagi Translate**. A small stdlib-first harness scores the models on your machine.

- 📊 **[docs/model-survey.md](docs/model-survey.md)** — the survey: candidates, licences, published quality, hardware sizing, runtimes, evaluation options and the measured results from this repo.
- 🇮🇩 **[docs/indonesian-notes.md](docs/indonesian-notes.md)** — linguistic/pipeline checklist (register, reduplication, `-nya`, numbers, entities, do-not-translate lists).
- 📈 **[results/results.md](results/results.md)** — the benchmark table produced by the runs below.

## Quick start

```bash
# 1. get models (pick what you want; all free)
ollama pull translategemma:4b        # Google TranslateGemma 4B, ~3.3 GB, needs no HF account
bash scripts/pull-models.sh hymt2    # Tencent Hy-MT2-1.8B (Apache-2.0) incl. the HF-download workaround
bash scripts/pull-models.sh argos    # Argos Translate en<->id (tiny, CPU-only, fully offline)

# 2. build the test set (FLORES-101 devtest + Tatoeba + curated tricky cases)
python3 eval/build_testset.py --flores 20 --tatoeba 40

# 3. run any backend
python3 eval/run_eval.py --backend ollama --model translategemma:4b \
  --prompt-style translate_gemma --src id --tgt en --name translategemma-4b

# 4. or run the hosted sweeps (Cloudflare Workers AI + Kagi Translate; needs .env)
bash scripts/run-cloud.sh

# 5. or run everything that is installed and render the table
bash scripts/run-bench.sh
python3 eval/summarize.py
```

`scripts/run-bench.sh` auto-detects which backends are available (Ollama models, Argos, transformers) and skips the rest.

## What the harness does

| file | purpose |
| --- | --- |
| `eval/build_testset.py` | builds `data/testset.jsonl` from FLORES-101 devtest (ungated mirror), Tatoeba (OPUS) and `data/curated.jsonl` |
| `eval/run_eval.py` | runs a backend over one direction, scores it, dumps every source/reference/hypothesis to `results/*.json` |
| `eval/backends.py` | Ollama, OpenAI-compatible (LM Studio / llama-server / vLLM), Transformers (NLLB, M2M-100, MADLAD, OPUS-MT), Argos, Cloudflare Workers AI (official SDK) and Kagi Translate adapters, plus the per-family prompt templates |
| `eval/metrics.py` | corpus chrF / chrF++ / BLEU + per-sentence chrF; uses `sacrebleu` when installed, otherwise a stdlib fallback |
| `eval/deno/run_eval.ts` | like-for-like Deno harness for the Workers AI sweep: same test set, same metric formulas, same results JSON and run lock, so `summarize.py` renders both clients into one table |
| `eval/memguard.py` | RAM-fit check, single-run lock and Ollama model eviction — stops a benchmark from exhausting the machine's memory |
| `eval/summarize.py` | renders `results/*.json` into `results/results.md` |
| `scripts/pull-models.sh` | model acquisition, including the HF-CDN redirect workaround for Ollama |
| `scripts/run-bench.sh` | builds the test set, runs every available backend, regenerates the table |
| `scripts/run-cloud.sh` | runs the hosted sweeps (Cloudflare Workers AI, Kagi Translate) in both directions, then regenerates the table |

Design choices worth knowing:

- **stdlib-first**: the HTTP backends need only the Python standard library. You can benchmark Ollama and LM Studio models on any machine, with no torch install.
- **prompt-style per family**: `translate_gemma` uses Google's published evaluation prompt, `hymt2` uses Tencent's instruction wording, `generic` for general LLMs, `none` for dedicated NMT.
- **warm-up before timing**: the first call loads the model, so it is executed before the clock starts (`--no-warmup` to disable).
- **per-category chrF**: aggregate scores hide exactly the failures that matter (idioms, numbers, do-not-translate entities), so scores are also grouped by category.
- **memory-guarded runs**: `eval/memguard.py` refuses to start a run that does not fit in available RAM. It allows one benchmark at a time, and it evicts the Ollama model after the run. A benchmark can no longer push the machine into swap.

## Memory guards

Every model-loading run is wrapped by `eval/memguard.py`:

- **Run lock** — only one benchmark at a time (`/tmp/indonesian-mt-bench.lock`, override with `MTBENCH_LOCK`). A second concurrent run fails fast with a pointer to the running pid instead of stacking another multi-GB model in RAM. Stale locks (dead pid or >3 h old) clear automatically.
- **Fit check** — before loading, the runner estimates the RAM need from parameter count and quantisation (override with `--est-gb`). It refuses to start unless `estimate + --min-free-gb` (default 2 GB) fits in `MemAvailable`. Swap is never counted as headroom. `--force` overrides at your own risk.
- **Auto-eviction** — the Ollama model is unloaded (`keep_alive=0`) when a run finishes (`--keep-loaded` disables this), so the next backend always starts from a clean memory state.

Server-side, start Ollama with `OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_NUM_PARALLEL=1` so it can never hold two models at once (these are read at server startup only). The lock does not cover `pip install torch` (≈2 GB). Do not install packages while a benchmark runs.

## Hosted providers (Cloudflare Workers AI + Kagi Translate)

The hosted backends load no model on this machine, so `memguard` skips the RAM fit check for them; the single-run lock still applies. `bash scripts/run-cloud.sh [cloudflare|kagi|both] [id-en|en-id|both]` runs each provider's sweep in both directions and regenerates the table.

Setup:

```bash
# .env (gitignored) — never commit these
CLOUDFLARE_API_TOKEN=...        # token with Workers AI permission
CLOUDFLARE_ACCOUNT_ID=...       # your Cloudflare account id
KAGI_SESSION=...                # the kagi_session cookie of translate.kagi.com
KAGI_CLIENT_REPO=/path/to/kagi-translate-client   # clone of bevry-vibes/kagi-translate-client

# one-time bootstrap (uv; never bare pip on the system)
uv venv .venv
uv pip install --python .venv/bin/python -r requirements.txt   # cloudflare SDK + sacrebleu
```

Direct runs:

```bash
# Cloudflare Workers AI, Python (official `cloudflare` SDK)
.venv/bin/python eval/run_eval.py --backend cloudflare --model '@cf/meta/m2m100-1.2b' \
  --prompt-style none --src id --tgt en --name cf-m2m100-1.2b

# Cloudflare Workers AI, Deno (npm `cloudflare` SDK; like-for-like client comparison)
deno run --allow-net --allow-env --allow-read --allow-write --allow-run \
  eval/deno/run_eval.ts --model '@cf/meta/m2m100-1.2b' --src id --tgt en --name cf-m2m100-1.2b-deno

# Kagi Translate through bevry-vibes/kagi-translate-client (--kagi-runtime python|deno)
.venv/bin/python eval/run_eval.py --backend kagi --kagi-runtime python \
  --prompt-style none --src id --tgt en --name kagi-py
```

Notes:

- **Workers AI sweep** lists every model Cloudflare tags "Translation" that serves Indonesian — currently only `@cf/meta/m2m100-1.2b`. `@cf/ai4bharat/indictrans2-en-indic-1B` is also tagged Translation but covers English and the 22 Indic languages; for Indonesian it silently returns Hindi, so it is excluded (see the survey for details).
- **Cost**: Workers AI bills in neurons; the free tier grants 10,000/day. One 78-segment m2m100 run costs well under 1,000 neurons. Kagi Translate usage draws on your Kagi account's translate allowance (check `kagi-translate credits`).
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
