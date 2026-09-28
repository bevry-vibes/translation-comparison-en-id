# prompts: qwen-mt-turbo retirement replacement

Companion: [1790619433111-qwen-mt-turbo-retirement-replacement.md](./1790619433111-qwen-mt-turbo-retirement-replacement.md)

Generating model: GLM 5.3 Flash (agent-detect id `zcode-zcode-glm53flash`). Session date: 2026-09-28.

Redactions: none needed — the task prompt carries no secrets; keys live only in the gitignored `.env`.

## prompt 1

You are working in /home/balupton/Projects/vibes/translation-comparison — a stdlib-first benchmark harness for Indonesian ⇄ English translation models (read its README.md, docs/model-survey.md, docs/indonesian-notes.md, and results/results.md first). You may edit files ONLY inside that repo. Commit your work there (conventional commits, SSH-signed via `git commit -S`; the repo's history shows the convention; if signing fails intermittently, retry once, then commit --no-gpg-sign and say so in your report). Do NOT touch the patipeaceplace repository.

## Why (context)

The production site's translator (patipeaceplace) used **qwen-mt-turbo** as its primary model — that model is **retired on 2026-10-10** (its model page states it twice; 60 RPM / 100K TPM, not raisable, not in paid plans). The site needs a replacement chosen by YOUR benchmark, not vibes. Production constraints that define "good": id↔en both directions; short web-content segments; **do-not-translate personal names must survive** (the curated set covers entities — per-category chrF matters, not just corpus averages); runs on a 5-minute-cron budget so speed matters; the fallback provider is Cloudflare Workers AI glm-4.7-flash.

## Verified facts

- qwen-mt-turbo: retiring 2026-10-10. qwen-mt-flash: NO retirement notice on its model page — it is the surviving MT candidate (and the prior benchmark's best en→id: chrF 87.26; id→en 69.9 vs turbo's 71.77). Both are 60 RPM / 100K TPM.
- The rate-limit docs list the models that SUPPORT console rate-limit raises: qwen3.6-plus, qwen3.6-flash, qwen3.5-flash, qwen3.5-plus, qwen-flash, and others — chat models only, no qwen-mt models.
- The repo already has: a Qwen-MT adapter (translation_options on https://maas.qwencloudapi.com/compatible-mode/v1/chat/completions), a generic OpenAI-compatible adapter (base_url configurable), Workers AI and Kagi adapters, the built test set (data/testset.jsonl), prior results for the full qwen-mt family + Kagi + Workers AI + local models.
- API keys: the repo's .env (QWENCLOUD_API_KEY, Cloudflare account/token, KAGI_SESSION) — verify they exist and work before running.

## Task

1. **Add chat-model benchmarking for the replacement candidates**: the QwenCloud compatible-mode endpoint with regular chat models — qwen-flash, qwen3.6-flash, qwen3.5-flash (the raisable-rate-limit set) — via the existing OpenAI-compatible adapter or a small dedicated adapter, using a translation prompt that mirrors production (a translation-engine system instruction, output only the translation; the plugin's exact wording is in patipeaceplace's plugins/auto-translate/src/providers.mjs glmTranslate — mirror its contract). Prompt style: reuse `generic` or add a named style, your call, document it.
2. **Run the sweeps, both directions (id→en and en→id), over the existing test set**: qwen-mt-flash (re-run for currency), the three chat models, and glm-4.7-flash on Workers AI if its keys work (it is the production fallback). Re-run qwen-mt-turbo only if cheap (it is the baseline being retired; its prior results may suffice — your call, justify).
3. **Update the docs**: results/results.md (regenerated table), docs/model-survey.md (a section on the retirement + the replacement evaluation, dated, with the production constraints), and anything else that references qwen-mt-turbo as the current choice.
4. **Recommend**: per direction, the winning replacement with numbers (chrF++/BLEU + per-category, especially the entity/do-not-translate category), rate-limit properties (raisable or not), cost at the site's volume (a few hundred segments/hour worst case), and the runner-up. Note explicitly if a chat model beats the surviving qwen-mt-flash, or if qwen-mt-flash wins despite the rate limits.
