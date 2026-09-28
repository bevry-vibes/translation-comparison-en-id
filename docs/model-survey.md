# Free / local AI models for Indonesian ⇄ English translation

Surveyed September 2026. Scope: **models you can run yourself for free** (no API keys, no
per-word billing) for the `id ⇄ en` pair, plus the tooling and evaluation harness to pick
between them — widened on 2026-09-23 with two hosted options that matter for deployment:
**Cloudflare Workers AI** (the deployment target) and **Kagi Translate**
(see [Hosted](#4-hosted-cloudflare-workers-ai-and-kagi-translate-added-2026-09-23)).
Everything below was checked against the live model hubs
(Hugging Face, Ollama, GitHub, arXiv) on 2026-09-21, and the headline candidates were
**actually run and scored on this machine** — see [Measured results](#measured-results-on-this-machine).

## TL;DR — what to use

| Situation | Use | Why |
| --- | --- | --- |
| Best quality, 8–16 GB RAM/VRAM budget | **TranslateGemma 12B** via Ollama (`ollama pull translategemma:12b`) | Purpose-built translator, WMT24++ en→id MetricX-24 **2.17** (Gemma 3 12B baseline: 2.84) |
| Everyday quality on a laptop / CPU only | **TranslateGemma 4B** (`translategemma:4b`, 3.3 GB) | MetricX-24 en→id **2.63**, still better than Gemma 3 27B (2.72); no HF account needed through Ollama |
| Need Apache-2.0 (commercial-safe) or 33-language coverage | **Hy-MT2-1.8B** (Tencent, Q4_K_M ≈ 1.2 GB) | Apache-2.0, explicit instruction following, runs on phones (1.25-bit quant = 440 MB) |
| Tiny footprint, pure CPU, batch jobs, no LLM machinery | **quickmt** (185M, CC-BY-4.0) or **Argos Translate** / **OPUS-MT** (`opus-mt-id-en`/`-en-id`, Apache-2.0) | CTranslate2, offline, sub-second per sentence; quickmt publishes NLLB-1.3B-class chrF at 185M params |
| Research-only / non-commercial is fine, want 200 languages | **NLLB-200** distilled 600M / 1.3B | Strong classic NMT; ⚠️ **CC-BY-NC-4.0** — not for commercial use |
| Need register/glossary/format control in one pass (subtitles, legal, redaction) | **Hy-MT2-7B** or **TranslateGemma 12B** with instructions | Both follow translation instructions (keep terms untranslated, SRT format, style) |
| Multiple local languages (Javanese, Sundanese) as well | **SEA-LION** (`Gemma-SEA-LION-v3-9B-IT`) or **Sahabat-AI** (`llama3-8b-cpt-sahabatai-v1`) | SEA-tuned LLMs, Indonesian + regional languages |
| Deploying on Cloudflare Workers AI | **m2m100-1.2b** — the only id⇄en translation model there | Measured chrF 66.90 id→en (above local 4B tier), but 71.49 en→id (well below); segment first (it drops multi-sentence input) |
| Hosted translation on QwenCloud MaaS | **qwen-flash** with a placeholder-preservation instruction (`qwen-mt-turbo` retires 2026-10-10; `qwen-mt-flash` fails masked-name token survival) | chrF 71.67 id→en / 82.06 en→id, 10/10 token survival both directions, raisable rate limits; see [token survival](#token-survival-masked-name-protection-added-2026-09-29) |
| Hosted quality reference / fastest integration | **Kagi Translate** (via bevry-vibes/kagi-translate-client) | Best measured id→en (chrF **74.82**); ties TranslateGemma 4B on en→id; session-cookie client, no public API used |

Rule of thumb: **specialised MT models (TranslateGemma, Hy-MT2) beat general local LLMs of the same size for Indonesian**, and a 4B specialised model is often better than a 12B general one.

## How this was researched

- Live Hugging Face API queries (`/api/models`, `/api/datasets`) for sizes, licenses, language tags and download counts.
- Ollama library / registry checks for what is actually pullable, plus reading the technical reports ([TranslateGemma, arXiv 2601.09012](https://arxiv.org/abs/2601.09012); [Hy-MT2, arXiv 2605.22064](https://arxiv.org/abs/2605.22064)) for per-language numbers.
- A runnable harness in `eval/` + `scripts/` that scores any of these models on FLORES-101 devtest, Tatoeba and hand-written "tricky case" probes (register, idioms, numbers, do-not-translate entities).


## 1. Purpose-built translation models (recommended)

### TranslateGemma — Google DeepMind, released 15 Jan 2026

Gemma 3 fine-tuned for translation (SFT on synthetic + human parallel data, then RL against MetricX-QE/AutoMQM reward ensembles). Ships as **4B / 12B / 27B**, evaluated on the WMT24++ 55-language set, and it is multimodal — it keeps Gemma 3's image input, so it can translate **text inside images** (Vistra benchmark) without a separate OCR step.

Published quality on Indonesian (MetricX-24, **lower is better**, WMT24++ en→id_ID):

| system | 27B | 12B | 4B |
| --- | ---: | ---: | ---: |
| TranslateGemma | **2.07** | **2.17** | **2.63** |
| Gemma 3 (baseline) | 2.72 | 2.84 | 3.27 |

Whole-suite averages (55 pairs, WMT24++): MetricX 3.09 vs 4.04 for Gemma 3 27B; COMET22 84.4 vs 83.1. Indonesian is in the "paired with English in both directions" list, so `id→en` is a trained direction, not a pivot.

- Weights: HF `google/translategemma-4b-it` / `-12b-it` / `-27b-it` — **gated** (accept Google's terms, needs an HF token).
- Easiest local route: `ollama pull translategemma:4b` (4b/12b/27b, ~2.4M pulls, no HF account). GGUF mirrors exist (`mradermacher/*`, `bullerwins/*`), plus MLX 4-bit builds for Apple Silicon.
- License: **Gemma Terms of Use** (not OSI open source; commercial use allowed with conditions).
- Prompt: Google publishes the exact evaluation prompt (paper Fig. 3) and recommends using it verbatim — reproduced in `eval/backends.py` (`--prompt-style translate_gemma`).
- Watch out: it is a generative model, so `num_predict`/truncation and repetition need sane settings; keep temperature 0 for translation.

### Hy-MT2 — Tencent Hunyuan, released 21 May 2026

A "fast-thinking" translation family: **1.8B dense / 7B dense / 30B-A3B MoE**, covering **33 languages including Indonesian** (`id`), with an explicit focus on real-world/business translation and *instruction following* (style control, keeping terms untranslated, delimiter preservation, SRT subtitles, legal redaction/anonymisation).

- License: **Apache-2.0** — the cleanest licence of the high-quality group, and ungated on HF.
- Repos: `tencent/Hy-MT2-1.8B`, `-7B`, `-30B-A3B`, plus `-FP8`, `-GGUF` and extreme quants (`-2Bit-GGUF`, `-1.25Bit-GGUF`). `tencent/Hy-MT2-1.8B-GGUF` is the most-downloaded translation repo of the set (~375k/month).
- On-device: AngelSlim 1.25-bit quantization shrinks the 1.8B model to **440 MB** with ~1.5x speed-up; their own quantisation table shows Q4_K_M costs only ~1.3 points of the average score (1.8B: 83.49 BF16 → 82.22 Q4_K_M; 7B: 89.17 → 88.96), while 2-bit costs ~4.6 points.
- Predecessors: `Hunyuan-MT-7B` / `Hunyuan-MT-Chimera-7B` (Sep 2025) and `Hy-MT1.5-1.8B/7B` (Dec 2025).
- Gotcha (reproduced here): `ollama pull hf.co/tencent/Hy-MT2-1.8B-GGUF:Q4_K_M` fails with *"blocked redirect to a different host"* because Hugging Face redirects to its CDN. Download the GGUF with `curl -L` and register it with `ollama create` (see `scripts/pull-models.sh`).

### Classic NMT — small, fast, boring, offline

| model | params | license | notes |
| --- | --- | --- | --- |
| `Helsinki-NLP/opus-mt-id-en` | ~74M | **Apache-2.0** | Tatoeba id→en: BLEU **47.7**, chrF 0.647 (opus-2019-12-18 eval) |
| `Helsinki-NLP/opus-mt-en-id` | ~74M | **Apache-2.0** | Tatoeba en→id: BLEU **38.3**, chrF 0.636 |
| Argos Translate `id↔en` (argospm 1.9) | ~74M (CTranslate2) | **MIT / CC0** | Pre-converted OPUS/OpenNMT models; `pip install argostranslate`; powers LibreTranslate |
| `facebook/nllb-200-distilled-600M` (also 1.3B, 3.3B) | 600M–3.3B | **CC-BY-NC-4.0** | 200 languages (`ind_Latn`/`eng_Latn`); best coverage incl. local languages; **non-commercial only** |
| `facebook/m2m100_418M` / `_1.2B` | 418M–1.2B | **MIT** | Older, weaker than NLLB; commercial-friendly |
| `google/madlad400-3b-mt` (also 7B/10B) | 3B–10B | **Apache-2.0** | 400+ languages, target-language prefix tags (`<2id>`) |

These are 10–100× faster per sentence on CPU than an LLM-based translator and never "chat", but they cannot follow instructions and are more literal on idioms, register and entities. Use them for volume, not for polish.

### quickmt — 185M, CC-BY-4.0, the best tiny permissive pair (verified 2026-09-21)

`quickmt/quickmt-en-id` and `quickmt/quickmt-id-en` (both **CC-BY-4.0**, commercial OK) — a 185M transformer ("big", 8 encoder / 2 decoder layers) trained with eole and exported to **CTranslate2** + sentencepiece. Self-published FLORES-200 devtest numbers for `en→id` (sacrebleu / COMET, RTX 4070s, 1012 sentences):

| system | BLEU | chrF2 | COMET22 | time (s) |
| --- | ---: | ---: | ---: | ---: |
| quickmt-en-id | **48.69** | **71.95** | **91.02** | **1.13** |
| NLLB-200-distilled-1.3B (CC-BY-NC) | 46.14 | 70.70 | 91.39 | 33.09 |
| NLLB-200-distilled-600M (CC-BY-NC) | 43.74 | 69.06 | 90.47 | 19.16 |
| opus-mt-en-id (Apache-2.0) | 39.71 | 66.50 | 88.24 | 3.08 |
| m2m100_1.2B (MIT) | 42.62 | 68.04 | 89.76 | 32.40 |

NLLB-1.3B-class quality, fully commercial-usable, at 185M params and ~30× NLLB's speed — the strongest small permissive candidate for volume/batch work found so far. Run via the `quickmt` pip package (or drive CTranslate2 + sentencepiece directly; the repo also loads in LibreTranslate). Not yet measured on this machine — backlog item in the next steps.

### Newer entries worth tracking (verified against live sources, 2026-09-21)

- **Meta Omnilingual MT (OMT)** — real and significant on paper: the first MT system covering **1,600+ languages** (Meta AI, 17 Mar 2026), in two architectures — OMT-LLaMA (decoder-only, LLaMA3 base, retrieval-augmented) and OMT-NLLB (encoder-decoder over an OmniSONAR aligned space) — with 1B–8B variants reported to match or beat a 70B LLM baseline, which would make the small ones very interesting for a 16 GB machine. ⚠️ **As of 2026-09-21 no public weight repositories exist on Hugging Face** under `omnilingual*`, `omt-*`, or Meta's org (only third-party ASR spin-offs). Meta released the paper, leaderboard and evaluation datasets (BOUQuET / Met-BOUQuET), **not weights**. Watchlist until weights actually appear.
- **Cohere Labs North Small Translate 1.0** (Sep 2026) — verified on HF: **218B total / ~25B active MoE**, license **CC-BY-NC-4.0**. Vendor-claimed WMT26 leader, but BF16 weights are ≈ 436 GB (not runnable locally on this class of machine) and Indonesian is not a tier-one language in its card. Relevant as a quality ceiling or for multi-GPU serving only.
- **NusaMT-7B** (`williamhtan/NusaMT-7B`) — exists, but targets **low-resource regional languages** (Balinese, Javanese, …), not `id⇄en`; research-grade adoption. Only relevant if your pipeline also needs those languages.

#### Reconciling a second opinion (another AI's survey, 2026-09-21)

Cross-checked each claim against live sources (HF API, Meta AI, GitHub, model cards):

| claim from the other survey | verdict |
| --- | --- |
| `opus-mt-en-id` / `opus-mt-id-en` are CC-BY 4.0 | ❌ both are **Apache-2.0** (HF cardData) — better than claimed |
| Meta OMT "weights are open-sourced on Hugging Face" | ❌ paper + eval datasets only; **no weight repos found** on HF |
| Cohere North Small Translate leads WMT26 | ✔ repo exists — but **CC-BY-NC-4.0**, 218B params, not local-runnable here |
| MADLAD-400 GGUF weights available | ⚠️ community builds only (`notjjustnumbers/madlad400-3b-mt-Q4_K_M-GGUF`, …) — **not official** |
| NusaMT-7B for regional languages | ✔ exists, but regional-only (not id⇄en) and research-grade |
| quickmt-en-id beats opus-mt / NLLB-600M | ✔ matches its published FLORES-200 table; worth a local benchmark |
| TranslateGemma 4B as the practical default | ✔ already **measured here**: chrF 64.87 id→en / 80.75 en→id on our set |
| Hy-MT2 33-language list "verify Indonesian is included" | ✔ already verified + measured here (`id` is in the 33; chrF 64.35/78.86) |
| Qwen3 / Llama 3.1 better "for nuance" | ✔ partially — but on this machine's benchmark Qwen3 1.7B *lost* to both specialists (chrF 59.75); nuance wins need a bigger LLM than a 16 GB CPU box affords |
| LTEngine as a self-hosted tool | ✔ real (Rust + llama.cpp, LibreTranslate-compatible, AGPL-3.0) but defaults to Gemma3 and is **in active development** — see runtimes table |

### Speech and multimodal (if the source is audio or images)

- `openai/whisper-large-v3` and successors: speech→text and speech→**English** translation, including Indonesian audio; mature free tooling (`whisper.cpp`, `faster-whisper`).
- Meta SeamlessM4T v2 covers Indonesian speech→text/text→text but is **CC-BY-NC-4.0**.
- TranslateGemma translates **text inside images** out of the box (screenshots, menus, receipts).


## 2. General-purpose local LLMs (good, but not specialists)

For `id ⇄ en` these are worse than TranslateGemma/Hy-MT2 at equal size, but they are handy if you already run one model for other tasks, or need glossary constraints and long context.

| model | sizes | license | Indonesian support |
| --- | --- | --- | --- |
| Qwen3 / Qwen3.x | 0.6B → 235B-A22B | Apache-2.0 | Yes (119 languages claimed); excellent instruction following |
| Qwen3.8 (2026-08) | 27B dense; Flash-Next (large MoE, ~50 GB/shard GGUFs) | Apache-2.0 (27B) / Qwen terms (Flash-Next) | Yes — same multilingual recipe; **no local footprint on 16 GB** (27B dense ≈ full RAM at Q4) |
| Gemma 3 | 1B / 4B / 12B / 27B | Gemma Terms | Yes — the TranslateGemma base (WMT24++ en→id MetricX 2.72–3.27) |
| Aya Expanse | 8B / 32B | CC-BY-NC-4.0 | Yes — 23 languages incl. `id`; strong for its size, non-commercial |
| Nemotron / Granite / Mistral families | various | mostly Apache-2.0 | Indonesian present but weaker coverage than Qwen |

Practical notes:
- Always force **temperature 0** and cap output length; general LLMs add preambles/notes unless forbidden.
- Prompt with the style you want ("formal Indonesian suitable for a bank statement" works).
- A general 7B model usually loses to **TranslateGemma 4B** on this pair — bigger is not automatically better.
- **Qwen3.8-LiveTranslate-Flash-Realtime** (real-time audio/video interpretation, understands 60 / speaks 29 languages) is **hosted-only**, and the live probe (2026-09-24) confirms it **cannot join a text benchmark at all**: on QwenCloud MaaS its session negotiates `input_modalities: ["audio"]` — audio/video in, translated audio + text out, no text-input event. The offline sibling the model page references (`qwen3.8-livetranslate-flash`) answers **"Model not exist"** on the API, and the previous-generation `qwen3-livetranslate-flash` is listed but rejects `translation_options`, so it is not callable for text on this gateway either. **No weights on Hugging Face or Ollama.** The usable QwenCloud text-translation path is the dedicated **`qwen-mt` family** (below) — see [Hosted](#4-hosted-cloudflare-workers-ai-and-kagi-translate-added-2026-09-23). Watch the Qwen org for the offline LiveTranslate weights, not resellers.

## 3. Indonesian / SEA-specialised models

Trained or continual-pretrained on Indonesian (often plus Javanese/Sundanese), so they handle register and local entities better than generic multilingual models. None is a dedicated translator, so reach for them when you also need reasoning, or care about regional languages.

| model | base / size | license | notes |
| --- | --- | --- | --- |
| `GoToCompany/llama3-8b-cpt-sahabatai-v1-instruct` | Llama 3 8B | Llama 3 Community | **Sahabat-AI** (GoTo/Indosat consortium); `en, id, jv, su`; also `Sahabat-AI/Llama-Sahabat-AI-v2-70B-IT` |
| `aisingapore/Gemma-SEA-LION-v3-9B-IT` | Gemma 3 9B | Gemma Terms | SEA-LION v3 (AI Singapore): `en, zh, vi, id, th, fil`; also `Llama-SEA-LION-v3-8B-IT`, `-70B-IT`, `Qwen-SEA-LION-v4.5-27B-IT-GGUF` |
| Komodo (`Komodo_7B_v1.0.0`, `Komodo_6B_v3.0.0`, `Komodo-Llama-3.2-3B-v2`) | Llama / own | check repo | Yellow.ai / TeamUNIVA Indonesian models; community GGUF builds available |
| `indonlp/cendol-mt5-*` | mT5 | check repo | Indonesian mT5 family (UI NLP) for Indonesian NLG; not MT-specialised |
| `LazarusNLP/NusaBERT*` | BERT | check repo | Encoder-only — good for classification, **cannot translate** |

## 4. Hosted: Cloudflare Workers AI and Kagi Translate (added 2026-09-23)

These are not free-and-local, so they sit outside the original scope — but they answer the
deployment question directly: if the pipeline runs on Cloudflare (or you want a hosted
fallback), what should it call, and how does that quality compare with the local stack?

### Cloudflare Workers AI

- **Catalog (2026-09-23):** exactly two models carry Cloudflare's "Translation" tag:
  `@cf/meta/m2m100-1.2b` (Meta M2M-100, many-to-many encoder-decoder) and
  `@cf/ai4bharat/indictrans2-en-indic-1B` (English + the 22 scheduled Indic languages).
  Prompted general LLMs also run there, but they are outside the sweep defined for this
  comparison (the user scoped it to Cloudflare's own Translation-tagged models).
- **Indonesian:** only m2m100 serves it. IndicTrans2 accepts an `ind_Latn` target without
  error and **silently returns Hindi** — a nasty deployment trap. It is excluded from
  the scored runs.
- **m2m100 quirk (observed here):** on a multi-sentence input it translates only one sentence
  and the rest vanishes — which sentence survives is inconsistent (the smoke kept the second
  of two; the full run kept the first and dropped "Semoga sehat selalu", scoring the
  greeting category chrF 31.3). Segment before you send.
- **API and cost:** `POST /client/v4/accounts/{account}/ai/run/{model}` with
  `{text, source_lang, target_lang}`; Translation-class limit 720 requests/min. Billed in
  neurons ($0.011 per 1,000; free tier 10,000/day) — a full 78-segment direction costs a few
  hundred neurons, so the whole sweep stays free-tier.
- **AI Gateway vs Workers AI:** Workers AI is the inference platform. AI Gateway is an
  optional proxy in front of any provider (Workers AI included) that adds analytics,
  caching, rate limiting and model fallback. Direct calls need no gateway; routing through
  one later changes only the URL and headers, not the benchmark logic.
- **SDK note (both languages):** the typed `ai.run()` helpers of the official `cloudflare`
  SDKs (Python 5.7.0, TypeScript 7.1.0) URL-encode the slash-bearing model id and Cloudflare
  answers "No route for that URI" (error 7000). Drive the SDKs' generic request path
  (`client.post(...)`) instead — auth, retries and error mapping stay SDK-managed. See
  `eval/backends.py` (`CloudflareBackend`) and `eval/deno/run_eval.ts`, which are like-for-like
  implementations (Python SDK vs npm SDK; the Deno harness shares the test set, the metric
  formulas and the results schema, and scores through sacrebleu for parity).

### Kagi Translate

- No public API is used here. The benchmark drives
  [bevry-vibes/kagi-translate-client](https://github.com/bevry-vibes/kagi-translate-client),
  which speaks translate.kagi.com's own web endpoints with a session cookie (`KAGI_SESSION`,
  read from the environment only). Kagi's official request-access Translate API exists
  (about $15 per million characters) if a contracted surface is preferred.
- The client ships like-for-like Python (uv) and Deno CLIs; the harness drives both
  (`--kagi-runtime python|deno`), so client/runtime overhead is measured too.
- Quality signal from the smoke test: "Halo, apa kabar?" → **"Hello, how are you?"** (Kagi)
  vs "Hi, what is the news?" (m2m100) — Kagi reads far more naturally on this pair.
- Usage draws on the Kagi account's translate allowance; the account showed unlimited
  credits on 2026-09-23.

### QwenCloud MaaS (Alibaba) — verified live 2026-09-24

The deployment question expanded to QwenCloud (`maas.qwencloudapi.com`, OpenAI-compatible
`/compatible-mode/v1`), so its translation surface was probed and benchmarked:

- **`qwen3.8-livetranslate-flash-realtime` is real but audio-only.** The WebSocket realtime
  endpoint connects and negotiates a session (`translation.language` defaults to `en`), but
  the session declares `input_modalities: ["audio"]` — there is no text-input event. The
  protocol is OpenAI-Realtime-shaped but its own dialect: `session.update` carries
  `translation: {source_language, language}` (Indonesian `id` is supported as a source),
  and translated text arrives as `response.text.text` / `response.audio_transcript.text`
  deltas; `response.create` is not a valid event. Calling the model through chat completions
  returns a bare `{"status_message": "Success"}` with no content — a trap.
- **The offline sibling does not exist on the API.** `qwen3.8-livetranslate-flash` (referenced
  by the model page) answers "Model not exist"; the catalog's `qwen3-livetranslate-flash`
  rejects `translation_options` and is not callable for text on this gateway.
- **The usable text-translation family is `qwen-mt-*`** — `qwen-mt-plus`, `qwen-mt-turbo`,
  `qwen-mt-flash`, `qwen-mt-lite`: plain chat completions with
  `translation_options: {source_lang: "auto", target_lang: "English"}` and the raw source
  text as the message — no prompt, no thinking, and (unlike Workers AI's m2m100)
  multi-sentence input comes back whole. All four tiers are benchmarked below.
- **Retirement (added 2026-09-28):** QwenCloud retires **`qwen-mt-turbo` on 2026-10-10**
  (stated twice on its model page). Its limits — 60 requests/min, 100K tokens/min — are
  **not raisable**, and the console rate-limit-raise list covers chat models only
  (`qwen3.6-plus`, `qwen3.6-flash`, `qwen3.5-flash`, `qwen3.5-plus`, `qwen-flash`, …);
  no `qwen-mt` model is on it. The replacement benchmark and the updated recommendation
  are in [the retirement sweep](#the-qwen-mt-turbo-retirement-and-the-replacement-sweep-2026-09-28),
  superseded on 2026-09-29 by
  [token survival](#token-survival-masked-name-protection-added-2026-09-29): masked-name
  testing eliminated `qwen-mt-flash` (it eats the production placeholder tokens) and the
  Workers AI fallback `glm-4.7-flash`; the current recommendation is **qwen-flash with a
  placeholder-preservation instruction**, with `qwen-mt-lite` as the zero-protocol-change
  alternative.

## 5. Runtimes: how to actually run these locally

| runtime | best for | Indonesian notes |
| --- | --- | --- |
| **Ollama** | easiest path; `translategemma:*` is a first-class library model (4b/12b/27b, ~2.4M pulls) | `ollama pull translategemma:4b`; HF GGUFs need a manual download + `ollama create` (cross-host redirects are blocked) |
| **LM Studio** | GUI, model discovery, GGUF | Any TranslateGemma/Hy-MT2 GGUF; exposes an OpenAI-compatible server at `:1234` |
| **llama.cpp / llama-server** | minimal deps, embedded/mobile, full quant control | Hy-MT2 GGUFs (`Q4_K_M`, `Q6_K`, `Q8_0`); some Hy-MT2 quants need Tencent's custom STQ kernel (llama.cpp PR #22836) — prefer standard quants |
| **vLLM / SGLang / TGI** | server throughput, batching | Use FP8/BF16 weights; `tencent/Hy-MT2-30B-A3B` is the throughput sweet spot |
| **transformers + CTranslate2** | NLLB / M2M / MADLAD / OPUS-MT | CPU is fine at 600M class; INT8 conversion cuts memory ~4× |
| **Argos Translate / LibreTranslate** | self-hosted API, HTML/file translation, minimal deps | `en↔id` packages exist (argospm 1.9); can pivot via English for other pairs |
| **LTEngine** (LibreTranslate) | LibreTranslate-compatible API over llama.cpp (Rust) | Runs Gemma3-class GGUFs (1b–27b, `gemma3-4b` ≈ 4 GB RAM); AGPL-3.0; **active development** — single-request mutex, no file/sentence-split support yet |
| **Firefox built-in translation** | free offline in-browser page translation | ❌ **No Indonesian** in the shipped model set (Marian/Bergamot WASM; repo archived 2023) |
| **Workers AI REST/SDK** (hosted) | no infra; the deployment target for this project | m2m100-1.2b is the only id↔en translation model; official `cloudflare` SDKs, generic `client.post` (see [Hosted](#4-hosted-cloudflare-workers-ai-and-kagi-translate-added-2026-09-23)) |
| **kagi-translate-client** (hosted) | hosted quality reference; Python (uv) + Deno CLIs | Session-cookie auth, no API key; `translate.kagi.com` web endpoints (see [Hosted](#4-hosted-cloudflare-workers-ai-and-kagi-translate-added-2026-09-23)) |

Hardware sizing (Q4-class weights, rules of thumb):

| model | weights on disk | comfortable RAM/VRAM |
| --- | --- | --- |
| Hy-MT2-1.8B (Q4_K_M / 1.25-bit) | 1.2 GB / 0.44 GB | 2–3 GB / phone-class |
| TranslateGemma 4B (Q4) | ~3.3 GB | 6–8 GB |
| Hy-MT2-7B (Q4_K_M) | ~4.5 GB | 8–10 GB |
| TranslateGemma 12B (Q4) | ~7–8 GB | 12–16 GB |
| Hy-MT2-30B-A3B (MoE, Q4) | ~18 GB | 20–24 GB (3B active → fast) |

## 6. Evaluation: what to measure with, and which datasets are usable

**Datasets (all free; the first two need no HF token):**

| dataset | what it is | Indonesian coverage |
| --- | --- | --- |
| `openlanguagedata/flores_plus` | FLORES+ , the current standard eval set | `id_Latn` + `eng_Latn`, professional translations — **gated (auto-approve, needs HF login)** |
| `gsarti/flores_101` | FLORES-101 mirror, ungated | `ind` + `eng` dev/devtest — what this repo's harness uses |
| `google/wmt24pp` (WMT24++) | 55-language human eval set Google uses for TranslateGemma; where the id MetricX numbers come from | `en→id_ID` and reverse |
| Tatoeba / OPUS (`OPUS-Tatoeba/en-id`) | short everyday sentence pairs from Tatoeba | tens of thousands of pairs, CC-BY |
| `indonlp/NusaX`, NusaWrites | Indonesian + 12 local languages, incl. MT splits | Indonesian↔local languages, some id↔en |
| TED2020 / TICO-19 | talk transcripts / COVID public-health text | id present, good for domain checks |


## 7. Battle-tested gotchas

- **Gated repos.** `google/translategemma-*` requires accepting Google's terms and an HF token; the Ollama build and community GGUF mirrors avoid that. `openlanguagedata/flores_plus` is auto-gated too (use the `gsarti/flores_101` mirror if you cannot log in).
- **Ollama + Hugging Face GGUFs.** `ollama pull hf.co/<repo>:<quant>` fails with *"blocked redirect to a different host"* on this setup because HF 302s to its CDN. `curl -L` the `.gguf` yourself, then `ollama create <name> -f Modelfile` with `FROM /path/model.gguf`.
- **Some Hy-MT2 GGUFs need a patched llama.cpp.** Tencent notes that the GGUF quants rely on their custom STQ kernel (llama.cpp PR #22836). Standard quants (`Q4_K_M`, `Q6_K`, `Q8_0`) are the safe bet on stock Ollama/llama.cpp.
- **Licences are not uniform.** Apache-2.0: Hy-MT2, OPUS-MT, M2M-100, MADLAD, Qwen3, Whisper. Non-commercial: NLLB-200, Aya Expanse, SeamlessM4T. Vendor terms: Gemma (Gemma 3, TranslateGemma, Gemma-SEA-LION), Llama 3 (Sahabat-AI). Check before shipping anything commercial.
- **Generative models chat.** Expect preambles ("Here is the translation:"), explanations and occasional refusals; always post-process, cap output tokens, temperature 0.
- **Short inputs hallucinate.** One-word/three-word segments are where LLMs invent content; the classic NMT models are safer for UI strings and table cells.
- **Long documents drift.** Nothing here maintains terminology or pronouns across segments on its own; chunk by paragraph and re-inject a glossary every chunk.
- **Benchmarks lie by omission.** A model can win on aggregate chrF and still be unusable for your domain — always inspect per-category scores and the raw hypotheses (`results/*.json`).
- **Single-reference metrics under-rate valid creativity.** In our smoke run an idiom probe was translated correctly but scored 39 chrF because the reference used different wording.
- **M2M-100 translates only one sentence of a multi-sentence input** (observed on Workers AI, 2026-09-23): two sentences in, one out, and which one survives is inconsistent. Segment before you send.
- **IndicTrans2 silently returns Hindi for Indonesian.** Cloudflare tags it "Translation" and accepts `ind_Latn` as the target without an error; the output is Devanagari Hindi. Validate language coverage per model before trusting a hosted catalog tag.

## 8. Decision guide

**If you want the best possible free `id ⇄ en` quality:** TranslateGemma 12B (or 27B if the hardware is
there). It is a purpose-built translator with published, per-language evidence for Indonesian, and
strong instruction following.

**If you need commercial-safe weights:** Hy-MT2 (Apache-2.0) — 1.8B for CPU/laptop/edge, 7B for a GPU workstation, and 30B-A3B if you can host ~20 GB and want server throughput with MoE speed. OPUS-MT/Argos (`Apache-2.0`/`MIT`) cover the low-footprint end of the same licence story.

**If you must run with no LLM runtime at all** (embedded, old CPUs, offline appliances): quickmt (185M, CC-BY-4.0 — best published chrF of the tiny tier), Argos Translate, or `opus-mt-id-en`/`opus-mt-en-id` via CTranslate2 — a few hundred MB of RAM, sub-second latency, trivially batchable.

## Measured results on this machine

Setup: AMD Ryzen 5 7640U, 12 threads, 15 GB RAM, **no GPU**, Ollama 0.34.2 (CPU inference), Python 3.14, `sacrebleu` 2.6 metrics. Test set produced by `eval/build_testset.py`: 20 FLORES-101 devtest pairs (professional, formal/news), 40 Tatoeba pairs (short everyday sentences), 18 hand-written `id→en` + 14 `en→id` tricky cases (register, idioms, numbers, do-not-translate entities, long sentences). Model load time is excluded (warm-up call first).

### id → en (78 segments)

| model | prompt | chrF | chrF++ | BLEU | s/segment | weights |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Kagi Translate (web, session client) | — | **74.82** | **73.20** | **53.12** | 1.54 py / **0.26** deno | hosted |
| Qwen-MT turbo (`qwen-mt-turbo`) | — | 71.77 | 70.02 | 46.62 | 0.51 | hosted |
| Qwen-MT lite (`qwen-mt-lite`) | — | 71.26 | 69.58 | 46.47 | 1.08 | hosted |
| Qwen-MT plus (`qwen-mt-plus`) | — | 70.68 | 68.67 | 43.61 | 0.74 | hosted |
| Qwen-MT flash (`qwen-mt-flash`) | — | 69.90 | 68.02 | 43.57 | **0.34** | hosted |
| Workers AI m2m100-1.2b | — | 66.90 | 65.12 | 43.06 | 1.38 py / 1.17 deno | hosted |
| TranslateGemma 4B (`translategemma:4b`, Q4) | TranslateGemma template | 64.87 | 63.10 | 38.79 | 4.36 | 3.3 GB |
| Hy-MT2-1.8B (Q4_K_M) | Hy-MT2 instruction | 64.35 | 62.21 | 35.10 | 1.00 | 1.2 GB |

Per-category chrF (only `flores-devtest`, 20 pairs, and `tatoeba`, 40 pairs, are statistically meaningful; single-pair categories are directional hints):

| category | TranslateGemma 4B | Hy-MT2-1.8B |
| --- | ---: | ---: |
| flores-devtest (20) | **69.72** | 69.04 |
| tatoeba (40) | 68.51 | **69.23** |
| idiom (3) | **43.68** | 25.73 |
| do-not-translate (2) | **87.29** | 74.17 |
| numbers-currency (1) | **100.00** | 85.66 |
| technical-ui (1) | **83.21** | 65.27 |
| colloquial-register (1) | 40.52 | **51.53** |
| legal-admin (1) | 66.83 | **80.55** |
| long-sentence (1) | 48.30 | **66.89** |
| passive-di (1) | 69.11 | **87.53** |

Both models are effectively tied on aggregate quality here (−0.5 chrF, within noise for 78 segments), but Hy-MT2-1.8B is **4.4× faster with a third of the disk/RAM** — on a CPU-only machine that is the difference between 1 s and 4.4 s per segment. TranslateGemma 4B was clearly better at idioms, entity/number preservation and UI strings; Hy-MT2 was better on the long, subordinate-clause sentence, the legal passive and colloquial register.

### en → id (14 segments, curated probes only)

| model | chrF | chrF++ | BLEU | s/segment |
| --- | ---: | ---: | ---: | ---: |
| Qwen-MT flash (`qwen-mt-flash`) | **87.26** | **86.71** | 72.48 | **0.33** |
| Qwen-MT turbo (`qwen-mt-turbo`) | 86.00 | 85.65 | **77.38** | 0.31 |
| Qwen-MT plus (`qwen-mt-plus`) | 83.99 | 83.61 | 73.05 | 0.30 |
| Qwen-MT lite (`qwen-mt-lite`) | 82.01 | 81.51 | 69.30 | 0.28 |
| TranslateGemma 4B | 80.75 | 79.96 | 62.83 | 2.84 |
| Kagi Translate (web, session client) | 80.53 | 80.09 | 69.17 | 1.91 py / 0.25 deno |
| Hy-MT2-1.8B | 78.86 | 78.25 | 57.60 | 0.94 |
| Workers AI m2m100-1.2b | 71.49 | 70.24 | 52.53 | 0.99 py / 0.81 deno |

Sample outputs worth knowing (all three are "valid but different" from the reference, which is why single-reference chrF under-reports quality):

- `browser` reference `peramban`: TranslateGemma returned "Browser ini tidak didukung pada perangkat Anda." — the loanword users actually say.
- `application` reference `Permohonan`: returned "Aplikasi tersebut …" — correct for software, wrong for a form submission; sense disambiguation needs context you must provide.
- `always in sync` reference `selalu tersinkronisasi`: returned "selalu sinkron" — shorter, natural.

The full per-segment source/reference/hypothesis dumps are in `results/*.json`, and the generated summary table is in `results/results.md`.

### Hosted vs local (runs of 2026-09-23)

- Hosted rows were measured on 2026-09-23 with the same test set and the same sacrebleu metric backend as the local rows, so the tables are directly comparable.
- **Kagi Translate wins id→en outright** (chrF 74.82, +10 over the local 4B tier) and ties TranslateGemma 4B on en→id (80.53 vs 80.75 — within 14-segment noise); its BLEU lead on en→id (69.17 vs 62.83) says it matches the reference wording more often. Weakest en→id categories: legal clauses (68.4) and short UI strings (69.9).
- **The Qwen-MT family takes en→id by a wide margin**: qwen-mt-flash scores chrF 87.26 (+6.5 over the previous best) at 0.33 s/sentence — the best quality AND latency of any hosted row — with qwen-mt-turbo close behind (86.00, and the best BLEU at 77.38; it retires 2026-10-10 — see the 2026-09-28 sweep below). On id→en the four tiers cluster at 69.9–71.8, above Workers AI m2m100 and the local tier, though still under Kagi. Translations come back fluent and complete: the multi-sentence greeting that m2m100 mangled ("Semoga sehat selalu" dropped, chrF 31.3) translates in full (greeting-register chrF 93.2). Weak spots mirror the other systems: idioms (24–33) and short Tatoeba everyday lines.
- **Workers AI m2m100 beats the local 4B tier on id→en aggregate** (66.90 vs 64.87) despite dropping multi-sentence content — the aggregate is dominated by single-sentence FLORES/Tatoeba segments. On en→id it is 9 chrF behind (71.49 vs 80.75). For a Cloudflare deployment: usable for pre-segmented id→en volume, not competitive en→id.
- **Python vs Deno client parity is exact**: identical scores on every run (deterministic services, same metric formulas). Latency differs by client machinery — the Deno Kagi path is ~6× faster per sentence than the Python path (0.26 vs 1.54 s) because the Python runtime pays a `uv` process start per sentence; Deno edges the Workers AI rows by ~0.2 s/sentence.
- **Timing semantics**: hosted rows time one network round trip per sentence against warm models; local rows time CPU inference after a warm-up. Do not read the s/segment column as a like-for-like speed ranking across the hosted/local boundary.

### The qwen-mt-turbo retirement and the replacement sweep (2026-09-28)

QwenCloud retires **qwen-mt-turbo** on **2026-10-10** (stated twice on its model page).
Its rate limits — 60 requests/min, 100K tokens/min — are **not raisable**, and the
console raise list covers chat models only (`qwen3.6-plus`, `qwen3.6-flash`,
`qwen3.5-flash`, `qwen3.5-plus`, `qwen-flash`, …); no `qwen-mt` model is on it. Since
the retiring model is the primary translator of a production site (patipeaceplace,
id→en primary, short web segments, names must survive, 5-minute cron budget), the
replacement candidates were benchmarked in one session on the same test set and metric,
both directions:

- **qwen-mt-flash** (the surviving `qwen-mt` tier) and **qwen-mt-turbo** (retiring
  baseline) re-run through `translation_options` — the re-runs double as a drift control.
- The console-raisable chat models **qwen-flash**, **qwen3.6-flash**, **qwen3.5-flash**
  through the OpenAI-compatible endpoint with the production **`engine` prompt**
  (a translation-engine system instruction plus the raw source text — the exact request
  shape of patipeaceplace's `glmTranslate`).
- The production Workers AI fallback **glm-4.7-flash** through the same `engine` prompt
  (`WorkersAiChatBackend`, production request shape).

**id → en (78 segments)**

| model | prompt | chrF | chrF++ | BLEU | s/segment | rate limits |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Kagi Translate (2026-09-23 reference) | — | **74.82** | **73.20** | 53.12 | 0.26–1.54 | n/a (web session) |
| qwen3.5-flash | engine | **72.11** | 70.58 | **48.92** | 16.88 | raisable |
| qwen-mt-turbo (retiring baseline) | — | 71.94 | 70.17 | 46.68 | 0.78 | 60 RPM / 100K TPM; retires 2026-10-10 |
| qwen-flash | engine | 71.67 | 70.13 | 48.81 | **0.46** | raisable |
| qwen3.6-flash | engine | 71.62 | 69.79 | 46.59 | 7.58 | raisable |
| glm-4.7-flash (Workers AI) | engine | 70.11 | 68.52 | 45.13 | 17.10 | Workers AI neurons |
| qwen-mt-flash | — | 69.95 | 68.05 | 43.56 | 0.87 | 60 RPM / 100K TPM, not raisable |

**en → id (14 segments)**

| model | prompt | chrF | chrF++ | BLEU | s/segment |
| --- | --- | ---: | ---: | ---: | ---: |
| qwen-mt-flash | — | **87.07** | **86.50** | 73.92 | **0.35** |
| qwen-mt-turbo (retiring baseline) | — | 86.00 | 85.65 | **77.38** | 0.31 |
| qwen3.6-flash | engine | 84.57 | 84.16 | 72.39 | 6.99 |
| qwen3.5-flash | engine | 82.90 | 81.65 | 62.07 | 8.00 |
| qwen-flash | engine | 82.06 | 81.49 | 69.51 | 0.52 |
| glm-4.7-flash (Workers AI) | engine | 71.61 | 70.09 | 50.34 | 13.88 |

Drift check: qwen-mt-turbo id→en 71.77 (2026-09-24) → 71.94; qwen-mt-flash 69.90 → 69.95;
qwen-mt-flash en→id 87.26 → 87.07. Scores are stable across five days.

Findings:

- **No single successor dominates both directions.** qwen-mt-flash keeps the en→id
  crown (87.07) but is the weakest `qwen-mt` tier on id→en (69.95, −2.0 vs the retiring
  turbo). The chat models tie or beat turbo on id→en (qwen-flash 71.67, qwen3.5-flash
  72.11 — the best Qwen number measured) but give up 3–5 chrF on en→id. The 78-vs-14
  segment asymmetry makes id→en the statistically stronger comparison — conveniently
  also the production direction (the site translates its Indonesian content into
  English).
- **Chat models are MT-class on id→en now.** With the `engine` prompt the best of them
  land within 0.3 chrF of the retiring dedicated model and above every non-QwenCloud
  option measured; the dedicated `qwen-mt` family keeps a real en→id edge.
- **Entities and do-not-translate survive everywhere that matters.** id→en
  do-not-translate probes: qwen-flash 100.0 (both), qwen3.6-flash 89.37, qwen3.5-flash
  89.37, both qwen-mt models 87.29 — in every case the entity itself
  (`support@example.com`, `Settings > Security`) survived intact; the chrF spread comes
  from phrasing around it ("by tomorrow at the latest" vs "no later than tomorrow").
  acronym-entity (Kemenkeu → Ministry of Finance): qwen-mt 92.54, qwen3.5/3.6-flash
  87.98, qwen-flash 83.0. On en→id the acronym probe (GDP → PDB) is 100.0 for every
  Qwen model — only glm-4.7-flash left it as "GDP" (88.94). No name butchering observed
  in any candidate's entity probes.
- **Thinking latency is the chat models' hidden cost.** qwen3.6-flash and
  qwen3.5-flash spend 7–17 s/segment on reasoning tokens versus 0.3–0.9 for the
  `qwen-mt` family and qwen-flash; a 200-segment entry would take 25–55 minutes through
  them — far outside the production 5-minute cron budget, and billed tokens all the
  same. glm-4.7-flash is similarly slow (13.9–17.1 s/s) and collapses en→id (71.61 —
  level with Workers AI m2m100, 10+ behind the Qwen tier, with real mistranslations:
  *utang* "debt" → "knots"). It stays viable only as an outage fallback, never a
  primary.
- **Reliability during the sweep:** zero 429s at sequential per-segment pacing (the
  harness retries 429/5xx honouring `Retry-After`, excluded from measured latency).
  qwen3.5-flash stalled twice past the 300 s socket timeout mid-sweep — the harness now
  retries transient timeouts so the run survives, but an unattended cron would have
  hung twice for five minutes; a reliability strike against it.

Recommendation (for the production site; grounded in the tables above —
**superseded 2026-09-29**: the plain-text ranking missed masked-name token survival, see
[the token-survival section](#token-survival-masked-name-protection-added-2026-09-29)
for the rewritten recommendation; qwen-mt-flash, recommended here as the default, fails
the masked test):

- **Default: qwen-mt-flash.** Best en→id measured anywhere (87.07); id→en within 2.0
  chrF of the retiring turbo and above every non-QwenCloud option; entity behaviour
  identical to turbo's (do-not-translate 87.29, acronym-entity 92.54); zero integration
  change (same `translation_options` contract); 0.35–0.87 s/segment keeps even a
  300-segment entry inside the cron window. The non-raisable 60 RPM / 100K TPM caps sit
  one to two orders of magnitude above the site's sequential per-segment traffic — only
  a whole-corpus rebuild would press them (split it across runs if that ever happens).
  Cost at this volume is negligible: the entire ~500-request sweep cost cents on
  QwenCloud, and the site's steady-state traffic (a handful of content entries per
  week) is far below that.
- **Raisable alternative: qwen-flash.** Statistically tied with the retiring turbo on
  id→en (71.67 vs 71.94; BLEU 48.81 vs 46.68), the only perfect do-not-translate score
  (100.0), the fastest model of the sweep (0.46 s/s), and the one candidate whose rate
  limits the console can actually raise. Trade-off: en→id 82.06 (−5.0 vs qwen-mt-flash)
  and acronym-entity 83.0 (weakest of the Qwen set). Switch to it — or add it as a
  second provider — if bulk re-translation volume ever meets the qwen-mt caps.
- **Fallback: keep glm-4.7-flash as-is.** Maker-diverse and independent of QwenCloud,
  which is its entire job; the numbers confirm it should never be the primary (en→id at
  m2m100 level, 13.9–17.1 s/segment), but the queue drains from it only during an
  outage.
- **Not primaries: qwen3.6-flash / qwen3.5-flash.** Competitive quality (qwen3.5-flash
  is nominally the best Qwen id→en at 72.11), but thinking latency (7–17 s/s) and the
  qwen3.5 stalls blow the cron budget. Revisit if a non-thinking variant of that
  quality tier appears.

### Token survival: masked-name protection (added 2026-09-29)

The plain-text sweep above has a blind spot the production pipeline hit the same week:
patipeaceplace's translator masks every known name form into a private-use placeholder
before the provider sees the text (`protectTerms`: the form is replaced by
`U+E000 + <0-based glossary index> + U+E001`, glossary sorted longest-form-first,
self-mapping), then restores the tokens afterwards and asserts every name survived.
With that scheme live, a **qwen-mt-flash** regeneration dropped the masked names of
"Petrus", "Nanik" and the organisation name across an article (five survival-assertion
flags) while **qwen-mt-turbo** handled two full articles clean — and the chrF benchmark
never saw it, because none of its segments were masked.

`eval/build_masked_testset.py` builds `data/masked.jsonl` to close that gap: 20
name-heavy segments (10 per direction, production staff + organisation names, some with
repeated occurrences), masked exactly like production. `eval/token_survival.py` scores
each hypothesis strictly: every expected token must survive with the right index and
count, nothing may be renumbered or left behind, and every name must round-trip through
restoration. Chat models were run with a new **`engine-preserve`** prompt (the
production engine instruction plus an explicit "copy every
`U+E000<digits>U+E001` token verbatim" clause); the qwen-mt models got the raw masked
text (their production shape). Strict verdicts — one dropped name fails the run:

| model | prompt | id→en survived | en→id survived | verdict | plain-set chrF id→en / en→id |
| --- | --- | ---: | ---: | --- | --- |
| qwen-flash | engine-preserve | **10/10** | **10/10** | **PASS** | 71.67 / 82.06 |
| qwen-mt-lite | none (raw) | **10/10** | **10/10** | **PASS** | 71.26 / 82.01 |
| qwen3.6-flash | engine-preserve | **10/10** | **10/10** | **PASS** | 71.62 / 84.57 |
| qwen3.5-flash | engine-preserve | **10/10** | **10/10** | **PASS** | 72.11 / 82.90 |
| qwen-mt-turbo (retiring baseline) | none (raw) | 9/10 | 10/10 | FAIL | 71.94 / 86.00 |
| qwen-mt-flash | none (raw) | 2/10 | 10/10 | FAIL | 69.95 / 87.07 |
| qwen-mt-plus | none (raw) | 1/10 | 7/10 | FAIL | 70.68 / 83.99 |
| glm-4.7-flash (Workers AI) | engine | 0/10 | 0/10 | FAIL | 70.11 / 71.61 |
| glm-4.7-flash (Workers AI) | engine-preserve | 0/10 | 0/10 | FAIL | 63.74 / 57.28 |

Full per-segment failure detail: [results/token-survival.md](../results/token-survival.md).

- **The failure modes are graded, not binary.** glm strips the private-use wrappers and
  literalises the index ("Laporan tahunan **10** ditulis oleh **5**…", even translating
  index 0 as the word "nol"); qwen-mt-flash/plus reduce sentence-adjacent tokens to bare
  numbers with punctuation ("**1.** Leading the community's weekly meeting…") while
  occasionally keeping mid-sentence tokens; qwen-mt-turbo failed exactly one segment —
  a **sentence-initial** masked organisation name rendered as "0 opens registration…" —
  and passed everything else.
- **"Production-verified" is not adversarially safe.** The turbo baseline that handled
  two full articles clean still failed the probe set's sentence-initial org token.
  Production evidently never hit that placement, or it is stochastic. The survival
  assertion and review flags must stay regardless of which model wins — the benchmark
  and the assertion layer are the safety net, not the model choice.
- **The direction asymmetry is real**: qwen-mt-flash carried every token en→id (10/10)
  and lost almost all of them id→en (2/10). The production pipeline runs id→en.
- **The preservation instruction works, where the model can follow it**: all three
  raisable chat models went to perfect 10/10 in both directions with `engine-preserve`.
  glm-4.7-flash failed 0/10 **with the same instruction** — it cannot carry masked
  segments at all.

**Rewritten recommendation** (supersedes the plain-text recommendation of 2026-09-28;
a successor must pass token survival AND quality AND the 5-minute cron budget):

- **No qwen-mt survivor is both safe and raisable.** qwen-mt-flash (the earlier pick)
  and qwen-mt-plus fail token survival outright; qwen-mt-turbo, the model production
  trusts, is itself not perfect on adversarial placements and retires 2026-10-10;
  qwen-mt-lite passes cleanly raw but inherits the family's non-raisable 60 RPM / 100K
  TPM caps and its single-vendor retirement risk (the family is demonstrably being
  pruned).
- **Winner: qwen-flash with the `engine-preserve` instruction as the production
  default.** Perfect 10/10 token survival in both directions, turbo-level plain-text
  quality (id→en 71.67 vs turbo 71.94; BLEU 48.81, second only to qwen3.5-flash's
  48.92), 0.46–0.52 s/segment (a
  300-segment entry translates in ~2.5 minutes, inside the cron window), and the only
  quality survivor whose rate limits the console can raise. Cost of adoption: switch the
  provider from the qwen-mt `translation_options` shape to chat completions and append
  the one-sentence preservation clause to the engine system instruction — small, tested
  changes to the production translator.
- **Ranked behind it:** qwen3.6-flash + instruction (best survivor en→id at 84.57 and
  perfect survival, but 6–8 s/segment of thinking latency blows the cron budget on
  entry-sized batches) → qwen3.5-flash + instruction (perfect survival, best survivor
  id→en at 72.11, but 8–17 s/segment plus mid-sweep socket stalls — worst reliability)
  → qwen-mt-lite raw (the zero-protocol-change drop-in: passes 10/10 without any prompt
  change at 1.1 s/segment, id→en 71.26; take it if the provider switch must wait, and
  accept the non-raisable caps).
- **The failover path needs rework: glm-4.7-flash destroys masked names** (0/10 with
  and without the instruction). During a QwenCloud outage the current fallback would
  flag every masked segment for review — availability with unusable output. Point the
  outage failover at a token-safe provider instead (the qwen-flash chat path, or
  re-test future fallback candidates on `data/masked.jsonl` first), and keep the
  survival assertion + review flags as the permanent safety net. If a future sweep
  produces no token-safe candidate at all, the recommendation is: stay on
  qwen-mt-turbo until retirement, then fail over to the best survivor with review
  flags on every segment, or switch vendors.

### Caveats on these numbers

- 78 (+14) segments is a *sanity* set: enough to catch systematic problems, not enough to rank two models 1 chrF apart. Treat the category table as a list of things to test with your own data.
- One reference per segment penalises valid alternatives, as the examples above show.
- CPU-only timings say nothing about GPU throughput; on a GPU both models would be 10–50× faster, and the 12B/27B variants become practical.
- The Apple/Intel/consumer-GPU picture differs: on Apple Silicon use the MLX 4-bit builds (`mlx-community/translategemma-*-4bit`) or LM Studio.

**If you need Indonesian plus Javanese/Sundanese/Betawi robustness:** NLLB-200 (non-commercial) for coverage, or Sahabat-AI / SEA-LION for an LLM that understands the regional mix.

**If you need to translate images, audio or subtitles:** TranslateGemma (text in images) + Whisper (audio → English) + Hy-MT2 (SRT/instruction-following cues).

## 9. Suggested next steps

1. Replace `data/curated.jsonl` references with real references from your own domain (support tickets, invoices, product copy) — 50–100 segments is enough to re-rank the candidates for your use case.
2. Run head-to-heads with `scripts/run-bench.sh` on that set; keep TranslateGemma 4B/12B and Hy-MT2 1.8B/7B.
3. Benchmark the classic NMT tier now that CPU torch is installed: `pip install transformers sentencepiece`, then e.g. `python3 eval/run_eval.py --backend transformers --model Helsinki-NLP/opus-mt-id-en --family opus --prompt-style none --src id --tgt en --name opus-mt-id-en` (the guard sizes opus-mt at ~1.5 GB — run with ~3.5 GB free, or pass `--est-gb 0.8` on a tight box). Same for `quickmt` once `pip install quickmt` (pulls CTranslate2) is in — it is the strongest permissive tiny-tier candidate found so far.
4. Add a neural metric (COMET-22 or MetricX-24) if GPU time is available; chrF alone cannot tell you which of two fluent outputs is better.
5. Build the glossary/do-not-translate layer and the number/date/currency post-processor described in [indonesian-notes.md](indonesian-notes.md) — that buys more quality than swapping models.
6. Consider fine-tuning only after that: OPUS/FLORES plus your own parallel data on a 1.8B–7B model (LoRA) is cheap, and both Hy-MT2 and TranslateGemma ship training recipes.

**Metrics.** For `id ⇄ en` prefer **chrF/chrF++** over BLEU (Indonesian's affixation and
compound reduplication make BLEU unstable on small sets) and add a **neural metric**
(COMET-22, MetricX-24) if you can afford the extra model — those are what the vendor tables use.
The bundled harness reports corpus chrF, chrF++, BLEU (via `sacrebleu` when installed) and
per-category chrF; neural metrics are optional extras (`pip install unbabel-comet` — large, GPU recommended).

**Benchmark hygiene, learned the hard way while building this:**
- 30–50 sentences per category is enough to spot a regression, not enough to rank two models 1 point apart.
- Score per *category* (UI, legal, medical, idiom, numbers). Aggregate scores hide the failures that actually bite.
- Use one reference per sentence (that's all FLORES/Tatoeba give you) and accept that valid-but-different translations score lower — check the worst-performers by hand.
- Measure **seconds/sentence** with the model already loaded (the harness warms up first), otherwise the first call's load time dominates.
- Translate twice at temperature 0 and compare — any difference means non-determinism you must handle.
- Keep the harness's sample dumps (`results/*.json` contains every source/reference/hypothesis pair) for auditing.

| TranslateGemma 27B (Q4) | ~17 GB | 20–24 GB (full precision: one H100/TPU) |
