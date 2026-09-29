Assisted-by: ZCode · GLM 5.3 Flash <zcode-zcode-glm53flash@local>

Prompts companion: [.plans/1790663016019-reimagine-repo-around-results-site.prompts.md](.plans/1790663016019-reimagine-repo-around-results-site.prompts.md)

# Reimagine the repo around the results site (no backwards compatibility)

## Context

The shadcn/ui results site (https://translation-comparison-en-id.bevry.workers.dev, Worker
`translation-comparison-en-id`) is now the canonical surface for measured results. It already
replaced `results/results.md` (deleted), survived a visual acceptance pass, and gained a
Quality | Token survival toggle with per-model category chrF and failure dialogs. What remains
is scattered: interpretation knowledge lives in prose, replication knowledge (prompts, request
shapes, gateway flags) lives in code and survey paragraphs, two markdown result surfaces still
exist, and several code paths duplicate each other. Agents arriving at this repo misread it.

The user approved a free redesign: **backwards compatibility is explicitly not a concern** —
file names, result labels, data shapes, CLI flags and scripts may all break.

Confirmed decisions (session 2026-09-29):

- **The site is the canonical rendered surface for measured results.** Repo markdown stays for
  narrative only. `docs/indonesian-notes.md` is preserved untouched (user: "The indonesian
  notes is great, preserve that").
- Main table has direction tabs (left) and a Quality | Token survival toggle (right) on one
  row; every column sortable; the standalone survival card is gone; failure dialogs live in the
  table. This UX is kept, not redone.
- Agent guidance must cover **interpretation** (what the numbers mean, what is comparable) and
  **replication** (verbatim prompts, request shapes, flags) — "agents that are referring to
  this repo [must] comprehend the results, and understand how to interpret the results"; "we
  also need agent guidance on how to replicate the successes, e.g. the prompts".
- Retire: duplicate client-parity result rows, `results/token-survival.md`,
  stale result generations from older test sets. The **Deno harness stays** but is repositioned
  (approved 2026-09-29): a kept-working TypeScript consumer path — proven with a smoke run, never
  used for measurement rows — because "some consumers of this work with ts instead of python".
- Deduplicate: Cloudflare backends, shell scaffolding, provider metadata (one manifest),
  runs-table column definitions.
- `docs/model-survey.md` restructured for legibility; its tables frozen as point-in-time
  snapshots (the site carries live numbers going forward).
- **en→id test-set parity is in scope** (approved 2026-09-29: "do it, it was meant to be
  included … do not care about backwards compat"): grow the en→id side to segment parity with
  id→en (~78 each), archive the 14-segment v1 en→id results as incomparable, and re-measure the
  existing 2026-09-29 candidate set on the balanced set. Historical en→id comparability is
  explicitly sacrificed — that is the point of no-back-compat.
- Reciprocity gate: the live combo `zcode-zcode-glm53flash` is excepted by the policy owner per
  [bevry-vibes/agent-detect#3](https://github.com/bevry-vibes/agent-detect/issues/3); trailers
  are generated via agent-detect's documented from-identity mode.

## Steps

### 0. Plan bookkeeping

1. Commit this plan + its prompts companion (`docs(plans)`), push. (This step.)

### 1. Single scoring path and result hygiene

2. **`eval/token_survival.py` → pure scoring library + JSON CLI.** Keep
   `score_segment`/`score_run` as the single implementation; replace the markdown renderer with
   a `--json` output that `build_site_data.py` consumes. Delete `results/token-survival.md` and
   the md-rendering code. The site becomes the only rendered survival surface, computed once
   (today `build_site_data.py` re-scores masked runs through a second entry path — collapsed).
3. **Prune and rename results (no back-compat).** Move stale generations to
   `results/archive/`: `generic-qwen3-1.7b-*` (30-pair run against a dead test set) and the
   client-parity duplicates `*-deno.json` (Cloudflare Deno leg) and `kagi-deno-*`. Rename
   `kagi-py-*` → `kagi-*` (the python client is the canonical Kagi measurement). Update
   `KAGI.md`-style references accordingly.
4. **Reposition `eval/deno/run_eval.ts` as the TypeScript consumer proof.** Keep the harness;
   verify it still works with a smoke run; remove it from the measurement sweeps
   (`scripts/run-cloud.sh` stops producing `*-deno` rows; its README/results/README description
   says "kept-working client proof for TS consumers, not a measurement source"). Archive the
   `*-deno` measurement rows per step 3. `KagiBackend` keeps its `--kagi-runtime deno` option
   (same TS-consumer rationale) while the `kagi-deno` parity rows archive.

### 2. Agent guidance layer

5. **`results/README.md` — the interpretation + replication contract**, written for agents:
   artifact map (`results/*.json`, `site/src/data/results.json`, `results/archive/`), field
   dictionary for both JSON shapes, comparability rules (78 vs 14 segments per direction;
   survival comes from the separate 10-segment masked set joined by model; restored chrF is a
   secondary hint; hosted s/sentence includes network round trips; prompt styles and their
   meanings), the replication checklist (commands per provider family, gateway reasoning
   switches, `--max-tokens 1024` for OpenRouter's credit preflight, Cline `{"data":…}`
   envelope, temperature 0, sequential pacing, warmup-before-timing), the masking protocol
   (`U+E000 + 0-based longest-form-first glossary index + U+E001`, restore-then-assert), and
   the archive rule.
6. **AGENTS.md pointers**: "read `results/README.md` before interpreting or extending results;
   `site/src/data/results.json` is the joined dataset; the site is the canonical rendered
   surface — redeploy after new runs; do not reintroduce markdown result files." Update the
   measured-results rule (commit `results/*.json` + refreshed site data; no md).
7. **`site/public/llms.txt`**: static agent-facing summary pointing at the site sections, the
   repo, the survey, and `results/README.md`.

### 3. Site: methodology, prompts, recommendation, failures

8. **Generated prompts segment.** `eval/build_site_data.py` imports the prompt builders from
   `eval/backends.py` (single source of truth) and emits `prompts.json`: template name →
   verbatim system/user text, the qwen-mt `translation_options` shape, and per-provider request
   shapes. The site renders a "Prompts & replication" methodology segment with copy buttons.
   Nothing hand-copied — the rendering is generated from the code that produced the numbers.
9. **"Replicate this run" block in the run dialog.** Each run row gains a replication object
   (provider manifest + prompt_style → endpoint, request shape, verbatim prompt, ready-to-run
   command with gateway flags filled in). The dialog becomes a self-contained recipe.
10. **"Current recommendation" segment** sourced from a small structured file
    (`docs/recommendation.json`): primary (`qwen/qwen3-235b-a22b-2507` on OpenRouter with
    `engine-preserve`), premium alternative (`z-ai/glm-5`), token-safe failover
    (`moonshotai/kimi-k2.5` / `google/gemma-4-31b-it`), the disqualifications (DeepSeek V4
    fails masked survival; glm-5.3-flash fails en→id survival; glm-4.7-flash 0/10), cron-budget
    caveat, and the supersession history. Repo docs and the site render the same file.
11. **All-failures segment**: an expandable per-segment failure listing across all masked runs
    (the site's replacement for what `token-survival.md` uniquely provided).

### 4. Code quality

12. **Cloudflare backends**: extract a shared base (SDK load, warmup, run path, envelope
    checks) for `CloudflareBackend` + `WorkersAiChatBackend`.
13. **`scripts/lib.sh`**: .env loading, uv bootstrap, direction loops, site-data refresh tail;
    `run-cloud.sh`, `run-providers.sh`, `run-bench.sh` consume it.
14. **Provider manifest** (`eval/providers.json` or a python dict): prefix, label, base URL,
    key env var, reasoning switch, envelope quirk. `run_eval.py` grows a backend factory
    registry; `build_site_data.py` and `run-providers.sh` read the same manifest instead of
    hardcoding prefix maps and model lists.
15. **`runs-table.tsx`**: unify the Model/Prompt column definitions across quality/survival
    modes.
16. **README restructure**: site-first results story; quick start → harness → site (build +
    deploy) → providers → docs; no references to retired files.

### 5. en→id test-set parity (approved 2026-09-29)

17. **Balance the test set.** Extend `eval/build_testset.py` to build both directions at
    segment parity (~78 each): the en→id side gains FLORES-101 devtest + Tatoeba segments
    alongside its 14 curated probes; the id→en side must regenerate byte-identical segments
    (verified by diffing ids/sources against the current `data/testset.jsonl`) so the existing
    id→en results stay valid. Version the output as `data/testset-v2.jsonl` and keep the
    test-set name recorded in every run payload.
18. **Archive the v1 en→id results.** Move every live `*-enid.json` with `pairs == 14` to
    `results/archive/testset-v1/` — 14 curated probes cannot rank against 78-segment legs. The
    id→en results stay live. The masked set is already 10/10 balanced and is untouched.
19. **Re-measure the existing candidate set on the new en→id side** (same models as the
    2026-09-29 sweep — no new candidates): the OpenRouter + DeepSeek legs
    (`scripts/run-providers.sh en-id`), the QwenCloud `qwen` + `qwen-chat` legs and glm
    (`scripts/run-cloud.sh`), and Kagi. Sequential behind the memguard run lock; kicked off in
    the background while phases 2–4 proceed. Wall clock is a few hours of unattended API calls;
    cost is pennies-to-a-dollar at these segment counts.
20. Rebuild site data; en→id tables become direction-comparable;
    `results/README.md` documents test-set v2 and the archive layout.

### 6. Survey restructure

21. `docs/model-survey.md`: "Current recommendation" box at the very top (mirroring
    `docs/recommendation.json`); measurement tables explicitly labeled point-in-time snapshots
    (frozen — live numbers live on the site); history sections ordered with their supersession
    links intact. Content otherwise preserved verbatim.

### 7. Deno-only toolchain — Python dropped, Node dropped (amendment, approved 2026-09-29)

Modelled on [agent-detect's website plan](../../agent-detect/.plans/1790666509289-website-registry-site.md):
Deno is the only language and the only toolchain. Committed results do not regenerate — the
Deno harness is parity-verified against them by construction and spot-check.

22. **Harness port.** `eval/deno/run_eval.ts` is promoted to *the* harness: port the remaining
    backends from `eval/backends.py` (OpenAI-compat with reasoning switches, `max_tokens` and
    the Cline `{"data":…}` envelope; qwen-mt `translation_options`; Kagi client; Ollama), the
    `engine`/`engine-preserve` prompt builders, the empty-content guard, both test sets, and a
    port of the memguard **run lock** (one benchmark at a time). New
    `eval/deno/token_survival.ts` replaces `eval/token_survival.py` (writes
    `results/token-survival.json`). Metrics stay the existing Deno implementations
    (parity-verified against sacrebleu when the client-parity rows were run).
23. **Site pipeline.** Adopt the agent-detect layout: `site/deno.json` tasks (`data`, `build`,
    `check`, `deploy`), `site/tools/build_data.ts` replaces `eval/build_site_data.py` (reads
    `results/*.json`, `results/token-survival.json`, `docs/recommendation.json`; the prompt and
    provider manifests port to TS), and `site/worker/index.ts` adds JSON routes
    (`/index.json`, `/runs/<label>.json`, `/llms.txt`) with `env.ASSETS.fetch` fallback in
    `wrangler.jsonc`. `site/public/data/` becomes generated-at-deploy (gitignored); the
    committed `site/src/data/results.json` convention ends.
24. **Node is not a project runtime.** Tasks invoke the npm tooling through Deno's npm
    compatibility (`deno run -A npm:vite build`, `deno run -A npm:wrangler deploy`); if a
    package will not run under Deno, fall back to `deno task` executing
    `node_modules/.bin/<tool>` and record it in the plan — but no `.js`/`.mjs` source, no
    `node` invocations, and no python anywhere.
25. **Deletions.** `eval/*.py`, `eval/memguard.py` (after the lock port), `requirements.txt`,
    `.venv`, the python branches of `scripts/lib.sh`, `python.md`; sweeps become `deno task`
    calls. AGENTS.md drops the python skill reference and gains the Deno conventions.
26. **Parity gate before deletion.** One smoke segment per backend through the Deno harness
    must produce the same shape (and, for a model already measured, a matching score within
    metric tolerance) as the committed Python-era results; only then delete.

### 8. Verify and ship

27. Browser verification pass over the deployed site: tabs, both modes, sorting, sample and
    failure dialogs, the recommendation/prompts/replication/failures segments, and the new JSON
    routes.
28. An agent-comprehension read-through: follow AGENTS.md → README → results/README.md → site
    as a fresh agent would, and fix anything still ambiguous.
29. Commits per logical chunk (conventional, trailer, 1Password-signed), push, deploy.

## Out of scope

- Switching the production translator (patipeaceplace) to the recommended successor; this repo
  only measures and recommends.
- Introducing new models or providers: the parity re-runs (phase 5) re-measure the existing
  2026-09-29 candidate set on the balanced test set; no new candidates join. (The refactor
  phases themselves are verified against committed data plus one smoke pass — they require no
  benchmarking runs at all.)
