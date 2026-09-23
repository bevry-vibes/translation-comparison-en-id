# plan: add Cloudflare Workers AI + Kagi Translate as hosted translation backends

Assisted-by: ZCode · GLM 5.3 Flash <zcode-zcode-glm53flash@local>

Companion: [1790142658653-cloudflare-kagi-cloud-benchmarks.prompts.md](./1790142658653-cloudflare-kagi-cloud-benchmarks.prompts.md)

## context

The harness in `eval/` benchmarks local id↔en models through duck-typed backends that expose `.translate(texts, src, tgt) -> Result` (`eval/backends.py`). `eval/run_eval.py` drives them by flags. `eval/metrics.py` scores BLEU/chrF. `eval/memguard.py` holds the run lock and the RAM fit check. `eval/summarize.py` renders `results/results.md`. No cloud backend exists yet.

## decisions (user-confirmed)

- The Cloudflare sweep lists every model Cloudflare tags "Translation" in their catalog: `@cf/meta/m2m100-1.2b` and `@cf/ai4bharat/indictrans2-en-indic-1B`. The sweep enumerates the tag through the API at run time; it does not hardcode the list. No prompted-LLM sweep.
- The Python backend uses the official `cloudflare` SDK. A like-for-like Deno harness uses the npm `cloudflare` SDK.
- Kagi Translate is the second cloud provider. It uses our own client, `github.com/bevry-vibes/kagi-translate-client`. The client ships a Python (uv) CLI and a Deno CLI with the same interface. The two runtime installs form the Kagi like-for-like pair.
- Cloud backends set `loads_local_model = False`. `run_eval.py` then skips the RAM fit check only for them. The run lock still applies.
- Secrets live only in the gitignored `.env`: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `KAGI_SESSION`, `KAGI_CLIENT_REPO`. No committed file carries the literal account ID, the token, or the cookie. The prompts companion redacts them inside otherwise-verbatim prompts.
- Workers AI facts: run endpoint `POST /client/v4/accounts/{account}/ai/run/{model}`, envelope `{result, success, errors}`. m2m100 input `{text, source_lang, target_lang}` returns `result.translated_text`. IndicTrans2 returns `result.translations[]`. Translation limit is 720 requests/min. The free tier grants 10k neurons/day; one 78-segment run costs about 100–500 neurons.
- AI Gateway vs Workers AI: Workers AI is the inference platform (hosted models, neuron billing). AI Gateway is an optional proxy in front of any provider; it adds analytics, caching, rate limits, and fallbacks. Direct calls need no gateway. Routing through one later changes only the URL and headers, not the benchmark logic.

## steps

1. Gate and process: run the agent-detect reciprocity check; write this plan and its companion; commit.
2. Upstream: reference the `python.md` skill of bevry-vibes/skills from this repo's `AGENTS.md` through a local `python.md` with this project's tweaks.
3. Verify access: token verify; enumerate the Translation-tagged models; smoke m2m100 id→en; smoke IndicTrans2 en→id (expected unsupported — it covers English and the 22 Indic languages; Indonesian is not one).
4. Smoke the Kagi client in both runtimes (`uv run kagi_translate.py`, `deno run kagi_translate.ts`); confirm the JSON output shape and the `id` language code.
5. Python: `requirements.txt` with `cloudflare` (uv venv bootstrap, never bare pip); `CloudflareBackend` (lazy SDK import, response-shape normalisation) and `KagiBackend` (stdlib `subprocess` to the client CLI, `--kagi-runtime {python,deno}`); wire `run_eval.py` (`--backend cloudflare|kagi`, `--account-id`, env fallbacks, fit-check skip).
6. Deno: `eval/deno/run_eval.ts` + `eval/deno/metrics.ts` against the npm `cloudflare` SDK; same testset, same metrics formulas, same results JSON schema (backend `cloudflare-deno`); same pid lock.
7. Orchestrate: `scripts/run-cloud.sh [cloudflare|kagi|both] [id-en|en-id|both]`.
8. Docs: README setup and usage; `docs/model-survey.md` hosted sections for Workers AI and Kagi; scope and runtimes tables.
9. Runs: m2m100 both directions through the Python backend, then the Deno harness; IndicTrans2 per smoke outcome; Kagi both directions through both runtimes; `eval/summarize.py`; survey tables; commit results with the code.
10. Report: chrF and latency table across local, Workers AI, and Kagi; deployment recommendation; AI Gateway explanation.

## deviation log

- The agent-detect reciprocity gate returned `not reciprocal` (exit 10) for the `zcode` harness and provider rules. The maintainer classifies this verdict as an open bug in the rule data; the discussion is tracked upstream as https://github.com/bevry-vibes/agent-detect/issues/3, which requests a per-combo exceptions mechanism because the verdict is effectively permanent for this combo. The maintainer directed the session to continue. This entry records that direction; the gate output is not altered or bypassed.
- The upstream `python.md` skill already existed, so step 2 shrank to the AGENTS.md reference and the local tweaks file.
