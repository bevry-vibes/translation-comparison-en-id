# Identity-persistence spike (2026-09-29)

**Question:** can we fix weak models' masked-name failures by changing the
*masking scheme*, instead of blacklisting the models? (Directive: "improve our
strategy rather than blacklisting".)

**Harness:** [`eval/deno/spike_identity.ts`](../eval/deno/spike_identity.ts) —
translates the 10 masked-identity segments (`data/masked.jsonl`) under six
schemes and requires *every* marker occurrence to survive, in order, with no
renumbering, and every name to come back after restoration. Worker pool with
`--concurrency` bounded by an `--rpm` start-rate gate; 429 `Retry-After` is
honoured.

## Schemes

| id | token | clause |
| --- | --- | --- |
| `pua` | `` (private-use U+E000..U+E001) | the production `ENGINE_PRESERVE_SYSTEM` clause, verbatim |
| `brackets` | `[[n]]` | same preservation contract |
| `curly` | `{{n}}` | same |
| `identifier` | `NME{n}X` | same |
| `xml` | `<name-n>` | same |
| `real` | no masking | names inline; judged on the names themselves |

## Results

Strict verdicts — every (run, segment) pair must survive. Failures are
transcription errors of the marker itself, not paraphrases.

| model (provider, direction) | pua | brackets | curly | identifier | xml | real |
| --- | --- | --- | --- | --- | --- | --- |
| `@cf/zai-org/glm-4.7-flash` (CF, id→en, 2 runs) | **14/20 FAIL** | 20/20 | **19/20 FAIL** | 20/20 | 20/20 | 20/20 |
| `@cf/zai-org/glm-5.3-flash` (CF, en→id, 1 run) | **8/10 FAIL** | 10/10 | 10/10 | 10/10 | 10/10 | 10/10 |
| nemotron (CF, id→en, 2 runs; earlier run) | **14/20 FAIL** | 20/20 | 20/20 | 20/20 | 20/20 | 20/20 |
| `deepseek/deepseek-v4-flash` (OpenRouter, id→en, 2 runs) | 20/20 | 20/20 | 20/20 | 20/20 | 20/20 | 20/20 |
| `google/gemma-4-31b-it` (OpenRouter, id→en, 1 run) | 10/10 | 10/10 | 10/10 | 10/10 | 10/10 | 10/10 |
| `qwen/qwen3-235b-a22b-2507`, `z-ai/glm-5`, `moonshotai/kimi-k2.5` | **blocked** — OpenRouter account hit 0 credits mid-sweep (HTTP 402); their only failures were 402s, and the benchmark already measures them at 10/10 survival on `pua`. Re-confirm on ASCII after a top-up. | | | | | |

## Mechanism

- **Private-use characters break tokenizers.** GLM's tokenizer cannot emit
  U+E000/U+E001: the models render `\uE000n\uE001` as bare digits
  (`"1 leads the weekly community meeting…"`) or invent pseudo-tags
  (`"<1> and <3> suggest…"`, `"<0> opens peace workshop registration…"`) —
  restoration then finds nothing. This hits glm-4.7-flash, glm-5.3-flash and
  nemotron; it is a *scheme* failure, not a competence failure.
- **Curly braces are flaky** for GLM (one `{{1}}` dropped across 20) — the
  template-placeholder habit. Not fatal, but why carry the risk?
- **ASCII markers are safe everywhere measured.** `[[n]]`, `NME{n}X` and
  `<name-n>` were survived perfectly by every model that completed the sweep,
  including the two models that fail `pua`.
- **The explicit preservation clause is doing real work.** DeepSeek —
  disqualified on benchmark survival (7/10 id→en) — passed *all six schemes*
  20/20 under the spike, whose `pua` clause is verbatim
  `ENGINE_PRESERVE_SYSTEM`. The spike could not reproduce the benchmark's
  drops; treat DeepSeek's disqualification as *unconfirmed* until a fresh
  benchmark masked run reproduces it (candidate causes: direct-API vs
  OpenRouter routing, the sweep's lower `max_tokens`, or batch intermittency).

## Roll-in results (2026-09-29, later the same day)

The benchmark migrated to `[[n]]` on the strength of the spike: the masked test
set (`build_masked_testset.ts`), the `ENGINE_PRESERVE_SYSTEM` clause, and the
survival scorer (`token_survival.ts`). The PUA-era masked results and the old
test set live in `results/archive/masked-pua-2026-09-29/`. Two harness bugs
were fixed in the same stroke:

- `run_eval.ts`'s `cloudflare-chat` path hardcoded the `engine` prompt while
  recording `--prompt-style` in the metadata — every CF `masked-preserve` run
  before this date actually ran without the preservation clause;
- the sweeps sent `--max-tokens 1024`, which reasoning models spend on thinking
  before translating — truncation dropped trailing tokens and is the most
  likely cause of DeepSeek's original masked failures (the sweeps now send
  4096, matching the spike).

Official survival re-measurement on the new scheme (`engine-preserve`, strict):

| model (provider) | id→en | en→id |
| --- | --- | --- |
| `@cf/zai-org/glm-4.7-flash` | **9/10** — one intermittent `[[1]]` drop (masked-iden-06) | **10/10** |
| `@cf/zai-org/glm-5.3-flash` | **10/10** | **10/10** |
| `deepseek-flash` (official API) | **10/10** | **10/10** |
| `deepseek-v4-pro` (official API) | **10/10** | **10/10** |

Read-out: glm-5.3-flash and both DeepSeek models are fully fixed — DeepSeek's
disqualification does not survive the scheme change, and with 77.10 chrF
id→en it returns to contention pending the full re-sweep. glm-4.7-flash is
viable but not spotless (1 drop in 20). The OpenRouter models
(qwen3-235b-a22b-2507, glm-5, kimi-k2.5, gemma-4-31b-it) await re-measurement
until the account is funded; gemma-4-31b-it's spike sweep (10/10 all schemes)
is the only OR-side brackets evidence so far.

## Decision

1. **Switch the masked-identity scheme from PUA tokens to ASCII brackets
   `[[n]]`** — shortest form, never observed to fail, fixed both GLM models and
   nemotron outright. `<name-n>` is the runner-up; drop `{{n}}` from
   consideration.
2. Apply to the production masking (patipeaceplace `protectTerms`) and to this
   benchmark (`build_masked_testset.ts` token + the
   `ENGINE_PRESERVE_SYSTEM` clause), then **re-measure token survival for all
   models** once OpenRouter credits are topped up.
3. Re-verify DeepSeek's masked-survival failures with a fresh benchmark run
   before treating them as model truth.

## Replication

```bash
set -a; source .env; set +a
# full matrix, cloudflare (paid-plan models: add --rpm 18)
deno run --allow-net --allow-env --allow-read --allow-write \
  eval/deno/spike_identity.ts --model '@cf/zai-org/glm-4.7-flash' \
  --base-url https://ignored --api-key-env CLOUDFLARE_API_TOKEN \
  --cloudflare-chat --direction id-en --runs 2 --concurrency 6
# openrouter (add --max-tokens 512 when the account runs low on credits)
deno run --allow-net --allow-env --allow-read --allow-write \
  eval/deno/spike_identity.ts --model 'deepseek/deepseek-v4-flash' \
  --base-url https://openrouter.ai/api/v1 --api-key-env OPENROUTER_API_KEY \
  --direction id-en --runs 2 --concurrency 6
```

Note for future archaeology: an earlier run of this spike reported 0/20
"empty content (finish_reason=stop)" for every model — that was a harness bug
(reading `choices[0].content` instead of `choices[0].message.content`), not
model behaviour, and it is what the 2026-09-29 recommendations above used to
say before this spike corrected the record.
