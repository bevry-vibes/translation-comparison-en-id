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
- Retire: the Deno harness, duplicate client-parity result rows, `results/token-survival.md`,
  stale result generations from older test sets.
- Deduplicate: Cloudflare backends, shell scaffolding, provider metadata (one manifest),
  runs-table column definitions.
- `docs/model-survey.md` restructured for legibility; its tables frozen as point-in-time
  snapshots (the site carries live numbers going forward).
- The en→id test-set asymmetry (78 vs 14 segments) is real but **out of scope**: rebalancing it
  invalidates historical comparability and is a separate user decision.
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
4. **Delete `eval/deno/`** and the deno invocation in `scripts/run-cloud.sh`; simplify
   `KagiBackend` (drop `--kagi-runtime` and the deno path — python only).

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

### 5. Survey restructure

17. `docs/model-survey.md`: "Current recommendation" box at the very top (mirroring
    `docs/recommendation.json`); measurement tables explicitly labeled point-in-time snapshots
    (frozen — live numbers live on the site); history sections ordered with their supersession
    links intact. Content otherwise preserved verbatim.

### 6. Verify and ship

18. Rebuild data flow end to end: `build_testset.py` (unchanged outputs),
    `build_masked_testset.py`, one smoke scoring pass, `build_site_data.py` (now consuming
    survival JSON), `npm run build`, `wrangler deploy`.
19. Browser verification pass over the deployed site: tabs, both modes, sorting, sample and
    failure dialogs, the new methodology/prompts/recommendation segments.
20. An agent-comprehension read-through: follow AGENTS.md → README → results/README.md → site
    as a fresh agent would, and fix anything still ambiguous.
21. Commits per logical chunk (conventional, trailer, 1Password-signed), push, deploy.

## Out of scope

- Rebalancing the en→id test set to segment parity with id→en (separate decision — invalidates
  historical comparability).
- Switching the production translator (patipeaceplace) to the recommended successor; this repo
  only measures and recommends.
- New model runs beyond a smoke pass; the 2026-09-29 sweep data is the dataset this refactor
  is verified against.
