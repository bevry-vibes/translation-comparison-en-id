# plan: replace the retiring qwen-mt-turbo — benchmark QwenCloud chat models and the Workers AI glm fallback

Assisted-by: ZCode · GLM 5.3 Flash <zcode-zcode-glm53flash@local>

Companion: [1790619433111-qwen-mt-turbo-retirement-replacement.prompts.md](./1790619433111-qwen-mt-turbo-retirement-replacement.prompts.md)

## context

The production site's translator (patipeaceplace `plugins/auto-translate`) uses **qwen-mt-turbo** as its primary model. QwenCloud retires that model on **2026-10-10** (stated twice on its model page; 60 RPM / 100K TPM, not raisable, not in paid plans). **qwen-mt-flash** carries no retirement notice and is the surviving MT candidate (prior benchmark: best en→id, chrF 87.26; id→en 69.9 vs turbo's 71.77). The QwenCloud rate-limit docs list the console-raisable models — qwen3.6-plus, qwen3.6-flash, qwen3.5-flash, qwen3.5-plus, qwen-flash, … — **chat models only, no qwen-mt models**. The production fallback is Cloudflare Workers AI **glm-4.7-flash**.

Production constraints that define "good": id⇄en both directions; short web-content segments; do-not-translate personal names must survive (per-category chrF matters, not just corpus averages); the 5-minute-cron budget makes speed matter; maker-diverse fallback already in place.

This repo already has: the Qwen-MT adapter (`translation_options` on the QwenCloud compatible-mode endpoint), the generic OpenAI-compatible adapter, Workers AI and Kagi adapters, the test set (`data/testset.jsonl`, 78 id→en + 14 en→id pairs), and prior results for the qwen-mt family + Kagi + Workers AI + local models (2026-09-23/24).

## decisions

- The chat candidates (`qwen-flash`, `qwen3.6-flash`, `qwen3.5-flash`) run through the **existing OpenAI-compatible adapter** against `https://maas.qwencloudapi.com/compatible-mode/v1` — QwenCloud's chat endpoint is exactly that, so no dedicated adapter is warranted.
- A new named prompt style, **`engine`**, mirrors the production contract of `glmTranslate` in patipeaceplace's `plugins/auto-translate/src/providers.mjs` verbatim: a system message ("You are a translation engine. Translate the user's text from X to Y. Output only the translation, preserving paragraph breaks. No notes, no reasoning, no alternatives.") plus the raw source text as the user message. `build_prompt` stays string-shaped; a new `build_messages` helper returns the message array (`engine` → system + user, every other style → single user message wrapping `build_prompt`).
- glm-4.7-flash gets a **small dedicated `WorkersAiChatBackend`** mirroring `glmTranslate`'s request shape (chat messages + `stream: false` on the `ai/run` path, read `result.choices[0].message.content`, tolerate `result.response`) through the official SDK's generic request path (the slash-encoding bug rule). The existing `CloudflareBackend` stays m2m100-shaped.
- The HTTP retry/backoff loop (429/5xx, Retry-After honoured, excluded from measured latency) moves out of `QwenMtBackend` into a shared helper so the OpenAI-compatible backend gets the same rate-limit behaviour during sweeps.
- Sweeps (both directions): re-run `qwen-mt-flash` for currency, re-run `qwen-mt-turbo` as a same-session baseline (cheap — 92 segments ≈ cents — and it controls for drift since the 2026-09-24 run), run the three chat models with the `engine` style, and run glm-4.7-flash through `WorkersAiChatBackend` (it is the production fallback; its keys verified working 2026-09-28).
- `scripts/run-cloud.sh` gains `qwen-chat` and `glm` providers plus a `replacement` convenience that runs exactly the retirement sweep in both directions; `all` includes the new providers.
- Thinking models are run **as they are** (production sends no reasoning-suppression parameter to glm; QwenCloud exposes no such switch on these ids) — `reasoning_content`/`reasoning` arrive as separate fields so `content` stays clean. Their token burn is a reported cost/latency finding, not something the harness masks.

## steps

1. Gate (agent-detect reciprocity check), write this plan + companion, commit.
2. Verify keys: QwenCloud probe of all four model ids; Cloudflare token verify + glm-4.7-flash engine-style smoke.
3. Code: `eval/backends.py` (`build_messages`, shared retry helper, `WorkersAiChatBackend`), `eval/run_eval.py` (`engine` style, `cloudflare-chat` backend), `scripts/run-cloud.sh` wiring; README run-cloud notes.
4. Run the replacement sweep both directions; `eval/summarize.py`.
5. Analyse: per-direction ranking, per-category chrF with emphasis on `do-not-translate`/entity categories, latency (5-minute-cron budget), token cost from API usage where visible, rate-limit behaviour observed during the sweep.
6. Docs: regenerate `results/results.md`; dated `docs/model-survey.md` section on the retirement + replacement evaluation; fix every spot that presents qwen-mt-turbo as the current choice.
7. Commit code, results, and docs separately (conventional commits, SSH-signed).

## deviation log

- (resumed 2026-09-29 after an interrupted execution) The earlier session completed only the id→en half (qwen-mt-flash/turbo re-runs, qwen-flash, qwen3.6-flash); this session ran the missing en→id half (qwen-flash, qwen3.6-flash, qwen3.5-flash, qwen-mt-flash re-run, glm-4.7-flash) plus the two id→en runs the interruption dropped entirely (qwen3.5-flash, glm-4.7-flash).
- `_post_chat_retry` (eval/backends.py) originally retried only HTTP 429/5xx; a qwen3.5-flash request stalled past the 300 s socket timeout mid-sweep and crashed the run with a raw TimeoutError. The helper now retries transient read timeouts / URLErrors with the same backoff (it caught two more stalls in the completed qwen3.5-flash id→en sweep).
- No 429s were hit by any sweep at sequential per-segment pacing; the rate-limit behaviour finding is therefore "caps never approached", not "429s observed".
