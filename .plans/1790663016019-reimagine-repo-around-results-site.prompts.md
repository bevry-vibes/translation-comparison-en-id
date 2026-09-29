# Prompts companion — 1790663016019-reimagine-repo-around-results-site

- Session: `sess_4f8eccfd-f58c-4bb2-9cb6-9487067f557b` (ZCode desktop, harness `zcode` 3.14.3, provider `account:zai-individual-coding-plan`)
- Model, as the harness reports it: `GLM-5.3-Flash` (zcode-zcode-glm53flash)
- Date: 2026-09-29 (plan written ~06:23 UTC)
- Provenance: the session began from this repo at commit `e0e740e`. Per plans.md, timestamps are
  recorded only where actually observed; individual prompts below carry no fabricated times.
  Prompts 3 arrived mid-turn; all others were standalone turns, in the order shown.

## The prompts

**1.** (session-opening prompt)

> Push and commit anything local. Secondly, qwencloud is a PIA in terms of their billing. I've added api keys to .env for opencode, openrouter, cline, and deepseek. Evaluate all their open-weight models that would be appropriate. To do this, fetch their available models, and consider what to use. It is fine to use their qwen models, it is just qwencloud we have an issue with. But we need to plan for a successor to qwen-mt-turbo.
>
> Secondly, for the results.md the current format is unreadable, change it to tables where we can compare the results of everything. Or better yet, generate a html file that better showcases the results.  Use shacdn/ui for it. Serve it via cloudflare on workers.dev or whatever it is. This can completely replace the markdown results.
>
> You can use subagents.

**2.**

> The zcode violation is a known exception, see agent-detect's issue tracker.

**3.** (mid-turn, during the first deploy)

> serve to `translation-comparison.bevry.workers.dev`, delete the `translate-comparison-...`

**4.**

> Actually, serve to `translation-comparison-en-id.bevry.workers.dev` to match the repo

**5.**

> Allow "Category chrF" to be viewed for the model when selecting the model in the table above.
>
> How come the modal when clicking a model is so thing?

**6.**

> rate limit hit, it is now reset

**7.**

> does it make sense to merge Masked-name token survival into the top table and the modal? - do not implement, just answer

**8.**

> okay then, where there is en-id and id-en buttons on the top left of the first table, add a similar toggle on the top right to make the table columsn change into what token survival is measuring, this way the order of the rows can stay the same, and we no longer undesirably collapse the diretction of the language pairs

**9.**

> allow sorting of the rows by clicking the columns
>
> move the right toggle and the left toggle to be the same "row" level
>
> remove the bottom table, it is not needed anymore, it is redundant

**10.**

> Okay, this is great. The html is superior to our result.md. Make sure agents that are referring to this repo can comprehend the results, and understand how to interpret the results. As other agents seem to misunderstand the new structure.
>
> Also consider updating the html page to include segments to replace the other .md files.
>
> Do not implement, just propose something in chat.

**11.**

> we also need agent guidance on how to replicate the successes, e.g. the prompts

**12.**

> Okay great, any thing else reimangine about this repo, redo for code quality and to remove redundancy, to improve legibility etc; removal of tech debt, old conventions, etc.
>
> The indonesian notes is great, preserve that.

**13.** (prompt that initiated this plan)

> all good, do a new plan - do not care about backwards compat

**14.** (plan amendment: parity in, "new runs" bullet questioned)

> > Rebalancing the en→id test set to segment parity with id→en (separate decision — invalidates historical comparability).
> do it, it was meant to be included in ignore b/c
>
> > New model runs beyond a smoke pass; the 2026-09-29 sweep data is the dataset this refactor is verified against.
> what is this?

**15.** (plan amendment: keep the Deno client as a proof, not a measurement source)

> 1. good
> 2.ok yeah, out of scope
>
> keep deno client, but just prove it works, don't use it for measurements - as some consumers of this work with ts instead of python

**16.** (plan amendment: Deno-only toolchain)

> I've decided, drop all the python code and use deno code instead. We do not have to regenerate results, as there should be parity.
>
> The deno and wrangler impl should be similar to this plan from this other project
> agent-detect/.plans/1790666509289-website-registry-site.md
>
> How will this impact this work? Were we using Cloudflare Worekrs or Cloudflare Pages or something else? Were we using node.js for the website?

**17.**

> Do it, revise our plan to incorporate that, and yeah to be explicit drop node.js drop python.

## Steering notes

- Prompts 7–9 designed the current table UX (survival as a column mode joined by model, stable
  chrF row order, sortable columns, one toggle row, survival card removed); the plan preserves
  that UX rather than redesigning it.
- Prompts 10–12 scoped the agent-guidance layer, the prompts/replication guidance, and the
  tech-debt agenda; prompt 12 explicitly preserves `docs/indonesian-notes.md`.
- Prompt 13 set the no-backwards-compatibility constraint and requested this plan.
- Prompt 14 pulled en→id test-set parity into scope as phase 5 (archive v1 en→id results,
  re-measure the same candidate set on the balanced side) and asked what the "new model runs"
  out-of-scope bullet meant (answered: the refactor phases need no benchmarking runs —
  committed data plus a smoke pass verifies them; only the parity phase re-runs models, and it
  re-runs the existing candidate set, adding no new candidates).
- Prompt 16 asked for the impact of dropping python for deno (answered: Workers-with-assets stays, node was only the build toolchain, committed results stand); prompt 17 approved the pivot, explicitly dropping node.js and python, mirroring agent-detect's website plan.
- Prompt 15 confirmed the parity phase and the out-of-scope production-switch, and reversed the
  Deno-harness deletion: `eval/deno/` stays as a kept-working TypeScript consumer path (smoke
  proven, never a measurement row source) because some consumers work in TS rather than python.
